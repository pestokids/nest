// DEV ONLY: Ask Nest and the morning brief for ?preview (PST-279). Asking plays a
// pretend run: a lookup or two, then the answer streams in. Canned answers pick a
// topic from the question's words; anything else gets "I don't know from Nest's
// data". Every name is a made-up fixture investor.
//   &ask=empty|thinking|streaming|answer|verbal|prep|deck|unknown|failed   opens ⌘K in Ask mode
//     (with &ai=nokey: "AI isn't set up here"; prep implies &google=connected)
//   &brief=default|fallback|quiet|dismissed   the morning brief on Today (none without it)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AskRun } from '../lib/ask'
import type { Brief, BriefSince } from '../lib/brief'
import type { GoogleData } from '../lib/google'
import type { Activity, Investor } from '../lib/pipeline'
import type { Round } from '../lib/round'
import type { Suggestion } from '../lib/suggestions'
import { nextMoves } from '../lib/today'
import { estimate, type Model } from '../lib/models'

export const PREVIEW_ASK = ['empty', 'thinking', 'streaming', 'answer', 'verbal', 'prep', 'deck', 'unknown', 'failed'] as const
export type PreviewAsk = (typeof PREVIEW_ASK)[number]
export const PREVIEW_BRIEF = ['default', 'fallback', 'quiet', 'dismissed'] as const
export type PreviewBrief = (typeof PREVIEW_BRIEF)[number]

type Topic = 'chase' | 'verbal' | 'prep' | 'deck' | 'unknown'
const topicOf = (q: string): Topic =>
  /verbal|signed|commit/i.test(q) ? 'verbal' : /prep|\d\s*(pm|am)|meeting/i.test(q) ? 'prep' : /deck|seen|opened/i.test(q) ? 'deck' : /chase|today|follow|who should/i.test(q) ? 'chase' : 'unknown'
const TOOLS: Record<Topic, string[]> = {
  chase: ['todays_moves', 'material_opens'],
  verbal: ['round_totals'],
  prep: ['meetings_between', 'get_investor'],
  deck: ['material_opens'],
  unknown: ['search_investors'],
}
const SOURCES: Record<Topic, AskRun['sources']> = {
  chase: { investors: 40, threads: 12, meetings: 3 },
  verbal: { investors: 3, threads: 0, meetings: 0 },
  prep: { investors: 1, threads: 4, meetings: 2 },
  deck: { investors: 6, threads: 0, meetings: 0 },
  unknown: { investors: 40, threads: 0, meetings: 0 },
}

function answerFor(topic: Topic, investors: Investor[], google: GoogleData): string {
  const c = (name: string) => {
    const i = investors.find((x) => x.name === name)
    return i ? `[[investor:${i._id}|${i.name}]]` : name
  }
  const id = (name: string) => investors.find((x) => x.name === name)?._id ?? ''
  if (topic === 'chase')
    return [
      'Three people, in this order:',
      '',
      `1. ${c('Orchard Capital')} opened deck v4 this morning (4 min, longest on p6). Strike while it’s fresh: send the data room.`,
      `2. ${c('Lantern Ventures')} has been at Intro for 9 days with no call booked. Ask Ankur to nudge, or book the first call.`,
      `3. ${c('Kite Angels')} asked for week-8 retention by Fri 20 Nov. You have it now; send the follow-up.`,
      '',
      `[[action:open|${id('Orchard Capital')}]]`,
      `[[action:open|${id('Lantern Ventures')}]]`,
    ].join('\n')
  if (topic === 'verbal')
    return [
      '**$150K** is verbal but not signed, from two investors:',
      '',
      `- ${c('Saffron Seed')}: $100K, SAFE sent 3 days ago, not signed yet.`,
      `- ${c('Rowan Operator')}: $50K, said yes on a call, SAFE not sent.`,
      '',
      'Committed in all (verbal and later) is $425K of the $1M target.',
      '',
      `[[action:open|${id('Rowan Operator')}]]`,
    ].join('\n')
  if (topic === 'prep') {
    const m = google.meetings.find((x) => x.investorIds.length && x.eventId === 'fx-kite')
    if (!m) return 'There’s no investor meeting on your calendar at 4pm today, so there’s nothing to prep. I don’t know from Nest’s data what the 16:30 intro call is about.'
    return [
      `Nothing with an investor at 4pm: the 16:30 is an intro call with someone not in Nest yet. Your investor meeting today is ${c('Kite Angels')} at 11:00, their 2nd meeting.`,
      '',
      'Open from last time: week-8 retention, which you promised by Fri 20 Nov, and how you keep stories safe for 4-year-olds.',
      '',
      `[[action:prep|${m._id}]]`,
    ].join('\n')
  }
  if (topic === 'deck')
    return [
      'Deck v4 went to six investors. Two haven’t opened it:',
      '',
      `- ${c('Lantern Ventures')}: sent 4 days ago, not opened.`,
      `- ${c('Juniper Seed')}: sent yesterday, not opened.`,
      '',
      `Three in conversation were never sent v4: ${c('Fernhill Fund')}, ${c('Saltmarsh Angels')} and ${c('Northwind Accelerator')}.`,
      '',
      `[[action:open|${id('Lantern Ventures')}]]`,
      `[[action:draft|${id('Lantern Ventures')}]]`,
    ].join('\n')
  return 'I don’t know from Nest’s data. Nest has investors, meetings, email subjects and who opened what, but no product or churn numbers.'
}

type Pretend = { run: AskRun; text: string }

/** A made-up morning brief from the fixture investors and the preview's suggestions. */
function fixtureBrief(state: PreviewBrief, investors: Investor[], acts: Activity[], round: Round, suggestions: Suggestion[], today: string): Brief {
  const who = (name: string) => {
    const i = investors.find((x) => x.name === name)
    return i ? [{ investorId: i._id, name: i.name }] : []
  }
  const since: BriefSince =
    state === 'quiet'
      ? { replies: [], opens: [], meetings: [], suggestions: { open: 0, safe: 0 } }
      : {
          replies: [...who('Kite Angels'), ...who('Lantern Ventures')],
          opens: who('Orchard Capital').map((w) => ({ ...w, material: 'Pitch deck v4', kind: 'deck' as const, ms: 4 * 6e4 + 12e3, page: 6 })),
          meetings: who('Kite Angels').map((w) => ({ ...w, title: 'Pesto × Kite Angels', notes: 'read' as const })),
          suggestions: { open: suggestions.length, safe: suggestions.filter((s) => s.safe).length },
        }
  // Claude's line where a move is about one investor; the others keep Today's why, as they would.
  const reason = state === 'default' || state === 'dismissed' ? 'They read deck v4 for four minutes this morning. Ask while it’s fresh.' : undefined
  const moves = nextMoves({ investors, acts, round, today })
    .slice(0, 3)
    .map((m) => ({ key: m.key, title: m.title, why: m.why, ...('investorId' in m.action ? { investorId: m.action.investorId, ...(reason ? { reason } : {}) } : {}) }))
  const at = Date.parse(today + 'T08:00:00+05:30')
  return { _id: 'brief-' + today, day: today, builtAt: at, since, moves, costUsd: state === 'fallback' ? 0 : 0.0004, ...(state === 'dismissed' ? { dismissedAt: at + 36e5 } : {}) }
}

export function useAskPreview(o: {
  ask: PreviewAsk | null
  brief: PreviewBrief | null
  investors: Investor[] | null
  /** The fixture and its suggestions are in. */
  ready: boolean
  acts: Activity[]
  round: Round
  google: GoogleData | null
  suggestions: Suggestion[]
  today: string
  fail: boolean
  /** PST-273: the Ask model Settings › AI picked (the Ask chip can pick another for one question). */
  askModel: Model
}) {
  const [runs, setRuns] = useState<Record<string, Pretend>>({})
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  const latest = useRef({ investors: o.investors, google: o.google })
  latest.current = { investors: o.investors, google: o.google }

  const play = useCallback((id: string, question: string, model: Model, stopAt?: 'thinking' | 'streaming' | 'failed') => {
    const topic = topicOf(question)
    const text = answerFor(topic, latest.current.investors ?? [], latest.current.google ?? { loaded: true, me: null, team: [], meetings: [], threads: [] })
    const set = (patch: Partial<AskRun>) => setRuns((rs) => (rs[id] ? { ...rs, [id]: { ...rs[id], run: { ...rs[id].run, ...patch } } } : rs))
    const later = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms))
    setRuns((rs) => ({ ...rs, [id]: { text, run: { _id: id, question, status: 'thinking', text: '', tools: [], sources: { investors: 0, threads: 0, meetings: 0 }, costUsd: 0, model } } }))
    TOOLS[topic].forEach((t, i) => later(350 + i * 650, () => set({ tools: TOOLS[topic].slice(0, i + 1) })))
    const t0 = 350 + TOOLS[topic].length * 650
    if (stopAt === 'thinking') return
    const cost = estimate('ask', model).usd * (TOOLS[topic].length + 1) / 4
    if (stopAt === 'failed') return later(t0, () => set({ status: 'failed', error: 'Claude request failed (529)', costUsd: cost / 2 }))
    const end = stopAt === 'streaming' ? Math.floor(text.length * 0.45) : text.length
    for (let n = 0, k = 0; n < end; k++) {
      n = Math.min(end, n + 6)
      const upTo = n
      later(t0 + k * 28, () => set({ status: 'answering', text: text.slice(0, upTo) }))
    }
    if (stopAt !== 'streaming') later(t0 + Math.ceil(end / 6) * 28 + 40, () => set({ status: 'done', text, sources: SOURCES[topic], costUsd: cost }))
  }, [])

  const ask = useCallback(
    async (question: string, model?: Model) => {
      await new Promise((r) => setTimeout(r, 120))
      if (o.fail) throw new Error('preview')
      const id = 'pask-' + Date.now()
      const st = o.ask === 'thinking' || o.ask === 'streaming' || o.ask === 'failed' ? o.ask : undefined
      play(id, question, model ?? o.askModel, st)
      return id
    },
    [o.fail, o.ask, o.askModel, play],
  )
  const useAskRun = useCallback((runId: string | null) => (runId ? (runs[runId]?.run ?? null) : null), [runs])

  const [brief, setBrief] = useState<Brief | null | undefined>(undefined)
  useEffect(() => {
    if (!o.ready || brief !== undefined) return
    setBrief(o.brief ? fixtureBrief(o.brief, o.investors!, o.acts, o.round, o.suggestions, o.today) : null)
  }, [o.ready, brief, o.brief, o.investors, o.acts, o.round, o.suggestions, o.today])
  const setBriefDismissed = useCallback(
    async (_id: string, dismissed: boolean) => {
      await new Promise((r) => setTimeout(r, 120))
      if (o.fail) throw new Error('preview')
      setBrief((b) => (b ? { ...b, dismissedAt: dismissed ? Date.now() : undefined } : b))
    },
    [o.fail],
  )
  return useMemo(() => ({ ask, useAskRun, brief, setBriefDismissed }), [ask, useAskRun, brief, setBriefDismissed])
}
