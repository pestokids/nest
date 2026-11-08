// PST-297: the Inbox's data. Every feature's sources go through buildInbox
// (src/lib/inbox.ts) once, above the app shell, so Today, Home's Inbox card and
// the top bar's count read the same rows. Done and snooze are per-person marks:
// Convex when signed in, an in-memory store under ?preview (where
// &today=inbox|phone|clear lay src/preview/inboxFixture.ts over the sources).
import { useMutation, useQuery } from 'convex/react'
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { api } from '../../../convex/_generated/api'
import { todayIST } from '../../lib/dates'
import { buildInbox, snoozeUntil, visibleInbox, type InboxMark, type InboxMarkKind, type InboxOpen, type InboxRow, type InboxSources, type InboxType } from '../../lib/inbox'
import { duration, topPage } from '../../lib/materials'
import { priorities } from '../../lib/priority'
import { previewInboxSources } from '../../preview/inboxFixture'
import { CloseProvider, useClose } from '../close/CloseData'
import { usePriorityScores } from '../investors/findMoreData'
import { useRaise } from '../data'
import { useDecisions } from '../decisions/data'
import { useIntroducers, useIntroInvestors } from '../introducers/data'
import { useMaterials } from '../materials/data'
import { useIndex, versionName } from '../materials/parts'
import { usePreviewState } from '../preview-state'
import type { ChipTone } from '../ui'

/** Each row type's chip, on Today and Home. */
export const INBOX_TONE: Record<InboxType, ChipTone> = {
  followup: 'waiting', reply: 'success', thank: 'success', report: 'success', decide: 'error', awaiting: 'waiting', confirm: 'selected', close: 'selected',
  due: 'outline', review: 'neutral', fix: 'success', opened: 'success', quiet: 'waiting', move: 'muted',
}

export type InboxValue = {
  loaded: boolean
  now: number
  today: string
  /** Every row, done and snoozed ones too. */
  all: InboxRow[]
  /** What's left, ranked: the list, Home's card and the count. */
  rows: InboxRow[]
  count: number
  /** Done or snoozed (until tomorrow 09:00 IST). Hides the row at once; resolves with the mark it replaced, for Undo. */
  mark: (row: InboxRow, kind: InboxMarkKind) => Promise<InboxMark | null>
  /** Undo: the mark it replaced, or none. */
  restore: (key: string, prev: InboxMark | null) => Promise<unknown>
  /** The Inbox is clear: true the first time today for this person (the confetti plays). */
  cleared: (day: string) => Promise<boolean>
}

type Marks = { loaded: boolean; list: InboxMark[]; mark: InboxValue['mark']; restore: InboxValue['restore']; cleared: InboxValue['cleared'] }

const Ctx = createContext<InboxValue | null>(null)

export function useInbox(): InboxValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useInbox outside InboxProvider')
  return v
}

/** Wrap the app shell (inside the Raise data, Introducers, Decisions and Materials). */
export function InboxProvider({ children }: { children: ReactNode }) {
  return (
    <CloseProvider>
      {usePreviewState() ? <PreviewInbox>{children}</PreviewInbox> : <ConvexInbox>{children}</ConvexInbox>}
    </CloseProvider>
  )
}

/** The clock the rows read: a minute is fine for deadlines, snoozes and "2h ago". */
function useMinute() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])
  return now
}

function useInboxValue(marks: Marks): InboxValue {
  const d = useRaise()
  const x = useDecisions()
  const intro = useIntroducers()
  const introInvestors = useIntroInvestors()
  const m = useMaterials()
  const ix = useIndex()
  const close = useClose()
  const fits = d.useFits()
  const preview = usePreviewState()
  const now = useMinute()
  const today = todayIST(now)

  const opens = useMemo(
    () =>
      m.notices.map((n): InboxOpen => {
        const l = m.links.find((k) => k._id === n.linkId)
        const s = l ? ix.stat(l) : undefined
        const page = s ? topPage(s.pageMs) : null
        const what = l ? versionName(ix.mat.get(l.materialId), ix.shown(l)) : 'a document'
        return { linkId: n.linkId, investorId: n.investorId, at: n.at, text: 'Read ' + what + (s?.totalMs ? ' for ' + duration(s.totalMs) : '') + (page ? ', longest on p' + page : '') }
      }),
    [m.notices, m.links, ix],
  )
  const jev = usePriorityScores()
  const priority = useMemo(() => {
    const p = priorities(d.investors, fits, today, jev)
    return (id: string) => p.get(id)?.score ?? 0
  }, [d.investors, fits, today, jev])

  const all = useMemo(() => {
    const src: InboxSources = {
      now, today, investors: d.investors, acts: d.acts, round: d.round, meetings: d.google.meetings, threads: d.google.threads,
      decisions: x.decisions, signals: x.signals, introducers: intro.introducers, intros: intro.intros, introInvestors,
      closings: close.closings, opens, suggestions: d.suggestions, priority, briefMoves: d.brief?.moves,
    }
    return buildInbox(previewInboxSources(preview?.today, src))
  }, [now, today, d.investors, d.acts, d.round, d.google, x.decisions, x.signals, intro.introducers, intro.intros, introInvestors, close.closings, opens, d.suggestions, priority, d.brief, preview?.today])

  const rows = useMemo(() => visibleInbox(all, new Map(marks.list.map((k) => [k.key, k])), now), [all, marks.list, now])
  const loaded = d.loaded && x.loaded && intro.loaded && close.loaded && m.loaded && marks.loaded
  return useMemo(
    () => ({ loaded, now, today, all, rows: loaded ? rows : [], count: loaded ? rows.length : 0, mark: marks.mark, restore: marks.restore, cleared: marks.cleared }),
    [loaded, now, today, all, rows, marks.mark, marks.restore, marks.cleared],
  )
}

function Provide({ marks, children }: { marks: Marks; children: ReactNode }) {
  return <Ctx.Provider value={useInboxValue(marks)}>{children}</Ctx.Provider>
}

/* ---------- Convex ---------- */

function ConvexInbox({ children }: { children: ReactNode }) {
  const list = useQuery(api.inbox.marks)
  const markM = useMutation(api.inbox.mark).withOptimisticUpdate((store, a) => {
    const cur = store.getQuery(api.inbox.marks, {})
    if (cur) store.setQuery(api.inbox.marks, {}, [...cur.filter((k) => k.key !== a.key), { key: a.key, kind: a.kind, version: a.version, ...(a.until !== undefined ? { until: a.until } : {}) }])
  })
  const restoreM = useMutation(api.inbox.restore).withOptimisticUpdate((store, a) => {
    const cur = store.getQuery(api.inbox.marks, {})
    if (cur) store.setQuery(api.inbox.marks, {}, [...cur.filter((k) => k.key !== a.key), ...(a.prev ? [{ key: a.key, ...a.prev }] : [])])
  })
  const clearedM = useMutation(api.inbox.cleared)
  const marks = useMemo<Marks>(
    () => ({
      loaded: !!list,
      list: list ?? [],
      mark: async (row, kind) => {
        const prev = await markM({ key: row.key, kind, version: row.version, ...(kind === 'snooze' ? { until: snoozeUntil(Date.now()) } : {}) })
        return prev ? { key: row.key, ...prev } : null
      },
      restore: (key, prev) => restoreM({ key, prev: prev ? { kind: prev.kind, version: prev.version, ...(prev.until !== undefined ? { until: prev.until } : {}) } : null }),
      cleared: (day) => clearedM({ day }),
    }),
    [list, markM, restoreM, clearedM],
  )
  return <Provide marks={marks}>{children}</Provide>
}

/** &today=clear: every row starts done, as if Dev had just cleared the Inbox. */
function ClearAll() {
  const { loaded, all } = useInbox()
  useEffect(() => {
    if (!loaded) return
    const marked = new Set(read().list.map((k) => k.key + '@' + k.version))
    const fresh = all.filter((r) => !marked.has(r.key + '@' + r.version))
    if (fresh.length) write((x) => ({ ...x, list: [...x.list.filter((k) => !fresh.some((r) => r.key === k.key)), ...fresh.map((r) => ({ key: r.key, kind: 'done' as const, version: r.version }))] }))
  }, [loaded, all])
  return null
}

/* ---------- preview: one store per page load ---------- */

type Store = { list: InboxMark[]; clearedOn: string | null }
let store: Store = { list: [], clearedOn: null }
const listeners = new Set<() => void>()
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
const read = () => store
const write = (fn: (s: Store) => Store) => {
  store = fn(store)
  listeners.forEach((l) => l())
}

function PreviewInbox({ children }: { children: ReactNode }) {
  const clear = usePreviewState()?.today === 'clear'
  const s = useSyncExternalStore(subscribe, read, read)
  const marks = useMemo<Marks>(
    () => ({
      loaded: true,
      list: s.list,
      mark: async (row, kind) => {
        const prev = read().list.find((k) => k.key === row.key) ?? null
        const next: InboxMark = { key: row.key, kind, version: row.version, ...(kind === 'snooze' ? { until: snoozeUntil(Date.now()) } : {}) }
        write((x) => ({ ...x, list: [...x.list.filter((k) => k.key !== row.key), next] }))
        return prev
      },
      restore: async (key, prev) => write((x) => ({ ...x, list: [...x.list.filter((k) => k.key !== key), ...(prev ? [prev] : [])] })),
      cleared: async (day) => {
        if (read().clearedOn === day) return false
        write((x) => ({ ...x, clearedOn: day }))
        return true
      },
    }),
    [s.list],
  )
  return (
    <Provide marks={marks}>
      {clear ? <ClearAll /> : null}
      {children}
    </Provide>
  )
}
