// PST-298: the Close tab's writes show at once (Convex optimistic updates), the
// way convex/closings.ts makes them; Convex swaps in the saved rows when the
// mutation lands, or drops the guess when it's refused.
import type { OptimisticLocalStore } from 'convex/browser'
import type { FunctionArgs } from 'convex/server'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { applyMove } from '../../lib/board'
import { checkTick, cleanCapTable, cleanTerms, planTick, setStep, validateCapTable, validateTerms, type StepKey } from '../../lib/close'
import { checkTranche2, trancheOf } from '../../lib/closeKit'
import { todayIST } from '../../lib/dates'
import { COMMIT } from '../../lib/stages'

type Store = OptimisticLocalStore

/** A step ticked, re-dated or unticked; signed and wired move the investor's stage as well. */
export function showTick(store: Store, a: { id: Id<'closings'>; key: StepKey; at: string | null }, today = todayIST()) {
  const d = store.getQuery(api.closings.data, {})
  const list = store.getQuery(api.investors.list, {})
  const c = d?.closings.find((x) => x._id === a.id)
  const inv = list?.find((i) => i._id === c?.investorId)
  if (!d || !list || !c || !inv) return
  const plan = planTick(c, inv.stage, a.key, a.at, today)
  if ('error' in plan) return
  store.setQuery(api.closings.data, {}, { ...d, closings: d.closings.map((x) => (x === c ? { ...x, steps: plan.steps } : x)) })
  const to = plan.to
  if (to) store.setQuery(api.investors.list, {}, list.map((i) => (i === inv ? { ...i, ...applyMove(inv, to, today).patch } : i)))
}

/** The terms saved (Record SAFE sent ticks "sent" too); the amount becomes the investor's Committed. A form the server would refuse waits for its messages. */
export function showCloseSave(store: Store, a: FunctionArgs<typeof api.closings.save>, today = todayIST()) {
  const d = store.getQuery(api.closings.data, {})
  const list = store.getQuery(api.investors.list, {})
  const inv = list?.find((i) => i._id === a.investorId)
  const body = cleanTerms(a.terms)
  if (!d || !list || !inv || Object.keys(validateTerms(body)).length) return
  const prev = d.closings.find((c) => c.investorId === a.investorId)
  if (!prev && !COMMIT.has(inv.stage)) return
  if (a.sentAt && checkTick(prev?.steps ?? [], 'sent', a.sentAt, today)) return
  const steps = a.sentAt ? setStep(prev?.steps ?? [], 'sent', a.sentAt) : (prev?.steps ?? [])
  const kit = prev ? { tranche: prev.tranche, confirmationSentAt: prev.confirmationSentAt, acceptedAt: prev.acceptedAt, questionnaire: prev.questionnaire } : {}
  const row = {
    _id: prev?._id ?? (`optimistic-${crypto.randomUUID()}` as Id<'closings'>), _creationTime: prev?._creationTime ?? Date.now(),
    investorId: a.investorId, ...body, steps, ...kit, updatedAt: Date.now(), updatedBy: prev?.updatedBy ?? ('' as Id<'users'>),
  }
  store.setQuery(api.closings.data, {}, { ...d, closings: [...d.closings.filter((c) => c !== prev), row] })
  if (inv.committed !== body.amount) store.setQuery(api.investors.list, {}, list.map((i) => (i === inv ? { ...i, committed: body.amount } : i)))
}

/** A record removed (after its confirmation). */
export function hideClosing(store: Store, id: Id<'closings'>) {
  const d = store.getQuery(api.closings.data, {})
  if (d) store.setQuery(api.closings.data, {}, { ...d, closings: d.closings.filter((c) => c._id !== id) })
}

/** The Close kit's steps on a record: they accepted, the questionnaire, the tranche (and with it the cap). */
export function showKit(store: Store, a: FunctionArgs<typeof api.closings.setKit>) {
  const d = store.getQuery(api.closings.data, {})
  const c = d?.closings.find((x) => x._id === a.id)
  if (!d || !c) return
  const next = { ...c }
  if (a.accepted === true && !c.acceptedAt) {
    if (!c.confirmationSentAt) return
    next.acceptedAt = Date.now()
  }
  if (a.accepted === false) next.acceptedAt = undefined
  if (a.questionnaire) next.questionnaire = a.questionnaire === 'none' ? undefined : a.questionnaire
  if (a.tranche && a.tranche !== trancheOf(c)) {
    if (a.tranche === 2 && !d.tranche2) return
    const cap = a.tranche === 2 ? d.tranche2?.cap : store.getQuery(api.settings.get, {})?.round.cap
    next.tranche = a.tranche === 2 ? 2 : undefined
    if (cap) next.cap = cap
  }
  store.setQuery(api.closings.data, {}, { ...d, closings: d.closings.map((x) => (x === c ? next : x)) })
}

/** Tranche 2's cap set up, changed (every tranche-2 record follows) or taken away. */
export function showTranche2(store: Store, cap: number | null) {
  const d = store.getQuery(api.closings.data, {})
  if (!d) return
  const inTwo = d.closings.filter((c) => trancheOf(c) === 2)
  if (cap === null ? inTwo.length : checkTranche2(cap, store.getQuery(api.settings.get, {})?.round.cap)) return
  store.setQuery(api.closings.data, {}, {
    ...d,
    tranche2: cap === null ? null : { cap },
    closings: cap === null ? d.closings : d.closings.map((c) => (trancheOf(c) === 2 ? { ...c, cap } : c)),
  })
}

/** What an investor gets (null: back to the suggestion) and why. */
export function showAllocation(store: Store, a: FunctionArgs<typeof api.closings.setAllocation>) {
  const d = store.getQuery(api.closings.data, {})
  if (!d || (typeof a.gets === 'number' && (!Number.isFinite(a.gets) || a.gets < 0))) return
  const prev = d.allocations.find((x) => x.investorId === a.investorId)
  const gets = a.gets === undefined ? prev?.gets : a.gets === null ? undefined : Math.round(a.gets)
  const row = { investorId: a.investorId, gets, why: a.why === undefined ? (prev?.why ?? '') : a.why.trim().slice(0, 200) }
  store.setQuery(api.closings.data, {}, { ...d, allocations: [...d.allocations.filter((x) => x !== prev), row] })
}

/** Settings › Round › Cap table saved (or cleared). */
export function showCapTable(store: Store, capTable: FunctionArgs<typeof api.closings.setCapTable>['capTable']) {
  const d = store.getQuery(api.closings.data, {})
  const next = capTable ? cleanCapTable(capTable) : null
  if (!d || (next && Object.keys(validateCapTable(next)).length)) return
  store.setQuery(api.closings.data, {}, { ...d, capTable: next })
}
