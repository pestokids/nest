import { forwardRef, type HTMLAttributes } from 'react'
import { cardText } from '../../lib/board'
import { applicationTone } from '../../lib/applications' // PST-302
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
  /** PST-302: the card's ⋯ menu (move to any stage). */
  onMenu?: (anchor: HTMLElement) => void
}

/** A deal card (components/Deal card): name, amount, type · firm, warmth chip, next step or quiet warning. */
export const DealCard = forwardRef<HTMLDivElement, Props>(function DealCard({ inv, today, quietDays, ghost, settle, onMenu, className, ...rest }, ref) {
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
        {onMenu ? (
          <button
            type="button"
            className="pb-card__menu"
            aria-label={'Move ' + inv.name + ' to a stage'}
            aria-haspopup="menu"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onMenu(e.currentTarget)
            }}
          >
            <Icon name="more" size={16} />
          </button>
        ) : null}
      </div>
      {t.sub ? <div className="pb-card__sub">{t.sub}</div> : null}
      <span className="pb-card__chip">{t.chip}</span>
      {t.app && inv.application ? <span className={'pb-card__chip pb-card__chip--app is-' + applicationTone(inv.application)}>{t.app}</span> : null}
      <div className="pb-card__foot">
        <Icon name={t.tone === 'quiet' ? 'alert' : t.tone === 'waiting' ? 'clock' : 'calendar'} size={16} />
        <span>{t.foot}</span>
      </div>
    </div>
  )
})
