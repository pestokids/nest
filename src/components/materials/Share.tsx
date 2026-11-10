// PST-282: Share (raise-materials/share.png, the phone share sheet): one link per
// investor with its own options, then copy, WhatsApp on phones, or Send by
// email when the server has a Resend key.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ACTIVE, IDX } from '../../lib/stages'
import { DEFAULT_EXPIRY_DAYS, DEFAULT_OPTIONS, EXPIRY_CHOICES, linkState, normOptions, shareLabel, shareUrl, type LinkOptions } from '../../lib/materials'
import { pop } from '../../lib/motion'
import { play } from '../../lib/sound'
import { useRaise } from '../data'
import { Modal, useTitleId } from '../system/Modal'
import { useSaveAction } from '../system/useSaveAction'
import { Button, Icon, IconButton, Select, Textarea, Toggle, useToast } from '../ui'
import { useMaterials, type NewLink } from './data'
import { copyText, useIndex, versionName } from './parts'

const OPTION_ROWS: { key: keyof LinkOptions; label: string; short: string }[] = [
  { key: 'askEmail', label: 'Ask for their email before it opens', short: 'Ask for their email first' },
  { key: 'allowDownload', label: 'Allow download', short: 'Allow download' },
  { key: 'watermark', label: 'Watermark pages with the viewer’s email', short: 'Watermark with their email' },
  { key: 'notify', label: 'Notify me on the first open', short: 'Notify me on the first open' },
  { key: 'reply', label: 'Show “Questions? Reply to Dev”', short: 'Show “Reply to Dev”' },
]

const names = (xs: string[]) => (xs.length <= 2 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
const usePhone = () => typeof matchMedia === 'function' && matchMedia('(max-width: 720px)').matches

export type ShareStart = { materialId?: string; investorIds?: string[]; sent?: boolean }

export function ShareDialog({ start, onClose }: { start: ShareStart; onClose: () => void }) {
  const titleId = useTitleId()
  return (
    <Modal onClose={onClose} labelledBy={titleId} className="share" initialFocus="panel">
      <IconButton icon="close" label="Close" className="share__close" onClick={onClose} />
      <ShareForm titleId={titleId} start={start} onDone={onClose} />
    </Modal>
  )
}

/**
 * The Share form. In a dialog from the library, or inline in the investor
 * drawer (`pickMaterial`: choose what to send first).
 */
export function ShareForm({ titleId, start, onDone, pickMaterial }: { titleId: string; start: ShareStart; onDone: () => void; pickMaterial?: boolean }) {
  const m = useMaterials()
  const d = useRaise()
  const ix = useIndex()
  const save = useSaveAction()
  const uid = useId()
  const [materialId, setMaterialId] = useState(start.materialId ?? (m.materials.find((x) => x.kind === 'deck') ?? m.materials[0])?._id ?? '')
  const material = ix.mat.get(materialId)
  const cur = ix.current(materialId)
  const [who, setWho] = useState<string[]>(start.investorIds ?? [])
  const [opts, setOpts] = useState<LinkOptions>(DEFAULT_OPTIONS)
  const [days, setDays] = useState<number>(DEFAULT_EXPIRY_DAYS)
  const [pin, setPin] = useState<'version' | 'current'>('version')
  const [made, setMade] = useState<NewLink[] | null>(null)
  const [busy, setBusy] = useState(false)
  const byId = useMemo(() => new Map(d.investors.map((i) => [i._id, i])), [d.investors])
  const what = pin === 'current' ? material?.title ?? '' : versionName(material, cur)

  // Booked or later, still talking, and no live link that shows this version.
  const suggested = useMemo(() => {
    if (!cur) return []
    const now = Date.now()
    const have = new Set(m.links.filter((l) => l.materialId === materialId && linkState(l, now) === 'live' && ix.shown(l)?._id === cur._id).map((l) => l.investorId))
    return d.investors
      .filter((i) => ACTIVE.has(i.stage) && (IDX[i.stage] ?? 0) >= IDX.booked! && !have.has(i._id) && !who.includes(i._id))
      .sort((a, b) => (IDX[b.stage] ?? 0) - (IDX[a.stage] ?? 0) || a.name.localeCompare(b.name))
      .slice(0, 3)
  }, [d.investors, m.links, materialId, cur, ix, who])

  async function create() {
    if (!material || !cur || !who.length) return
    setBusy(true)
    await save(() => m.act.share({ materialId, versionId: pin === 'current' ? 'current' : cur._id, investorIds: who, options: normOptions(opts), expiresInDays: days }), {
      failMessage: 'Couldn’t make the links.',
      onDone: (links) => {
        play('save')
        setMade(links)
      },
    })
    setBusy(false)
  }
  // Preview (&materials=sent): arrive on the made links.
  const started = useRef(false)
  useEffect(() => {
    if (!start.sent || started.current || !cur) return
    started.current = true
    void create()
  }, [start.sent, cur]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!material || !cur)
    return (
      <div className="share__body">
        <p className="share__eyebrow eyebrow-mono">Share</p>
        <h2 className="share__title" id={titleId}>
          Nothing to share yet
        </h2>
        <p className="share__lede">Upload the deck first, then share it here.</p>
      </div>
    )

  if (made) return <Made titleId={titleId} links={made} what={what} onDone={onDone} />

  return (
    <div className="share__body">
      <p className="share__eyebrow eyebrow-mono">Share · nest.pestokids.com/d</p>
      <h2 className="share__title" id={titleId}>
        Share {versionName(material, cur)}
      </h2>
      <p className="share__lede">Each investor gets their own link, so you see exactly who read what.</p>
      {pickMaterial ? (
        <Select label="What to send" value={materialId} onChange={(e) => setMaterialId(e.target.value)}>
          {m.materials.map((x) => (
            <option key={x._id} value={x._id}>
              {versionName(x, ix.current(x._id))}
            </option>
          ))}
        </Select>
      ) : null}
      <InvestorPicker who={who} setWho={setWho} labelId={`${uid}-to`} />
      {suggested.length ? (
        <div className="share__suggest">
          <p>
            Booked or later and haven’t seen v{cur.n}: {names(suggested.map((i) => i.name))}
          </p>
          <button type="button" onClick={() => setWho((w) => [...w, ...suggested.map((i) => i._id)])}>
            <Icon name="plus" size={16} />
            {suggested.length === 1 ? 'Add' : suggested.length === 2 ? 'Add both' : `Add all ${suggested.length}`}
          </button>
        </div>
      ) : null}
      <fieldset className="share__opts">
        <legend className="share__label">Link settings</legend>
        {OPTION_ROWS.map((o) => {
          const locked = o.key === 'askEmail' && opts.watermark
          return (
            <Toggle
              key={o.key}
              className="share__opt"
              label={
                <>
                  <span className="only-desk">{o.label}</span>
                  <span className="only-phone">{o.short}</span>
                  {locked ? <span className="share__why"> The watermark needs it.</span> : null}
                </>
              }
              checked={locked || opts[o.key]}
              disabled={locked}
              onChange={(e) => setOpts((x) => ({ ...x, [o.key]: e.target.checked }))}
            />
          )
        })}
        <div className="share__row">
          <span>Link expires</span>
          <Select aria-label="Link expires" value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
            {EXPIRY_CHOICES.map((c) => (
              <option key={c.days} value={c.days}>
                {c.label}
              </option>
            ))}
          </Select>
        </div>
        {ix.versionsOf(materialId).length > 1 || pin === 'current' ? (
          <div className="share__row">
            <span>Shows</span>
            <Select aria-label="Which version the link shows" value={pin} onChange={(e) => setPin(e.target.value as 'version' | 'current')}>
              <option value="version">v{cur.n}, even after a new version</option>
              <option value="current">Always the current version</option>
            </Select>
          </div>
        ) : null}
      </fieldset>
      {who.length ? (
        <div className="share__links">
          <p className="share__count eyebrow-mono">
            {who.length} link{who.length === 1 ? '' : 's'}
          </p>
          <ul>
            {who.map((id) => (
              <li key={id} className="share__link share__link--draft">
                <span className="share__name">{byId.get(id)?.name ?? 'Deleted investor'}</span>
                <span className="share__url">nest.pestokids.com/d/…</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="share__foot">
        <p className="share__note">Nest adds each link to the investor’s history and counts their first open as a touch.</p>
        <div className="share__actions">
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void create()} disabled={!who.length} loading={busy} loadingLabel="Making links…">
            {who.length > 1 ? `Create ${who.length} links` : 'Create link'}
          </Button>
        </div>
      </div>
    </div>
  )
}

/** Chips for the chosen investors and a type-to-find box (arrow keys, Enter, Backspace). */
function InvestorPicker({ who, setWho, labelId }: { who: string[]; setWho: (fn: (w: string[]) => string[]) => void; labelId: string }) {
  const d = useRaise()
  const [q, setQ] = useState('')
  const [at, setAt] = useState(0)
  const [open, setOpen] = useState(false)
  const byId = new Map(d.investors.map((i) => [i._id, i]))
  const matches = q.trim()
    ? d.investors.filter((i) => !who.includes(i._id) && `${i.name} ${i.firm}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 6)
    : []
  const add = (id: string) => {
    setWho((w) => (w.includes(id) ? w : [...w, id]))
    setQ('')
    setAt(0)
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setAt((k) => (matches.length ? (k + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length : 0))
    } else if (e.key === 'Enter' && matches[at]) {
      e.preventDefault()
      add(matches[at]._id)
    } else if (e.key === 'Backspace' && !q && who.length) setWho((w) => w.slice(0, -1))
  }
  return (
    <div className="share__to">
      <label className="share__label" id={labelId} htmlFor={`${labelId}-input`}>
        Send to
      </label>
      <div className="share__chips">
        {who.map((id) => (
          <span key={id} className="share__chip m-pop">
            {byId.get(id)?.name ?? 'Deleted investor'}
            <button type="button" aria-label={`Remove ${byId.get(id)?.name ?? 'investor'}`} onClick={() => setWho((w) => w.filter((x) => x !== id))}>
              <Icon name="close" size={14} strokeWidth={2.4} />
            </button>
          </span>
        ))}
        <input
          id={`${labelId}-input`}
          value={q}
          placeholder={who.length ? 'Add an investor…' : 'Type an investor’s name…'}
          autoComplete="off"
          role="combobox"
          aria-expanded={open && matches.length > 0}
          aria-controls={`${labelId}-list`}
          aria-activedescendant={open && matches[at] ? `${labelId}-opt-${at}` : undefined}
          onChange={(e) => {
            setQ(e.target.value)
            setAt(0)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKey}
        />
      </div>
      {open && matches.length ? (
        <ul className="share__list" role="listbox" id={`${labelId}-list`}>
          {matches.map((i, k) => (
            <li key={i._id} id={`${labelId}-opt-${k}`} role="option" aria-selected={k === at} className={k === at ? 'is-on' : undefined} onMouseDown={(e) => (e.preventDefault(), add(i._id))}>
              <span>{i.name}</span>
              {i.firm && i.firm !== i.name ? <span className="share__firm">{i.firm}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/** The links are made: copy each, WhatsApp on phones, Send by email when it's set up. */
function Made({ titleId, links, what, onDone }: { titleId: string; links: NewLink[]; what: string; onDone: () => void }) {
  const m = useMaterials()
  const d = useRaise()
  const toast = useToast()
  const save = useSaveAction()
  const phone = usePhone()
  const byId = new Map(d.investors.map((i) => [i._id, i]))
  const origin = typeof location !== 'undefined' ? location.origin : undefined
  const [message, setMessage] = useState(`Hi,\n\nHere’s the ${what} from Pesto. It reads well on a phone.\n\nDev`)
  const [sent, setSent] = useState<ReadonlySet<string>>(() => new Set())
  const [sending, setSending] = useState(false)
  const withEmail = links.filter((l) => byId.get(l.investorId)?.email)
  const noEmail = links.filter((l) => !byId.get(l.investorId)?.email)

  async function copy(l: NewLink, el: HTMLElement) {
    if (await copyText(shareUrl(l.token, origin))) {
      pop(el)
      toast({ tone: 'info', icon: 'link', message: `Copied ${byId.get(l.investorId)?.name ?? 'the'} link.` })
    }
  }
  async function email() {
    setSending(true)
    await save(() => m.act.email(withEmail.map((l) => l.linkId), message), {
      failMessage: 'Couldn’t send the emails.',
      onDone: (r) => {
        if (r.sent) {
          play('log')
          setSent(new Set(withEmail.map((l) => l.linkId)))
        }
        toast(
          r.sent
            ? { message: `Sent ${r.sent} email${r.sent === 1 ? '' : 's'}.${r.failed ? ` ${r.failed} didn’t go; copy those links instead.` : ''}` }
            : { tone: 'info', icon: 'mail', message: 'Email isn’t set up, so nothing was sent. Copy the links instead.' },
        )
      },
    })
    setSending(false)
  }

  return (
    <div className="share__body">
      <p className="share__eyebrow eyebrow-mono">Share · links ready</p>
      <h2 className="share__title" id={titleId}>
        {links.length === 1 ? 'Your link is ready' : `${links.length} links are ready`}
      </h2>
      <p className="share__lede">Each opens {what} for one investor. Their first open shows up in Nest.</p>
      <div className="share__links">
        <ul>
          {links.map((l) => {
            const name = byId.get(l.investorId)?.name ?? 'Deleted investor'
            const url = shareUrl(l.token, origin)
            return (
              <li key={l.linkId} className="share__link m-rise">
                <span className="share__name">{name}</span>
                <span className="share__url">{shareLabel(l.token)}</span>
                {sent.has(l.linkId) ? <span className="share__sent">Emailed</span> : null}
                {phone ? (
                  <a className="share__icon" href={`https://wa.me/?text=${encodeURIComponent(`${message}\n\n${url}`)}`} target="_blank" rel="noreferrer" aria-label={`Send ${name}’s link on WhatsApp`}>
                    <Icon name="arrow-right" size={18} />
                  </a>
                ) : null}
                <button type="button" className="share__icon" aria-label={`Copy ${name}’s link`} onClick={(e) => void copy(l, e.currentTarget)}>
                  <Icon name="link" size={18} />
                </button>
              </li>
            )
          })}
        </ul>
      </div>
      {m.emailReady && withEmail.length ? (
        <div className="share__email">
          <Textarea label="Message" value={message} rows={5} onChange={(e) => setMessage(e.target.value)} help={`Each email ends with that investor’s own link. From Dev at Pesto; replies go to Dev.`} />
          {noEmail.length ? <p className="share__note">No email for {names(noEmail.map((l) => byId.get(l.investorId)?.name ?? 'one investor'))}: copy their link instead.</p> : null}
        </div>
      ) : null}
      <div className="share__foot">
        <p className="share__note">{phone ? 'Copy a link, or send it on WhatsApp.' : 'Copy a link into your own email or chat.'}</p>
        <div className="share__actions">
          {m.emailReady && withEmail.length ? (
            <Button variant="secondary" icon="mail" onClick={() => void email()} loading={sending} loadingLabel="Sending…" disabled={sent.size > 0}>
              {sent.size ? 'Sent' : 'Send by email'}
            </Button>
          ) : null}
          <Button variant="primary" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    </div>
  )
}
