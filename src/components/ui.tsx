import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { shortDate } from '../lib/dates'
import { money } from '../lib/money'
import type { Investor } from '../lib/pipeline'
import { ACTIVE, LABEL, WARM } from '../lib/stages'
import { errorMessage, useRaise } from './data'

/* ---------- toast + drawer opener ---------- */
type UI = { toast: (m: string) => void; open: (id: string | null) => void; advance: (i: Investor) => void }
export const UIContext = createContext<UI | null>(null)
export const useUI = () => {
  const v = useContext(UIContext)
  if (!v) throw new Error('useUI outside UIContext')
  return v
}

export function useToast() {
  const [msg, setMsg] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const toast = useCallback((m: string) => {
    setMsg(m)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setMsg(null), 2600)
  }, [])
  const node = (
    <div className="toast" hidden={!msg} role="status">
      {msg}
    </div>
  )
  return { toast, node }
}

/** Advance one stage with the prototype's toast. */
export function useAdvance(toast: (m: string) => void) {
  const { advance } = useRaise()
  return useCallback(
    async (i: Investor) => {
      try {
        const r = await advance(i._id)
        if (r) toast(`${i.name} → ${r.label}. Set the next step.`)
      } catch (e) {
        toast(errorMessage(e))
      }
    },
    [advance, toast],
  )
}

/* ---------- shared bits ---------- */
export const WarmChip = ({ w }: { w: Investor['warmth'] }) => <span className={`chip ${w}`}>{WARM[w] || ''}</span>

export const openOnKey = (fn: () => void) => (e: React.KeyboardEvent) => {
  if (e.key === 'Enter' && e.target === e.currentTarget) fn()
}

/** A list row (Today panels), as the prototype's rowHTML. */
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
        <span className="chip stage">{LABEL[i.stage] || i.stage}</span>
        {ACTIVE.has(i.stage) || i.stage === 'todo' ? (
          <button
            className="btn small"
            type="button"
            aria-label={`Advance ${i.name}`}
            onClick={(e) => {
              e.stopPropagation()
              advance(i)
            }}
          >
            →
          </button>
        ) : null}
      </div>
      <div className="d">
        {i.nextStep ? <span>{i.nextStep}</span> : <span>No next step set</span>}
        {i.nextDate ? (
          <span className={`chip ${late ? 'late' : ''}`}>
            {late ? 'late · ' : ''}
            {shortDate(i.nextDate)}
          </span>
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
