// PST-293: the decision rows (src/lib/inbox.ts) on Today, in Due today, until
// PST-297's Inbox replaces Today: Decide rows, new asks from emails, decide-by
// dates that have passed, and the 3rd call done.
import { useMemo } from 'react'
import { DECISION_LABEL } from '../../lib/decisions'
import { decisionInbox, type DecisionInboxRow } from '../../lib/inbox'
import { useRaise } from '../data'
import { openDraft } from '../drafts/data'
import { openOnKey, useUI } from '../raise-ui'
import { Button } from '../ui'
import { useDecide, useDecisions } from './data'

export function useDecisionInbox(today: string): DecisionInboxRow[] {
  const { investors } = useRaise()
  const x = useDecisions()
  return useMemo(() => decisionInbox({ investors, decisions: x.decisions, signals: x.signals, today }), [investors, x.decisions, x.signals, today])
}

export function DecisionRows({ rows }: { rows: DecisionInboxRow[] }) {
  const ui = useUI()
  const decide = useDecide()
  return (
    <>
      {rows.map((r) => {
        const inv = { _id: r.investorId, name: r.name }
        return (
          <li key={r.key} className="quiet-row decision-row" data-kind={r.kind}>
            <div className="quiet-row__main" role="button" tabIndex={0} data-nav-id={r.investorId} onClick={() => ui.open(r.investorId)} onKeyDown={openOnKey(() => ui.open(r.investorId))} aria-label={'Open ' + r.name}>
              <span className="row__name">{r.name}</span>
              <span className={'row__sub' + (r.kind === 'decide_by' || r.kind === 'third_call' ? ' row__sub--warn' : '')}>{r.detail}</span>
            </div>
            {r.kind === 'decide' && r.signalId && r.change ? (
              <>
                <Button variant="ghost" className="decision-row__leave" onClick={() => decide.resolve(inv, r.signalId!, false)}>
                  Leave it
                </Button>
                <Button variant="secondary" className="quiet-row__btn" onClick={() => decide.resolve(inv, r.signalId!, true)}>
                  Mark as {DECISION_LABEL[r.change.to].toLowerCase()}
                </Button>
              </>
            ) : r.kind === 'ask' && r.signalId ? (
              <>
                <Button variant="ghost" className="quiet-row__draft" icon="spark" onClick={() => openDraft({ investorId: r.investorId, type: 'followup' })} aria-label={'Draft a reply to ' + r.name}>
                  Draft
                </Button>
                <Button variant="secondary" className="quiet-row__btn" onClick={() => decide.doneAsk(r.signalId!)}>
                  Done
                </Button>
              </>
            ) : (
              <Button variant="secondary" className="quiet-row__btn" icon="spark" onClick={() => openDraft({ investorId: r.investorId, type: 'decision' })}>
                Ask for a yes or no
              </Button>
            )}
          </li>
        )
      })}
    </>
  )
}
