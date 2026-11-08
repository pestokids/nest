// PST-298: Convex optimistic updates for the inbox, race, decisions and
// introducers changes a click makes (the rest are in optimistic.ts). Each shows
// the change in the local query results at once; Convex swaps in the saved rows
// when the mutation lands, or drops the guess if it fails.
import type { OptimisticLocalStore } from 'convex/browser'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { withStatus, type Decision } from '../lib/decisions'
import { normEmail } from '../lib/google'
import { normName, type Relation } from '../lib/introducers'

/* ---------- decisions ---------- */

type Patch = (d: Decision) => Decision

function patchDecision(store: OptimisticLocalStore, investorId: string, fn: Patch) {
  const cur = store.getQuery(api.decisions.data, {})
  if (cur) store.setQuery(api.decisions.data, {}, { ...cur, decisions: cur.decisions.map((d) => (d.investorId === investorId ? fn(d) : d)) })
}

function patchSignal(store: OptimisticLocalStore, signalId: string, p: { doneAt?: number; askDoneAt?: number; undoneAt?: number }) {
  const cur = store.getQuery(api.decisions.data, {})
  if (cur) store.setQuery(api.decisions.data, {}, { ...cur, signals: cur.signals.map((s) => (s._id === signalId ? { ...s, ...p } : s)) })
}

/** Undo of a status change: the status, reason and maybe-since it replaced (`before`: the decision as it was), unless it has changed again since. */
export function showDecisionBack(store: OptimisticLocalStore, before: Decision | undefined, after: Decision['status']) {
  if (!before) return
  patchDecision(store, before.investorId, (d) => {
    if (d.status !== after) return d
    const { status: _s, reason: _r, maybeSince: _m, ...rest } = d
    return { ...rest, ...(before.status ? { status: before.status } : {}), ...(before.reason ? { reason: before.reason } : {}), ...(before.maybeSince !== undefined ? { maybeSince: before.maybeSince } : {}) }
  })
}

/** A Decide row answered: it leaves the Inbox, and taking it changes the status. */
export function showResolve(store: OptimisticLocalStore, a: { signalId: string; accept: boolean }, now = Date.now()) {
  const s = store.getQuery(api.decisions.data, {})?.signals.find((x) => x._id === a.signalId)
  if (!s || s.doneAt) return
  if (a.accept && s.change) patchDecision(store, s.investorId, (d) => withStatus(d, s.change!.to, s.change!.reason, now))
  patchSignal(store, a.signalId, { doneAt: now })
}

/** Undo of the change Nest made from a signal: the status it had before, and the signal marked undone. */
export function showUndoSignal(store: OptimisticLocalStore, a: { signalId: string }, now = Date.now()) {
  const s = store.getQuery(api.decisions.data, {})?.signals.find((x) => x._id === a.signalId)
  if (!s?.change || s.undoneAt) return
  const { to, from } = s.change
  patchDecision(store, s.investorId, (d) => (d.status === to ? withStatus(d, from, undefined, now) : d))
  patchSignal(store, a.signalId, { undoneAt: now })
}

/** An ask's Inbox row is done. */
export function showDoneAsk(store: OptimisticLocalStore, a: { signalId: string }, now = Date.now()) {
  patchSignal(store, a.signalId, { askDoneAt: now })
}

/* ---------- race ---------- */

type LastUpdateRow = { _id: Id<'investorUpdates'>; sentOn: string; count: number; by: string }

/** Mark sent: the card's "Last update" reads today at once. */
export function showUpdateSent(store: OptimisticLocalStore, a: { count: number }, today: string) {
  const cur = store.getQuery(api.race.data, {})
  if (cur) store.setQuery(api.race.data, {}, { ...cur, lastUpdate: { _id: `optimistic-${crypto.randomUUID()}` as Id<'investorUpdates'>, sentOn: today, count: Math.max(0, Math.round(a.count)), by: '' } })
}

/** Undo of Mark sent: the update before it (`prev`) is the last one again. */
export function showUpdateUndone(store: OptimisticLocalStore, a: { id: string }, prev: LastUpdateRow | null) {
  const cur = store.getQuery(api.race.data, {})
  if (cur?.lastUpdate?._id === a.id) store.setQuery(api.race.data, {}, { ...cur, lastUpdate: prev })
}

/* ---------- introducers ---------- */

type Fields = { name: string; email?: string; relation: Relation; notes: string }
const tidy = (f: Fields) => ({ name: f.name.trim().replace(/\s+/g, ' '), email: normEmail(f.email) || undefined, relation: f.relation, notes: f.notes.trim() })

/** A new introducer shows in the list at once (someone already there by that name stays as they are). */
export function showIntroducer(store: OptimisticLocalStore, f: Fields, now = Date.now()) {
  const cur = store.getQuery(api.introducers.list, {})
  if (!cur || !normName(f.name) || f.relation === 'committed' || cur.introducers.some((p) => normName(p.name) === normName(f.name))) return
  store.setQuery(api.introducers.list, {}, { ...cur, introducers: [...cur.introducers, { _id: `optimistic-${crypto.randomUUID()}` as Id<'introducers'>, ...tidy(f), createdAt: now }] })
}

/** Edit details: the person's name, email, relation and notes change at once. */
export function showIntroducerEdit(store: OptimisticLocalStore, a: Fields & { id: string }) {
  const cur = store.getQuery(api.introducers.list, {})
  if (cur && a.relation !== 'committed') store.setQuery(api.introducers.list, {}, { ...cur, introducers: cur.introducers.map((p) => (p._id === a.id ? { ...p, ...tidy(a) } : p)) })
}

/** The intro from a person (or a committed investor) to an investor: shows at once unless it's there already. */
export function showLink(store: OptimisticLocalStore, a: { investorId: string; introducerId?: string; viaInvestorId?: string }, now = Date.now()) {
  const cur = store.getQuery(api.introducers.list, {})
  if (!cur || !a.introducerId === !a.viaInvestorId) return
  if (cur.intros.some((x) => x.investorId === a.investorId && (a.introducerId ? x.introducerId === a.introducerId : x.viaInvestorId === a.viaInvestorId))) return
  const from = a.introducerId ? { introducerId: a.introducerId as Id<'introducers'> } : { viaInvestorId: a.viaInvestorId as Id<'investors'> }
  store.setQuery(api.introducers.list, {}, { ...cur, intros: [...cur.intros, { _id: `optimistic-${crypto.randomUUID()}` as Id<'intros'>, investorId: a.investorId as Id<'investors'>, ...from, steps: {}, createdAt: now }] })
}

/** You nudged the introducer: the 3 days start again today. */
export function showNudged(store: OptimisticLocalStore, a: { introId: string }, today: string) {
  const cur = store.getQuery(api.introducers.list, {})
  if (cur) store.setQuery(api.introducers.list, {}, { ...cur, intros: cur.intros.map((x) => (x._id === a.introId ? { ...x, nudgedAt: today } : x)) })
}
