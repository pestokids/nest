import { useEffect, useRef } from 'react'
import { pop, shine } from '../../lib/motion'
import { play } from '../../lib/sound'
import { useRaise } from '../data'
import { Icon } from '../ui'

const plural = (n: number, one: string) => n + ' ' + one + (n === 1 ? '' : 's')

/**
 * Bulk Enrich's toast (investors-enrich-selected.png): "1 of 4 done", a bar that
 * fills, then lime with what's waiting for review. Two run at a time, about 30
 * seconds each.
 */
export function EnrichProgress({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const { ai } = useRaise()
  const box = useRef<HTMLDivElement>(null)
  const line = useRef<HTMLSpanElement>(null)
  const runs = new Map(ai.runs.flatMap((r) => (r.investorId ? [[r.investorId, r] as const] : [])))
  const list = ids.map((id) => runs.get(id))
  const total = ids.length
  const done = list.filter((r) => r && r.status !== 'queued' && r.status !== 'running').length
  const toReview = list.reduce((s, r) => s + (r?.pending ?? 0), 0)
  const finished = done === total
  const minutes = Math.ceil(((total - done) * 30) / 2 / 60)

  const seen = useRef(done)
  useEffect(() => {
    if (done === seen.current) return
    seen.current = done
    pop(line.current)
  }, [done])
  useEffect(() => {
    if (!finished) return
    shine(box.current)
    play('import-done')
    const t = setTimeout(onClose, 8000)
    return () => clearTimeout(t)
  }, [finished, onClose])

  return (
    <div ref={box} className={'enrich-toast' + (finished ? ' is-done' : '')} role="status" aria-live="polite">
      <button type="button" className="enrich-toast__x" aria-label="Close" onClick={onClose}>
        <Icon name="close" size={16} strokeWidth={2.4} />
      </button>
      <div className="enrich-eyebrow eyebrow-mono">
        <Icon name="spark" size={16} className="enrich-spark" />
        {finished ? 'Enriched ' : 'Enriching '}
        {total}
      </div>
      <span ref={line} className="enrich-toast__line">
        {finished
          ? plural(total, 'investor') + ' enriched · ' + (toReview ? plural(toReview, 'fact') + ' to review' : 'nothing new')
          : done + ' of ' + total + ' done · ' + (minutes <= 1 ? 'about a minute left' : 'about ' + minutes + ' minutes left')}
      </span>
      {!finished ? (
        <>
          <div className="enrich-toast__bar" aria-hidden="true">
            <span style={{ width: Math.max(4, (done / total) * 100) + '%' }} />
          </div>
          <p className="enrich-toast__note">Results wait in each investor’s drawer to keep.</p>
        </>
      ) : (
        <p className="enrich-toast__note">Open one to keep what’s right.</p>
      )}
    </div>
  )
}
