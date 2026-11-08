// PST-293: Pipeline › Maybes (the "Get to a no" part of pipeline-race.png):
// every maybe, the longest one first, with how many calls and the decide-by
// date, and one button each: Ask for a yes or no (a draft), Mark as no, or Set a
// date. PST-295 adds the Board · Race · Maybes switcher; until then this is
// /raise/pipeline?view=maybes.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ASK_OR_DROP_CALLS, decideByLine, isDecideByPassed, maybeAction, maybeDays, sortMaybes, type Decision } from '../../lib/decisions'
import { todayIST } from '../../lib/dates'
import { foldAway, MOMENT_MS } from '../../lib/motion'
import { quietDays } from '../../lib/today'
import { useRaise } from '../data'
import { useDecide, useDecisions } from '../decisions/data'
import { openDraft } from '../drafts/data'
import { NestWithEggs } from '../illustrations'
import { openOnKey, useUI } from '../raise-ui'
import { useListKeys } from '../system/useListKeys'
import { Button, Card } from '../ui'

const plural = (n: number, one: string) => n + ' ' + one + (n === 1 ? '' : 's')

/** How many maybes there are (PST-295's switcher shows it as "Maybes 4"). */
export function useMaybeCount() {
  return useDecisions().decisions.filter((d) => d.status === 'maybe').length
}

/** `onRace`: the empty state's "See the race" (left out inside the race itself). */
export function Maybes({ onRace }: { onRace?: () => void }) {
  const d = useRaise()
  const x = useDecisions()
  const decide = useDecide()
  const ui = useUI()
  const today = todayIST()
  const list = useRef<HTMLUListElement>(null)
  useListKeys(list)

  // PST-298: a maybe that becomes a No (Mark as no, here or in the drawer) greys and folds away before it leaves (interactions-batch-1.png).
  const [gone, setGone] = useState<ReadonlyMap<string, Decision>>(() => new Map())
  const seen = useRef<ReadonlyMap<string, Decision>>(new Map())
  useEffect(() => {
    const maybes = new Map(x.decisions.filter((r) => r.status === 'maybe').map((r) => [r.investorId, r]))
    const nos = [...seen.current.values()].filter((r) => !maybes.has(r.investorId) && x.decisionOf(r.investorId).status === 'no')
    seen.current = maybes
    if (!nos.length) return
    const ids = new Set(nos.map((r) => r.investorId))
    setGone((g) => new Map([...g, ...nos.map((r) => [r.investorId, r] as const)]))
    setTimeout(() => setGone((g) => new Map([...g].filter(([id]) => !ids.has(id)))), MOMENT_MS)
  }, [x])
  const folding = useRef(new Map<string, Animation | null>())
  useLayoutEffect(() => {
    for (const [id, a] of folding.current)
      if (!gone.has(id)) {
        a?.cancel()
        folding.current.delete(id)
      }
    for (const id of gone.keys())
      if (!folding.current.has(id)) folding.current.set(id, foldAway(list.current?.querySelector<HTMLElement>(`[data-maybe="${CSS.escape(id)}"]`), { grey: true, slide: 40 }))
  }, [gone])

  const rows = useMemo(() => {
    const byId = new Map(d.investors.map((i) => [i._id, i]))
    return sortMaybes(x.decisions.filter((r) => byId.has(r.investorId)).map((r) => ({ ...(gone.get(r.investorId) ?? r), name: byId.get(r.investorId)!.name })))
      .map((r) => ({ d: r, i: byId.get(r.investorId)! }))
  }, [d.investors, x.decisions, gone])

  return (
    <Card tone="peach" riseIndex={0} className="maybes" aria-labelledby="maybes-title">
      <header className="maybes__head">
        <div className="maybes__eyebrow eyebrow-mono">Get to a no</div>
        <h2 id="maybes-title" className="maybes__title">
          {rows.length ? plural(rows.length, 'maybe') : 'No maybes'}
        </h2>
        <p className="maybes__note">Maybes are fake traction. Ask by the 3rd call. Once a decide-by date passes, get a yes or a no.</p>
      </header>
      {!x.loaded ? null : rows.length ? (
        <ul className="maybes__rows" ref={list}>
          {rows.map(({ d: m, i }) => {
            const days = maybeDays(m.maybeSince!, Date.now())
            const quiet = quietDays(i, today)
            const hotCalls = m.calls >= ASK_OR_DROP_CALLS
            const callText = hotCalls
              ? plural(m.calls, 'call') + ' · ask or drop'
              : plural(m.calls, 'call') + (quiet !== null && quiet >= d.round.quietDays ? ' · ' + quiet + ' days quiet' : '')
            const lead = !!m.reason
            const late = isDecideByPassed(m, today)
            const when = m.reason ? '“Come back when you have a lead” · a polite no' : m.decideBy ? decideByLine(m.decideBy, today) : 'No decide-by date'
            const action = maybeAction(m, today, quiet)
            return (
              <li key={i._id} className="maybe-row" data-maybe={i._id}>
                <div className="maybe-row__main" role="button" tabIndex={0} data-nav-id={i._id} onClick={() => ui.open(i._id)} onKeyDown={openOnKey(() => ui.open(i._id))} aria-label={'Open ' + i.name}>
                  <span className="maybe-row__name">{i.name}</span>
                  <span className="maybe-row__days">A maybe for {plural(days, 'day')}</span>
                  <span className={'maybe-row__calls' + (hotCalls ? ' is-hot' : '')}>{callText}</span>
                  <span className={'maybe-row__when' + (late || lead ? ' is-hot' : '')}>{when}</span>
                </div>
                <div className="maybe-row__act">
                  {action === 'ask' ? (
                    <Button variant="primary" onClick={() => openDraft({ investorId: i._id, type: 'decision' })}>
                      Ask for a yes or no
                    </Button>
                  ) : action === 'no' ? (
                    <Button variant="secondary" onClick={() => decide.status(i, 'no')}>
                      Mark as no
                    </Button>
                  ) : (
                    <Button variant="secondary" onClick={() => ui.open(i._id, { decide: true })}>
                      Set a date
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      ) : (
        <div className="empty-state empty-state--cream maybes__empty">
          <NestWithEggs size={88} />
          <div>
            <p className="empty-state__title">No maybes. Nice.</p>
            <p>Everyone is interested, a yes or a no. Mark a maybe from the investor’s drawer, or Nest will from their emails and your notes.</p>
            {onRace ? (
              <Button variant="secondary" className="empty-state__action" onClick={onRace}>
                See the race
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </Card>
  )
}
