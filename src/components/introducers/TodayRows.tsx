// PST-294: introducer rows on Today, in the existing sections (PST-297's Inbox
// takes over from src/lib/inbox.ts): Due today gets "thank them" (the day the
// intro is made) and "report back" (once the investor decides); Gone quiet gets
// "nudge the introducer" (3 days with no reply to the ask).
import { useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { todayIST } from '../../lib/dates'
import { introNudges, introReports, introThanks, type IntroRow } from '../../lib/inbox'
import { play } from '../../lib/sound'
import { pop } from '../../lib/motion'
import { openOnKey, useUI } from '../raise-ui'
import { Button, Checkbox, Chip, Icon } from '../ui'
import { useIntroducers, useIntroInvestors } from './data'

/** Thank-yous and reports due, and introducers to nudge. */
export function useIntroInbox(today: string) {
  const x = useIntroducers()
  const investors = useIntroInvestors()
  return useMemo(() => {
    if (!x.loaded) return { due: [] as IntroRow[], nudges: [] as IntroRow[] }
    const src = { introducers: x.introducers, intros: x.intros, investors, today }
    return { due: [...introThanks(src), ...introReports(src)], nudges: introNudges(src) }
  }, [x.loaded, x.introducers, x.intros, investors, today])
}

function useOpenPerson() {
  const navigate = useNavigate()
  return (key: string) => void navigate({ to: '/raise/investors', search: { view: 'introducers', person: key } })
}

/** Rows for Due today: tick to mark thanked (or reported back). */
export function IntroDueRows({ rows }: { rows: IntroRow[] }) {
  const x = useIntroducers()
  const { fail } = useUI()
  const openPerson = useOpenPerson()
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(() => new Set())
  async function tick(r: IntroRow) {
    setLeaving((s) => new Set(s).add(r.key))
    play('card-pickup', { rate: 1.2, volume: 0.6 })
    await new Promise((res) => setTimeout(res, 300))
    try {
      await x.setStep(r.introId, r.kind === 'thank' ? 'thanked' : 'reported', todayIST())
    } catch (e) {
      fail(e)
    } finally {
      setLeaving((s) => new Set([...s].filter((k) => k !== r.key)))
    }
  }
  return (
    <>
      {rows.map((r) => (
        <li key={r.key} className={'due-row' + (leaving.has(r.key) ? ' due-row--leaving' : '')}>
          <Checkbox className="due-row__tick" checked={leaving.has(r.key)} onChange={() => void tick(r)} aria-label={'Done: ' + r.title} />
          <div className="due-row__main" role="button" tabIndex={0} data-nav-id={r.key} onClick={() => openPerson(r.personKey)} onKeyDown={openOnKey(() => openPerson(r.personKey))} aria-label={'Open ' + r.name}>
            <span className="row__text">
              <span className="row__name">{r.title}</span>
              <span className="row__sub">
                {r.detail}
                {r.kind === 'thank' && r.late > 0 ? <span className="row__late"> · {r.late === 1 ? '1 day late' : r.late + ' days late'}</span> : null}
              </span>
            </span>
            <Chip tone="outline" dot={false} className="due-row__chip only-desk">
              {r.kind === 'thank' ? 'Thank' : 'Report back'}
            </Chip>
            <Icon name="chevron-right" size={20} className="due-row__chev" />
          </div>
        </li>
      ))}
    </>
  )
}

/** Rows for Gone quiet: an introducer who hasn't replied to the ask in 3 days. */
export function IntroQuietRows({ rows }: { rows: IntroRow[] }) {
  const x = useIntroducers()
  const { fail } = useUI()
  const openPerson = useOpenPerson()
  // After a nudge the row stays with its "Nudged" chip until you leave Today.
  const [nudged, setNudged] = useState<IntroRow[]>([])
  const shown = [...rows.filter((r) => !nudged.some((n) => n.key === r.key)), ...nudged]
  async function nudge(r: IntroRow, el: HTMLElement | null) {
    setNudged((xs) => [...xs, r])
    play('nudge')
    requestAnimationFrame(() => pop(el?.closest('.quiet-row')?.querySelector('.quiet-row__nudged')))
    try {
      await x.nudged(r.introId)
    } catch (e) {
      setNudged((xs) => xs.filter((n) => n.key !== r.key))
      fail(e)
    }
  }
  return (
    <>
      {shown.map((r) => (
        <li key={r.key} className="quiet-row">
          <div className="quiet-row__main" role="button" tabIndex={0} data-nav-id={r.key} onClick={() => openPerson(r.personKey)} onKeyDown={openOnKey(() => openPerson(r.personKey))} aria-label={'Open ' + r.name}>
            <span className="row__name">{r.title}</span>
            <span className="row__sub only-desk">Warm path · {r.detail.toLowerCase()}</span>
            <span className="row__sub row__sub--warn only-phone">{r.detail}</span>
          </div>
          {nudged.some((n) => n.key === r.key) ? (
            <Chip tone="live" className="quiet-row__nudged">
              Nudged
            </Chip>
          ) : (
            <Button variant="secondary" className="quiet-row__btn" onClick={(e) => void nudge(r, e.currentTarget)} aria-label={'Nudge ' + r.name}>
              Nudge
            </Button>
          )}
        </li>
      ))}
    </>
  )
}
