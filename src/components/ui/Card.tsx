import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'
import { rise } from '../../lib/motion'

export type CardTone = 'white' | 'forest' | 'lime' | 'peach' | 'mint' | 'paper'

type CardProps = HTMLAttributes<HTMLElement> & {
  tone?: CardTone
  /** Index in a rising group (420ms, 60ms stagger). Omit for no rise. */
  riseIndex?: number
  as?: 'section' | 'article' | 'div'
}

/** Radius 20 card; tones match the Home bento. */
export const Card = forwardRef<HTMLElement, CardProps>(function Card({ tone = 'white', riseIndex, as: Tag = 'section', className, style, children, ...rest }, ref) {
  return (
    <Tag
      ref={ref as React.Ref<HTMLDivElement>}
      className={['card', `card--${tone}`, riseIndex !== undefined && 'm-rise', className].filter(Boolean).join(' ')}
      style={riseIndex !== undefined ? { ...rise(riseIndex), ...style } : style}
      {...rest}
    >
      {children}
    </Tag>
  )
})

export type KpiTone = 'default' | 'good' | 'warning'

/** KPI card: label, big number, one line of context. */
export function KpiCard({ label, value, note, tone = 'default', riseIndex }: { label: ReactNode; value: ReactNode; note?: ReactNode; tone?: KpiTone; riseIndex?: number }) {
  return (
    <div className={['kpi-card', `kpi-card--${tone}`, riseIndex !== undefined && 'm-rise'].filter(Boolean).join(' ')} style={riseIndex !== undefined ? rise(riseIndex) : undefined}>
      <span className="kpi-card__label">{label}</span>
      <span className="kpi-card__value num">{value}</span>
      {note ? <span className="kpi-card__note">{note}</span> : null}
    </div>
  )
}
