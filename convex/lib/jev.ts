// PST-292: the Jev client (TypeSafe's System One API, docs.typesafe.ai), over fetch:
// the official SDK isn't needed for one POST, and fetch is what Convex's runtime has.
// askJev checks the key, the on/off switch and this month's cap before it calls,
// answers from the cache when the same text was asked before, retries 429 and 5xx
// twice, and records every call in jevRuns. It returns null whenever Jev can't
// answer (off, no key, the cap, a failure), and every caller then does what Nest did
// before Jev. Logs carry the feature and counts only: never the state or the answers.
// The key is TYPESAFE_API_KEY in the Convex env; nothing here logs it or puts it in an error.
import type { ActionCtx, QueryCtx } from '../_generated/server'
import { internal } from '../_generated/api'
import { todayIST } from '../../src/lib/dates'
import {
  estimateTokens, JEV_API, JEV_DEFAULT_CAP, JEV_MODEL, jevCost, jevHash, overCap, readAnswers,
  type Answers, type JevFeature, type JevQuestion, type JevStatus,
} from '../../src/lib/jev'

// For PST-293 (signals from emails and notes) and PST-296 (scoring): the question builders and types.
export {
  choice, duplicateQuestions, noteQuestions, noul, qaQuestions, score, THRESHOLDS, topPick, trigramSimilarity, whoQuestions,
  type Answers, type ChoiceAnswer, type JevFeature, type JevQuestion, type NoulAnswer, type ScoreAnswer,
} from '../../src/lib/jev'

/** Waits before the 2nd and 3rd tries when the API says 429 or 5xx (a retry-after header wins, up to MAX_WAIT_MS). */
const BACKOFF_MS = [1000, 3000]
const MAX_WAIT_MS = 10_000
const TIMEOUT_MS = 20_000

export const hasJevKey = () => !!process.env.TYPESAFE_API_KEY?.trim()

/** The first moment of this month in IST, as epoch ms. */
export const monthStartIST = (now = Date.now()) => Date.parse(todayIST(now).slice(0, 8) + '01T00:00:00+05:30')

/** Settings › AI's Jev row: set up, on, the cap, and this month's calls and spend. */
export async function jevStatus(ctx: QueryCtx, now = Date.now()): Promise<JevStatus> {
  const row = await ctx.db.query('settings').withIndex('by_key', (q) => q.eq('key', 'ai')).unique()
  const ai = row?.key === 'ai' ? row : null
  const runs = await ctx.db.query('jevRuns').withIndex('by_at', (q) => q.gte('at', monthStartIST(now))).collect()
  return {
    connected: hasJevKey(),
    on: ai?.jev ?? true,
    capUsd: ai?.jevCapUsd ?? JEV_DEFAULT_CAP,
    monthUsd: runs.reduce((s, r) => s + r.costUsd, 0),
    calls: runs.filter((r) => r.status !== 'capped' && !r.cached).length,
    cached: runs.filter((r) => r.cached).length,
  }
}

/** Worth scheduling a Jev call from a mutation: a key, switched on, and this month's spend under the cap. */
export async function jevReady(ctx: QueryCtx): Promise<boolean> {
  if (!hasJevKey()) return false
  const s = await jevStatus(ctx)
  return s.on && s.monthUsd < s.capUsd
}

export type JevResult<Q extends Record<string, JevQuestion>> = { answers: Answers<Q>; cached: boolean; costUsd: number; model?: string }
type Outcome = { ok: true; answers: unknown; model?: string; inputTokens: number; outputTokens: number } | { ok: false; reason: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** One POST, tried up to three times on 429, 5xx and network errors. */
async function post(key: string, body: string): Promise<Outcome> {
  let reason = 'unknown'
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
    let res: Response
    try {
      res = await fetch(JEV_API, { method: 'POST', headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' }, body, signal: ctl.signal })
    } catch {
      reason = ctl.signal.aborted ? 'timeout' : 'network'
      clearTimeout(timer)
      if (attempt < BACKOFF_MS.length) await sleep(BACKOFF_MS[attempt])
      continue
    }
    clearTimeout(timer)
    if (res.ok) {
      const j = (await res.json().catch(() => null)) as { model?: string; answers?: unknown; usage?: { input_tokens?: number; output_tokens?: number } } | null
      if (!j) return { ok: false, reason: 'bad_json' }
      return { ok: true, answers: j.answers, model: j.model, inputTokens: j.usage?.input_tokens ?? 0, outputTokens: j.usage?.output_tokens ?? 0 }
    }
    reason = String(res.status)
    if (res.status !== 429 && res.status < 500) return { ok: false, reason }
    if (attempt < BACKOFF_MS.length) {
      const after = Number(res.headers.get('retry-after'))
      await sleep(Number.isFinite(after) && res.headers.has('retry-after') ? Math.min(after * 1000, MAX_WAIT_MS) : BACKOFF_MS[attempt])
    }
  }
  return { ok: false, reason }
}

/**
 * Ask Jev `questions` about `state` (docs.typesafe.ai/primitives). Answers come
 * back keyed by question id and typed by question type. Null when Jev is off, the key
 * is missing, the call would pass this month's cap, or the call failed.
 */
export async function askJev<Q extends Record<string, JevQuestion>>(
  ctx: Pick<ActionCtx, 'runQuery' | 'runMutation'>,
  o: { feature: JevFeature; state: unknown; questions: Q },
): Promise<JevResult<Q> | null> {
  const key = process.env.TYPESAFE_API_KEY?.trim()
  const questions = Object.keys(o.questions).length
  const tag = 'jev feature=' + o.feature + ' questions=' + questions
  if (!key) {
    console.log(tag + ' skipped=nokey')
    return null
  }
  const hash = await jevHash(JEV_MODEL, o.state, o.questions)
  const gate = await ctx.runQuery(internal.jev.gate, { hash })
  if (!gate.on) {
    console.log(tag + ' skipped=off')
    return null
  }
  const run = { feature: o.feature, questions, inputTokens: 0, outputTokens: 0, costUsd: 0 }
  if (gate.cached) {
    const answers = readAnswers(o.questions, gate.cached.answers)
    if (answers) {
      await ctx.runMutation(internal.jev.record, { ...run, status: 'ok', cached: true, ...(gate.cached.model ? { model: gate.cached.model } : {}) })
      console.log(tag + ' status=ok cached=true')
      return { answers, cached: true, costUsd: 0, ...(gate.cached.model ? { model: gate.cached.model } : {}) }
    }
  }
  const estimate = jevCost(estimateTokens(o.state, o.questions))
  if (overCap(gate.spentUsd, estimate, gate.capUsd)) {
    await ctx.runMutation(internal.jev.record, { ...run, status: 'capped', cached: false, reason: 'cap' })
    console.log('jev cap reached feature=' + o.feature + ' spent=$' + gate.spentUsd.toFixed(4) + ' cap=$' + gate.capUsd.toFixed(2))
    return null
  }
  const t0 = Date.now()
  const out = await post(key, JSON.stringify({ model: JEV_MODEL, state: o.state, questions: o.questions }))
  const secs = ' ms=' + (Date.now() - t0)
  if (!out.ok) {
    await ctx.runMutation(internal.jev.record, { ...run, status: 'error', cached: false, reason: out.reason })
    console.log(tag + ' status=error reason=' + out.reason + secs)
    return null
  }
  const costUsd = jevCost(out.inputTokens)
  const answers = readAnswers(o.questions, out.answers)
  const used = { ...run, inputTokens: out.inputTokens, outputTokens: out.outputTokens, costUsd, cached: false, ...(out.model ? { model: out.model } : {}) }
  if (!answers) {
    await ctx.runMutation(internal.jev.record, { ...used, status: 'error', reason: 'bad_answer' })
    console.log(tag + ' status=error reason=bad_answer in=' + out.inputTokens + secs)
    return null
  }
  await ctx.runMutation(internal.jev.record, { ...used, status: 'ok', hash, answers })
  console.log(tag + ' status=ok cached=false in=' + out.inputTokens + ' out=' + out.outputTokens + ' cost=$' + costUsd.toFixed(6) + secs)
  return { answers, cached: false, costUsd, ...(out.model ? { model: out.model } : {}) }
}
