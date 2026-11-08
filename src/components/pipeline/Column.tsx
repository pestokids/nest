import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { BOARD, COLUMN_SORTS, isHiddenStage, type BoardStage, type ColumnSort } from '../../lib/board'
import { pop } from '../../lib/motion'
import { Egg } from '../illustrations'
import { Button, Icon } from '../ui'

type Props = {
  stage: BoardStage
  count: number
  /** Counts pop when this changes and lists this column. */
  bump: { n: number; stages: string[] }
  over: boolean
  /** A card is passing a neighbour: the empty egg wobbles. */
  near: boolean
  entering: boolean
  sort: ColumnSort
  onSort: (s: ColumnSort) => void
  onAdd: () => void
  onHide?: () => void
  empty: boolean
  children: ReactNode
}

/** One stage: sticky header (dot, name, count, ⋯, +), its rule, and its own scrolling list. */
export function Column({ stage, count, bump, over, near, entering, sort, onSort, onAdd, onHide, empty, children }: Props) {
  const s = BOARD[stage]
  const countRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (bump.n && bump.stages.includes(stage)) pop(countRef.current)
  }, [bump, stage])

  // Fade the last card while there is more to scroll to.
  const listRef = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState(false)
  useLayoutEffect(() => {
    const l = listRef.current
    if (!l) return
    const upd = () => setMore(l.scrollTop + l.clientHeight < l.scrollHeight - 2)
    upd()
    l.addEventListener('scroll', upd, { passive: true })
    const ro = new ResizeObserver(upd)
    ro.observe(l)
    for (const c of l.children) ro.observe(c)
    return () => {
      l.removeEventListener('scroll', upd)
      ro.disconnect()
    }
  }, [count])

  return (
    <section
      className={['pb-col', over && 'pb-col--over', near && 'pb-col--near', entering && 'pb-col--enter'].filter(Boolean).join(' ')}
      data-drop={stage}
      aria-label={`${s.label}, ${count}`}
    >
      <header className="pb-col__head">
        <span className="pb-dot" style={{ background: s.dot }} aria-hidden="true" />
        <h2 className="pb-col__name">{s.label}</h2>
        <span className="pb-col__count" ref={countRef}>
          {count}
        </span>
        <span className="pb-col__sp" />
        <ColumnMenu label={s.label} sort={sort} onSort={onSort} onAdd={onAdd} onHide={isHiddenStage(stage) ? onHide : undefined} />
        <button type="button" className="pb-icon-btn" aria-label={`Add investor to ${s.label}`} onClick={onAdd}>
          <Icon name="plus" size={18} strokeWidth={2} />
        </button>
      </header>
      <p className="pb-col__rule">{s.rule}</p>
      <div className={['pb-col__list', more && 'pb-col__list--more'].filter(Boolean).join(' ')} ref={listRef} data-drop-list>
        {children}
        {empty ? (
          <div className="pb-empty">
            <Egg size={28} />
            <span>Nobody here yet. A card moves in when its rule is true.</span>
            <Button variant="secondary" size="sm" onClick={onAdd}>
              Add investor
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  )
}

function ColumnMenu({ label, sort, onSort, onAdd, onHide }: { label: string; sort: ColumnSort; onSort: (s: ColumnSort) => void; onAdd: () => void; onHide?: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      ref.current?.querySelector<HTMLButtonElement>('button')?.focus()
    }
    document.addEventListener('pointerdown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', down)
      document.removeEventListener('keydown', key)
    }
  }, [open])
  const pick = (fn: () => void) => () => {
    setOpen(false)
    fn()
  }
  return (
    <div className="pb-menu" ref={ref}>
      <button type="button" className="pb-icon-btn" aria-label={`${label} options`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="more" size={18} />
      </button>
      {open ? (
        <div className="pb-menu__panel" role="menu" aria-label={`${label} options`}>
          <div className="pb-menu__label">Sort</div>
          {COLUMN_SORTS.map((o) => (
            <button key={o.k} type="button" role="menuitemradio" aria-checked={sort === o.k} className="pb-menu__item" onClick={pick(() => onSort(o.k))}>
              <span>{o.l}</span>
              {sort === o.k ? <Icon name="check" size={16} strokeWidth={2.2} /> : null}
            </button>
          ))}
          <div className="pb-menu__sep" />
          <button type="button" role="menuitem" className="pb-menu__item" onClick={pick(onAdd)}>
            Add investor here
          </button>
          {onHide ? (
            <button type="button" role="menuitem" className="pb-menu__item" onClick={pick(onHide)}>
              Hide column
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
