import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useRaise } from '../../../components/data'
import { Board } from '../../../components/pipeline/Board'
import { Maybes, useMaybeCount } from '../../../components/pipeline/Maybes' // PST-293
import { PhoneBoard } from '../../../components/pipeline/PhoneBoard'
import { isView, nextView, PIPELINE_VIEWS, VIEW_LABEL, type PipelineView } from '../../../components/pipeline/views'
import { usePreviewState } from '../../../components/preview-state'
import { Race } from '../../../components/race/Race'
import { matchesFilter, type BoardFilter } from '../../../lib/board'
import { todayIST } from '../../../lib/dates'
import { KEYS, keyLabel, matches, singleKeyOk } from '../../../lib/shortcuts'

/** PST-295: the view lives in the URL (?view=race, ?view=maybes), so a view is a link. Board is the default. */
export const Route = createFileRoute('/_app/raise/pipeline')({
  validateSearch: (s: Record<string, unknown>): { view?: PipelineView } => ({ view: isView(s.view) && s.view !== 'board' ? s.view : undefined }),
  component: Pipeline,
})

const PHONE = '(max-width: 720px)'
const subscribe = (fn: () => void) => {
  const mq = matchMedia(PHONE)
  mq.addEventListener('change', fn)
  return () => mq.removeEventListener('change', fn)
}
const usePhone = () => useSyncExternalStore(subscribe, () => matchMedia(PHONE).matches, () => false)

/** Raise › Pipeline: Board (a Linear-style board on desktop, one stage at a time on phones), Race and Maybes. */
function Pipeline() {
  const { investors, round } = useRaise()
  const phone = usePhone()
  const s = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const preview = usePreviewState()
  const view: PipelineView = s.view ?? (preview?.pipeline === 'maybes' ? 'maybes' : preview?.race && preview.race !== 'home' ? 'race' : 'board')
  const setView = useCallback((v: PipelineView) => navigate({ search: (prev) => ({ ...prev, view: v === 'board' ? undefined : v }), replace: true }), [navigate])

  // V: the next view, never while typing or with a dialog or the drawer open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!matches(e, KEYS.views) || !singleKeyOk(e) || document.querySelector('.sys-modal, [aria-modal="true"]')) return
      e.preventDefault()
      setView(nextView(view))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [view, setView])

  const [filter, setFilter] = useState<BoardFilter>({ q: '', wave: null, type: null })
  const today = todayIST()
  const shown = useMemo(() => investors.filter((i) => matchesFilter(i, filter)), [investors, filter])
  const maybeCount = useMaybeCount()
  return (
    <>
      <div className="pviews">
        <div className="pviews__list" role="tablist" aria-label="Pipeline views">
          {PIPELINE_VIEWS.map((v) => (
            <button key={v} type="button" role="tab" aria-selected={v === view} className={`chip pviews__opt ${v === view ? 'chip--selected' : 'chip--outline'}`} onClick={() => setView(v)}>
              {VIEW_LABEL[v]}
              {v === 'maybes' && maybeCount ? <span className="num"> {maybeCount}</span> : null}
            </button>
          ))}
        </div>
        <p className="pviews__hint">{keyLabel(KEYS.views)} to switch views</p>
      </div>
      {view === 'race' ? (
        <Race />
      ) : view === 'maybes' ? (
        <Maybes />
      ) : phone ? (
        <PhoneBoard investors={investors} today={today} quietDays={round.quietDays} />
      ) : (
        <Board investors={shown} total={investors.length} filter={filter} setFilter={setFilter} today={today} quietDays={round.quietDays} waves={round.waves} />
      )}
    </>
  )
}
