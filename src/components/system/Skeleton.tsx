import { useRouterState } from '@tanstack/react-router'
import type { CSSProperties } from 'react'
import { EggCracking } from '../illustrations'

export type SkeletonLayout = 'inbox' | 'board' | 'race' | 'table' | 'close' | 'cards' | 'plan' | 'settings'

const Bar = ({ w, h = 12, r, className }: { w: number | string; h?: number; r?: number; className?: string }) => (
  <span className={['sk', className].filter(Boolean).join(' ')} style={{ width: w, height: h, borderRadius: r ?? h / 2 } as CSSProperties} />
)

/** Rows of a list while it loads: a dot, two lines and an action, as in the Inbox, the drawer's sections and Introducers. */
export function SkeletonRows({ rows = 4, action = true }: { rows?: number; action?: boolean }) {
  return (
    <div className="sk-root sk-rows" aria-busy="true" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div className="sk-row" key={i}>
          <Bar w={22} h={22} />
          <span className="sk-row__name">
            <Bar w={i % 2 ? 120 : 150} h={14} />
            <Bar w={i % 2 ? 200 : 170} />
          </span>
          {action ? <Bar w={96} h={36} r={12} className="sk-row__go" /> : null}
        </div>
      ))}
    </div>
  )
}

/**
 * The loading shimmer (system/loading.png): grey bars in the shape of the view
 * that's loading, so nothing jumps when the data lands, and one light sweep
 * across them every 1.4s (still under reduced motion). Plan keeps the forest
 * card with the egg ("Warming up the nest…") where its summary card goes.
 */
export function Skeleton({ layout = 'cards' }: { layout?: SkeletonLayout }) {
  const hero = (
    <div className="sk-hero">
      <EggCracking size={56} className="sk-hero__egg" />
      <span>Warming up the nest…</span>
    </div>
  )
  return (
    <div className={`sk-root sk-root--${layout}`} aria-busy="true" role="status" aria-label="Loading">
      {layout === 'inbox' ? (
        <div className="sk-inbox">
          <div className="sk-card sk-card--table">
            <span className="sk-head">
              <Bar w={120} h={26} r={8} />
              <Bar w="70%" />
              <span className="sk-chips">
                {[64, 96, 72, 84, 90, 70].map((w, i) => (
                  <Bar key={i} w={w} h={28} r={14} />
                ))}
              </span>
            </span>
            {Array.from({ length: 6 }, (_, i) => (
              <div className="sk-row" key={i}>
                <Bar w={22} h={22} />
                <Bar w={84} h={26} r={13} />
                <span className="sk-row__name">
                  <Bar w={150} h={14} />
                  <Bar w={i % 2 ? 220 : 260} />
                </span>
                <Bar w={110} h={36} r={12} className="sk-row__go" />
              </div>
            ))}
          </div>
          <div className="sk-inbox__side">
            <div className="sk-card sk-card--short">
              <Bar w={120} />
              <Bar w="80%" h={20} />
              <Bar w="100%" h={8} className="sk-gap" />
            </div>
            <div className="sk-card sk-card--short">
              <Bar w={90} h={28} r={8} />
              <Bar w="70%" />
            </div>
          </div>
        </div>
      ) : layout === 'board' ? (
        <>
          <div className="sk-filters">
            {[60, 56, 80].map((w, i) => (
              <Bar key={i} w={w} h={36} r={18} />
            ))}
          </div>
          <div className="sk-filters">
            <Bar w={300} h={44} r={10} />
            <Bar w={160} h={44} r={10} />
            <Bar w={160} h={44} r={10} />
          </div>
          <div className="sk-board">
            {[3, 2, 1, 1, 0].map((n, i) => (
              <div className="sk-col" key={i}>
                <Bar w={90} h={14} />
                <Bar w="80%" />
                {Array.from({ length: n }, (_, j) => (
                  <div className="sk-card sk-card--deal" key={j}>
                    <Bar w="60%" h={14} />
                    <Bar w="40%" />
                    <Bar w={110} h={26} r={13} />
                    <Bar w="85%" className="sk-gap" />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      ) : layout === 'race' ? (
        <>
          <div className="sk-filters">
            {[60, 56, 80].map((w, i) => (
              <Bar key={i} w={w} h={36} r={18} />
            ))}
          </div>
          <div className="sk-hero sk-hero--race" />
          <div className="sk-grid sk-grid--settings">
            <div className="sk-card sk-card--table">
              <span className="sk-head">
                <Bar w={150} h={24} r={8} />
                <Bar w="60%" />
              </span>
              {Array.from({ length: 5 }, (_, i) => (
                <div className="sk-row" key={i}>
                  <Bar w={36} h={36} />
                  <span className="sk-row__name">
                    <Bar w={130} h={14} />
                    <Bar w={70} />
                  </span>
                  <Bar w={280} h={10} />
                  <Bar w={80} />
                </div>
              ))}
            </div>
            <div className="sk-card">
              <Bar w={70} />
              <Bar w={140} h={22} />
              <Bar w="90%" />
              {Array.from({ length: 4 }, (_, i) => (
                <Bar key={i} w="100%" h={36} r={10} />
              ))}
            </div>
          </div>
        </>
      ) : layout === 'close' ? (
        <>
          <div className="sk-filters">
            {[90, 90, 120, 90].map((w, i) => (
              <Bar key={i} w={w} h={32} r={16} />
            ))}
          </div>
          <div className="sk-hero sk-hero--close" />
          <div className="sk-grid sk-grid--5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div className="sk-card sk-card--short" key={i}>
                <Bar w={80} />
                <Bar w={60} h={22} />
              </div>
            ))}
          </div>
          <div className="sk-card sk-card--table">
            <Bar w="100%" h={40} r={12} />
            {Array.from({ length: 4 }, (_, i) => (
              <div className="sk-row" key={i}>
                <Bar w={150} h={14} />
                <Bar w={70} />
                <Bar w={80} h={28} r={14} />
                <Bar w="20%" />
                <Bar w={96} h={36} r={12} className="sk-row__go" />
              </div>
            ))}
          </div>
        </>
      ) : layout === 'cards' ? (
        <>
          <div className="sk-grid sk-grid--3">
            {[0, 1, 2].map((i) => (
              <div className="sk-card" key={i}>
                <Bar w={36} h={36} />
                <Bar w="60%" h={14} className="sk-gap" />
                <Bar w="100%" />
                <Bar w="70%" />
                <Bar w={120} h={36} r={12} className="sk-gap" />
              </div>
            ))}
          </div>
          <div className="sk-grid sk-grid--4">
            {[0, 1, 2, 3].map((i) => (
              <div className="sk-card sk-card--short" key={i}>
                <Bar w={90} />
                <Bar w={70} h={36} r={10} />
                <Bar w="80%" />
              </div>
            ))}
          </div>
        </>
      ) : layout === 'table' ? (
        <>
          <div className="sk-filters">
            <Bar w={300} h={44} r={10} />
            <Bar w={140} h={44} r={10} />
            <Bar w={140} h={44} r={10} />
            <Bar w={140} h={44} r={10} />
          </div>
          <div className="sk-card sk-card--table">
            <Bar w="100%" h={40} r={12} />
            {Array.from({ length: 7 }, (_, i) => (
              <div className="sk-row" key={i}>
                <Bar w={22} h={22} r={6} />
                <span className="sk-row__name">
                  <Bar w={140} h={14} />
                  <Bar w={90} />
                </span>
                <Bar w={70} h={28} r={14} />
                <Bar w={80} h={28} r={14} />
                <Bar w="18%" />
                <Bar w={60} />
              </div>
            ))}
          </div>
        </>
      ) : layout === 'plan' ? (
        <>
          <div className="sk-card sk-card--strip">
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i}>
                <Bar w={60} />
                <Bar w={110} h={20} />
              </span>
            ))}
          </div>
          {hero}
          <div className="sk-grid sk-grid--5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div className="sk-card sk-card--phase" key={i}>
                <Bar w={56} h={26} r={13} />
                <Bar w="70%" h={22} />
                <Bar w="90%" />
                <Bar w="100%" h={8} className="sk-gap" />
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="sk-grid sk-grid--settings">
          <div className="sk-card">
            <Bar w={160} h={22} />
            <Bar w="50%" />
            <div className="sk-grid sk-grid--3 sk-gap">
              {Array.from({ length: 6 }, (_, i) => (
                <span key={i} className="sk-field">
                  <Bar w={80} />
                  <Bar w="100%" h={44} r={10} />
                </span>
              ))}
            </div>
            {Array.from({ length: 5 }, (_, i) => (
              <Bar key={i} w="100%" h={36} r={10} />
            ))}
          </div>
          <div className="sk-card">
            <Bar w={180} h={22} />
            <Bar w="90%" />
            <Bar w="70%" />
            <Bar w="100%" h={48} r={12} className="sk-gap" />
          </div>
        </div>
      )}
    </div>
  )
}

const VIEW_LAYOUT: Record<string, SkeletonLayout> = { today: 'inbox', pipeline: 'board', investors: 'table', close: 'close', plan: 'plan', settings: 'settings' }

/** The Raise view's skeleton while data loads, shaped like the view you're on. */
export function ViewSkeleton() {
  const path = useRouterState({ select: (s) => s.location.pathname })
  const view = useRouterState({ select: (s) => (s.location.search as { view?: string }).view })
  const layout = view === 'race' ? 'race' : (VIEW_LAYOUT[path.split('/').pop() ?? ''] ?? 'cards')
  return <Skeleton layout={layout} />
}
