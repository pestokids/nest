import { forwardRef, type HTMLAttributes } from 'react'
import { cardText } from '../../lib/board'
import { money } from '../../lib/money'
import type { Investor } from '../../lib/pipeline'
import { Icon } from '../ui'

type Props = HTMLAttributes<HTMLDivElement> & {
  inv: Investor
  today: string
  quietDays: number
  /** The faded copy left behind while this card is being dragged. */
  ghost?: boolean
  /** Just dropped: settles with a spring. */
  settle?: boolean
}

/** A deal card (components/Deal card): name, amount, type · firm, warmth chip, next step or quiet warning. */
export const DealCard = forwardRef<HTMLDivElement, Props>(function DealCard({ inv, today, quietDays, ghost, settle, className, ...rest }, ref) {
  const t = cardText(inv, today, quietDays, money)
  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      data-card={inv._id}
      data-nav-id={inv._id}
      aria-roledescription="Draggable card"
      aria-keyshortcuts="[ ]"
      aria-label={`${inv.name}. ${t.foot}. Press ] or [ to move it a stage.`}
      className={['pb-card', `pb-card--${t.tone}`, ghost && 'pb-card--ghost', settle && 'pb-card--settle', className].filter(Boolean).join(' ')}
      {...rest}
    >
      <div className="pb-card__top">
        <span className="pb-card__name">{inv.name}</span>
        <span className="pb-card__amt">{t.amount}</span>
      </div>
      {t.sub ? <div className="pb-card__sub">{t.sub}</div> : null}
      <span className="pb-card__chip">{t.chip}</span>
      <div className="pb-card__foot">
        <Icon name={t.tone === 'quiet' ? 'alert' : 'calendar'} size={16} />
        <span>{t.foot}</span>
      </div>
    </div>
  )
})
