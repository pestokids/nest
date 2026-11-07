// PST-277: "Unmatched notes" on Today, in the style of Who's this?. Notes from
// Wispr Flow (or an agent, through MCP) that Nest couldn't match to an investor by
// email or meeting title wait here, one at a time, until Dev says whose they are
// (they become that investor's note, and Nest reads them) or that they're not
// about the round (Undo in the toast).
import { useMemo, useState } from 'react'
import { todayIST } from '../../lib/dates'
import { dayLabel } from '../../lib/investorView'
import type { UnmatchedNote } from '../../lib/meetingNotes'
import { noteLines } from '../../lib/qanda'
import { play } from '../../lib/sound'
import { useRaise } from '../data'
import { useUI } from '../raise-ui'
import { useSaveAction } from '../system/useSaveAction'
import { Badge, Card, Icon } from '../ui'
import { useQanda } from './data'

const SOURCE: Record<UnmatchedNote['source'], string> = { wispr: 'Wispr Flow', agent: 'an agent', paste: 'a paste' }

export function UnmatchedNotes() {
  const { unmatched, act } = useQanda()
  const d = useRaise()
  const ui = useUI()
  const save = useSaveAction()
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set())
  const options = useMemo(() => [...d.investors].sort((a, b) => a.name.localeCompare(b.name)), [d.investors])
  const left = unmatched.filter((u) => !gone.has(u._id))
  const u = left[0]
  if (!u) return null
  const hide = (id: string, on: boolean) => setGone((s) => (on ? new Set(s).add(id) : new Set([...s].filter((x) => x !== id))))
  const today = todayIST()
  const preview = noteLines(u.text).slice(0, 2).map((l) => l.text)

  const link = (investorId: string) => {
    const i = d.investors.find((x) => x._id === investorId)
    if (!i) return
    hide(u._id, true)
    play('rule-check', { volume: 0.6 })
    void save(() => act.matchUnmatched(u._id, investorId), {
      failMessage: 'Couldn’t add the notes to ' + i.name + '.',
      onError: () => (hide(u._id, false), false),
      onDone: () =>
        ui.toast({
          message: (d.ai.connected ? 'Notes added to ' + i.name + '. Nest is reading them.' : 'Notes added to ' + i.name + '.'),
          action: { label: 'View', onClick: () => ui.open(investorId, { tab: 'notes' }) },
        }),
    })
  }
  const drop = () => {
    hide(u._id, true)
    void save(() => act.dropUnmatched(u._id), {
      failMessage: 'Couldn’t save that.',
      onError: () => (hide(u._id, false), false),
      onDone: () =>
        ui.toast({
          tone: 'info',
          message: 'Set aside. Not about the round.',
          action: { label: 'Undo', onClick: () => { play('undo'); hide(u._id, false); void save(() => act.restoreUnmatched(u._id), { failMessage: 'Couldn’t undo that.' }) } },
        }),
    })
  }

  return (
    <Card riseIndex={9} tone="peach" className="gcard gwho nr-unmatched" aria-labelledby="nr-unmatched-title">
      <header className="gcard__head">
        <h2 id="nr-unmatched-title" className="today__h2 gcard__title">
          <Icon name="note" size={20} />
          Unmatched notes
          {left.length > 1 ? (
            <Badge className="list-panel__badge" aria-label={left.length + ' notes'}>
              {left.length}
            </Badge>
          ) : null}
        </h2>
      </header>
      <p className="gwho__lede">Meeting notes from {SOURCE[u.source]} that Nest couldn’t match to an investor.</p>
      <div className="gwho__box">
        <p className="gwho__name">
          {u.meetingTitle} · <span className="gwho__email">{u.date === today ? 'today' : dayLabel(u.date, today)}</span>
        </p>
        {u.email ? <p className="gwho__meet">{u.email}</p> : null}
        {preview.map((l, i) => (
          <p key={i} className="nr-unmatched__line">
            {l}
          </p>
        ))}
      </div>
      <div className="gwho__actions">
        <button type="button" className="gask__text" onClick={drop}>
          Not about the round
        </button>
      </div>
      <label className="gwho__link">
        <span>Whose notes are these?</span>
        <select value="" onChange={(e) => e.target.value && link(e.target.value)} aria-label="Pick the investor these notes are about">
          <option value="">Pick an investor…</option>
          {options.map((i) => (
            <option key={i._id} value={i._id}>
              {i.name}
            </option>
          ))}
        </select>
        <Icon name="chevron-down" size={16} />
      </label>
    </Card>
  )
}
