import { useRouterState } from '@tanstack/react-router'
import type { CSSProperties } from 'react'
import { EggCracking } from '../illustrations'

export type SkeletonLayout = 'today' | 'table' | 'plan' | 'settings'

const Bar = ({ w, h = 12, r, className }: { w: number | string; h?: number; r?: number; className?: string }) => (
  <span className={['sk', className].filter(Boolean).join(' ')} style={{ width: w, height: h, borderRadius: r ?? h / 2 } as CSSProperties} />
)

/**
 * The loading shimmer (system/loading.png): grey bars where the view will be,
 * a forest card with the egg ("Warming up the nest…") on top, and one light
 * sweep across them every 1.4s (still under reduced motion).
 */
export function Skeleton({ layout = 'today' }: { layout?: SkeletonLayout }) {
  const hero = (
    <div className="sk-hero">
      <EggCracking size={56} className="sk-hero__egg" />
      <span>Warming up the nest…</span>
    </div>
  )
  return (
    <div className={`sk-root sk-root--${layout}`} aria-busy="true" role="status" aria-label="Loading">
      {layout === 'today' ? (
        <>
          {hero}
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

/** The Raise view's skeleton while data loads, shaped like the view you're on. */
export function ViewSkeleton() {
  const path = useRouterState({ select: (s) => s.location.pathname })
  const layout: SkeletonLayout = path.endsWith('/investors') ? 'table' : path.endsWith('/plan') ? 'plan' : path.endsWith('/settings') ? 'settings' : 'today'
  return <Skeleton layout={layout} />
}
