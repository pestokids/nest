import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState, useSyncExternalStore } from 'react'
import { useRaise } from '../../../components/data'
import { Board } from '../../../components/pipeline/Board'
import { PhoneBoard } from '../../../components/pipeline/PhoneBoard'
import { matchesFilter, type BoardFilter } from '../../../lib/board'
import { todayIST } from '../../../lib/dates'
import { Maybes } from '../../../components/pipeline/Maybes' // PST-293
import { usePreviewState } from '../../../components/preview-state'
import { useRouterState } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/raise/pipeline')({ component: Pipeline })

const PHONE = '(max-width: 720px)'
const subscribe = (fn: () => void) => {
  const mq = matchMedia(PHONE)
  mq.addEventListener('change', fn)
  return () => mq.removeEventListener('change', fn)
}
const usePhone = () => useSyncExternalStore(subscribe, () => matchMedia(PHONE).matches, () => false)

/** Raise › Pipeline: a Linear-style board on desktop, one stage at a time on phones. */
function Pipeline() {
  const { investors, round } = useRaise()
  const phone = usePhone()
  const [filter, setFilter] = useState<BoardFilter>({ q: '', wave: null, type: null })
  const today = todayIST()
  const shown = useMemo(() => investors.filter((i) => matchesFilter(i, filter)), [investors, filter])
  // PST-293: Pipeline › Maybes at ?view=maybes (and &pipeline=maybes in preview) until PST-295's switcher lands.
  const view = useRouterState({ select: (s): string => String((s.location.search as { view?: unknown }).view ?? '') })
  const preview = usePreviewState()
  if (view === 'maybes' || preview?.pipeline === 'maybes') return <Maybes />
  return phone ? (
    <PhoneBoard investors={investors} today={today} quietDays={round.quietDays} />
  ) : (
    <Board
      investors={shown}
      total={investors.length}
      filter={filter}
      setFilter={setFilter}
      today={today}
      quietDays={round.quietDays}
      waves={round.waves}
    />
  )
}
