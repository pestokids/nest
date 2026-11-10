// PST-291: Close › Allocation (screens/round5/close-allocation.png). When
// soft circles, verbals and signed want more than the room: who gets what and
// why, what's left to place, tranche 2 at a higher cap, and one allocation
// email per investor for Dev to send (no bulk send).
import { Link } from '@tanstack/react-router'
import { useMemo, useState, type CSSProperties } from 'react'
import { ladder } from '../../lib/close'
import {
  addBusinessDays, allocationRows, allocationTotals, allocationText, checkTranche2, commitmentTerms, leftText, trancheLine, trancheOf, WIRE_BUSINESS_DAYS,
  type AllocRow,
} from '../../lib/closeKit'
import { todayIST } from '../../lib/dates'
import { money } from '../../lib/money'
import { rise, useInView } from '../../lib/motion'
import { play } from '../../lib/sound'
import { useRaise } from '../data'
import { openDraft, useDrafts } from '../drafts/data'
import { useUI } from '../raise-ui'
import { AmountInput } from '../settings/inputs'
import { useSaveAction } from '../system/useSaveAction'
import { Button, buttonClass } from '../ui'
import { useClose } from './CloseData'

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')

export function Allocation() {
  const d = useRaise()
  const c = useClose()
  const x = useDrafts()
  const { toast } = useUI()
  const save = useSaveAction()
  const l = useMemo(() => ladder(d.investors, c.closings), [d.investors, c.closings])
  const room = d.round.stretch
  const rows = useMemo(() => allocationRows(l.rows, c.allocations, room), [l.rows, c.allocations, room])
  const t = allocationTotals(rows, room)
  const [bar, seen] = useInView<HTMLDivElement>()
  const scale = Math.max(t.wanted, room, t.allocated, 1)
  const [drafted, setDrafted] = useState<{ investorId: string; name: string; draftId: string }[] | null>(null)
  const [busy, setBusy] = useState(false)
  const placed = rows.filter((r) => r.gets > 0)

  const setRow = (r: AllocRow, patch: { gets?: number | null; why?: string }) =>
    save(() => c.setAllocation(r.investorId, patch), { failMessage: `Couldn’t save ${r.name}’s allocation.` })

  async function draftAll() {
    const today = todayIST()
    const list = placed.map((r) => {
      const row = l.rows.find((y) => y.investor._id === r.investorId)!
      const terms = commitmentTerms(row.investor, row.closing, d.round, c.tranche2)
      const yes = row.closing?.acceptedAt ? todayIST(row.closing.acceptedAt) : today
      const text = allocationText({ contactName: row.closing?.signerName, row: r, terms, wireBy: addBusinessDays(yes, WIRE_BUSINESS_DAYS), me: d.me })
      return { investorId: r.investorId, type: 'allocation' as const, to: row.closing?.signerEmail ?? '', ...text }
    })
    setBusy(true)
    const ids = await save(() => x.saveMany(list), { failMessage: 'Couldn’t write the allocation emails.' })
    setBusy(false)
    if (!ids) return
    play('save')
    setDrafted(placed.map((r, i) => ({ investorId: r.investorId, name: r.name, draftId: ids[i] })))
    toast({ tone: 'success', icon: 'check', message: `Drafted ${ids.length} allocation email${ids.length === 1 ? '' : 's'}. Open each one to add the SAFE link and send it.` })
  }

  return (
    <div className="alloc">
      <section className="alloc-hero card card--forest m-rise">
        <p className="eyebrow-mono">{t.over ? 'Oversubscribed · ' : ''}{money(t.wanted)} wanted, {money(room)} of room</p>
        <h2>{t.over ? 'Decide who gets what' : 'Everyone fits'}</h2>
        <p>{t.over ? 'Tell everyone the round closes in 48 hours, then allocate with your co-founder. Same terms for everyone in this tranche.' : 'Demand is within the room, so everyone can get what they asked for. Same terms for everyone in this tranche.'}</p>
        <div className={`alloc-bar${seen ? ' is-seen' : ''}`} ref={bar} aria-hidden="true">
          <span className="alloc-bar__fill" style={{ '--w': `${Math.min(100, (t.allocated / scale) * 100)}%` } as CSSProperties} />
          <span className="alloc-bar__room" style={{ left: `${Math.min(100, (room / scale) * 100)}%` }} />
        </div>
        <div className="alloc-bar__labels">
          <span className="alloc-bar__got">{money(t.allocated)} allocated</span>
          <span className="alloc-bar__roomtag" style={{ left: `${Math.min(100, (room / scale) * 100)}%` }}>room {money(room)}</span>
          <span>wanted {money(t.wanted)}</span>
        </div>
      </section>

      <div className="alloc__grid">
        <section className="alloc-table card m-rise" style={rise(1)} aria-label="Allocation">
          {rows.length ? (
            <table>
              <thead>
                <tr>
                  <th scope="col">Investor</th>
                  <th scope="col">Wants</th>
                  <th scope="col">Gets</th>
                  <th scope="col">Why</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Row key={r.investorId} row={r} onSave={(p) => void setRow(r, p)} />
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Total</th>
                  <td className="num">{money(t.wanted)}</td>
                  <td className="num alloc-table__got">{money(t.allocated)}</td>
                  <td className={t.left > 499 || t.left < -499 ? 'alloc-table__left' : ''}>{leftText(t.left)}</td>
                </tr>
              </tfoot>
            </table>
          ) : (
            <div className="close-empty close-empty--inline">
              <p>Nobody has said a number yet. Soft circles, verbals and signed SAFEs show up here.</p>
              <Link to="/raise/pipeline" className={buttonClass({ variant: 'secondary' })}>
                Open Pipeline
              </Link>
            </div>
          )}
          {rows.some((r) => r.suggested) ? <p className="alloc-table__note">Until you enter an amount, Gets is a suggested cut that fits the room and keeps angels whole.</p> : null}
        </section>

        <aside className="alloc__side">
          <Tranche2Card />
          <section className="alloc-send card m-rise" style={rise(3)}>
            <p className="eyebrow-mono">When it’s decided</p>
            <p>Drafts for each investor: what they get, the SAFE link, and the wire deadline. You send them.</p>
            {drafted ? (
              <ul className="alloc-send__list">
                {drafted.map((y) => (
                  <li key={y.draftId}>
                    <button type="button" className="drawer__textbtn" onClick={() => openDraft({ investorId: y.investorId, draftId: y.draftId })}>
                      {y.name}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <Button variant="primary" onClick={() => void draftAll()} loading={busy} loadingLabel="Writing…" disabled={!placed.length}>
              {drafted ? 'Draft them again' : `Draft ${placed.length} allocation email${placed.length === 1 ? '' : 's'}`}
            </Button>
          </section>
        </aside>
      </div>
    </div>
  )
}

function Row({ row, onSave }: { row: AllocRow; onSave: (p: { gets?: number | null; why?: string }) => void }) {
  const [gets, setGets] = useState<number | undefined>(row.gets)
  const [why, setWhy] = useState(row.why)
  const cut = row.gets < row.wants
  return (
    <tr>
      <th scope="row">
        <span className="alloc-who">
          <span className={`avatar alloc-av${row.kind === 'Lead' ? '' : ' is-quiet'}`} aria-hidden="true">
            {initials(row.name)}
          </span>
          <span>
            <strong>{row.name}</strong>
            <small>{row.kind}</small>
          </span>
        </span>
      </th>
      <td className="num">{money(row.wants)}</td>
      <td>
        <span className={`input alloc-gets${cut ? ' is-cut' : ''}`}>
          <AmountInput
            aria-label={`What ${row.name} gets`}
            value={gets}
            onChange={setGets}
            onBlur={() => {
              if (gets === undefined) {
                if (!row.suggested) onSave({ gets: null })
              } else if (Number.isFinite(gets) && gets !== row.gets) onSave({ gets })
            }}
          />
        </span>
      </td>
      <td>
        <input
          className="alloc-why"
          aria-label={`Why ${row.name} gets that`}
          value={why}
          placeholder="Why"
          maxLength={200}
          onChange={(e) => setWhy(e.target.value)}
          onBlur={() => why.trim() !== row.why && onSave({ why })}
        />
      </td>
    </tr>
  )
}

/** Next tranche: tranche 2 at a higher cap for anything after tranche 1. */
function Tranche2Card() {
  const d = useRaise()
  const c = useClose()
  const { toast } = useUI()
  const save = useSaveAction()
  const cap1 = d.round.cap
  const [cap, setCap] = useState<number | undefined>(c.tranche2?.cap ?? (cap1 ? Math.round((cap1 * 1.25) / 1e6) * 1e6 : undefined))
  const [error, setError] = useState<string | null>(null)
  const inTwo = c.closings.filter((k) => trancheOf(k) === 2).length
  const changed = cap !== c.tranche2?.cap
  const submit = async () => {
    const err = checkTranche2(cap, cap1)
    if (err) {
      play('nope')
      return setError(err)
    }
    setError(null)
    await save(() => c.setTranche2(cap!), {
      failMessage: 'Couldn’t set up tranche 2.',
      onDone: (n) => n && toast({ tone: 'success', message: `Tranche 2 is at ${money(cap!)} post. New commitments start in it.` }),
    })
  }
  return (
    <section className="alloc-t2 card card--mint m-rise" style={rise(2)}>
      <p className="eyebrow-mono">Next tranche</p>
      <h3>Raise the cap for the rest</h3>
      <p>
        {c.tranche2
          ? `Tranche 2 is set up. ${inTwo ? `${inTwo} commitment${inTwo === 1 ? ' is' : 's are'} in it.` : 'Nobody is in it yet.'} Same terms for everyone within a tranche.`
          : `Demand is above room. Close this tranche at ${cap1 ? money(cap1) : 'its cap'}, and offer anything after it at a higher cap.`}
      </p>
      <dl className="alloc-t2__rows">
        <dt>Tranche 1</dt>
        <dd>
          {money(d.round.stretch)} at {cap1 ? money(cap1) + ' post' : 'the cap in Settings'}
        </dd>
        <dt>
          <label htmlFor="alloc-t2-cap">Tranche 2</label>
        </dt>
        <dd className={error ? 'field--error' : undefined}>
          <span className="input">
            <AmountInput id="alloc-t2-cap" value={cap} onChange={(v) => {
              setCap(v)
              setError(null)
            }} aria-invalid={error ? true : undefined} aria-describedby={error ? 'alloc-t2-err' : undefined} />
          </span>
        </dd>
      </dl>
      {error ? (
        <p className="field__error" id="alloc-t2-err">
          {error}
        </p>
      ) : null}
      {cap1 && cap && cap > cap1 ? <p className="alloc-t2__line">{trancheLine(cap1, cap)}</p> : null}
      {!cap1 ? <p className="alloc-t2__line">Save tranche 1’s cap in Settings › Round first.</p> : null}
      {!c.tranche2 || changed ? (
        <Button variant="dark" onClick={() => void submit()} disabled={!cap1}>
          {c.tranche2 ? 'Save tranche 2' : 'Set up tranche 2'}
        </Button>
      ) : null}
    </section>
  )
}
