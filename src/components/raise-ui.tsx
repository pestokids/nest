// Shared bits of the Raise views: toasts, the drawer opener, advance and delete with undo.
import { createContext, useCallback, useContext } from 'react'
import type { Investor } from '../lib/pipeline'
import { play } from '../lib/sound'
import { WARM, type Stage } from '../lib/stages'
import { errorMessage, useRaise } from './data'
import { Chip, type ChipTone, type ToastInput } from './ui'

/* ---------- toast + drawer opener ---------- */
/** Prefill for the drawer's "new" state, e.g. the stage of the column whose + was clicked. */
export type OpenOptions = { stage?: Stage }
export type UI = {
  toast: (t: ToastInput | string) => void
  /** Opens the drawer on an investor, or its "new" state with `null` (optionally with a preselected stage). The opener gets focus back on close. */
  open: (id: string | null, opts?: OpenOptions) => void
  /** What the open drawer was opened with (its "new" state reads `stage` from here). */
  opening: OpenOptions
  advance: (i: Investor) => void
  /** Delete with an Undo toast; the delete is sent when the toast goes. */
  remove: (i: Investor) => void
  /** A write failed: error toast and the save-failed sound. */
  fail: (e: unknown) => void
}
export const UIContext = createContext<UI | null>(null)
export const useUI = () => {
  const v = useContext(UIContext)
  if (!v) throw new Error('useUI outside UIContext')
  return v
}

/** Error toast plus the save-failed sound. */
export function useFail(toast: UI['toast']) {
  return useCallback(
    (e: unknown) => {
      play('save-failed')
      toast({ tone: 'error', message: errorMessage(e) })
    },
    [toast],
  )
}

/** Advance one stage, with a success toast (Pipeline's arrow). */
export function useAdvance(toast: UI['toast'], fail: UI['fail']) {
  const { advance } = useRaise()
  return useCallback(
    async (i: Investor) => {
      try {
        const r = await advance(i._id)
        if (r) toast(`${i.name} → ${r.label}. Set the next step.`)
      } catch (e) {
        fail(e)
      }
    },
    [advance, toast, fail],
  )
}

/* ---------- shared bits ---------- */
const WARM_TONE: Record<Investor['warmth'], ChipTone> = { existing: 'live', warm: 'success', intro: 'neutral', cold: 'muted' }
export const WarmChip = ({ w }: { w: Investor['warmth'] }) => (
  <Chip tone={WARM_TONE[w] ?? 'neutral'} dot={false} className="chip--sm">
    {WARM[w] || ''}
  </Chip>
)

export const openOnKey = (fn: () => void) => (e: React.KeyboardEvent) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
    e.preventDefault()
    fn()
  }
}
