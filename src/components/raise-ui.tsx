// Shared bits of the Raise views (re-skinned prototype pieces). T3–T5 replace these with the new layouts.
import { createContext, useCallback, useContext, type ReactNode } from 'react'
import { shortDate } from '../lib/dates'
import { money } from '../lib/money'
import type { Investor } from '../lib/pipeline'
import { ACTIVE, LABEL, WARM } from '../lib/stages'
import { errorMessage, useRaise } from './data'
import { Chip, IconButton, type ChipTone, type ToastInput } from './ui'

/* ---------- toast + drawer opener ---------- */
type UI = { toast: (t: ToastInput | string) => void; open: (id: string | null) => void; advance: (i: Investor) => void }
export const UIContext = createContext<UI | null>(null)
export const useUI = () => {
  const v = useContext(UIContext)
  if (!v) throw new Error('useUI outside UIContext')
  return v
}

/** Advance one stage, with a success toast. */
export function useAdvance(toast: UI['toast']) {
  const { advance } = useRaise()
  return useCallback(
    async (i: Investor) => {
      try {
        const r = await advance(i._id)
        if (r) toast(`${i.name} → ${r.label}. Set the next step.`)
      } catch (e) {
        toast({ tone: 'error', message: errorMessage(e) })
      }
    },
    [advance, toast],
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
  if (e.key === 'Enter' && e.target === e.currentTarget) fn()
}

/** A list row (Today panels). */
export function Row({ i, today, sev }: { i: Investor; today: string; sev?: 'sev-bad' | 'sev-warn' }) {
  const { open, advance } = useUI()
  const late = !!i.nextDate && i.nextDate < today
  return (
    <div className={`row ${sev ?? ''}`} tabIndex={0} onClick={() => open(i._id)} onKeyDown={openOnKey(() => open(i._id))}>
      <div>
        <span className="n">{i.name}</span>
        {i.firm ? <span className="muted"> · {i.firm}</span> : null}
      </div>
      <div className="act">
        <Chip tone="outline" className="chip--sm">
          {LABEL[i.stage] || i.stage}
        </Chip>
        {ACTIVE.has(i.stage) || i.stage === 'todo' ? (
          <IconButton
            icon="arrow-right"
            size="sm"
            label={`Advance ${i.name}`}
            onClick={(e) => {
              e.stopPropagation()
              advance(i)
            }}
          />
        ) : null}
      </div>
      <div className="d">
        {i.nextStep ? <span>{i.nextStep}</span> : <span>No next step set</span>}
        {i.nextDate ? (
          <Chip tone={late ? 'error' : 'outline'} className="chip--sm">
            {late ? 'late · ' : ''}
            {shortDate(i.nextDate)}
          </Chip>
        ) : null}
        <WarmChip w={i.warmth} />
        {i.expected ? <span className="num">{money(i.expected)}</span> : null}
      </div>
    </div>
  )
}

export function Panel({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="panel">
      <header>
        <h2>{title}</h2>
        {aside !== undefined ? <span className="muted">{aside}</span> : null}
      </header>
      {children}
    </div>
  )
}
