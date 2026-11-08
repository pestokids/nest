// PST-290: Convex optimistic updates for the instant changes. Each shows the
// change in the local query results at once; Convex swaps in the saved rows
// when the mutation lands (or drops the guess if it fails).
import type { OptimisticLocalStore } from 'convex/browser'
import type { FunctionArgs } from 'convex/server'
import { api } from '../../convex/_generated/api'
import type { Doc, Id } from '../../convex/_generated/dataModel'
import { todayIST } from '../lib/dates'
import type { AISettings } from '../lib/enrich'
import { cleanCompanies } from '../lib/findMore'
import { normEmail } from '../lib/google'
import { AI_MODEL, type Feature, type Model } from '../lib/models'
import { applyAdvance, applySave } from '../lib/pipeline'
import { validateRound, type Round } from '../lib/round'
import { IDX, type PipelineStage } from '../lib/stages'
import { acceptsTogether, sortSuggestions } from '../lib/suggestions'
import { applyTouch, undoTouchPatch, type TouchFields } from '../lib/touch'

type NoteArgs = { id: Id<'investors'>; note: string; touch?: Doc<'activities'>['touch']; date?: string; next?: { step: string; date?: string | null } }

/** A logged touch: lastTouch (and the next step) on the investor, and its row at the top of both activity lists. */
export function showTouch(store: OptimisticLocalStore, a: NoteArgs, by: string, today = todayIST()) {
  const list = store.getQuery(api.investors.list, {})
  const i = list?.find((x) => x._id === a.id)
  if (!list || !i) return
  const { day, patch } = applyTouch(i, { touch: a.touch, date: a.date, next: a.next ? { step: a.next.step, date: a.next.date ?? undefined } : undefined }, today)
  store.setQuery(api.investors.list, {}, list.map((x) => (x._id === a.id ? { ...x, ...patch } : x)))
  const row = {
    _id: `optimistic-${crypto.randomUUID()}` as Id<'activities'>, _creationTime: Date.now(), investorId: a.id, kind: 'note' as const,
    note: a.note.trim(), ...(a.touch ? { touch: a.touch } : {}), date: day, userId: '' as Id<'users'>, by,
  }
  const recent = store.getQuery(api.activities.recent, {})
  if (recent) store.setQuery(api.activities.recent, {}, [row, ...recent])
  const theirs = store.getQuery(api.activities.forInvestor, { investorId: a.id })
  if (theirs) store.setQuery(api.activities.forInvestor, { investorId: a.id }, [row, ...theirs])
}

/** Undo of a touch: its row goes, and the fields go back unless they changed again since. */
export function hideTouch(store: OptimisticLocalStore, a: { id: Id<'investors'>; activityId: Id<'activities'>; from: TouchFields; set: TouchFields }) {
  const list = store.getQuery(api.investors.list, {})
  if (list) store.setQuery(api.investors.list, {}, list.map((i) => (i._id === a.id ? { ...i, ...undoTouchPatch(i, a) } : i)))
  const recent = store.getQuery(api.activities.recent, {})
  if (recent) store.setQuery(api.activities.recent, {}, recent.filter((x) => x._id !== a.activityId))
  const theirs = store.getQuery(api.activities.forInvestor, { investorId: a.id })
  if (theirs) store.setQuery(api.activities.forInvestor, { investorId: a.id }, theirs.filter((x) => x._id !== a.activityId))
}

/** One stage on (the drawer's Move button), with its next step. */
export function showAdvance(store: OptimisticLocalStore, a: { id: Id<'investors'>; next?: { step: string; date?: string | null } }, today = todayIST()) {
  const list = store.getQuery(api.investors.list, {})
  if (!list) return
  store.setQuery(api.investors.list, {}, list.map((i) => {
    const nx = i._id === a.id ? applyAdvance(i, today) : null
    if (!nx) return i
    return { ...i, stage: nx.stage, lastTouch: nx.lastTouch, ...(nx.raiseMax ? { maxStage: nx.stage } : {}), ...(a.next ? { nextStep: a.next.step.trim(), nextDate: a.next.date ?? undefined } : {}) }
  }))
}

/* ---------- PST-298: every other change a user makes shows first too ---------- */

type Store = OptimisticLocalStore

/**
 * Rows an optimistic update took out of a list (a dismissed fact, a deleted
 * question), so the Undo that puts one back can show it at once too, after the
 * server has already dropped it from the results.
 */
const taken = new Map<string, unknown>()
export const take = (id: string, row: unknown) => void taken.set(id, row)
export const given = <T>(id: string) => taken.get(id) as T | undefined

/** An edited investor (a new one waits for its id): the cleaned fields, with lastTouch and maxStage as the server works them out. */
export function showSave(store: Store, a: FunctionArgs<typeof api.investors.upsert>, today = todayIST()) {
  const list = store.getQuery(api.investors.list, {})
  const prev = a.id ? list?.find((i) => i._id === a.id) : undefined
  const f = a.fields
  if (!list || !prev || !f.name.trim()) return
  const num = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? undefined : Math.max(0, x))
  const body = {
    ...f,
    name: f.name.trim(), firm: f.firm.trim(), path: f.path.trim(), nextStep: f.nextStep.trim(), notes: f.notes.trim(), source: f.source.trim(),
    expected: num(f.expected), committed: num(f.committed), nextDate: f.nextDate || undefined, lastTouch: f.lastTouch || undefined, email: f.email?.trim() || undefined,
    parkedUntil: f.stage === 'parked' ? f.parkedUntil || undefined : undefined,
    emails: f.emails === undefined ? prev.emails : f.emails?.length ? f.emails : undefined,
    domains: f.domains === undefined ? prev.domains : f.domains?.length ? f.domains : undefined,
  }
  const { lastTouch, maxStage } = applySave(prev, body, today)
  store.setQuery(api.investors.list, {}, list.map((i) => (i._id === a.id ? { ...i, ...body, lastTouch, maxStage } : i)))
}

/** A deleted investor leaves the list. */
export function hideInvestor(store: Store, id: Id<'investors'>) {
  const list = store.getQuery(api.investors.list, {})
  if (list) store.setQuery(api.investors.list, {}, list.filter((i) => i._id !== id))
}

/** A move back marked as a correction (or not): the move's row says so, and the furthest stage follows. */
export function showCorrection(store: Store, a: { activityId: Id<'activities'>; on: boolean }) {
  const recent = store.getQuery(api.activities.recent, {})
  const theirs = store.getAllQueries(api.activities.forInvestor)
  const act = [recent, ...theirs.map((q) => q.value)].flatMap((l) => l ?? []).find((x) => x._id === a.activityId)
  const list = store.getQuery(api.investors.list, {})
  const inv = list?.find((i) => i._id === act?.investorId)
  if (!act?.stage || !list || !inv || !!act.correction === a.on) return
  const maxStage = a.on ? ((IDX[act.stage] !== undefined ? act.stage : 'todo') as PipelineStage) : act.correction?.maxBefore
  if (maxStage) store.setQuery(api.investors.list, {}, list.map((i) => (i === inv ? { ...i, maxStage } : i)))
  const mark = <T extends { _id: string }>(rows: T[]) => rows.map((x) => (x._id === a.activityId ? { ...x, correction: a.on ? { maxBefore: inv.maxStage } : undefined } : x))
  if (recent) store.setQuery(api.activities.recent, {}, mark(recent))
  for (const q of theirs) if (q.value) store.setQuery(api.activities.forInvestor, q.args, mark(q.value))
}

/** Settings › Round saved (a form with errors waits for the server's messages). */
export function showRound(store: Store, round: Round) {
  if (Object.keys(validateRound(round)).length) return
  store.setQuery(api.settings.get, {}, { round, exists: true })
}

/** A prep to-do ticked or unticked. */
export function showPrepTick(store: Store, a: { phaseKey: string; item: number; done: boolean }, by: string) {
  const rows = store.getQuery(api.prep.list, { phaseKey: a.phaseKey })
  if (!rows) return
  const rest = rows.filter((r) => r.item !== a.item)
  store.setQuery(api.prep.list, { phaseKey: a.phaseKey }, a.done ? [...rest, rows.find((r) => r.item === a.item) ?? { item: a.item, doneAt: Date.now(), by }] : rest)
}

type GoogleOp = { eventId: string; answer: 'm1' | 'm2' | 'passed' } | { dismiss: string } | { syncing: true } | { disconnected: true }

/** Calendar and Gmail: how a meeting went, "Not about the round" for a person, Sync now, and Disconnect (its synced meetings and emails go). */
export function showGoogle(store: Store, op: GoogleOp) {
  const g = store.getQuery(api.google.data, {})
  if (!g) return
  if ('eventId' in op) return store.setQuery(api.google.data, {}, { ...g, meetings: g.meetings.map((m) => (m.eventId === op.eventId ? { ...m, answer: op.answer } : m)) })
  if ('dismiss' in op) {
    const e = normEmail(op.dismiss)
    const hit = (m: (typeof g.meetings)[number]) => m.mine && m.people.some((p) => p.email === e) && !m.dismissed?.includes(e)
    return store.setQuery(api.google.data, {}, { ...g, meetings: g.meetings.map((m) => (hit(m) ? { ...m, dismissed: [...(m.dismissed ?? []), e] } : m)) })
  }
  if ('syncing' in op) return store.setQuery(api.google.data, {}, { ...g, me: g.me && { ...g.me, running: true } })
  store.setQuery(api.google.data, {}, { ...g, me: null, team: g.team.filter((t) => !t.mine), meetings: g.meetings.filter((m) => !m.mine), threads: g.threads.filter((t) => !t.mine) })
}

/** Suggestions accepted or dismissed leave the queue (`safe`: every one "Accept N safe ones" takes). */
export function hideSuggestions(store: Store, a: { ids: Id<'suggestions'>[] } | { safe: true }) {
  const list = store.getQuery(api.suggestions.list, {})
  if (!list) return
  const gone = (s: (typeof list)[number]) => ('safe' in a ? acceptsTogether(s) : a.ids.includes(s._id))
  for (const s of list) if (gone(s)) take(s._id, s)
  store.setQuery(api.suggestions.list, {}, list.filter((s) => !gone(s)))
}

/** Their Undo puts them back. */
export function showSuggestionsBack(store: Store, ids: Id<'suggestions'>[]) {
  const list = store.getQuery(api.suggestions.list, {})
  if (!list) return
  const back = ids.flatMap((id) => (list.some((s) => s._id === id) ? [] : (given<(typeof list)[number]>(id) ?? [])))
  if (back.length) store.setQuery(api.suggestions.list, {}, sortSuggestions([...list, ...back]))
}

/** Enrichment's review: a fact kept or dismissed, or every pending one of a run. The drawer, Who's this? and the pending counts follow. */
export function showFacts(store: Store, a: { factId: Id<'facts'> } | { runId: Id<'enrichRuns'> }, to: 'kept' | 'dismissed') {
  let of: string | undefined
  const decide = <T extends Doc<'facts'>>(facts: T[]): T[] =>
    facts.flatMap((f) => {
      if (f.status !== 'pending' || ('factId' in a ? f._id !== a.factId : f.runId !== a.runId)) return [f]
      of = f.investorId
      if (to === 'kept') return [{ ...f, status: 'kept' as const }]
      take(f._id, f)
      return []
    })
  for (const q of store.getAllQueries(api.enrich.forInvestor)) if (q.value) store.setQuery(api.enrich.forInvestor, q.args, { ...q.value, facts: decide(q.value.facts) })
  const d = store.getQuery(api.enrich.data, {})
  if (!d) return
  const senders = d.senders.map((s) => ({ ...s, facts: decide(s.facts) }))
  const runs = d.runs.map((r) => ('runId' in a ? (r._id === a.runId ? { ...r, pending: 0 } : r) : r.investorId === of ? { ...r, pending: Math.max(0, r.pending - 1) } : r))
  store.setQuery(api.enrich.data, {}, { ...d, senders, runs })
}

/** The Undo of a dismissed fact. */
export function showFactBack(store: Store, factId: Id<'facts'>) {
  const f = given<Doc<'facts'>>(factId)
  if (!f) return
  const back = <T extends Doc<'facts'>>(facts: T[]) => (facts.some((x) => x._id === factId) ? facts : [...facts, { ...f, status: 'pending' } as T])
  for (const q of store.getAllQueries(api.enrich.forInvestor)) if (q.value && q.args.investorId === f.investorId) store.setQuery(api.enrich.forInvestor, q.args, { ...q.value, facts: back(q.value.facts) })
  const d = store.getQuery(api.enrich.data, {})
  if (!d) return
  const senders = d.senders.map((s) => (!f.investorId && s.run._id === f.runId ? { ...s, facts: back(s.facts) } : s))
  const runs = d.runs.map((r) => (f.investorId && r.investorId === f.investorId ? { ...r, pending: r.pending + 1 } : r))
  store.setQuery(api.enrich.data, {}, { ...d, senders, runs })
}

/** Settings › AI: the automatic toggles, a model (`feature` left out: the default; null: back to it) and Jev's switch and cap. */
export function showAI(store: Store, op: { auto: Partial<AISettings> } | { feature?: Feature; model: Model | null } | { jev: { on?: boolean; capUsd?: number } }) {
  const d = store.getQuery(api.enrich.data, {})
  if ('jev' in op) {
    const { on, capUsd } = op.jev
    if (capUsd !== undefined && !(Number.isFinite(capUsd) && capUsd >= 0)) return
    const jev = { ...(on !== undefined ? { on } : {}), ...(capUsd !== undefined ? { capUsd: Math.round(capUsd * 100) / 100 } : {}) }
    if (d) store.setQuery(api.enrich.data, {}, { ...d, jev: { ...d.jev, ...jev } })
    const f = store.getQuery(api.findMore.state, {})
    if (f && on !== undefined) store.setQuery(api.findMore.state, {}, { ...f, jev: on })
    return
  }
  if (!d) return
  if ('auto' in op) return store.setQuery(api.enrich.data, {}, { ...d, settings: { ...d.settings, ...Object.fromEntries(Object.entries(op.auto).filter(([, x]) => x !== undefined)) } })
  const models = op.feature
    ? { ...d.models, features: Object.fromEntries(Object.entries({ ...d.models.features, [op.feature]: op.model }).filter(([, m]) => m)) }
    : { ...d.models, default: op.model ?? AI_MODEL }
  store.setQuery(api.enrich.data, {}, { ...d, models })
}

/** The drawer's People: someone made the main contact. */
export function showPrimary(store: Store, personId: Id<'people'>) {
  for (const q of store.getAllQueries(api.enrich.forInvestor))
    if (q.value?.people.some((p) => p._id === personId)) store.setQuery(api.enrich.forInvestor, q.args, { ...q.value, people: q.value.people.map((p) => ({ ...p, primary: p._id === personId })) })
}

/** Enrich's Stop: the run stops where it is. */
export function showStopped(store: Store, runId: Id<'enrichRuns'>) {
  const stop = <T extends { _id: string; status: string; finishedAt?: number }>(r: T): T => (r._id === runId ? { ...r, status: 'stopped', finishedAt: Date.now() } : r)
  for (const q of store.getAllQueries(api.enrich.forInvestor)) if (q.value?.run?._id === runId) store.setQuery(api.enrich.forInvestor, q.args, { ...q.value, run: stop(q.value.run) })
  const d = store.getQuery(api.enrich.data, {})
  if (d) store.setQuery(api.enrich.data, {}, { ...d, runs: d.runs.map(stop) })
}

/** Someone added to the drawer's People (the first one is the main contact). */
export function showPerson(store: Store, a: FunctionArgs<typeof api.enrich.addPerson>) {
  const ai = store.getQuery(api.enrich.forInvestor, { investorId: a.investorId })
  const name = a.name.trim().slice(0, 120)
  if (!ai || !name) return
  const email = normEmail(a.email)
  const p = {
    _id: `optimistic-${crypto.randomUUID()}` as Id<'people'>, _creationTime: Date.now(), investorId: a.investorId, name, primary: !ai.people.some((x) => x.primary),
    ...(a.title?.trim() ? { title: a.title.trim().slice(0, 120) } : {}), ...(email ? { email } : {}),
  }
  store.setQuery(api.enrich.forInvestor, { investorId: a.investorId }, { ...ai, people: [...ai.people, p] })
}

/** A revoked agent key leaves the list. */
export function hideAgentKey(store: Store, id: Id<'agentKeys'>) {
  const a = store.getQuery(api.agents.list, {})
  if (a) store.setQuery(api.agents.list, {}, { ...a, keys: a.keys.filter((k) => k._id !== id) })
}

/** The morning brief folded to one line, or shown again. */
export function showBrief(store: Store, a: { id: Id<'briefs'>; dismissed: boolean }) {
  const b = store.getQuery(api.brief.today, {})
  if (b?._id === a.id) store.setQuery(api.brief.today, {}, { ...b, dismissedAt: a.dismissed ? Date.now() : undefined })
}

/** Find more: the companies chips, and candidates added (they wait in Suggestions). */
export function showFind(store: Store, op: { companies: string[] } | { added: Id<'findCandidates'>[] }) {
  const s = store.getQuery(api.findMore.state, {})
  if (!s) return
  if ('companies' in op) return store.setQuery(api.findMore.state, {}, { ...s, companies: cleanCompanies(op.companies) })
  const n = s.candidates.filter((c) => op.added.includes(c._id)).length
  store.setQuery(api.findMore.state, {}, { ...s, run: s.run && { ...s.run, added: s.run.added + n }, candidates: s.candidates.filter((c) => !op.added.includes(c._id)) })
}

/** Drafts: "I sent it" (a draft kept as it is in the fields shows its new text too). */
export function showDraft(store: Store, a: { draftId: Id<'drafts'>; sent?: true; subject?: string; body?: string; to?: string }) {
  for (const q of store.getAllQueries(api.drafts.forInvestor)) {
    if (!q.value?.drafts.some((x) => x._id === a.draftId)) continue
    const drafts = q.value.drafts.map((x) =>
      x._id !== a.draftId || x.status === 'sent' ? x : a.sent ? { ...x, status: 'sent' as const, sentAt: Date.now() } : { ...x, subject: a.subject?.trim() ?? x.subject, body: a.body?.trim() ?? x.body, to: a.to?.trim() || x.to },
    )
    store.setQuery(api.drafts.forInvestor, q.args, { ...q.value, drafts })
  }
}

type MaterialsOp = { current: Id<'materialVersions'> } | { revoke: Id<'shareLinks'> } | { seen: Id<'shareLinks'>[] } | { remove: Id<'materials'> }

/** Materials: a version made current, a link revoked, first-open notices seen, and a material deleted (after its confirmation). */
export function showMaterials(store: Store, op: MaterialsOp) {
  const d = store.getQuery(api.materials.data, {})
  if (!d) return
  if ('current' in op) {
    const v = d.versions.find((x) => x._id === op.current)
    if (v) store.setQuery(api.materials.data, {}, { ...d, materials: d.materials.map((m) => (m._id === v.materialId ? { ...m, currentVersionId: v._id } : m)) })
    return
  }
  if ('revoke' in op) return store.setQuery(api.materials.data, {}, { ...d, links: d.links.map((l) => (l._id === op.revoke && l.revokedAt === undefined ? { ...l, revokedAt: Date.now() } : l)) })
  if ('seen' in op) return store.setQuery(api.materials.data, {}, { ...d, notices: d.notices.filter((n) => !op.seen.includes(n.linkId)) })
  const gone = new Set(d.links.filter((l) => l.materialId === op.remove).map((l) => l._id as string))
  store.setQuery(api.materials.data, {}, {
    ...d,
    materials: d.materials.filter((m) => m._id !== op.remove),
    versions: d.versions.filter((v) => v.materialId !== op.remove),
    links: d.links.filter((l) => !gone.has(l._id)),
    stats: d.stats.filter((s) => !gone.has(s.linkId)),
    notices: d.notices.filter((n) => !gone.has(n.linkId)),
  })
}
