import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { BOARD, BOARD_KEYS, BOARD_STAGES, cardKeyAction, columnCompare, swipeTarget, type BoardStage } from '../../lib/board'
import { pop, shake, shine } from '../../lib/motion'
import type { Investor } from '../../lib/pipeline'
import { play } from '../../lib/sound'
import { Egg } from '../illustrations'
import { useUI } from '../raise-ui'
import { Icon } from '../ui'
import { DealCard } from './DealCard'
import { boardPreview } from './preview'
import { useMoveCard } from './useMoveCard'

/** Phones: one stage at a time, a scrolling stage chip strip, swipe a card right to move it on. */
export function PhoneBoard({ investors, today, quietDays }: { investors: Investor[]; today: string; quietDays: number }) {
  const { open } = useUI()
  const moveCard = useMoveCard()
  const [stage, setStage] = useState<BoardStage>(() => {
    const p = boardPreview()?.stage
    return p ?? BOARD_STAGES.find((s) => investors.some((i) => i.stage === s)) ?? 'ask'
  })
  const [lit, setLit] = useState<{ stage: BoardStage; n: number } | null>(null)
  const strip = useRef<HTMLDivElement>(null)

  const count = useMemo(() => {
    const m = new Map<string, number>()
    for (const i of investors) m.set(i.stage, (m.get(i.stage) ?? 0) + 1)
    return m
  }, [investors])
  const cards = useMemo(
    () => investors.filter((i) => i.stage === stage).sort(columnCompare('attention', today, quietDays)),
    [investors, stage, today, quietDays],
  )
  const next = swipeTarget(stage)
  const s = BOARD[stage]

  useLayoutEffect(() => {
    strip.current?.querySelector<HTMLElement>(`[data-stage="${stage}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [stage])
  useEffect(() => {
    if (!lit) return
    const el = strip.current?.querySelector<HTMLElement>(`[data-stage="${lit.stage}"]`)
    shine(el)
    pop(el?.querySelector('.pb-chip__n'))
  }, [lit])

  const moveTo = (inv: Investor, to: BoardStage, el?: Element | null) => {
    moveCard(inv, to, { from: el })
    setLit((l) => ({ stage: to, n: (l?.n ?? 0) + 1 }))
  }

  return (
    <div className="pb-phone">
      <div className="pb-chips" ref={strip} role="tablist" aria-label="Stages">
        {BOARD_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={k === stage}
            data-stage={k}
            className={['pb-chip', k === stage && 'pb-chip--on'].filter(Boolean).join(' ')}
            onClick={() => setStage(k)}
          >
            <span className="pb-chip__pill">
              {BOARD[k].label} <span className="pb-chip__n">{count.get(k) ?? 0}</span>
            </span>
          </button>
        ))}
      </div>
      <p className="pb-phone__eyebrow">
        {s.label} · {s.rule.replace(/\.$/, '').split('. ')[0]}
      </p>
      <div className="pb-phone__list" role="tabpanel" aria-label={s.label}>
        {cards.map((inv) => (
          <SwipeCard
            key={inv._id}
            inv={inv}
            next={next}
            today={today}
            quietDays={quietDays}
            onOpen={() => open(inv._id)}
            onSwipe={(el) => next && moveTo(inv, next, el)}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return
              const a = cardKeyAction(e.key, inv.stage, { meta: e.metaKey, ctrl: e.ctrlKey, alt: e.altKey })
              if (!a) return
              e.preventDefault()
              if (a.do === 'open') open(inv._id)
              else if (a.do === 'nope') {
                play('nope')
                shake(e.currentTarget)
              } else moveTo(inv, a.to, e.currentTarget)
            }}
          />
        ))}
        {!cards.length ? (
          <div className="pb-empty pb-empty--phone">
            <Egg size={28} />
            <span>Nobody here yet</span>
          </div>
        ) : null}
        {next && cards.length ? (
          <div className="pb-phone__hint">
            <Icon name="arrow-right" size={18} />
            <span>Swipe a card right to move it to {BOARD[next].label}.</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}

const DECIDE = 10

/** A card that follows the finger sideways; past a third of its width it moves on. */
function SwipeCard({ inv, next, today, quietDays, onOpen, onSwipe, onKeyDown }: {
  inv: Investor
  next: BoardStage | null
  today: string
  quietDays: number
  onOpen: () => void
  onSwipe: (el: Element | null) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const g = useRef<{ id: number; sx: number; sy: number; axis: 'x' | 'y' | null; x: number } | null>(null)
  const swallow = useRef(false)
  const [gone, setGone] = useState(false)

  const set = (x: number, animate: boolean) => {
    const el = card.current
    const w = wrap.current
    if (!el || !w) return
    el.style.transition = animate ? 'translate 220ms var(--ease-out-back)' : 'none'
    el.style.translate = `${x}px 0`
    w.style.setProperty('--swipe', String(Math.max(0, Math.min(1, x / (w.clientWidth / 3)))))
  }

  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || gone) return
    g.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, axis: null, x: 0 }
  }
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = g.current
    if (!s || s.id !== e.pointerId) return
    const dx = e.clientX - s.sx
    const dy = e.clientY - s.sy
    if (!s.axis) {
      if (Math.abs(dx) > DECIDE && Math.abs(dx) > Math.abs(dy) * 1.2) {
        s.axis = 'x'
        e.currentTarget.setPointerCapture(e.pointerId)
      } else if (Math.abs(dy) > DECIDE) s.axis = 'y'
      else return
    }
    if (s.axis !== 'x') return
    // Right follows the finger; left (and right with nowhere to go) resists.
    s.x = dx > 0 && next ? dx : dx / 4
    set(s.x, false)
  }
  const up = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = g.current
    g.current = null
    if (!s || s.id !== e.pointerId || s.axis !== 'x') return
    swallow.current = true
    setTimeout(() => (swallow.current = false), 0)
    const w = wrap.current?.clientWidth ?? 300
    if (s.x > Math.min(140, w / 3) && next) {
      setGone(true)
      const el = card.current
      if (el) {
        el.style.transition = 'translate 180ms var(--ease-out)'
        el.style.translate = `${w + 24}px 0`
      }
      setTimeout(() => onSwipe(wrap.current), 170)
      return
    }
    if (!next && e.clientX - s.sx > 40) {
      play('nope')
      shake(card.current)
    }
    set(0, true)
  }

  return (
    <div className="pb-swipe" ref={wrap}>
      {next ? (
        <div className="pb-swipe__under" aria-hidden="true">
          <Icon name="arrow-right" size={18} strokeWidth={2.2} />
          {BOARD[next].label}
        </div>
      ) : null}
      <DealCard
        ref={card}
        inv={inv}
        today={today}
        quietDays={quietDays}
        className="pb-card--phone"
        aria-label={`${inv.name}.${next ? ` Swipe right to move to ${BOARD[next].label}.` : ''}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => {
          g.current = null
          set(0, true)
        }}
        onClick={() => !swallow.current && onOpen()}
        onKeyDown={onKeyDown}
      />
    </div>
  )
}
