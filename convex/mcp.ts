// PST-276: the Nest MCP server's tools (the protocol is in mcpHttp.ts). The read
// tools are one internal query. Everything else is one internal mutation, and
// every write becomes a Suggestions row (source "agent", named after the key) that
// Dev accepts or dismisses: nothing an agent does changes the raise directly.
// enrich only starts the existing lookup, within its daily cap, and what it finds
// waits for review too. Arguments arrive checked against each tool's JSON Schema
// (src/lib/agents.ts checkArgs). Email bodies are never stored, so never returned.
// PST-279: Ask Nest calls the same read tools (convex/ask.ts), and each read also
// says what it looked at (`seen`), for Ask's "From N investors…" line.
import { v } from 'convex/values'
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { vAgentScope } from './agentsSchema'
import { insertSuggestion } from './suggestions'
import { addMeetingNotes } from './noteReads'
import { sha256Hex } from './lib/agentKey'
import { hasAIKey } from './lib/anthropic'
import { CACHE_DAYS, capLeft, queue } from './lib/enrichQueue'
import { loadRound } from './lib/round'
import { keptFits } from './priority'
import { parseAmount } from '../src/lib/agents'
import { dupKey } from '../src/lib/csv'
import { ladder, RUNG_LABEL, RUNGS } from '../src/lib/close'
import { dayDiff, todayIST } from '../src/lib/dates'
import { fieldLabel, firmDomain } from '../src/lib/enrich'
import { addressesOf, contactSignals, DAY_MS, dayOf, domainOf, GENERIC_DOMAINS, isOurs, normEmail, timeOf } from '../src/lib/google'
import { dayLabel } from '../src/lib/investorView'
import { KIND_LABEL, linkState } from '../src/lib/materials'
import { money } from '../src/lib/money'
import { dueDate, dueList, lastContact, quietFor, quietList } from '../src/lib/pipeline'
import { priorities } from '../src/lib/priority'
import { ACTIVE, LABEL, STAGE_KEYS, STAGE_TILE, TOUCH_LABEL, WARM, type TouchKind } from '../src/lib/stages'
import type { SuggestionKind, SuggestionPatch } from '../src/lib/suggestions'
import { nextMoves } from '../src/lib/today'

/** What a read looked at, by id (Ask adds them up across its calls). */
export type Seen = { investors?: string[]; threads?: string[]; meetings?: string[] }
type Out = { ok: true; data: Record<string, unknown>; seen?: Seen } | { ok: false; error: string }
type Args = Record<string, unknown>
/** What an agent can suggest (meeting notes' question and warm path rows come only from Nest's own read). */
type AgentPatch = Exclude<SuggestionPatch, { op: 'questions' | 'warm_path' }>
const done = (data: Record<string, unknown>, seen?: Seen): Out => ({ ok: true, data, ...(seen ? { seen } : {}) })
const nope = (error: string): Out => ({ ok: false, error })
const NO_INVESTOR = 'There’s no investor with that id. Use search_investors to find the right one.'
const SIGNAL_DAYS = 120

async function investorById(ctx: QueryCtx, raw: unknown) {
  const id = typeof raw === 'string' ? ctx.db.normalizeId('investors', raw) : null
  return id ? await ctx.db.get(id) : null
}

/** Meetings that matched an investor (never anyone's unmatched ones, which only their owner sees) and email threads. */
async function signals(ctx: QueryCtx, now: number) {
  const meetings = (
    await ctx.db
      .query('meetings')
      .withIndex('by_start', (q) => q.gte('start', now - SIGNAL_DAYS * DAY_MS))
      .collect()
  ).filter((m) => m.investorIds.length)
  const threads = await ctx.db
    .query('emailTouches')
    .withIndex('by_last', (q) => q.gte('lastAt', now - SIGNAL_DAYS * DAY_MS))
    .collect()
  return { meetings, threads }
}

/** Every investor, with the email and meeting days that count as a touch (gone quiet, last touch). */
async function investorsWithContact(ctx: QueryCtx, now: number, sig?: Awaited<ReturnType<typeof signals>>) {
  const investors = await ctx.db.query('investors').collect()
  const s = contactSignals(sig ?? (await signals(ctx, now)), now)
  return investors.map((i) => ({ ...i, contact: s.get(i._id) }))
}
type Inv = Awaited<ReturnType<typeof investorsWithContact>>[number]

/** Today's three moves as Today works them out, over every investor with their email and meeting touches. Also the morning brief's (brief.ts). */
export async function movesNow(ctx: QueryCtx, now: number) {
  const today = todayIST(now)
  const { round } = await loadRound(ctx)
  const sig = await signals(ctx, now)
  const investors = await investorsWithContact(ctx, now, sig)
  const acts = await ctx.db.query('activities').withIndex('by_date').order('desc').take(1000)
  return { today, round, investors, signals: sig, moves: nextMoves({ investors, acts, round, today }) }
}

/** An investor in a list. */
const brief = (i: Inv) => ({
  id: i._id, name: i.name, firm: i.firm, stage: LABEL[i.stage], wave: i.wave, nextStep: i.nextStep || null, nextDate: i.nextDate ?? null, lastTouch: lastContact(i) ?? null,
})

/* ---------- read ---------- */

async function searchInvestors(ctx: QueryCtx, a: Args): Promise<Out> {
  const words = String(a.query ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  const now = Date.now()
  const all = await investorsWithContact(ctx, now)
  // PST-284: priority is scored against everyone (the round's average check), not just the matches.
  const priority = priorities(all, await keptFits(ctx), todayIST(now))
  const found = all
    .filter((i) => (!a.stage || i.stage === a.stage) && (!a.wave || i.wave === a.wave))
    .filter((i) => {
      const text = [i.name, i.firm, i.email ?? '', ...(i.emails ?? [])].join(' ').toLowerCase()
      return words.every((w) => text.includes(w))
    })
    .sort((x, y) => x.name.localeCompare(y.name))
  return done(
    {
      count: found.length,
      investors: found.slice(0, 50).map((i) => ({ ...brief(i), priority: priority.get(i._id)!.score })),
      ...(found.length > 50 ? { note: `Showing 50 of ${found.length}. Narrow it down with query, stage or wave.` } : {}),
    },
    { investors: found.slice(0, 50).map((i) => i._id) },
  )
}

async function getInvestor(ctx: QueryCtx, a: Args): Promise<Out> {
  const i = await investorById(ctx, a.id)
  if (!i) return nope(NO_INVESTOR)
  const now = Date.now()
  const all = await signals(ctx, now)
  const meetings = all.meetings.filter((m) => m.investorIds.includes(i._id)).sort((x, y) => y.start - x.start)
  const threads = all.threads.filter((t) => t.investorIds.includes(i._id)).sort((x, y) => y.lastAt - x.lastAt)
  const contact = contactSignals({ meetings, threads }, now).get(i._id)
  const people = await ctx.db
    .query('people')
    .withIndex('by_investor', (q) => q.eq('investorId', i._id))
    .collect()
  const acts = await ctx.db
    .query('activities')
    .withIndex('by_investor', (q) => q.eq('investorId', i._id))
    .order('desc')
    .take(20)
  const facts = (
    await ctx.db
      .query('facts')
      .withIndex('by_investor', (q) => q.eq('investorId', i._id))
      .collect()
  ).filter((f) => f.status === 'kept')
  const asks = await ctx.db
    .query('questionAsks')
    .withIndex('by_investor', (q) => q.eq('investorId', i._id))
    .collect()
  const questions = []
  for (const ask of asks.sort((x, y) => y.date.localeCompare(x.date))) {
    const q = await ctx.db.get(ask.questionId)
    if (q && !q.removedAt && !q.mergedInto) questions.push({ question: q.text, theme: q.theme, asked: ask.date })
  }
  return done({
    investor: {
      id: i._id, name: i.name, firm: i.firm, type: i.type, geo: i.geo, warmth: WARM[i.warmth], warmPath: i.path || null, tier: i.tier, wave: i.wave,
      stage: LABEL[i.stage], lead: i.lead, expected: i.expected ?? null, committed: i.committed ?? null, nextStep: i.nextStep || null, nextDate: i.nextDate ?? null,
      lastTouch: lastContact({ lastTouch: i.lastTouch, contact }) ?? null, parkedUntil: i.parkedUntil ?? null,
      email: i.email ?? null, otherEmails: i.emails ?? [], domains: i.domains ?? [], notes: i.notes || null, source: i.source || null,
    },
    people: people
      .sort((x, y) => Number(y.primary) - Number(x.primary))
      .map((p) => ({ name: p.name, title: p.title, rank: p.rank, email: p.email, location: p.location, linkedin: p.linkedin, primary: p.primary })),
    history: acts.map((x) => ({
      date: x.date,
      what: x.kind === 'stage' ? `Moved to ${x.stage ? LABEL[x.stage] : 'a new stage'}` : (x.note ?? ''),
      ...(x.touch ? { kind: TOUCH_LABEL[x.touch] } : {}),
      ...(x.source ? { from: x.source === 'calendar' ? 'Calendar' : 'Gmail' } : {}),
    })),
    emails: threads.slice(0, 20).map((t) => ({ subject: t.subject, date: dayOf(t.lastAt), lastFrom: t.lastFrom === 'us' ? 'Pesto' : 'them', messages: t.count })),
    meetings: meetings.slice(0, 20).map((m) => ({ title: m.title, date: dayOf(m.start), time: timeOf(m.start) + ' IST', past: m.end <= now })),
    factsKept: facts.map((f) => ({ about: f.group, field: fieldLabel(f.group, f.field), value: f.value, source: f.source })),
    questionsAsked: questions,
  }, { investors: [i._id], threads: threads.slice(0, 20).map((t) => t._id), meetings: meetings.slice(0, 20).map((m) => m._id) })
}

async function todaysMoves(ctx: QueryCtx): Promise<Out> {
  const now = Date.now()
  const { today, round, investors, signals: sig, moves } = await movesNow(ctx, now)
  const names = new Map<string, string>(investors.map((i) => [i._id, i.name]))
  const from = Date.parse(today + 'T00:00:00+05:30')
  const seen = new Set<string>()
  const meetings = sig.meetings.filter((m) => m.start >= from && m.start < from + DAY_MS && !seen.has(m.eventId) && seen.add(m.eventId))
  return done(
    {
      today,
      dueToday: dueList(investors, today).map((i) => ({ ...brief(i), due: dueDate(i) })),
      goneQuiet: quietList(investors, today, round.quietDays).map((i) => {
        const days = quietFor(i, today, round.quietDays)
        return { ...brief(i), quietFor: days === Infinity ? 'never touched' : `${days} days` }
      }),
      quietAfterDays: round.quietDays,
      meetingsToday: meetings.sort((x, y) => x.start - y.start).map((m) => ({ id: m._id, title: m.title, time: timeOf(m.start) + ' IST', investors: m.investorIds.map((id) => names.get(id)).filter(Boolean) })),
      nextMoves: moves.map((m) => ({ title: m.title, why: m.why, ...('investorId' in m.action ? { investorId: m.action.investorId } : {}) })),
    },
    { investors: investors.map((i) => i._id), threads: sig.threads.map((t) => t._id), meetings: meetings.map((m) => m._id) },
  )
}

async function listQuestions(ctx: QueryCtx, a: Args): Promise<Out> {
  const theme = typeof a.theme === 'string' ? a.theme.toLowerCase() : ''
  const questions = (await ctx.db.query('questions').collect())
    .filter((q) => !q.removedAt && !q.mergedInto && (!theme || q.theme.toLowerCase() === theme))
    .sort((x, y) => y.askedCount - x.askedCount || x.text.localeCompare(y.text))
  return done({
    count: questions.length,
    questions: questions.map((q) => ({ question: q.text, theme: q.theme, bestAnswer: q.bestAnswer.trim() || 'Needs an answer', timesAsked: q.askedCount, ...(q.slideRef ? { slide: q.slideRef } : {}) })),
  })
}

/* PST-279: read helpers for Ask Nest (agents get them too). */

/** The money ladder (Close): soft, verbal, SAFE sent, signed, wired, with who and how much. */
async function roundTotals(ctx: QueryCtx): Promise<Out> {
  const { round } = await loadRound(ctx)
  const l = ladder(await ctx.db.query('investors').collect(), await ctx.db.query('closings').collect())
  const rung = (r: (typeof RUNGS)[number]) => {
    const rows = l.rows.filter((x) => x.rung === r)
    return { label: RUNG_LABEL[r], amount: l.rungs[r].amount, count: rows.length, investors: rows.map((x) => ({ id: x.investor._id, name: x.investor.name, amount: x.amount })) }
  }
  return done(
    {
      currency: 'USD',
      softCircle: rung('soft'),
      verbal: rung('verbal'),
      safeSent: rung('sent'),
      signed: rung('signed'),
      wired: rung('wired'),
      verbalNotSigned: { amount: l.rungs.verbal.amount + l.rungs.sent.amount, count: l.rungs.verbal.count + l.rungs.sent.count },
      committed: l.committed,
      target: round.target,
      stretch: round.stretch,
      note: 'Each amount is the closing record’s, else Committed, else Expected. Committed is verbal and later; soft circles are not in it.',
    },
    { investors: l.rows.map((x) => x.investor._id) },
  )
}

/** Materials, the links shared with investors and what they opened. */
async function materialOpens(ctx: QueryCtx, a: Args): Promise<Out> {
  const who = a.investorId === undefined ? null : await investorById(ctx, a.investorId)
  if (a.investorId !== undefined && !who) return nope(NO_INVESTOR)
  const words = String(a.material ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  const version = typeof a.version === 'number' ? a.version : undefined
  const materials = (await ctx.db.query('materials').collect()).filter((m) => words.every((w) => `${m.title} ${KIND_LABEL[m.kind]} ${m.kind}`.toLowerCase().includes(w)))
  const versions = await ctx.db.query('materialVersions').collect()
  const investors = await ctx.db.query('investors').collect()
  const names = new Map<string, string>(investors.map((i) => [i._id, i.name]))
  const now = Date.now()
  const links = []
  for (const m of materials) {
    for (const l of await ctx.db.query('shareLinks').withIndex('by_material', (q) => q.eq('materialId', m._id)).collect()) {
      if (!l.investorId || !names.has(l.investorId) || (who && l.investorId !== who._id)) continue
      const n = versions.find((x) => x._id === (l.versionId === 'current' ? m.currentVersionId : l.versionId))?.n
      if (version !== undefined && n !== version) continue
      const views = await ctx.db.query('views').withIndex('by_link', (q) => q.eq('linkId', l._id)).collect()
      const pages = new Map<number, number>()
      for (const w of views) for (const p of w.pages) pages.set(p.page, (pages.get(p.page) ?? 0) + p.ms)
      const ms = [...pages.values()].reduce((s, x) => s + x, 0)
      const longest = [...pages.entries()].sort((x, y) => y[1] - x[1])[0]
      links.push({
        investorId: l.investorId, investor: names.get(l.investorId)!, material: m.title, version: n ? `v${n}` : null, followsCurrent: l.versionId === 'current',
        sharedOn: dayOf(l.createdAt), link: linkState(l, now), opened: views.length > 0, opens: views.length,
        ...(views.length ? { firstOpened: dayOf(Math.min(...views.map((w) => w.startedAt))), lastOpened: dayOf(Math.max(...views.map((w) => w.lastAt))), minutesRead: Math.round(ms / 6e3) / 10 } : {}),
        ...(longest ? { longestPage: longest[0] } : {}),
      })
    }
  }
  const linked = new Set(links.map((x) => x.investorId))
  const without = words.length && !who ? investors.filter((i) => ACTIVE.has(i.stage) && !linked.has(i._id)).map((i) => ({ id: i._id, name: i.name, stage: LABEL[i.stage] })) : null
  return done(
    {
      materials: materials.map((m) => ({ title: m.title, kind: KIND_LABEL[m.kind], current: `v${versions.find((x) => x._id === m.currentVersionId)?.n ?? '?'}`, versions: versions.filter((x) => x.materialId === m._id).map((x) => `v${x.n}`) })),
      links: links.sort((x, y) => Number(y.opened) - Number(x.opened) || x.investor.localeCompare(y.investor)),
      ...(without ? { investorsWithoutLink: without } : {}),
    },
    { investors: [...linked] },
  )
}

/** Investor meetings in a range of days (India time), with their ids for the prep brief. */
async function meetingsBetween(ctx: QueryCtx, a: Args): Promise<Out> {
  const from = a.from as string
  const to = (a.to as string | undefined) ?? from
  if (to < from) return nope('to must be the same day as from or later.')
  if (dayDiff(to, from) > 31) return nope('At most 31 days at a time.')
  const start = Date.parse(from + 'T00:00:00+05:30')
  const end = Date.parse(to + 'T00:00:00+05:30') + DAY_MS
  const now = Date.now()
  const seen = new Set<string>()
  const meetings = (
    await ctx.db
      .query('meetings')
      .withIndex('by_start', (q) => q.gte('start', start).lt('start', end))
      .collect()
  )
    .filter((m) => m.investorIds.length && !seen.has(m.eventId) && seen.add(m.eventId))
    .sort((x, y) => x.start - y.start)
  const out = []
  for (const m of meetings) {
    const investors = []
    let notes = false
    for (const id of m.investorIds) {
      const i = await ctx.db.get(id)
      if (i) investors.push({ id: i._id, name: i.name })
      const ns = await ctx.db
        .query('notes')
        .withIndex('by_investor', (q) => q.eq('investorId', id))
        .collect()
      notes ||= ns.some((n) => !n.removedAt && (n.meetingId === m._id || n.date === dayOf(m.start)))
    }
    out.push({ id: m._id, title: m.title, day: dayOf(m.start), start: timeOf(m.start) + ' IST', end: timeOf(m.end) + ' IST', past: m.end <= now, investors, notesSaved: notes })
  }
  return done({ from, to, now: `${dayOf(now)} ${timeOf(now)} IST`, count: out.length, meetings: out }, { meetings: meetings.map((m) => m._id), investors: [...new Set(out.flatMap((m) => m.investors.map((i) => i.id)))] })
}

export const read = internalQuery({
  args: { tool: v.string(), args: v.any() },
  handler: async (ctx, { tool, args }): Promise<Out> => {
    if (tool === 'search_investors') return await searchInvestors(ctx, args)
    if (tool === 'get_investor') return await getInvestor(ctx, args)
    if (tool === 'todays_moves') return await todaysMoves(ctx)
    if (tool === 'list_questions') return await listQuestions(ctx, args)
    if (tool === 'round_totals') return await roundTotals(ctx)
    if (tool === 'material_opens') return await materialOpens(ctx, args)
    if (tool === 'meetings_between') return await meetingsBetween(ctx, args)
    return nope(`${tool} isn’t a read tool.`)
  },
})

/* ---------- write: always a suggestion ---------- */

type Agent = { keyId: Id<'agentKeys'>; name: string }

/** The agent's sentence, with the investor's name in front when it doesn't say who. */
function about(i: { name: string; firm: string }, text: string) {
  const t = text.toLowerCase()
  return t.includes(i.name.toLowerCase()) || (i.firm && t.includes(i.firm.toLowerCase())) ? text : `${i.name}: ${text}`
}

/**
 * Queue one suggestion from an agent. Its key is a hash of what it suggests, so
 * the same suggestion is never queued twice and one Dev dismissed never comes back.
 */
async function suggest(ctx: MutationCtx, agent: Agent, s: { kind: SuggestionKind; investorId?: Id<'investors'>; title: string; fix: string; patch: AgentPatch }): Promise<Out> {
  const key = 'agent:' + (await sha256Hex(JSON.stringify([s.kind, s.investorId ?? '', s.patch]))).slice(0, 32)
  const id = await insertSuggestion(ctx, { ...s, source: 'agent', agentName: agent.name, safe: false, key })
  if (!id) return done({ suggested: false, message: 'That suggestion is already in Dev’s queue, or Dev dismissed it before. Nothing new was added.' })
  return done({ suggested: true, suggestionId: id, message: 'Added to Dev’s Suggestions queue. Nothing has changed yet: Dev will accept or dismiss it.' })
}

async function logTouch(ctx: MutationCtx, agent: Agent, a: Args): Promise<Out> {
  const i = await investorById(ctx, a.investorId)
  if (!i) return nope(NO_INVESTOR)
  const today = todayIST()
  const date = a.date as string
  if (date > today) return nope(`date can’t be in the future (today is ${today} in India).`)
  const touch = a.kind as TouchKind
  const note = a.note as string
  const what = TOUCH_LABEL[touch].toLowerCase()
  return await suggest(ctx, agent, {
    kind: 'touch', investorId: i._id, title: about(i, note),
    fix: `Log ${what === 'email' ? 'an' : 'a'} ${what} · ${date === today ? 'today' : dayLabel(date, today)}`,
    patch: { op: 'touch', touch, note, date },
  })
}

async function addInvestor(ctx: MutationCtx, agent: Agent, a: Args): Promise<Out> {
  const name = a.name as string
  const firm = (a.firm as string | undefined) ?? ''
  const email = typeof a.email === 'string' ? normEmail(a.email) || undefined : undefined
  const note = a.note as string | undefined
  const same = (await ctx.db.query('investors').collect()).find((i) => dupKey(i.name, i.firm) === dupKey(name, firm) || (!!email && addressesOf(i).emails.includes(email)))
  if (same) return nope(`${same.name} is already on the list (id ${same._id}). Use get_investor, or suggest_change for a fix.`)
  const who = firm && firm.toLowerCase() !== name.toLowerCase() ? `${name} (${firm})` : name
  return await suggest(ctx, agent, {
    kind: 'new_investor', title: note ? `${who}: ${note}` : `${who} isn’t on the list yet.`, fix: `Add ${who} to the list`,
    patch: { op: 'new_investor', name, firm, ...(email ? { email } : {}), ...(note ? { note } : {}) },
  })
}

async function suggestChange(ctx: MutationCtx, agent: Agent, a: Args): Promise<Out> {
  const i = await investorById(ctx, a.investorId)
  if (!i) return nope(NO_INVESTOR)
  const title = about(i, a.why as string)
  const value = a.value as string | number
  if (a.kind === 'stage') {
    const want = String(value).trim().toLowerCase()
    const to = STAGE_KEYS.find((k) => k === want || LABEL[k].toLowerCase() === want || STAGE_TILE[k].toLowerCase() === want)
    if (!to) return nope(`value must be a stage: ${STAGE_KEYS.join(', ')}.`)
    if (to === i.stage) return nope(`${i.name} is already at ${LABEL[to]}.`)
    return await suggest(ctx, agent, { kind: 'stage', investorId: i._id, title, fix: `Move to ${STAGE_TILE[to]}`, patch: { op: 'stage', from: i.stage, to } })
  }
  if (a.kind === 'next_step') {
    const step = String(value).trim()
    const date = a.date as string | undefined
    if (!step) return nope('value must be the next step, e.g. “Send the data room”.')
    const when = date ? ` · ${dayLabel(date, todayIST())}` : ''
    return await suggest(ctx, agent, { kind: 'next_step', investorId: i._id, title, fix: `Set “${step}”${when}`, patch: { op: 'next_step', step, ...(date ? { date } : {}) } })
  }
  const amount = parseAmount(value)
  if (!amount) return nope('value must be the amount in US dollars the investor said, e.g. 50000.')
  return await suggest(ctx, agent, { kind: 'expected', investorId: i._id, title, fix: `Set Expected to ${money(amount)}`, patch: { op: 'expected', amount } })
}

/** The existing enrichment, as an automatic run: it counts towards (and stops at) the daily cap. */
async function enrich(ctx: MutationCtx, a: Args): Promise<Out> {
  if ((a.investorId === undefined) === (a.email === undefined)) return nope('Pass exactly one of investorId and email.')
  if (!hasAIKey()) return nope('AI isn’t set up on this Nest, so it can’t look anyone up.')
  if ((await capLeft(ctx)) <= 0) return nope('Nest has done all its automatic lookups for today. Try again tomorrow, or ask Dev to click Enrich.')
  if (a.investorId !== undefined) {
    const i = await investorById(ctx, a.investorId)
    if (!i) return nope(NO_INVESTOR)
    const runs = await ctx.db
      .query('enrichRuns')
      .withIndex('by_investor', (q) => q.eq('investorId', i._id))
      .order('desc')
      .take(5)
    if (runs.some((r) => r.status === 'queued' || r.status === 'running')) return done({ started: false, message: `A lookup of ${i.name} is already running.` })
    const email = normEmail(i.email)
    const domain = firmDomain(i)
    await queue(ctx, { investorId: i._id, auto: true, ...(email ? { email } : {}), ...(domain ? { domain } : {}) })
    return done({ started: true, message: `Started looking up ${i.name}. What Nest finds waits for Dev to review; nothing changes until then.` })
  }
  const e = normEmail(a.email as string)
  if (!e || isOurs(e)) return nope('email must be someone outside Pesto.')
  const since = Date.now() - CACHE_DAYS * DAY_MS
  const runs = await ctx.db
    .query('enrichRuns')
    .withIndex('by_email', (q) => q.eq('email', e).gte('startedAt', since))
    .collect()
  if (runs.some((r) => !r.investorId && r.status !== 'failed' && r.status !== 'stopped')) return done({ started: false, message: 'Nest looked them up in the last 30 days; Dev can see it in Who’s this?.' })
  await queue(ctx, { email: e, auto: true, ...(GENERIC_DOMAINS.has(domainOf(e)) ? {} : { domain: domainOf(e) }) })
  return done({ started: true, message: 'Started looking them up. What Nest finds shows in Who’s this? for Dev to review.' })
}

/** Notes from Wispr Flow or an agent (PST-277): saved on the investor, or kept in Unmatched notes; Nest's read only suggests. */
async function addNotes(ctx: MutationCtx, a: Args): Promise<Out> {
  const given = a.investorId === undefined ? null : await investorById(ctx, a.investorId)
  if (a.investorId !== undefined && !given) return nope(NO_INVESTOR)
  const today = todayIST()
  const date = a.date as string
  if (date > today) return nope(`date can’t be in the future (today is ${today} in India).`)
  const r = await addMeetingNotes(ctx, {
    ...(given ? { investorId: given._id } : {}),
    ...(typeof a.email === 'string' ? { email: a.email } : {}),
    meetingTitle: a.meetingTitle as string,
    date,
    text: a.text as string,
    source: a.source === 'wispr' ? 'wispr' : 'agent',
  })
  if ('unmatchedId' in r) return done({ saved: true, matched: false, message: 'Nest couldn’t tell which investor these notes are about, so they wait in Unmatched notes on Today until Dev picks one.' })
  const i = await ctx.db.get(r.investorId)
  const read = r.readId ? 'Nest is reading them; anything it proposes waits in Suggestions for Dev.' : 'Nest won’t read them automatically here, so nothing else changes.'
  return done({ saved: true, matched: true, investorId: r.investorId, noteId: r.noteId, message: `Saved on ${i?.name ?? 'the investor'}. ${read}` })
}

export const write = internalMutation({
  args: { tool: v.string(), args: v.any(), agent: v.object({ keyId: v.id('agentKeys'), name: v.string(), scope: vAgentScope }) },
  handler: async (ctx, { tool, args, agent }): Promise<Out> => {
    if (agent.scope !== 'suggest') return nope('This key can only read.')
    if (tool === 'log_touch') return await logTouch(ctx, agent, args)
    if (tool === 'add_investor') return await addInvestor(ctx, agent, args)
    if (tool === 'suggest_change') return await suggestChange(ctx, agent, args)
    if (tool === 'enrich') return await enrich(ctx, args)
    if (tool === 'add_meeting_notes') return await addNotes(ctx, args)
    return nope(`${tool} isn’t a write tool.`)
  },
})
