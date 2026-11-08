// DEV ONLY: renders Home and the Raise views with in-memory writes, so the UI
// can be checked without a Google sign-in. Never used in production builds.
// Data: the fake fixture in src/preview/ (default), or internal/seed.json with `&seed`.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { applyMove, applyUndo } from '../lib/board'
import { todayIST } from '../lib/dates'
import { applyAdvance, applySave, NEW_INVESTOR, touchDay, type Activity, type Investor, type TouchOptions } from '../lib/pipeline'
import { DEFAULT_ROUND, diffRound, mergeRound, type Round } from '../lib/round'
import { LABEL } from '../lib/stages'
import { fixtureActs, fixtureBoardExtras, fixtureInvestors, fixtureMembers, fixtureMid, fixtureRound } from '../preview/fixture'
import { addDays } from '../lib/today'
import { cleanDomains, cleanEmails, withContact, type GoogleData } from '../lib/google'
import { fixtureGoogle, type PreviewGoogle } from '../preview/googleFixture'
import { ACTIVE } from '../lib/stages'
import { useAIPreview, type PreviewAI } from '../preview/aiFixture'
import { fitsByInvestor } from '../lib/priority'
import { fixtureInsights } from '../preview/insightsFixture'
import { acceptsTogether, reconcile, ruleSuggestions, sortSuggestions, type CheckInput, type Suggestion, type SuggestionDraft } from '../lib/suggestions'
import {
  fixtureAgentSuggestion, fixtureExtraSuggestions, fixtureSuggestionInvestors, fixtureSuggestionMeetings, type PreviewSuggestions,
} from '../preview/suggestionsFixture'
import { fixtureCloseInvestors, type PreviewClose } from '../preview/closeFixture'
import { RaiseContext, type LogRow, type RaiseData } from './data'
import { PreviewQanda } from '../preview/PreviewQanda'
import { useAgentsPreview, type PreviewAgents } from '../preview/agentsFixture'
import { useAskPreview, type PreviewAsk, type PreviewBrief } from '../preview/askFixture'
import { modelFor } from '../lib/models'
import { fixtureRace } from '../preview/raceFixture' // PST-295
import { applyTouch, undoTouchPatch } from '../lib/touch'

type Seed = { round?: Partial<Round>; investors: (Omit<Investor, '_id'> & { slug: string })[] }
export type PreviewHome = 'default' | 'firstrun' | 'prepdone'
/** T5 options: `loading` never finishes loading; `mid` is the mid-round fixture; `fail` makes every write fail (save-failed + Retry). */
export type PreviewExtra = {
  loading?: boolean; mid?: boolean; fail?: boolean; /** PST-284 `&insights=default|behind`: a month of made-up history for Plan › Insights. */ insights?: 'default' | 'behind'
  /** PST-295: a made-up kickoff week for Pipeline › Race (`lead`: two offers, and a lead). */
  race?: 'race' | 'lead'
}

/** What the rule checks read in preview: the fixture, its made-up meetings and the Google fixture. */
const checkInput = (investors: Investor[], acts: Activity[], g: GoogleData, now: number): CheckInput => ({
  investors, acts, meetings: [...fixtureSuggestionMeetings(investors, now), ...g.meetings], threads: g.threads, today: todayIST(now), now,
})
const stamp = (now: number) => (d: SuggestionDraft, k: number): Suggestion => ({ ...d, _id: `ps${now}-${k}`, status: 'open', createdAt: now + k })

/** `board`: add the Pipeline board's extra fake cards (`&pipeline=…`). `today`: the Raise · Today preview state. `extra`: the Investors, Plan and system states. */
export function PreviewData({
  source, home = 'default', board = false, today: todayState = 'default', extra = {}, google: googleState = 'none', suggestions: suggestionsState = 'default', ai: aiState = 'default', close = null, agents: agentsState = 'default', ask: askState = null, brief: briefState = null, children,
}: {
  source: 'fixture' | 'seed'
  home?: PreviewHome
  board?: boolean
  today?: 'default' | 'nothingdue' | 'win'
  extra?: PreviewExtra
  google?: PreviewGoogle
  /** PST-275 `&suggestions=…` */
  suggestions?: PreviewSuggestions
  /** PST-274 `&ai=…` */
  ai?: PreviewAI
  /** PST-283 `&close=…`: adds the closing investors. */
  close?: PreviewClose | null
  /** PST-276 `&agents=…` */
  agents?: PreviewAgents
  /** PST-279 `&ask=…` and `&brief=…` */
  ask?: PreviewAsk | null
  brief?: PreviewBrief | null
  children: ReactNode
}) {
  const [investors, setInvestors] = useState<Investor[] | null>(null)
  const [acts, setActs] = useState<Activity[]>([])
  const [round, setRound] = useState<Round>(DEFAULT_ROUND)
  const [roundExists, setRoundExists] = useState(true)
  const [log, setLog] = useState<LogRow[]>(() => {
    const h = 36e5
    const now = Date.now()
    return [
      { _id: 'l1', at: now - 2 * h, by: 'Dev', field: 'quietDays', from: '5', to: '4' },
      { _id: 'l2', at: now - 26 * h, by: 'Sam', field: 'stretch', from: '1250000', to: '1500000' },
      { _id: 'l3', at: now - 50 * h, by: 'Dev', field: 'import', from: '', to: '12 investors from first-list.csv' },
    ]
  })
  const [ticks, setTicks] = useState<Record<string, number[]>>({})
  // `&google=…`: made-up Calendar and Gmail data, built once the investors are in.
  const [google, setGoogle] = useState<GoogleData | null>(null)
  useEffect(() => {
    if (investors && !google) setGoogle(fixtureGoogle(googleState, investors, Date.now()))
  }, [investors, google, googleState])

  // PST-275: suggested fixes, from the real rule checks over the fixture plus the rows other features make.
  // `none` and `tidy` start empty; `agent` has the agent's row arrive a moment after load.
  const emptyList = suggestionsState === 'none' || suggestionsState === 'tidy'
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null)
  useEffect(() => {
    if (!investors || !google || suggestions) return
    if (emptyList) return setSuggestions([])
    const now = Date.now()
    const agent = suggestionsState === 'agent' ? null : fixtureAgentSuggestion(investors, todayIST(now))
    setSuggestions([...ruleSuggestions(checkInput(investors, acts, google, now)), ...fixtureExtraSuggestions(investors), ...(agent ? [agent] : [])].map(stamp(now)))
  }, [investors, google, acts, suggestions, emptyList, suggestionsState])
  const ready = !!suggestions && !!investors
  useEffect(() => {
    if (suggestionsState !== 'agent' || !ready) return
    const t = setTimeout(() => {
      const d = fixtureAgentSuggestion(latest.current ?? [], todayIST())
      if (d) setSuggestions((xs) => (xs && !xs.some((s) => s.key === d.key) ? [...xs, stamp(Date.now())(d, 0)] : xs))
    }, 1500)
    return () => clearTimeout(t)
  }, [suggestionsState, ready])
  const undos = useRef(new Map<string, () => void>())

  useEffect(() => {
    const t = todayIST()
    const load = (inv: Investor[], r: Round) => {
      if (extra.insights) {
        const m = fixtureInsights(t, extra.insights)
        setInvestors(m.investors)
        setRound(m.round)
        setActs(m.acts)
        return
      }
      // PST-295
      if (extra.race) {
        const m = fixtureRace(t, extra.race === 'lead')
        setInvestors(m.investors)
        setRound(m.round)
        setActs(m.acts)
        return
      }
      if (extra.mid) {
        const m = fixtureMid(t)
        setInvestors(m.investors)
        setRound(m.round)
        setActs(m.acts)
        return
      }
      if (home === 'firstrun') {
        setInvestors([])
        setRoundExists(false)
        setRound(DEFAULT_ROUND)
        return
      }
      // `&today=nothingdue`: every next step is later and every live conversation was touched yesterday.
      const list =
        todayState === 'nothingdue'
          ? inv.map((i) => ({
              ...i,
              nextDate: i.nextDate && i.nextDate <= t ? addDays(t, 3) : i.nextDate,
              lastTouch: ACTIVE.has(i.stage) ? addDays(t, -1) : i.lastTouch,
            }))
          : inv
      setInvestors(list)
      setRound(r)
      setActs(fixtureActs(list, t))
      if (home === 'prepdone') {
        const p = r.phases.find((x) => t >= x.from && t <= x.to)
        if (p) setTicks({ [p.k]: p.todo.map((_, i) => i) })
      }
    }
    // The real seed file only exists locally; deployed previews always use the fixture.
    const withSuggestions = suggestionsState !== 'none' && suggestionsState !== 'tidy'
    if (source === 'fixture' || !import.meta.env.DEV)
      return load([...fixtureInvestors(t), ...(board ? fixtureBoardExtras(t) : []), ...(withSuggestions ? fixtureSuggestionInvestors(t, suggestionsState === 'jev') : []), ...(close ? fixtureCloseInvestors(t, close) : [])], close ? { ...fixtureRound(t), cap: 16000000 } : fixtureRound(t))
    fetch('/internal/seed.json')
      .then((r) => r.json() as Promise<Seed>)
      .then((s) => {
        const clean = (o: object) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null)) as Investor
        load(
          s.investors.map((i) => clean({ ...i, _id: i.slug })),
          mergeRound(s.round),
        )
      })
  }, [source, home, board, todayState, extra.mid, extra.insights, extra.race, suggestionsState, close])

  const latest = useRef(investors)
  const latestActs = useRef(acts)
  useEffect(() => {
    latest.current = investors
    latestActs.current = acts
  }, [investors, acts])

  const value = useMemo<Omit<RaiseData, 'ai' | 'aiDo' | 'useInvestorAI' | 'useFits' | 'agents' | 'agentsDo' | 'useAgentActivity' | 'ask' | 'useAskRun' | 'brief' | 'setBriefDismissed'>>(() => {
    const t = todayIST()
    let n = 0
    const act = (a: Omit<Activity, '_id' | 'date' | 'by'> & { date?: string }) => {
      const _id = `p${Date.now()}${n++}`
      setActs((xs) => [{ date: t, ...a, _id, by: 'Dev', _creationTime: Date.now() }, ...xs])
      return _id
    }
    const g = google ?? fixtureGoogle('none', [], 0)
    const list = withContact(investors ?? [], g, Date.now())
    // &fail: every write rejects, as if the connection dropped mid-save.
    const w = <A extends unknown[], R>(fn: (...a: A) => Promise<R>) =>
      extra.fail ? async (..._a: A): Promise<R> => { await new Promise((r) => setTimeout(r, 400)); throw new Error('Preview: writes fail (&fail)') } : fn

    // PST-275: suggested fixes in memory. Each accept applies the same change the investor writes would, and keeps its undo.
    const rows = suggestions ?? []
    const decide = (ids: string[], status: Suggestion['status']) =>
      setSuggestions((xs) => (xs ?? []).map((s) => (ids.includes(s._id) ? { ...s, status, decidedAt: status === 'open' ? undefined : Date.now() } : s)))
    const patchInv = (id: string, p: Partial<Investor>) => setInvestors((xs) => (xs ?? []).map((x) => (x._id === id ? { ...x, ...p } : x)))
    /** Apply one suggestion; returns its undo, or null when it no longer fits. */
    const applyOne = (s: Suggestion): (() => void) | null => {
      const all = latest.current ?? []
      const i = all.find((x) => x._id === s.investorId)
      const p = s.patch
      if (p.op === 'new_investor') {
        const key = (n: string, f: string) => `${n.trim().toLowerCase()}|${f.trim().toLowerCase()}`
        if (all.some((x) => key(x.name, x.firm) === key(p.name, p.firm))) return null
        const id = `pn${Date.now()}`
        setInvestors((xs) => [...(xs ?? []), { ...NEW_INVESTOR, _id: id, maxStage: 'todo', name: p.name, firm: p.firm, email: p.email, notes: p.note ?? '', source: `Suggested by ${s.agentName ?? 'an agent'}`, _creationTime: Date.now() }])
        return () => setInvestors((xs) => (xs ?? []).filter((x) => x._id !== id))
      }
      if (!i || p.op === 'review') return null
      if (p.op === 'stage') {
        if (i.stage !== p.from) return null
        const r = applyMove(i, p.to, t)
        patchInv(i._id, r.patch)
        const aid = r.logStage ? act({ investorId: i._id, kind: 'stage', stage: r.logStage }) : null
        return () => {
          patchInv(i._id, { stage: i.stage, lastTouch: i.lastTouch, maxStage: i.maxStage })
          if (aid) setActs((xs) => xs.filter((a) => a._id !== aid))
        }
      }
      if (p.op === 'touch') {
        const day = touchDay(p.date, t)
        const aid = act({ investorId: i._id, kind: 'note', note: p.note, touch: p.touch, date: day })
        patchInv(i._id, { lastTouch: !i.lastTouch || i.lastTouch < day ? day : i.lastTouch })
        return () => {
          setActs((xs) => xs.filter((a) => a._id !== aid))
          patchInv(i._id, { lastTouch: i.lastTouch })
        }
      }
      if (p.op === 'merge') {
        const drop = all.find((x) => x._id === s.otherInvestorId)
        if (!drop) return null
        const moved = latestActs.current.filter((a) => a.investorId === drop._id).map((a) => a._id)
        const email = i.email ?? drop.email
        const merged: Partial<Investor> = {
          email,
          emails: cleanEmails([...(i.emails ?? []), ...(drop.emails ?? []), ...(drop.email ? [drop.email] : [])], email),
          domains: cleanDomains([...(i.domains ?? []), ...(drop.domains ?? [])]),
          notes: [...new Set([i.notes.trim(), drop.notes.trim()].filter(Boolean))].join('\n\n'),
        }
        setActs((xs) => xs.map((a) => (moved.includes(a._id) ? { ...a, investorId: i._id } : a)))
        setInvestors((xs) => (xs ?? []).filter((x) => x._id !== drop._id).map((x) => (x._id === i._id ? { ...x, ...merged } : x)))
        return () => {
          setInvestors((xs) => [...(xs ?? []).map((x) => (x._id === i._id ? i : x)), drop])
          setActs((xs) => xs.map((a) => (moved.includes(a._id) ? { ...a, investorId: drop._id } : a)))
        }
      }
      // PST-277: the preview's Q&A bank is its own store (PreviewQanda), so questions from notes change nothing here.
      if (p.op === 'questions') return () => {}
      const set: Partial<Investor> =
        p.op === 'next_step'
          ? { nextStep: p.step, nextDate: p.date }
          : p.op === 'expected'
            ? { expected: p.amount }
            : p.op === 'warm_path'
              ? { notes: [i.notes.trim(), 'Warm path: ' + p.text].filter(Boolean).join('\n') }
              : { domains: cleanDomains([...(i.domains ?? []), p.domain]) }
      const before = Object.fromEntries(Object.keys(set).map((k) => [k, i[k as keyof Investor]])) as Partial<Investor>
      patchInv(i._id, set)
      return () => patchInv(i._id, before)
    }
    // PST-290: a touch, and what Undo needs (the preview's logNote too).
    const logTouch = async (id: string, note: string, o?: TouchOptions) => {
      const i = list.find((x) => x._id === id)
      if (!i) throw { data: 'That investor was deleted' }
      const from = { lastTouch: i.lastTouch, nextStep: i.nextStep, nextDate: i.nextDate }
      const { day, patch } = applyTouch(from, o, t)
      const activityId = act({ investorId: id, kind: 'note', note: note.trim(), touch: o?.touch, date: day })
      patchInv(id, patch)
      return { id, activityId, day, from, set: patch }
    }
    return {
      loaded: !!investors && !extra.loading,
      investors: list,
      acts,
      round,
      roundExists,
      me: 'Dev',
      save: w(async (id, f) => {
        const prev = id ? list.find((i) => i._id === id) ?? null : null
        const { lastTouch, maxStage, logStage } = applySave(prev, f, t)
        const nid = id ?? 'new' + Date.now()
        const doc: Investor = {
          ...f, _id: nid, lastTouch, maxStage, email: f.email?.trim() || undefined,
          emails: cleanEmails(f.emails, f.email).length ? cleanEmails(f.emails, f.email) : undefined,
          domains: cleanDomains(f.domains).length ? cleanDomains(f.domains) : undefined,
          parkedUntil: f.stage === 'parked' ? f.parkedUntil || undefined : undefined, _creationTime: prev?._creationTime ?? Date.now(),
          // PST-295: the lead fields aren't on the form (as in convex/investors.ts).
          canLead: prev?.canLead, leadAskedOn: prev?.leadAskedOn, leadOverride: prev && prev.lead !== f.lead ? f.lead : prev?.leadOverride,
        }
        setInvestors((xs) => (prev ? (xs ?? []).map((i) => (i._id === id ? doc : i)) : [...(xs ?? []), doc]))
        if (logStage) act({ investorId: nid, kind: 'stage', stage: logStage })
        return nid
      }),
      advance: w(async (id, next) => {
        const i = list.find((x) => x._id === id)
        const nx = i && applyAdvance(i, t)
        if (!i || !nx) return null
        const step = next ? { nextStep: next.step.trim(), nextDate: next.date || undefined } : {}
        setInvestors((xs) => (xs ?? []).map((x) => (x._id === id ? { ...x, stage: nx.stage, lastTouch: t, ...(nx.raiseMax ? { maxStage: nx.stage } : {}), ...step } : x)))
        act({ investorId: id, kind: 'stage', stage: nx.stage })
        return { stage: nx.stage, label: LABEL[nx.stage] }
      }),
      move: w(async (id, stage, o) => {
        const i = list.find((x) => x._id === id)
        if (!i) throw { data: 'That investor was deleted' }
        const from = { stage: i.stage, lastTouch: i.lastTouch, maxStage: i.maxStage, parkedUntil: i.parkedUntil ?? null }
        const until = stage === 'parked' && o && 'parkedUntil' in o ? o.parkedUntil ?? null : undefined
        if (i.stage === stage && until === undefined) return { id, to: stage, from, activityId: null }
        const { patch, logStage } = applyMove(i, stage, t, until)
        setInvestors((xs) => (xs ?? []).map((x) => (x._id === id ? { ...x, ...patch } : x)))
        const activityId = logStage ? act({ investorId: id, kind: 'stage', stage: logStage }) : null
        return { id, to: stage, from, activityId }
      }),
      undoMove: w(async (rec) => {
        // Undo runs from a toast created before the move, so read the latest rows.
        const i = latest.current?.find((x) => x._id === rec.id)
        const back = i && applyUndo(i, rec)
        if (!back) throw { data: 'It moved again since, so there’s nothing to undo' }
        setInvestors((xs) => (xs ?? []).map((x) => (x._id === rec.id ? { ...x, ...back } : x)))
        if (rec.activityId) setActs((xs) => xs.filter((a) => a._id !== rec.activityId))
      }),
      logNote: w(async (id, note, o) => (await logTouch(id, note, o)).day),
      // PST-290
      logTouch: w(logTouch),
      undoTouch: w(async (rec) => {
        setActs((xs) => xs.filter((a) => a._id !== rec.activityId))
        setInvestors((xs) => (xs ?? []).map((x) => (x._id === rec.id ? { ...x, ...undoTouchPatch(x, rec) } : x)))
      }),
      remove: w(async (id) => {
        setInvestors((xs) => (xs ?? []).filter((x) => x._id !== id))
        setActs((xs) => xs.filter((a) => a.investorId !== id))
      }),
      importMany: w(async (rows, file?: string) => {
        const stamp = Date.now()
        const ids = rows.map((_, k) => `imp${stamp}${k}`)
        setInvestors((xs) => [...(xs ?? []), ...rows.map((f, k) => ({ ...f, _id: ids[k], maxStage: 'todo' as const }))])
        if (rows.length) setLog((l) => [{ _id: `li${stamp}`, at: stamp, by: 'Dev', field: 'import', from: '', to: `${rows.length} investor${rows.length === 1 ? '' : 's'}${file ? ` from ${file}` : ''}` }, ...l])
        return { added: rows.length, skipped: 0, ids }
      }),
      updateRound: w(async (r) => {
        const ch = diffRound(round, r)
        setLog((l) => [...ch.map((c, k) => ({ ...c, _id: `l${Date.now()}${k}`, at: Date.now(), by: 'Dev' })), ...l])
        setRound(r)
        setRoundExists(true)
        return ch.length
      }),
      useLog: (id) => acts.filter((a) => a.investorId === id),
      useSettingsLog: () => log,
      usePrepTicks: (k) => (k ? ticks[k] ?? [] : undefined),
      setPrepTick: async (k, item, done) =>
        setTicks((m) => ({ ...m, [k]: done ? [...new Set([...(m[k] ?? []), item])] : (m[k] ?? []).filter((x) => x !== item) })),
      useMembers: () => fixtureMembers,
      google: g,
      googleDo: {
        connect: w(async () => {
          setGoogle(fixtureGoogle('syncing', list, Date.now()))
          return ''
        }),
        disconnect: w(async () => setGoogle(fixtureGoogle('none', list, Date.now()))),
        syncNow: w(async () => {
          setGoogle((x) => (x?.me ? { ...x, me: { ...x.me, running: true } } : x))
          setTimeout(() => setGoogle((x) => (x?.me ? { ...x, me: { ...x.me, running: false, lastSyncAt: Date.now() } } : x)), 1500)
        }),
        answer: w(async (eventId, answer) => setGoogle((x) => x && { ...x, meetings: x.meetings.map((m) => (m.eventId === eventId ? { ...m, answer } : m)) })),
        dismiss: w(async (email) => setGoogle((x) => x && { ...x, meetings: x.meetings.map((m) => (m.people.some((p) => p.email === email) ? { ...m, dismissed: [...(m.dismissed ?? []), email] } : m)) })),
      },
      suggestions: sortSuggestions(rows.filter((s) => s.status === 'open')),
      suggest: {
        accept: w(async (id) => {
          const s = rows.find((x) => x._id === id && x.status === 'open')
          if (!s) throw { data: 'That suggestion was already handled.' }
          if (s.patch.op === 'review') throw { data: 'This one needs a look in the drawer.' }
          const undo = applyOne(s)
          if (!undo) {
            setSuggestions((xs) => (xs ?? []).filter((x) => x._id !== id))
            return { applied: false }
          }
          undos.current.set(id, undo)
          decide([id], 'accepted')
          return { applied: true }
        }),
        dismiss: w(async (id) => decide([id], 'dismissed')),
        acceptSafe: w(async () => {
          const ids: string[] = []
          for (const s of sortSuggestions(rows.filter((x) => x.status === 'open' && acceptsTogether(x)))) {
            const undo = applyOne(s)
            if (!undo) continue
            undos.current.set(s._id, undo)
            ids.push(s._id)
          }
          decide(ids, 'accepted')
          return { ids }
        }),
        undo: w(async (ids) => {
          for (const id of [...ids].reverse()) {
            undos.current.get(id)?.()
            undos.current.delete(id)
          }
          decide(ids, 'open')
        }),
        check: async () => {
          if (emptyList) return
          const drafts = ruleSuggestions(checkInput(latest.current ?? [], latestActs.current, g, Date.now()))
          setSuggestions((xs) => {
            if (!xs) return xs
            const { add, update, withdraw } = reconcile(xs, drafts)
            if (!add.length && !update.length && !withdraw.length) return xs
            const next = xs.filter((s) => !withdraw.includes(s._id)).map((s) => ({ ...s, ...update.find((u) => u.id === s._id)?.draft }))
            return [...next, ...add.map(stamp(Date.now()))]
          })
        },
      },
    }
  }, [investors, acts, round, roundExists, log, ticks, extra.fail, extra.loading, google, suggestions, emptyList])

  // `&ai=…`: made-up enrichment; Keep writes through the preview's own save.
  const { keptFacts, ...enrich } = useAIPreview(aiState, investors, value.save, !!extra.fail)
  const fits = useMemo(() => fitsByInvestor(keptFacts, round), [keptFacts, round])
  // `&agents=…`: made-up agent keys and calls (Settings › Agents).
  const agents = useAgentsPreview(agentsState, !!extra.fail)
  // `&ask=…` and `&brief=…`: pretend Ask Nest runs and a made-up morning brief.
  const asking = useAskPreview({
    ask: askState, brief: briefState, investors, ready, acts, round, google, suggestions: value.suggestions, today: todayIST(), fail: !!extra.fail,
    askModel: modelFor(enrich.ai.models, 'ask'),
  })
  return (
    <RaiseContext.Provider value={{ ...value, ...enrich, useFits: () => fits, ...agents, ...asking }}>
      <PreviewQanda fail={!!extra.fail}>{children}</PreviewQanda>
    </RaiseContext.Provider>
  )
}
