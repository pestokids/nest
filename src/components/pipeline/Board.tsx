import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  BOARD, BOARD_STAGES, cardKeyAction, columnCompare, HIDDEN_STAGES, isBoardStage, landingIndex,
  type BoardFilter, type BoardStage, type ColumnSort,
} from '../../lib/board'
import { pop, scrollBehavior, shake } from '../../lib/motion'
import type { Investor } from '../../lib/pipeline'
import { play } from '../../lib/sound'
import { useUI } from '../raise-ui'
import { Column } from './Column'
import { DealCard } from './DealCard'
import { StageMenu } from './StageMenu' // PST-302
import { boardPreview } from './preview'
import { usePreviewState } from '../preview-state' // PST-302
import { isAwaiting } from '../../lib/applications' // PST-302
import { Scrollbar } from './Scrollbar'
import { Toolbar } from './Toolbar'
import { useBoardDrag } from './useBoardDrag'
import { useMoveCard } from './useMoveCard'
import { useListKeys } from '../system/useListKeys'

type Hidden = (typeof HIDDEN_STAGES)[number]
type Drag = { id: string; from: string; over: string | null; h: number; snapshot: Investor[] }

const SETTLE_MS = 200

/** The Linear-style board (desktop and tablet). */
export function Board({ investors, total, filter, setFilter, today, quietDays, waves }: {
  investors: Investor[]
  total: number
  filter: BoardFilter
  setFilter: (f: BoardFilter) => void
  today: string
  quietDays: number
  waves: string[]
}) {
  const { open } = useUI()
  const moveCard = useMoveCard()
  const preview = useMemo(() => boardPreview(), [])
  const [shown, setShown] = useState<Set<Hidden>>(() => new Set(preview?.state === 'shown' ? HIDDEN_STAGES : []))
  const [entering, setEntering] = useState<Hidden | null>(null)
  const [sorts, setSorts] = useState<Partial<Record<BoardStage, ColumnSort>>>({})
  const [drag, setDrag] = useState<Drag | null>(null)
  const [settle, setSettle] = useState<string | null>(null)
  const [bump, setBump] = useState({ n: 0, stages: [] as string[] })
  const [focusId, setFocusId] = useState<string | null>(null)
  // PST-302: a card's ⋯ menu, to move it to any stage (Not contacted too) in one move.
  const [menu, setMenu] = useState<{ inv: Investor; anchor: HTMLElement } | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const slotRef = useRef<HTMLDivElement>(null)
  // PST-302: ?preview&card=awaiting-decision focuses the card of an application awaiting a decision.
  const cardPreview = usePreviewState()?.card === 'awaiting-decision'
  const awaitingId = cardPreview ? investors.find((i) => isAwaiting(i.application))?._id : undefined
  useEffect(() => {
    if (awaitingId) setFocusId(awaitingId)
  }, [awaitingId])
  // PST-290: J and K through the cards, column by column; ↵ opens, D drafts. ] and [ still move a card.
  useListKeys(scroller)

  // While a card is held the board shows the data as it was at pickup, so a
  // save from another tab never shifts columns under the pointer; it lands on drop.
  const live = useRef(investors)
  useEffect(() => {
    live.current = investors
  }, [investors])
  const list = drag?.snapshot ?? investors

  const columns: BoardStage[] = [...BOARD_STAGES, ...HIDDEN_STAGES.filter((s) => shown.has(s))]
  const hiddenLeft = HIDDEN_STAGES.filter((s) => !shown.has(s))
  const sortOf = (s: BoardStage) => sorts[s] ?? 'attention'
  const byStage = useMemo(() => {
    const m = new Map<string, Investor[]>()
    for (const i of list) {
      const xs = m.get(i.stage)
      if (xs) xs.push(i)
      else m.set(i.stage, [i])
    }
    for (const [k, xs] of m) xs.sort(columnCompare(sorts[k as BoardStage] ?? 'attention', today, quietDays))
    return m
  }, [list, sorts, today, quietDays])
  const dragged = drag ? drag.snapshot.find((i) => i._id === drag.id) ?? null : null

  const after = (id: string, stages: string[]) => {
    setSettle(id)
    setBump((b) => ({ n: b.n + 1, stages }))
  }

  const dnd = useBoardDrag(scroller, {
    onLift: (id, h) => {
      play('card-pickup')
      const snapshot = live.current
      const inv = snapshot.find((i) => i._id === id)
      if (inv) setDrag({ id, from: inv.stage, over: null, h, snapshot })
    },
    onOver: (stage) => setDrag((d) => (d && d.over !== stage ? { ...d, over: stage } : d)),
    onDrop: (id, stage) => {
      setDrag(null)
      if (!stage || !isBoardStage(stage)) return
      const inv = live.current.find((i) => i._id === id)
      if (!inv) {
        play('nope')
        return
      }
      const m = moveCard(inv, stage, { from: slotRef.current })
      if (m.kind !== 'same') after(id, [inv.stage, stage])
    },
    onCancel: (byUser) => {
      setDrag(null)
      if (byUser) play('undo')
    },
  })

  const onKey = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>, inv: Investor) => {
      if (e.target !== e.currentTarget || drag) return
      const a = cardKeyAction(e.key, inv.stage, { meta: e.metaKey, ctrl: e.ctrlKey, alt: e.altKey })
      if (!a) return
      e.preventDefault()
      if (a.do === 'open') return open(inv._id)
      if (a.do === 'nope') {
        play('nope')
        shake(e.currentTarget)
        return
      }
      moveCard(inv, a.to, { from: e.currentTarget })
      after(inv._id, [inv.stage, a.to])
      setFocusId(inv._id)
    },
    [moveCard, open, drag],
  )

  useEffect(() => {
    if (!settle) return
    const t = setTimeout(() => setSettle(null), SETTLE_MS)
    return () => clearTimeout(t)
  }, [settle])

  // Keep keyboard focus on a card that moved column.
  useLayoutEffect(() => {
    if (!focusId) return
    const el = scroller.current?.querySelector<HTMLElement>(`[data-card="${CSS.escape(focusId)}"]`)
    if (el) {
      el.focus({ preventScroll: true })
      el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: scrollBehavior() })
    }
    setFocusId(null)
  }, [focusId, investors])

  const showHidden = (s: Hidden) => {
    setShown((x) => new Set([...x, s]))
    setEntering(s)
    requestAnimationFrame(() => scroller.current?.scrollTo({ left: scroller.current.scrollWidth, behavior: scrollBehavior() }))
  }
  const hide = (s: Hidden) => setShown((x) => new Set([...x].filter((k) => k !== s)))
  useEffect(() => {
    if (!entering) return
    const t = setTimeout(() => setEntering(null), 300)
    return () => clearTimeout(t)
  }, [entering])

  // Preview states that start scrolled to the end.
  useLayoutEffect(() => {
    if (preview && preview.state !== 'hidden' && scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth
  }, [preview])

  const near = new Set<string>()
  if (drag?.over && isBoardStage(drag.over)) {
    const ix = columns.indexOf(drag.over)
    for (const j of [ix - 1, ix + 1]) if (columns[j] && !(byStage.get(columns[j])?.length)) near.add(columns[j])
  }

  return (
    <div className="pb-desk">
      <Toolbar
        filter={filter}
        setFilter={setFilter}
        waves={waves}
        showClosed={hiddenLeft.length === 0}
        setShowClosed={(on) => setShown(new Set(on ? HIDDEN_STAGES : []))}
        count={investors.length}
        total={total}
      />
      <Scrollbar scroller={scroller}>
        <div className="pb-board" ref={scroller} role="group" aria-label="Pipeline board">
          {columns.map((stage) => {
            const cards = byStage.get(stage) ?? []
            const over = !!drag && drag.over === stage && drag.from !== stage
            const others = dragged ? cards.filter((c) => c._id !== dragged._id) : cards
            const slotAt = over && dragged ? landingIndex(others, dragged, stage, sortOf(stage), today, quietDays) : -1
            const slot = <div key="slot" ref={slotRef} className="pb-slot" style={{ height: drag?.h }} aria-hidden="true" />
            let k = 0
            return (
              <Column
                key={stage}
                stage={stage}
                count={cards.length}
                bump={bump}
                over={over}
                near={near.has(stage)}
                entering={entering === stage}
                sort={sortOf(stage)}
                onSort={(s) => setSorts((x) => ({ ...x, [stage]: s }))}
                onAdd={() => open(null, { stage })}
                onHide={stage === 'passed' || stage === 'parked' ? () => hide(stage) : undefined}
                empty={!cards.length && !over}
              >
                {cards.map((inv) => {
                  const isDragged = drag?.id === inv._id
                  const here = !isDragged && k++ === slotAt
                  return [
                    here ? slot : null,
                    <DealCard
                      key={inv._id}
                      inv={inv}
                      today={today}
                      quietDays={quietDays}
                      ghost={isDragged}
                      settle={settle === inv._id}
                      onPointerDown={(e) => dnd.onPointerDown(e, inv._id)}
                      onClick={() => !dnd.consumeClick() && open(inv._id)}
                      onKeyDown={(e) => onKey(e, inv)}
                      onMenu={(anchor) => setMenu({ inv, anchor })}
                    />,
                  ]
                })}
                {slotAt >= 0 && slotAt >= others.length ? slot : null}
              </Column>
            )
          })}
          {hiddenLeft.length ? (
            <aside className="pb-hidden" aria-label="Hidden columns">
              <div className="pb-hidden__label">Hidden columns</div>
              {hiddenLeft.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={['pb-hidden__item', drag?.over === s && drag.from !== s && 'pb-hidden__item--over'].filter(Boolean).join(' ')}
                  data-drop={s}
                  onClick={() => showHidden(s)}
                  aria-label={`Show ${BOARD[s].label}, ${byStage.get(s)?.length ?? 0}`}
                >
                  <span className="pb-dot" style={{ background: BOARD[s].dot }} aria-hidden="true" />
                  <span>{BOARD[s].label}</span>
                  <HiddenCount n={byStage.get(s)?.length ?? 0} bump={bump} stage={s} />
                </button>
              ))}
            </aside>
          ) : null}
        </div>
      </Scrollbar>
      {menu ? (
        <StageMenu
          inv={menu.inv}
          anchor={menu.anchor}
          onClose={() => setMenu(null)}
          onPick={(to) => {
            moveCard(menu.inv, to, { from: menu.anchor })
            after(menu.inv._id, [menu.inv.stage, to])
          }}
        />
      ) : null}
    </div>
  )
}

function HiddenCount({ n, bump, stage }: { n: number; bump: { n: number; stages: string[] }; stage: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (bump.n && bump.stages.includes(stage)) pop(ref.current)
  }, [bump, stage])
  return (
    <span className="pb-col__count" ref={ref}>
      {n}
    </span>
  )
}
