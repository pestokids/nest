// PST-294: Add (or edit) an introducer, and ask someone for another intro.
import { useState, type FormEvent } from 'react'
import { firstName, PICK_RELATIONS, RELATION_LABEL, type Person } from '../../lib/introducers'
import { play } from '../../lib/sound'
import { COMMIT, IDX } from '../../lib/stages'
import { useRaise } from '../data'
import { openDraft } from '../drafts/data'
import { useUI } from '../raise-ui'
import { Modal, useTitleId } from '../system/Modal'
import { Button, IconButton, Input, Select, Textarea } from '../ui'
import { useIntroducers, type IntroducerFields } from './data'

/** Add someone who introduces Dev, or edit one. Resolves (onSaved) with their id. */
export function IntroducerDialog({ edit, onClose, onSaved }: { edit?: Person; onClose: () => void; onSaved?: (id: string) => void }) {
  const x = useIntroducers()
  const { toast, fail } = useUI()
  const titleId = useTitleId()
  const [f, setF] = useState<IntroducerFields>(() => ({
    name: edit?.name ?? '', email: edit?.email ?? '', relation: edit && edit.relation !== 'committed' ? edit.relation : 'portfolio', notes: edit?.notes ?? '',
  }))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: keyof IntroducerFields) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!f.name.trim()) return setError('Add their name.')
    setBusy(true)
    try {
      if (edit?.introducerId) {
        await x.update(edit.introducerId, f)
        toast({ tone: 'success', icon: 'check', message: 'Saved.' })
        onSaved?.(edit.introducerId)
      } else {
        const r = await x.add(f)
        play('save')
        toast({ tone: 'success', icon: 'check', message: r.existed ? f.name.trim() + ' was already here.' : 'Added ' + f.name.trim() + '.' })
        onSaved?.(r.id)
      }
      onClose()
    } catch (err) {
      setBusy(false)
      fail(err)
    }
  }

  return (
    <Modal onClose={onClose} labelledBy={titleId} className="intro-dialog">
      <IconButton icon="close" label="Close" className="intro-dialog__close" onClick={onClose} />
      <h2 id={titleId} className="intro-dialog__title">{edit ? 'Edit ' + firstName(edit.name) : 'Add an introducer'}</h2>
      <p className="intro-dialog__sub">Someone who can introduce you to investors. A portfolio founder’s intro beats every other kind.</p>
      <form className="intro-dialog__form" onSubmit={(e) => void submit(e)} noValidate>
        <Input label="Name" value={f.name} onChange={(e) => { set('name')(e); setError('') }} error={error} autoFocus autoComplete="off" />
        <Input label="Email" help="Optional. The ask goes here when you send it from Nest." type="email" value={f.email ?? ''} onChange={set('email')} autoComplete="off" spellCheck={false} />
        <Select label="How you know them" value={f.relation} onChange={set('relation')}>
          {PICK_RELATIONS.map((r) => (
            <option key={r} value={r}>
              {RELATION_LABEL[r]}
            </option>
          ))}
        </Select>
        <Textarea label="Notes" help="e.g. Founder of a company in their portfolio." rows={3} value={f.notes} onChange={set('notes')} />
        <div className="intro-dialog__foot">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" loading={busy}>
            {edit ? 'Save' : 'Add introducer'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/** Ask a person for an intro to one more investor: the intro is made, then the forwardable draft opens. */
export function AskDialog({ person, onClose }: { person: Person; onClose: () => void }) {
  const x = useIntroducers()
  const d = useRaise()
  const { toast, fail } = useUI()
  const titleId = useTitleId()
  const who = firstName(person.name)
  const taken = new Set(x.intros.filter((i) => (person.introducerId ? i.introducerId === person.introducerId : i.viaInvestorId === person.investorId)).map((i) => i.investorId))
  const options = d.investors
    .filter((i) => i._id !== person.investorId && !taken.has(i._id) && i.stage !== 'passed' && !COMMIT.has(i.stage))
    .sort((a, b) => (IDX[a.stage] ?? 99) - (IDX[b.stage] ?? 99) || a.name.localeCompare(b.name))
  const [pick, setPick] = useState(options[0]?._id ?? '')
  const [busy, setBusy] = useState<'draft' | 'add' | null>(null)

  async function go(draft: boolean) {
    if (!pick) return
    setBusy(draft ? 'draft' : 'add')
    try {
      const introId = await x.link(pick, person)
      onClose()
      if (draft) openDraft({ investorId: pick, type: 'forwardable', introId })
      else toast({ tone: 'success', icon: 'check', message: who + ' is the warm path to ' + (d.investors.find((i) => i._id === pick)?.name ?? 'them') + '.' })
    } catch (e) {
      setBusy(null)
      fail(e)
    }
  }

  return (
    <Modal onClose={onClose} labelledBy={titleId} className="intro-dialog">
      <IconButton icon="close" label="Close" className="intro-dialog__close" onClick={onClose} />
      <h2 id={titleId} className="intro-dialog__title">Ask {who} for an intro</h2>
      <p className="intro-dialog__sub">Nest writes the ask and a note {who} can forward. Never cc an investor cold.</p>
      {options.length ? (
        <div className="intro-dialog__form">
          <Select label="To" value={pick} onChange={(e) => setPick(e.target.value)} autoFocus>
            {options.map((i) => (
              <option key={i._id} value={i._id}>
                {i.name}
              </option>
            ))}
          </Select>
          <div className="intro-dialog__foot">
            <Button variant="secondary" onClick={() => void go(false)} loading={busy === 'add'} disabled={!!busy}>
              Just add the warm path
            </Button>
            <Button variant="primary" icon="spark" onClick={() => void go(true)} loading={busy === 'draft'} loadingLabel="Opening…" disabled={!!busy}>
              Draft the ask
            </Button>
          </div>
        </div>
      ) : (
        <p className="intro-dialog__sub">{who} is already the warm path to everyone still open.</p>
      )}
    </Modal>
  )
}
