// Close › Cap table (screens/raise-close/cap-table-after-close.png): founders,
// the option pool and every SAFE, before and after the close, from the numbers
// in Settings › Round › Cap table.
import { Link } from '@tanstack/react-router'
import { useMemo } from 'react'
import { capTableAfter, capTableCsv, hasCapTable, ladder, pct, shares, stepMap, type CloseRow } from '../../lib/close'
import { todayIST } from '../../lib/dates'
import { longDay } from '../../lib/investorView'
import { money } from '../../lib/money'
import { rise } from '../../lib/motion'
import { play } from '../../lib/sound'
import { useRaise } from '../data'
import { useUI } from '../raise-ui'
import { Button, buttonClass, Icon } from '../ui'
import { useClose } from './CloseData'

export function CapTableView() {
  const d = useRaise()
  const c = useClose()
  const { toast } = useUI()
  const l = useMemo(() => ladder(d.investors, c.closings), [d.investors, c.closings])
  const commitments = l.rows.filter((r) => r.rung !== 'soft' && r.amount > 0)
  const capOf = (r: CloseRow) => r.closing?.cap ?? d.round.cap
  const priced = commitments.filter((r) => capOf(r))
  const unpriced = commitments.length - priced.length
  const table = useMemo(
    () => (hasCapTable(c.capTable) ? capTableAfter(c.capTable, priced.map((r) => ({ name: r.investor.name, amount: r.amount, cap: capOf(r)!, mfn: r.closing?.mfn }))) : null),
    [c.capTable, priced], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const wired = commitments.filter((r) => r.rung === 'wired')
  const closed = commitments.length > 0 && wired.length === commitments.length
  const lastWire = closed ? wired.map((r) => stepMap(r.closing).wired ?? '').sort().at(-1) : undefined
  const raised = commitments.reduce((a, r) => a + r.amount, 0)
  const caps = [...new Set(priced.map((r) => capOf(r)!))]

  const exportCsv = () => {
    if (!table) return
    const name = `nest-cap-table-${todayIST()}.csv`
    const url = URL.createObjectURL(new Blob([capTableCsv(table.rows)], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    play('export')
    setTimeout(() => URL.revokeObjectURL(url), 60000)
    toast({ message: `Exported the cap table to ${name}` })
  }

  const checks = [
    { done: commitments.length > 0 && commitments.every((r) => stepMap(r.closing).countersigned), label: 'Every SAFE countersigned' },
    { done: commitments.length > 0 && commitments.every((r) => r.closing?.signedUrl), label: 'A link to each signed copy' },
    { done: closed, label: 'Every wire in' },
    { done: commitments.some((r) => r.closing?.proRata), label: `Pro-rata rights noted (${commitments.filter((r) => r.closing?.proRata).length})` },
  ]

  return (
    <div className="close-cap">
      <section className={`close-banner card card--forest m-rise${closed ? ' is-closed' : ''}`}>
        <div>
          <div className="eyebrow-mono">{closed ? `Round closed${lastWire ? ` · ${longDay(lastWire)}` : ''}` : 'If the round closes as it stands'}</div>
          <h2>{closed ? `${money(raised)} raised on SAFEs` : `${money(raised)} committed on SAFEs`}</h2>
          <p>
            {commitments.length} investor{commitments.length === 1 ? '' : 's'}
            {caps.length === 1 ? ` · ${money(caps[0])} post-money cap` : caps.length > 1 ? ` · ${caps.length} different caps` : ''}
            {closed ? ' · all wires in' : ` · ${wired.length} wire${wired.length === 1 ? '' : 's'} in`}
          </p>
        </div>
        {closed ? <span className="close-banner__confetti" aria-hidden="true">{Array.from({ length: 9 }, (_, i) => <i key={i} />)}</span> : null}
      </section>

      <div className="close-cap__grid">
        <section className="close-cap__table card m-rise" style={rise(1)}>
          <header className="close-cap__head">
            <div>
              <h3>Cap table</h3>
              <p>Fully diluted, SAFEs converted at the cap. An estimate: check it with your lawyer.</p>
            </div>
            {table ? (
              <Button variant="secondary" icon="download" onClick={exportCsv}>
                Export CSV
              </Button>
            ) : null}
          </header>
          {table ? (
            <div className="close-captable" role="table" aria-label="Cap table before and after the close">
              <div className="close-captr close-captr--head" role="row">
                <span role="columnheader">Holder</span>
                <span role="columnheader">Type</span>
                <span role="columnheader">Invested</span>
                <span role="columnheader">Before</span>
                <span role="columnheader">After</span>
              </div>
              {table.rows.map((r) => (
                <div key={r.kind + r.holder} className={`close-captr is-${r.kind.toLowerCase()}`} role="row">
                  <span role="cell" className="close-captr__holder">{r.holder}</span>
                  <span role="cell">{r.kind}</span>
                  <span role="cell" className="num">{r.invested ? money(r.invested) : '–'}</span>
                  <span role="cell">
                    {r.before.shares ? <><strong>{pct(r.before.pct)}</strong><small className="num">{shares(r.before.shares)}</small></> : '–'}
                  </span>
                  <span role="cell">
                    <strong>{pct(r.after.pct)}</strong>
                    <small className="num">{shares(r.after.shares)}</small>
                  </span>
                </div>
              ))}
              <div className="close-captr close-captr--total" role="row">
                <span role="cell">Total</span>
                <span role="cell" />
                <span role="cell" className="num">{money(table.rows.reduce((a, r) => a + (r.invested ?? 0), 0))}</span>
                <span role="cell"><small className="num">{shares(table.before)}</small></span>
                <span role="cell"><small className="num">{shares(table.after)}</small></span>
              </div>
            </div>
          ) : hasCapTable(c.capTable) ? (
            <p className="close-warn">These SAFEs would own the whole company at their caps. Check the caps on each SAFE.</p>
          ) : (
            <div className="close-empty close-empty--inline">
              <Icon name="user" size={22} />
              <h4>Add your founders’ shares first</h4>
              <p>Founder share counts and the option pool go in Settings › Round › Cap table. Then this shows who owns what, before and after the close.</p>
              <Link to="/raise/settings" hash="cap-table" className={buttonClass({ variant: 'primary' })}>
                Add them in Settings
              </Link>
            </div>
          )}
          {unpriced ? <p className="close-model__note">{unpriced} commitment{unpriced === 1 ? ' has' : 's have'} no cap yet, so {unpriced === 1 ? 'it’s' : 'they’re'} left out. Set the cap on the SAFE, or in Settings.</p> : null}
        </section>

        <section className="close-cap__after card m-rise" style={rise(2)}>
          <h3>After the close</h3>
          <ul className="close-checks">
            {checks.map((x) => (
              <li key={x.label} className={x.done ? 'is-done' : ''}>
                <span className="close-checks__box" aria-hidden="true">{x.done ? <Icon name="check" size={14} strokeWidth={2.6} /> : null}</span>
                {x.label}
                <span className="sr-only">{x.done ? ' (done)' : ' (not yet)'}</span>
              </li>
            ))}
          </ul>
          <p className="close-note">Nest works these out from the SAFE records. Thank-you notes and the rest are yours to keep track of.</p>
        </section>
      </div>
    </div>
  )
}
