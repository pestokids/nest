// PST-282: adding to the library: a new material (its v1), or a new version of
// one. A PDF (up to 50 MB, pages counted with pdf.js) or a link (Google Slides or Docs).
import { useState, type FormEvent } from 'react'
import { cleanUrl, KIND_LABEL, MATERIAL_KINDS, type MaterialKind } from '../../lib/materials'
import { play } from '../../lib/sound'
import { Modal, useTitleId } from '../system/Modal'
import { useSaveAction } from '../system/useSaveAction'
import { Button, IconButton, Input, Segmented, Select, useToast } from '../ui'
import { useMaterials, type Source } from './data'
import { PdfDrop, type PickedPdf } from './parts'

type Kind = 'pdf' | 'link'
const LINK_HELP = 'Google Slides or Docs: share it with anyone who has the link, then paste it here.'

/** Upload the PDF (if any) and describe the version. */
function useSource() {
  const m = useMaterials()
  return async (kind: Kind, picked: PickedPdf | null, url: string, note: string): Promise<Source> =>
    kind === 'pdf' && picked ? { fileId: await m.act.upload(picked.file), pages: picked.pages, note } : { url: cleanUrl(url) ?? url, note }
}

export function AddDialog({ file, onClose, onAdded }: { file?: PickedPdf; onClose: () => void; onAdded?: (materialId: string) => void }) {
  const m = useMaterials()
  const titleId = useTitleId()
  const save = useSaveAction()
  const toast = useToast()
  const source = useSource()
  const [kind, setKind] = useState<Kind>('pdf')
  const [picked, setPicked] = useState<PickedPdf | null>(file ?? null)
  const [url, setUrl] = useState('')
  const firstKind: MaterialKind = m.materials.some((x) => x.kind === 'deck') ? 'memo' : 'deck'
  const [what, setWhat] = useState<MaterialKind>(firstKind)
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [tried, setTried] = useState(false)
  const name = title.trim() || (what === 'data-room' || what === 'other' ? picked?.file.name.replace(/\.pdf$/i, '') ?? '' : KIND_LABEL[what])
  const urlBad = kind === 'link' && !cleanUrl(url)
  const missing = kind === 'pdf' ? !picked : urlBad

  async function submit(e: FormEvent) {
    e.preventDefault()
    setTried(true)
    if (missing || !name) return play('nope')
    setBusy(true)
    await save(async () => m.act.create(what, name, await source(kind, picked, url, note)), {
      failMessage: `Couldn’t add ${name}.`,
      onDone: (id) => {
        play('import-done')
        toast(`${name} is in the library.`)
        onClose()
        onAdded?.(id)
      },
    })
    setBusy(false)
  }

  return (
    <Modal onClose={onClose} labelledBy={titleId} className="addmat">
      <IconButton icon="close" label="Close" className="share__close" onClick={onClose} />
      <form className="share__body" onSubmit={submit} noValidate>
        <p className="share__eyebrow eyebrow-mono">Library</p>
        <h2 className="share__title" id={titleId}>
          Add to the library
        </h2>
        <p className="share__lede">Upload a PDF, or add a Google Slides or Docs link. You can add new versions later.</p>
        <Segmented label="File or link" value={kind} onChange={setKind} options={[{ value: 'pdf', label: 'PDF' }, { value: 'link', label: 'Link' }]} className="addmat__seg" />
        {kind === 'pdf' ? (
          <PdfDrop title="Drop a PDF here, or browse" sub="Up to 50 MB" picked={picked} onPick={setPicked} />
        ) : (
          <Input label="Link" type="url" inputMode="url" placeholder="https://docs.google.com/presentation/d/…" value={url} onChange={(e) => setUrl(e.target.value)} help={LINK_HELP} error={tried && urlBad ? 'That link doesn’t look right. It should start with https://' : undefined} />
        )}
        {tried && kind === 'pdf' && !picked ? <p className="mat-error" role="alert">Choose a PDF first.</p> : null}
        <div className="addmat__grid">
          <Select label="What is it?" value={what} onChange={(e) => setWhat(e.target.value as MaterialKind)}>
            {MATERIAL_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </Select>
          <Input label="Name" value={title} placeholder={name || 'e.g. Cap table'} onChange={(e) => setTitle(e.target.value)} maxLength={120} error={tried && !name ? 'Give it a name.' : undefined} />
        </div>
        <Input label="One line about it (optional)" value={note} placeholder="e.g. For intros. Forwardable." onChange={(e) => setNote(e.target.value)} maxLength={280} />
        <div className="share__foot">
          <span />
          <div className="share__actions">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" loading={busy} loadingLabel={kind === 'pdf' ? 'Uploading…' : 'Adding…'}>
              Add {name || 'it'}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  )
}

/** The panel's "Drop v5 here" box: a PDF or a link, and a one-line changelog. */
export function VersionForm({ materialId, next, file, onDone }: { materialId: string; next: number; file?: PickedPdf | null; onDone?: () => void }) {
  const m = useMaterials()
  const save = useSaveAction()
  const toast = useToast()
  const source = useSource()
  const [kind, setKind] = useState<Kind>('pdf')
  const [picked, setPicked] = useState<PickedPdf | null>(file ?? null)
  const [url, setUrl] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const ready = kind === 'pdf' ? !!picked : !!cleanUrl(url)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!ready) return play('nope')
    setBusy(true)
    await save(async () => m.act.addVersion(materialId, await source(kind, picked, url, note)), {
      failMessage: `Couldn’t add v${next}.`,
      onDone: () => {
        play('card-drop')
        toast(`v${next} is current. Links made for older versions keep showing theirs.`)
        setPicked(null)
        setUrl('')
        setNote('')
        onDone?.()
      },
    })
    setBusy(false)
  }

  const open = picked || kind === 'link'
  return (
    <form className={`vform${open ? ' vform--open' : ''}`} onSubmit={submit} noValidate>
      {kind === 'pdf' ? (
        <PdfDrop compact title={`Drop v${next} here. You can add a one-line changelog.`} picked={picked} onPick={setPicked} />
      ) : (
        <Input label={`v${next} link`} type="url" inputMode="url" placeholder="https://docs.google.com/…" value={url} onChange={(e) => setUrl(e.target.value)} help={LINK_HELP} />
      )}
      {open ? (
        <>
          <Input label="What changed? (one line)" value={note} placeholder="e.g. New retention slide." onChange={(e) => setNote(e.target.value)} maxLength={280} />
          <div className="vform__actions">
            <Button variant="ghost" onClick={() => (setPicked(null), setKind('pdf'))}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={!ready} loading={busy} loadingLabel={kind === 'pdf' ? 'Uploading…' : 'Adding…'}>
              Add v{next}
            </Button>
          </div>
        </>
      ) : (
        <button type="button" className="vform__alt" onClick={() => setKind('link')}>
          Or add a Google Slides or Docs link as v{next}
        </button>
      )}
    </form>
  )
}
