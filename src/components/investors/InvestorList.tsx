import { forwardRef, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { enrichedCell, type InvestorRun } from '../../lib/enrich'
import { agoLabel, isQuiet, nextLabel, subLine } from '../../lib/investorView'
import { money } from '../../lib/money'
import type { Investor } from '../../lib/pipeline'
import { play } from '../../lib/sound'
import { ACTIVE, IDX, STAGE_TILE, STAGES } from '../../lib/stages'
import { useRaise } from '../data'
import { openOnKey, useUI } from '../raise-ui'
import { Menu, type MenuItem } from '../system/Menu'
import { useSaveAction } from '../system/useSaveAction'
import { Chip, Icon, type ChipTone } from '../ui'

export type SortKey = 'name' | 'type' | 'stage' | 'wave' | 'path' | 'lastTouch' | 'nextStep' | 'expected'

const COLS: { k: SortKey | 'enriched'; label: string; className?: string }[] = [
  { k: 'name', label: 'Investor', className: 'c-name' },
  { k: 'type', label: 'Type', className: 'c-type' },
  { k: 'stage', label: 'Stage', className: 'c-stage' },
  { k: 'wave', label: 'Wave', className: 'c-wave' },
  { k: 'path', label: 'Warm path', className: 'c-path' },
  { k: 'lastTouch', label: 'Last touch', className: 'c-touch' },
  { k: 'enriched', label: 'Enriched', className: 'c-enriched' },
  { k: 'nextStep', label: 'Next step', className: 'c-next' },
  { k: 'expected', label: 'Amount', className: 'c-amt' },
]

function stageChip(i: Investor, quiet: boolean): { tone: ChipTone; dot: boolean } {
  if (i.stage === 'passed') return { tone: 'error', dot: false }
  if (i.stage === 'parked') return { tone: 'muted', dot: false }
  if (i.stage === 'todo') return { tone: 'outline', dot: false }
  if (quiet) return { tone: 'waiting', dot: true }
  return { tone: 'neutral', dot: false }
}

type Props = {
  rows: Investor[]
  today: string
  quietDays: number
  selected: Set<string>
  setSelected: Dispatch<SetStateAction<Set<string>>>
  allIds: string[]
  sort: SortKey
  dir: 'asc' | 'desc'
  onSort: (k: SortKey) => void
  onOpen: (id: string) => void
  onMore?: () => void
}

/** The investor table on desktop; a list of cards on phones. Rows open the drawer. */
export function InvestorList({ rows, today, quietDays, selected, setSelected, allIds, sort, dir, onSort, onOpen, onMore }: Props) {
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const all = allIds.length > 0 && allIds.every((id) => selected.has(id))
  const some = !all && allIds.some((id) => selected.has(id))
  const head = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (head.current) head.current.indeterminate = some
  }, [some])

  const { ai } = useRaise()
  const runs = useMemo(() => new Map(ai.runs.flatMap((r) => (r.investorId ? [[r.investorId, r] as const] : []))), [ai.runs])

  const more = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = more.current
    if (!el || !onMore || typeof IntersectionObserver !== 'function') return
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && onMore(), { rootMargin: '400px' })
    io.observe(el)
    return () => io.disconnect()
  }, [onMore])

  return (
    <>
      <div className="inv-table" role="table" aria-label="Investors" aria-rowcount={allIds.length + 1}>
        <div className="inv-row inv-row--head" role="row">
          <span className="c-check" role="columnheader">
            <Box
              ref={head}
              checked={all}
              label={all ? 'Clear selection' : 'Select all'}
              onChange={() => setSelected(all ? new Set() : new Set(allIds))}
            />
          </span>
          {COLS.map(({ k, label, className }) =>
            k === 'enriched' ? (
              <span key={k} className={className + ' inv-head-label'} role="columnheader">
                {label}
              </span>
            ) : (
              <span key={k} className={className} role="columnheader" aria-sort={sort === k ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                <button type="button" className={`inv-sort${sort === k ? ' is-on' : ''}`} onClick={() => onSort(k)}>
                  {label}
                  {sort === k || k === 'name' ? <Icon name="sort" size={13} strokeWidth={2.2} className={`inv-sort__icon${sort === k ? ` is-${dir}` : ''}`} /> : null}
                </button>
              </span>
            ),
          )}
          <span className="c-more" role="columnheader">
            <span className="sr-only">Actions</span>
          </span>
        </div>
        {rows.map((i) => (
          <Row key={i._id} i={i} run={runs.get(i._id)} today={today} quiet={isQuiet(i, today, quietDays)} checked={selected.has(i._id)} onCheck={() => toggle(i._id)} onOpen={() => onOpen(i._id)} />
        ))}
      </div>
      <ul className="inv-cards" aria-label="Investors">
        {rows.map((i) => (
          <CardRow key={i._id} i={i} today={today} quiet={isQuiet(i, today, quietDays)} checked={selected.has(i._id)} onCheck={() => toggle(i._id)} onOpen={() => onOpen(i._id)} />
        ))}
      </ul>
      {onMore ? <div ref={more} className="inv-more" aria-hidden="true" /> : null}
    </>
  )
}

type RowProps = { i: Investor; today: string; quiet: boolean; checked: boolean; onCheck: () => void; onOpen: () => void }

const rowClass = (base: string, i: Investor, quiet: boolean, checked: boolean) =>
  [base, quiet && 'is-quiet', (i.stage === 'passed' || i.stage === 'parked') && 'is-closed', checked && 'is-selected'].filter(Boolean).join(' ')

function Row({ i, run, today, quiet, checked, onCheck, onOpen }: RowProps & { run?: InvestorRun }) {
  const chip = stageChip(i, quiet)
  const enriched = enrichedCell(run)
  return (
    <div className={rowClass('inv-row', i, quiet, checked)} role="row" tabIndex={0} onClick={onOpen} onKeyDown={openOnKey(onOpen)} aria-label={`${i.name}, ${STAGE_TILE[i.stage]}`}>
      <span className="c-check" role="cell" onClick={(e) => e.stopPropagation()}>
        <Box checked={checked} onChange={onCheck} label={`Select ${i.name}`} />
      </span>
      <span className="c-name" role="cell">
        <strong>{i.name}</strong>
        <small>{subLine(i)}</small>
      </span>
      <span className="c-type" role="cell">
        <Chip tone="outline" dot={false} className="inv-type">
          {i.type}
        </Chip>
      </span>
      <span className="c-stage" role="cell">
        <Chip tone={chip.tone} dot={chip.dot} className="inv-stage">
          {STAGE_TILE[i.stage]}
        </Chip>
      </span>
      <span className="c-wave" role="cell">
        W{i.wave}
      </span>
      <span className="c-path" role="cell">
        {i.path || '—'}
      </span>
      <span className={`c-touch${quiet ? ' is-quiet' : ''}`} role="cell">
        {agoLabel(i.lastTouch, today)}
      </span>
      <span className={'c-enriched is-' + enriched.tone} role="cell">
        {enriched.text}
      </span>
      <span className="c-next" role="cell">
        {nextLabel(i, today)}
      </span>
      <span className="c-amt" role="cell">
        {i.expected ? money(i.expected) : '–'}
      </span>
      <span className="c-more" role="cell" onClick={(e) => e.stopPropagation()}>
        <RowMenu i={i} />
      </span>
    </div>
  )
}

function CardRow({ i, today, quiet, checked, onCheck, onOpen }: RowProps) {
  const chip = stageChip(i, quiet)
  return (
    <li className={rowClass('inv-c', i, quiet, checked)}>
      <span className="inv-c__check">
        <Box checked={checked} onChange={onCheck} label={`Select ${i.name}`} />
      </span>
      <div className="inv-c__body" role="button" tabIndex={0} onClick={onOpen} onKeyDown={openOnKey(onOpen)}>
        <div className="inv-c__top">
          <strong>{i.name}</strong>
          <span className="inv-c__amt">{i.expected ? money(i.expected) : '–'}</span>
        </div>
        <small className="inv-c__sub">{subLine(i)}</small>
        <div className="inv-c__chips">
          <Chip tone={chip.tone} dot={chip.dot} className="inv-stage">
            {STAGE_TILE[i.stage]}
          </Chip>
          <span className="inv-c__wave">W{i.wave}</span>
          {i.path ? <span className="inv-c__path">via {i.path}</span> : null}
        </div>
        {i.nextStep || i.nextDate || i.lastTouch ? (
          <div className="inv-c__foot">
            <span>{nextLabel(i, today)}</span>
            <span className={quiet ? 'is-quiet' : ''}>{agoLabel(i.lastTouch, today)}</span>
          </div>
        ) : null}
      </div>
      <span className="inv-c__more">
        <RowMenu i={i} />
      </span>
    </li>
  )
}

/** The design's 22px checkbox with a 44px hit area, without a visible label. */
const Box = forwardRef<HTMLInputElement, { checked: boolean; onChange: () => void; label: string }>(function Box({ checked, onChange, label }, ref) {
  return (
    <label className="checkbox inv-box">
      <span className="checkbox__box">
        <input ref={ref} type="checkbox" checked={checked} onChange={onChange} aria-label={label} />
        <span className="checkbox__mark" aria-hidden="true">
          <Icon name="check" size={16} strokeWidth={2.6} />
        </span>
      </span>
    </label>
  )
})

/** The row's ⋯ menu: open, log a touch, nudge, move on a stage, delete. */
function RowMenu({ i }: { i: Investor }) {
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const d = useRaise()
  const { open: openDrawer, toast, remove } = useUI()
  const save = useSaveAction()
  const ix = IDX[i.stage]
  const next = ix !== undefined && ix < STAGES.length - 1 ? STAGES[ix + 1] : null
  const first = i.name.split(/\s+/)[0]
  const items: MenuItem[] = [
    { label: 'Open', icon: 'user', onSelect: () => openDrawer(i._id) },
    { label: 'Log a touch', icon: 'note', onSelect: () => openDrawer(i._id) },
    ...(ACTIVE.has(i.stage)
      ? [{
          label: `Nudge ${first}`,
          icon: 'refresh' as const,
          onSelect: () =>
            void save(() => d.logNote(i._id, 'Nudged'), {
              failMessage: `Couldn’t log the nudge for ${i.name}.`,
              onDone: () => {
                play('nudge')
                toast(`Nudged ${i.name}. Logged as a touch.`)
              },
            }),
        }]
      : []),
    ...(next
      ? [{
          label: `Move to ${STAGE_TILE[next.k]}`,
          icon: 'arrow-right' as const,
          onSelect: () =>
            void save(() => d.advance(i._id), {
              failMessage: `Couldn’t move ${i.name}.`,
              onDone: (r) => {
                if (!r) return
                play('stage-up')
                toast(`${i.name} → ${r.label}. Set the next step.`)
              },
            }),
        }]
      : []),
    // Delete with Undo, the same as the drawer: the row goes now, the delete is sent when the toast goes.
    { label: 'Delete', icon: 'trash', danger: true, onSelect: () => remove(i) },
  ]
  return (
    <>
      <button ref={btn} type="button" className="inv-more-btn" aria-label={`More for ${i.name}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="more" size={18} />
      </button>
      {open ? <Menu anchor={btn.current} title={i.name} items={items} onClose={() => setOpen(false)} /> : null}
    </>
  )
}
