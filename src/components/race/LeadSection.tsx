// PST-295: the drawer's "The lead" (round5/drawer-decision-lead-warm-path.png):
// Can lead (from enrichment; Dev's switch always wins), the four lead steps,
// and "Ask if they'll lead". Picking the lead cracks the egg (interactions-batch-1.png).
import type { Investor } from '../../lib/pipeline'
import { canLeadOf, LEAD_STEPS, leadSteps, nextLeadStep } from '../../lib/race'
import { play } from '../../lib/sound'
import { openDraft } from '../drafts/data'
import { useUI } from '../raise-ui'
import { Button, Toggle } from '../ui'
import { useRace } from './data'

const first = (name: string) => name.trim().split(/\s+/)[0] || name
const FROM = { you: 'set by you', list: 'from your list', enrichment: 'from enrichment', none: '' } as const

export function LeadSection({ inv: raw }: { inv: Investor }) {
  const ui = useUI()
  const race = useRace()
  const inv = race.withLead(raw)
  const leading = race.leadId === inv._id
  if ((inv.stage === 'passed' || inv.stage === 'parked') && !leading) return null
  const cl = canLeadOf(inv)
  const steps = leadSteps(inv, race.leadId)
  const next = nextLeadStep(steps)
  const why = cl.from === 'none' ? 'Nest fills this in when it enriches them.' : [cl.reason || (cl.on ? 'Can lead' : 'Follows a lead'), FROM[cl.from]].filter(Boolean).join(' · ')

  const undo = (fn: () => Promise<unknown>) => ({ label: 'Undo', onClick: () => (play('undo'), void fn().catch(ui.fail)) })

  function asked() {
    play('ask')
    race.setLeadAsked(inv._id, true).catch(ui.fail)
    ui.toast({ message: `Asked ${first(inv.name)} to lead.`, action: undo(() => race.setLeadAsked(inv._id, false)) })
  }
  function setLead(on: boolean) {
    const saved = race.setLead(on ? inv._id : null)
    saved.catch(ui.fail)
    if (on) play('save')
    ui.toast({ tone: on ? 'win' : 'info', message: on ? `${first(inv.name)} is leading the round.` : 'The round has no lead now.', action: undo(() => saved.then((r) => race.setLead(r.before))) })
  }

  return (
    <section className="enrich-card race-leadsec" aria-labelledby={`lead-${inv._id}`}>
      <p className="eyebrow-mono race-leadsec__eyebrow" id={`lead-${inv._id}`}>
        The lead
      </p>
      <div className="race-leadsec__can">
        <div>
          <h3 className="race-leadsec__title">Can lead</h3>
          <p className="race-leadsec__why">{why}</p>
        </div>
        <Toggle aria-label="Can lead" checked={cl.on} onChange={(e) => void race.setCanLead(inv._id, e.target.checked).catch(ui.fail)} />
      </div>
      {cl.on || leading ? (
        <>
          <ol className="race-steps" aria-label="Lead steps">
            {LEAD_STEPS.map((s) => (
              <li key={s.k} className={`race-steps__step${steps[s.k] ? ' is-done' : s.k === next ? ' is-next' : ''}`}>
                <span className="race-steps__bar" aria-hidden="true" />
                <span className="race-steps__label">
                  {s.short}
                  <span className="sr-only">{steps[s.k] ? ', done' : s.k === next ? ', next' : ''}</span>
                </span>
              </li>
            ))}
          </ol>
          <div className="race-leadsec__actions">
            {!steps.asked ? (
              <>
                <Button onClick={() => openDraft({ investorId: inv._id, type: 'lead' })}>Ask if they’ll lead</Button>
                <button type="button" className="drawer__textbtn" onClick={asked}>
                  I already asked
                </button>
              </>
            ) : leading ? (
              <button type="button" className="drawer__textbtn" onClick={() => setLead(false)}>
                They’re not leading
              </button>
            ) : (
              <Button onClick={() => setLead(true)}>They’re leading</Button>
            )}
          </div>
        </>
      ) : null}
    </section>
  )
}
