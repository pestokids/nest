// Shared bits of the Raise views: toasts, the drawer opener, advance and delete with undo.
import { createContext, useCallback, useContext } from 'react'
import type { Investor } from '../lib/pipeline'
import { play } from '../lib/sound'
import { WARM, type Stage, type TouchKind } from '../lib/stages'
import { errorMessage, useRaise } from './data'
import { confirmAction } from './close/openKit'
import { Chip, type ChipTone, type ToastInput } from './ui'

/* ---------- toast + drawer opener ---------- */
/** Prefill for the drawer's "new" state: the stage of the column whose + was clicked, the name searched for ("Add “Name”"), or a person from Who's this? (name and email). */
export type OpenOptions = {
  stage?: Stage
  name?: string
  email?: string
  /** PST-282: open an investor on their Materials tab (PST-277: or Notes). */
  tab?: 'materials' | 'notes'
  /** PST-290 (⌘K): open straight into Log a touch (with its kind) or Park. */
  mode?: 'touch' | 'park'
  touch?: TouchKind
  /** PST-290: ← and → in the drawer: swap the investor in place (no slide, no sound; focus still goes back to the list). */
  swap?: boolean
}

/*
 * Opening the drawer from outside the Raise views (the ⌘K palette lives in the
 * app shell, above UIContext): navigate to a Raise view with `state.drawer`, and
 * the Raise layout passes it straight to useUI().open(id, opts). One opener.
 */
export type DrawerRequest = { id: string | null; opts?: OpenOptions }
declare module '@tanstack/react-router' {
  interface HistoryState {
    drawer?: DrawerRequest
  }
}
export type UI = {
  toast: (t: ToastInput | string) => void
  /** Opens the drawer on an investor, or its "new" state with `null` (optionally with a preselected stage or name). The opener gets focus back on close. */
  open: (id: string | null, opts?: OpenOptions) => void
  /** What the open drawer was opened with (its "new" state reads `stage` and `name` from here). */
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
        // PST-291: a verbal yes gets the Close kit's written confirmation offered.
        if (r) toast(r.stage === 'verbal' ? { message: `${i.name} → ${r.label}. Confirm it in writing today.`, action: confirmAction(i._id) } : `${i.name} → ${r.label}. Set the next step.`)
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
