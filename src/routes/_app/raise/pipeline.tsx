import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState, useSyncExternalStore } from 'react'
import { useRaise } from '../../../components/data'
import { Board } from '../../../components/pipeline/Board'
import { PhoneBoard } from '../../../components/pipeline/PhoneBoard'
import { matchesFilter, type BoardFilter } from '../../../lib/board'
import { todayIST } from '../../../lib/dates'

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
