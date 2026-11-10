// PST-294: Add (or edit) an introducer, and ask someone for another intro.
// PST-305: Network. Add person (the labels follow the relation, like PST-303's
// form; editing saves only the fields Dev touched), "Who do they know" (investors
// from the list, or a new firm and partner) and the CSV import of people.
import { useMemo, useState, type FormEvent } from 'react'
import { firstName, PICK_RELATIONS, RELATION_LABEL, type Person } from '../../lib/introducers'
import { personFieldCopy, personPatch, PEOPLE_TEMPLATE_CSV, previewPeople, type NewTarget, type PeoplePreview, type PersonForm, type PickRelation } from '../../lib/network'
import { play } from '../../lib/sound'
import { COMMIT, IDX, LABEL } from '../../lib/stages'
import { useRaise } from '../data'
import { usePreviewState } from '../preview-state'
import { useUI } from '../raise-ui'
import { Modal, useTitleId } from '../system/Modal'
import { Button, buttonClass, Checkbox, Chip, IconButton, Input, Select, Textarea } from '../ui'
import { PREVIEW_PEOPLE_CSV } from '../../preview/networkFixture'
import { useIntroducers } from './data'

/** Add someone to the Network, or edit one. Resolves (onSaved) with their id. */
export function IntroducerDialog({ edit, onClose, onSaved }: { edit?: Person; onClose: () => void; onSaved?: (id: string) => void }) {
  const x = useIntroducers()
  const { toast, fail } = useUI()
  const titleId = useTitleId()
  const [f, setF] = useState<PersonForm>(() => ({
    name: edit?.name ?? '', email: edit?.email ?? '', relation: edit && edit.relation !== 'committed' ? edit.relation : 'founder', notes: edit?.notes ?? '', company: edit?.company ?? '', companyDomain: edit?.companyDomain ?? '',
  }))
  const [touched, setTouched] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const copy = personFieldCopy(f.relation)
  const set = (k: keyof PersonForm) => (e: { target: { value: string } }) => {
    setF((p) => ({ ...p, [k]: e.target.value }))
    setTouched((t) => new Set(t).add(k))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!f.name.trim()) return setError('Add their name.')
    setBusy(true)
    try {
      if (edit?.introducerId) {
        const patch = personPatch(f, touched)
        if (Object.keys(patch).length) await x.updatePerson(edit.introducerId, patch)
        toast({ tone: 'success', icon: 'check', message: 'Saved.' })
        onSaved?.(edit.introducerId)
      } else {
        const r = await x.add({ name: f.name, email: f.email, relation: f.relation, notes: f.notes, ...(copy.company ? { company: f.company } : {}), ...(copy.website ? { companyDomain: f.companyDomain } : {}) })
        play('save')
        toast({ tone: 'success', icon: 'check', message: r.existed ? f.name.trim() + ' was already here.' : 'Added ' + f.name.trim() + ' to your Network.' })
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
      <h2 id={titleId} className="intro-dialog__title">{edit ? 'Edit ' + firstName(edit.name) : 'Add a person'}</h2>
      <p className="intro-dialog__sub">A founder, friend or advisor who can introduce you to investors. A founder’s intro beats every other kind.</p>
      <form className="intro-dialog__form" onSubmit={(e) => void submit(e)} noValidate>
        <Select label="Who are they?" value={f.relation} onChange={(e) => set('relation')({ target: { value: e.target.value as PickRelation } })}>
          {PICK_RELATIONS.map((r) => (
            <option key={r} value={r}>
              {RELATION_LABEL[r]}
            </option>
          ))}
        </Select>
        <Input label={copy.name.label} placeholder={copy.name.placeholder} value={f.name} onChange={(e) => { set('name')(e); setError('') }} error={error} autoFocus autoComplete="off" />
        {copy.company ? <Input label={copy.company.label} help={copy.company.help} placeholder={copy.company.placeholder} value={f.company} onChange={set('company')} autoComplete="off" /> : null}
        {copy.website ? <Input label={copy.website.label} help={copy.website.help} placeholder={copy.website.placeholder} value={f.companyDomain} onChange={set('companyDomain')} autoComplete="off" spellCheck={false} /> : null}
        <Input label={copy.email.label} help={copy.email.help} type="email" value={f.email} onChange={set('email')} autoComplete="off" spellCheck={false} />
        {copy.notes ? <Textarea label={copy.notes.label} help={copy.notes.help} placeholder={copy.notes.placeholder} rows={3} value={f.notes} onChange={set('notes')} /> : null}
        <div className="intro-dialog__foot">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" loading={busy}>
            {edit ? 'Save' : 'Add person'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/** "Who do they know": investors from the list, or a firm not in Nest yet. Each gets an intro "to ask" from this person. */
export function AskDialog({ person, onClose }: { person: Person; onClose: () => void }) {
  const x = useIntroducers()
  const d = useRaise()
  const { toast, fail } = useUI()
  const titleId = useTitleId()
  const who = firstName(person.name)
  const taken = new Set(x.intros.filter((i) => (person.introducerId ? i.introducerId === person.introducerId : i.viaInvestorId === person.investorId)).map((i) => i.investorId))
  const open = d.investors
    .filter((i) => i._id !== person.investorId && !taken.has(i._id) && i.stage !== 'passed' && !COMMIT.has(i.stage))
    .sort((a, b) => (IDX[a.stage] ?? 99) - (IDX[b.stage] ?? 99) || a.name.localeCompare(b.name))
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [fresh, setFresh] = useState<NewTarget[]>([])
  const [firm, setFirm] = useState('')
  const [partner, setPartner] = useState('')
  const [busy, setBusy] = useState(false)
  const needle = q.trim().toLowerCase()
  const shown = open.filter((i) => picked.has(i._id) || !needle || (i.name + ' ' + i.firm).toLowerCase().includes(needle)).slice(0, 8)
  const n = picked.size + fresh.length

  function addFirm() {
    if (!firm.trim()) return
    setFresh((xs) => [...xs, { firm: firm.trim(), ...(partner.trim() ? { partner: partner.trim() } : {}) }])
    setFirm('')
    setPartner('')
  }

  async function go() {
    if (!n) return
    setBusy(true)
    try {
      const r = await x.addTargets(person, { investorIds: [...picked], fresh })
      play('save')
      toast({ tone: 'success', icon: 'check', message: 'Added ' + n + ' to ' + who + '’s list' + (r.created ? ' (' + r.created + ' new to Nest, Not contacted)' : '') + '. Each is “to ask”.' })
      onClose()
    } catch (e) {
      setBusy(false)
      fail(e)
    }
  }

  return (
    <Modal onClose={onClose} labelledBy={titleId} className="intro-dialog">
      <IconButton icon="close" label="Close" className="intro-dialog__close" onClick={onClose} />
      <h2 id={titleId} className="intro-dialog__title">Who does {who} know?</h2>
      <p className="intro-dialog__sub">Pick investors {who} could introduce you to. Each goes on {who}’s list as “to ask”; you ask for 2–3 at once.</p>
      <div className="intro-dialog__form">
        <Input label="Search your investors" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Orchard" autoFocus autoComplete="off" />
        {shown.length ? (
          <ul className="net-pick" aria-label="Investors in Nest">
            {shown.map((i) => (
              <li key={i._id}>
                <Checkbox
                  label={<><strong>{i.name}</strong> <span className="net-pick__meta">{[i.type, LABEL[i.stage]].filter(Boolean).join(' · ')}</span></>}
                  checked={picked.has(i._id)}
                  onChange={(e) => {
                    const on = e.currentTarget.checked
                    setPicked((s) => {
                      const next = new Set(s)
                      if (on) next.add(i._id)
                      else next.delete(i._id)
                      return next
                    })
                  }}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="intro-dialog__sub">{open.length ? 'No investor in Nest matches “' + q.trim() + '”. Add the firm below.' : who + ' is already the warm path to everyone still open.'}</p>
        )}
        <fieldset className="net-new">
          <legend className="eyebrow-mono">Not in Nest yet</legend>
          <div className="net-new__row">
            <Input label="Firm" value={firm} onChange={(e) => setFirm(e.target.value)} placeholder="e.g. Brightpath Ventures" autoComplete="off" onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addFirm())} />
            <Input label="Partner" help="Optional." value={partner} onChange={(e) => setPartner(e.target.value)} autoComplete="off" onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addFirm())} />
            <Button variant="secondary" icon="plus" onClick={addFirm} disabled={!firm.trim()}>
              Add
            </Button>
          </div>
          {fresh.length ? (
            <ul className="net-new__list">
              {fresh.map((t, k) => (
                <li key={k}>
                  <Chip tone="outline" dot={false}>
                    {t.firm + (t.partner ? ' · ' + t.partner : '')}
                  </Chip>
                  <IconButton icon="close" label={'Remove ' + t.firm} onClick={() => setFresh((xs) => xs.filter((_, j) => j !== k))} />
                </li>
              ))}
            </ul>
          ) : null}
          <p className="draft__fine">New firms are added to Investors as Not contacted, source Network, warm path “via {person.name}”.</p>
        </fieldset>
        <div className="intro-dialog__foot">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void go()} loading={busy} disabled={!n}>
            {n ? 'Add ' + n + ' to ' + who + '’s list' : 'Add to ' + who + '’s list'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([PEOPLE_TEMPLATE_CSV], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'network-template.csv'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Import people from a CSV (name, email, relation, company, notes): a preview first, deduped by email or name. */
export function ImportPeopleDialog({ onClose, onDone }: { onClose: () => void; onDone?: (ids: string[]) => void }) {
  const x = useIntroducers()
  const { toast, fail } = useUI()
  const titleId = useTitleId()
  const sample = usePreviewState()?.network === 'import'
  const [text, setText] = useState(sample ? PREVIEW_PEOPLE_CSV : '')
  const [file, setFile] = useState(sample ? 'network.csv' : '')
  const [busy, setBusy] = useState(false)
  const preview: PeoplePreview | null = useMemo(() => (text.trim() ? previewPeople(text, x.introducers) : null), [text, x.introducers])

  async function pick(f: File | undefined) {
    if (!f) return
    setFile(f.name)
    setText(await f.text())
  }

  async function go() {
    if (!preview?.add.length) return
    setBusy(true)
    try {
      const r = await x.importPeople(preview.add.map((a) => a.fields))
      play('save')
      toast({ tone: 'success', icon: 'check', message: 'Added ' + r.added + (r.added === 1 ? ' person' : ' people') + ' to your Network' + (r.skipped ? '; ' + r.skipped + ' were already here.' : '.') })
      onDone?.(r.ids)
      onClose()
    } catch (e) {
      setBusy(false)
      fail(e)
    }
  }

  return (
    <Modal onClose={onClose} labelledBy={titleId} className="intro-dialog intro-dialog--wide">
      <IconButton icon="close" label="Close" className="intro-dialog__close" onClick={onClose} />
      <h2 id={titleId} className="intro-dialog__title">Import people</h2>
      <p className="intro-dialog__sub">
        A CSV with a header row: name, email, relation, company, notes. Only name is needed. Anyone already in your Network (same email or name) is skipped.{' '}
        <button type="button" className="net-link" onClick={downloadTemplate}>
          Download the template
        </button>
      </p>
      <div className="intro-dialog__form">
        <label className="net-file">
          <input type="file" accept=".csv,text/csv" onChange={(e) => void pick(e.currentTarget.files?.[0])} />
          <span className={buttonClass({ variant: 'secondary' })}>{file ? 'Pick another file' : 'Pick a CSV'}</span>
          <span className="net-file__name">{file || 'or paste it below'}</span>
        </label>
        <Textarea label="CSV" rows={4} value={text} onChange={(e) => { setText(e.target.value); setFile('') }} placeholder={'name,email,relation,company,notes'} spellCheck={false} />
        {preview?.error ? <p className="net-import__error" role="alert">{preview.error}</p> : null}
        {preview && !preview.error ? (
          <div className="net-import" aria-live="polite">
            <p className="net-import__sum">
              <strong>{preview.add.length} to add</strong>
              {preview.skipped.length ? ' · ' + preview.skipped.length + ' skipped' : ''}
              {preview.unknownHeaders.length ? ' · ignoring ' + preview.unknownHeaders.join(', ') : ''}
            </p>
            <ul className="net-import__rows">
              {preview.add.map((a) => (
                <li key={a.line}>
                  <strong>{a.fields.name}</strong>
                  <span>{[RELATION_LABEL[a.fields.relation], a.fields.company, a.fields.email].filter(Boolean).join(' · ')}</span>
                </li>
              ))}
              {preview.skipped.map((s) => (
                <li key={'s' + s.line} className="is-skipped">
                  <strong>{s.name}</strong>
                  <span>Line {s.line}: {s.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="intro-dialog__foot">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void go()} loading={busy} disabled={!preview?.add.length}>
            {preview?.add.length ? 'Import ' + preview.add.length : 'Import'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
