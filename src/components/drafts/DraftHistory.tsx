// PST-278: the last few drafts for an investor, at the top of the drawer's
// History. Each reopens in the Draft dialog as it was left.
import { formatDay, todayIST } from '../../lib/dates'
import { STATUS_LABEL, TYPE_LABEL, type Draft } from '../../lib/drafts'
import { cents } from '../../lib/enrich'
import { addDays } from '../../lib/today'
import { Chip, Icon, type ChipTone } from '../ui'
import { openDraft, useDrafts } from './data'

const SHOWN = 3
const TONE: Record<Draft['status'], ChipTone> = { sent: 'success', copied: 'outline', draft: 'muted' }

export function DraftHistory({ investorId }: { investorId: string }) {
  const info = useDrafts().useInvestorDrafts(investorId)
  const rows = info?.drafts.slice(0, SHOWN) ?? []
  if (!rows.length) return null
  const today = todayIST()
  const day = (ms: number) => {
    const d = todayIST(ms)
    return d === today ? 'Today' : d === addDays(today, -1) ? 'Yesterday' : formatDay(d)
  }
  return (
    <section className="draft-hist" aria-labelledby={'dh-' + investorId}>
      <h3 id={'dh-' + investorId} className="draft-hist__h eyebrow-mono">
        <Icon name="spark" size={14} className="draft__spark" />
        Drafts
      </h3>
      <ul className="draft-hist__list">
        {rows.map((x) => (
          <li key={x._id}>
            <button type="button" className="draft-hist__row" onClick={() => openDraft({ investorId, draftId: x._id, ...(x.type === 'forwardable' ? { type: x.type, introId: x.introId } : {}) })}>
              <span className="draft-hist__top">
                <span className="draft-hist__subject">{x.subject || TYPE_LABEL[x.type]}</span>
                <Chip tone={TONE[x.status]} dot={x.status === 'sent'} className="chip--sm">
                  {x.status === 'sent' && x.via === 'nest' ? 'Sent from Nest' : STATUS_LABEL[x.status]}
                </Chip>
              </span>
              <span className="draft-hist__meta">
                {[TYPE_LABEL[x.type], day(x.sentAt ?? x.createdAt), x.via === 'whatsapp' ? 'WhatsApp' : '', x.costUsd > 0 ? cents(x.costUsd) : ''].filter(Boolean).join(' · ')}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
