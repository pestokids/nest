// PST-283: what the Close tab and the Settings cap table card read and write.
// Its own provider, so the shared Raise data layer stays as it is: Convex when
// signed in, an in-memory store over the preview fixture under ?preview.
import { useAction, useMutation, useQuery } from 'convex/react'
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { cleanCapTable, cleanTerms, planTick, reminderKind, setStep, checkTick, validateCapTable, validateTerms, type CapTable, type Closing, type ClosingTerms, type Questionnaire, type StepKey } from '../../lib/close'
import { checkTranche2, commitmentTerms, trancheOf, type Allocation, type Tranche2 } from '../../lib/closeKit'
import { todayIST } from '../../lib/dates'
import { fieldsOf } from '../../lib/pipeline'
import { COMMIT, type Stage } from '../../lib/stages'
import { closePreview, fixtureCloseStore } from '../../preview/closeFixture'
import { useRaise } from '../data'
import { usePreviewState } from '../preview-state'
import { hideClosing, showAllocation, showCapTable, showCloseSave, showKit, showTick, showTranche2 } from './optimistic'

export type TickResult = { to: Stage | null; firstMoney: boolean }

export type CloseData = {
  loaded: boolean
  closings: Closing[]
  /** Null until someone fills in Settings › Round › Cap table. */
  capTable: CapTable | null
  /** Create or update a record (every term, links included). `sentAt` also ticks "SAFE sent". Resolves with its id. */
  save: (investorId: string, terms: ClosingTerms, sentAt?: string) => Promise<string>
  /** Tick, re-date or (with null) untick a step; signed and wired move the pipeline stage. */
  tick: (id: string, key: StepKey, at: string | null) => Promise<TickResult>
  remove: (id: string) => Promise<unknown>
  /** Resolves with 1 when it changed, 0 when nothing had. */
  setCapTable: (c: CapTable | null) => Promise<number>
  /** RESEND_API_KEY is set, so reminders can go by email. */
  emailReady: boolean
  /** Email a reminder to the record's signer and log an Email touch. Resolves with the address. */
  emailReminder: (id: string, subject: string, text: string) => Promise<{ to: string }>
  /** PST-291: tranche 2's cap (null until it's set up) and the saved allocation rows. */
  tranche2: Tranche2 | null
  allocations: Allocation[]
  /** The kit's steps on a record: they accepted (now), the questionnaire, the tranche. */
  setKit: (id: string, patch: KitPatch) => Promise<unknown>
  /** Set up or change tranche 2's cap (null takes it away). Resolves with 1 when it changed. */
  setTranche2: (cap: number | null) => Promise<number>
  /** What an investor gets (null: back to the suggestion) and why. */
  setAllocation: (investorId: string, patch: { gets?: number | null; why?: string }) => Promise<unknown>
}

export type KitPatch = { accepted?: boolean; questionnaire?: Questionnaire | 'none'; tranche?: 1 | 2 }

const CloseContext = createContext<CloseData | null>(null)

export function useClose(): CloseData {
  const v = useContext(CloseContext)
  if (!v) throw new Error('useClose outside CloseProvider')
  return v
}

/** Wrap anything that reads closings or the cap table. */
export function CloseProvider({ children }: { children: ReactNode }) {
  return usePreviewState() ? <PreviewClose>{children}</PreviewClose> : <ConvexClose>{children}</ConvexClose>
}

function ConvexClose({ children }: { children: ReactNode }) {
  const data = useQuery(api.closings.data)
  // PST-298: every write shows at once (./optimistic.ts); a reminder email waits for Resend.
  const save = useMutation(api.closings.save).withOptimisticUpdate((store, a) => showCloseSave(store, a))
  const tick = useMutation(api.closings.tick).withOptimisticUpdate((store, a) => showTick(store, a))
  const remove = useMutation(api.closings.remove).withOptimisticUpdate((store, { id }) => hideClosing(store, id))
  const setCapTable = useMutation(api.closings.setCapTable).withOptimisticUpdate((store, { capTable }) => showCapTable(store, capTable))
  const emailReminder = useAction(api.closings.emailReminder)
  const setKit = useMutation(api.closings.setKit).withOptimisticUpdate((store, a) => showKit(store, a))
  const setTranche2 = useMutation(api.closings.setTranche2).withOptimisticUpdate((store, { cap }) => showTranche2(store, cap))
  const setAllocation = useMutation(api.closings.setAllocation).withOptimisticUpdate((store, a) => showAllocation(store, a))
  const value = useMemo<CloseData>(
    () => ({
      loaded: !!data,
      closings: data?.closings ?? [],
      capTable: data?.capTable ?? null,
      save: (investorId, terms, sentAt) => save({ investorId: investorId as Id<'investors'>, terms, sentAt }),
      tick: (id, key, at) => tick({ id: id as Id<'closings'>, key, at }),
      remove: (id) => remove({ id: id as Id<'closings'> }),
      setCapTable: (capTable) => setCapTable({ capTable }),
      emailReady: data?.emailReady ?? false,
      emailReminder: (id, subject, text) => emailReminder({ id: id as Id<'closings'>, subject, text }),
      tranche2: data?.tranche2 ?? null,
      allocations: data?.allocations ?? [],
      setKit: (id, patch) => setKit({ id: id as Id<'closings'>, ...patch }),
      setTranche2: (cap) => setTranche2({ cap }),
      setAllocation: (investorId, patch) => setAllocation({ investorId: investorId as Id<'investors'>, ...patch }),
    }),
    [data, save, tick, remove, setCapTable, emailReminder, setKit, setTranche2, setAllocation],
  )
  return <CloseContext.Provider value={value}>{children}</CloseContext.Provider>
}

/* ---------- preview: one store per page load, so ticks survive moving between views ---------- */

type Store = { closings: Closing[]; capTable: CapTable | null; tranche2: Tranche2 | null; allocations: Allocation[] }
let store: Store | null = null
/** PST-291: the preview's Drafts stamps a sent confirmation through the mounted Close store (convex/drafts.ts does it on the server). */
let stamp: ((investorId: string, at: number) => void) | null = null
export const previewConfirmSent = (investorId: string, at: number) => stamp?.(investorId, at)
const listeners = new Set<() => void>()
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
const read = () => (store ??= fixtureCloseStore(todayIST(), closePreview() ?? 'empty'))
const write = (fn: (s: Store) => Store) => {
  store = fn(read())
  listeners.forEach((l) => l())
}
/** Rejects the way a Convex field-error does, so the dialogs show the messages. */
const fieldErrors = (errors: Record<string, string>) => {
  if (Object.keys(errors).length) throw { data: { message: 'Fix the highlighted fields', errors } }
}

function PreviewClose({ children }: { children: ReactNode }) {
  const d = useRaise()
  const snap = useSyncExternalStore(subscribe, read, read)
  useEffect(() => {
    const mine = (investorId: string, at: number) => {
      const prev = read().closings.find((c) => c.investorId === investorId)
      if (prev) return write((s) => ({ ...s, closings: s.closings.map((c) => (c._id === prev._id ? { ...c, confirmationSentAt: at } : c)) }))
      const inv = d.investors.find((i) => i._id === investorId)
      if (!inv) return
      const t = commitmentTerms(inv, null, d.round, read().tranche2)
      if (!t.amount || !t.cap) return
      if (inv.committed !== t.amount) void d.save(inv._id, { ...fieldsOf(inv), committed: t.amount })
      const c: Closing = { _id: 'pc' + Date.now().toString(36), investorId, amount: t.amount, instrument: t.instrument, cap: t.cap, proRata: false, mfn: false, steps: [], confirmationSentAt: at, ...(t.tranche === 2 ? { tranche: 2 } : {}) }
      write((s) => ({ ...s, closings: [...s.closings, c] }))
    }
    stamp = mine
    return () => {
      if (stamp === mine) stamp = null
    }
  }, [d])
  const value = useMemo<CloseData>(() => {
    const today = todayIST()
    const investor = (id: string) => {
      const i = d.investors.find((x) => x._id === id)
      if (!i) throw { data: 'That investor was deleted' }
      return i
    }
    return {
      loaded: true,
      closings: snap.closings.filter((c) => d.investors.some((i) => i._id === c.investorId)),
      capTable: snap.capTable,
      save: async (investorId, terms, sentAt) => {
        const inv = investor(investorId)
        const body = cleanTerms(terms)
        fieldErrors(validateTerms(body))
        const prev = read().closings.find((c) => c.investorId === investorId)
        if (!prev && !COMMIT.has(inv.stage)) throw { data: `Move ${inv.name} to Verbal first. Closing records start at a verbal yes.` }
        let steps = prev?.steps ?? []
        if (sentAt) {
          const err = checkTick(steps, 'sent', sentAt, today)
          if (err) fieldErrors({ sentAt: err })
          steps = setStep(steps, 'sent', sentAt)
        }
        if (inv.committed !== body.amount) await d.save(inv._id, { ...fieldsOf(inv), committed: body.amount })
        const id = prev?._id ?? 'pc' + Date.now().toString(36)
        const kit = prev ? { tranche: prev.tranche, confirmationSentAt: prev.confirmationSentAt, acceptedAt: prev.acceptedAt, questionnaire: prev.questionnaire } : {}
        write((s) => ({ ...s, closings: [...s.closings.filter((c) => c._id !== id), { ...body, ...kit, _id: id, investorId, steps }] }))
        return id
      },
      tick: async (id, key, at) => {
        const c = read().closings.find((x) => x._id === id)
        if (!c) throw { data: 'That closing record was removed' }
        const inv = investor(c.investorId)
        const plan = planTick(c, inv.stage, key, at, today)
        if ('error' in plan) throw { data: plan.error }
        write((s) => ({ ...s, closings: s.closings.map((x) => (x._id === id ? { ...x, steps: plan.steps } : x)) }))
        if (plan.to) await d.move(inv._id, plan.to)
        return { to: plan.to, firstMoney: plan.to === 'wired' && inv.maxStage !== 'wired' }
      },
      remove: async (id) => write((s) => ({ ...s, closings: s.closings.filter((c) => c._id !== id) })),
      setCapTable: async (capTable) => {
        const next = capTable ? cleanCapTable(capTable) : null
        if (next) fieldErrors(validateCapTable(next))
        const changed = JSON.stringify(read().capTable) !== JSON.stringify(next)
        write((s) => ({ ...s, capTable: next }))
        return changed ? 1 : 0
      },
      emailReady: true,
      emailReminder: async (id) => {
        const c = read().closings.find((x) => x._id === id)
        const to = c?.signerEmail?.trim().toLowerCase()
        if (!c || !to) throw { data: 'Add the signer’s email on the SAFE first.' }
        await d.logNote(c.investorId, reminderKind(c) === 'wire' ? 'Emailed a reminder about the wire' : 'Emailed a reminder to sign the SAFE', { touch: 'email' })
        return { to }
      },
      tranche2: snap.tranche2,
      allocations: snap.allocations,
      setKit: async (id, { accepted, questionnaire, tranche }) => {
        const c = read().closings.find((x) => x._id === id)
        if (!c) throw { data: 'That closing record was removed' }
        const next: Closing = { ...c }
        if (accepted === true && !c.acceptedAt) {
          if (!c.confirmationSentAt) throw { data: 'Send the written confirmation first: their yes is to that offer.' }
          next.acceptedAt = Date.now()
        }
        if (accepted === false) delete next.acceptedAt
        if (questionnaire) {
          if (questionnaire === 'none') delete next.questionnaire
          else next.questionnaire = questionnaire
        }
        if (tranche && tranche !== trancheOf(c)) {
          const t2 = read().tranche2
          if (tranche === 2) {
            if (!t2) throw { data: 'Set up tranche 2 first, in Close › Allocation.' }
            next.tranche = 2
            next.cap = t2.cap
          } else {
            delete next.tranche
            if (d.round.cap) next.cap = d.round.cap
          }
        }
        write((s) => ({ ...s, closings: s.closings.map((x) => (x._id === id ? next : x)) }))
      },
      setTranche2: async (cap) => {
        const inTwo = read().closings.filter((c) => trancheOf(c) === 2)
        if (cap === null && inTwo.length) throw { data: `Move ${inTwo.length === 1 ? 'the commitment' : `the ${inTwo.length} commitments`} in tranche 2 back to tranche 1 first.` }
        if (cap !== null) {
          const err = checkTranche2(cap, d.round.cap)
          if (err) fieldErrors({ cap: err })
        }
        if ((read().tranche2?.cap ?? null) === cap) return 0
        write((s) => ({ ...s, tranche2: cap === null ? null : { cap }, closings: cap === null ? s.closings : s.closings.map((c) => (trancheOf(c) === 2 ? { ...c, cap } : c)) }))
        return 1
      },
      setAllocation: async (investorId, { gets, why }) => {
        investor(investorId)
        if (typeof gets === 'number' && (!Number.isFinite(gets) || gets < 0)) fieldErrors({ gets: 'Zero or more.' })
        write((s) => {
          const prev = s.allocations.find((a) => a.investorId === investorId)
          const next = gets === undefined ? prev?.gets : gets === null ? undefined : Math.round(gets)
          const row: Allocation = { investorId, why: why === undefined ? prev?.why ?? '' : why.trim().slice(0, 200), ...(next !== undefined ? { gets: next } : {}) }
          return { ...s, allocations: [...s.allocations.filter((a) => a.investorId !== investorId), row] }
        })
      },
    }
  }, [snap, d])
  return <CloseContext.Provider value={value}>{children}</CloseContext.Provider>
}
