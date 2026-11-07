// PST-282: small pieces shared by the Materials tab, the material panel, Share,
// the drawer's Materials tab and Today's row.
import { useMemo, useRef, useState, type ReactNode } from 'react'
import {
  badgeOf, linkVersionId, MAX_UPLOAD_BYTES, PDF_TYPE, readStatus, READ_LABEL, topPage,
  type Material, type MaterialVersion, type ReadStatus, type ShareLink, type ViewStat,
} from '../../lib/materials'
import { shake } from '../../lib/motion'
import { countPages } from '../../lib/pdf'
import { play } from '../../lib/sound'
import { Chip, Icon, type ChipTone } from '../ui'
import { useMaterials } from './data'

/** Lookups over the Materials data, rebuilt when it changes. */
export function useIndex() {
  const m = useMaterials()
  return useMemo(() => {
    const mat = new Map(m.materials.map((x) => [x._id, x]))
    const ver = new Map(m.versions.map((x) => [x._id, x]))
    const statsOf = new Map<string, ViewStat[]>()
    for (const s of m.stats) statsOf.set(s.linkId, [...(statsOf.get(s.linkId) ?? []), s])
    const versionsOf = (materialId: string) => m.versions.filter((x) => x.materialId === materialId).sort((a, b) => b.n - a.n)
    const current = (materialId: string) => ver.get(mat.get(materialId)?.currentVersionId ?? '')
    /** The version a link shows now. */
    const shown = (l: ShareLink) => ver.get(linkVersionId(l, mat.get(l.materialId)) ?? '')
    /** A link's views on the version it shows (or its latest), with opens counted across versions. */
    const stat = (l: ShareLink): ViewStat | undefined => {
      const all = statsOf.get(l._id)
      if (!all?.length) return undefined
      const v = shown(l)
      const main = all.find((s) => s.versionId === v?._id) ?? [...all].sort((a, b) => b.lastAt - a.lastAt)[0]
      return { ...main, opens: all.reduce((n, s) => n + s.opens, 0), lastAt: Math.max(...all.map((s) => s.lastAt)) }
    }
    /** Pinned to a version older than the current one. */
    const isOld = (l: ShareLink) => {
      const v = shown(l)
      const c = current(l.materialId)
      return !!v && !!c && v.n < c.n
    }
    const status = (l: ShareLink): ReadStatus => readStatus(stat(l), shown(l)?.pages, isOld(l))
    return { mat, ver, versionsOf, current, shown, stat, isOld, status }
  }, [m.materials, m.versions, m.stats])
}

/** "Pitch deck v4". */
export const versionName = (m: Pick<Material, 'title'> | undefined, v: Pick<MaterialVersion, 'n'> | undefined) => (m ? (v ? `${m.title} v${v.n}` : m.title) : 'A deleted document')

/** The square file badge: PDF, DOC, PPT, XLS, LINK or DIR, tinted by kind. */
export function FileBadge({ material, version, size = 'md' }: { material?: Pick<Material, 'kind'>; version?: Pick<MaterialVersion, 'fileId' | 'url'>; size?: 'sm' | 'md' }) {
  const label = material?.kind === 'data-room' && !version ? 'DIR' : badgeOf(version)
  const tone = material?.kind === 'deck' ? 'forest' : label === 'DIR' ? 'forest' : label === 'XLS' ? 'blue' : label === 'PDF' ? 'peach' : 'mint'
  return (
    <span className={`fbadge fbadge--${tone} fbadge--${size}`} aria-hidden="true">
      {label}
    </span>
  )
}

/** "● v4". */
export const VersionChip = ({ n, className }: { n: number; className?: string }) => (
  <Chip tone="success" className={['vchip', className].filter(Boolean).join(' ')}>
    v{n}
  </Chip>
)

const READ_TONE: Record<ReadStatus, ChipTone> = { unopened: 'outline', read: 'success', back: 'live', dropped: 'error', opened: 'success', old: 'error' }
export const ReadChip = ({ status }: { status: ReadStatus }) => (
  <Chip tone={READ_TONE[status]} dot={status !== 'unopened' && status !== 'old'} className={`rchip rchip--${status}`}>
    {READ_LABEL[status]}
  </Chip>
)

/** One small bar per page: taller for more time, the most-read page dark, unread pages as dashes. */
export function PageStrip({ pageMs, pages, label }: { pageMs: number[]; pages?: number; label: string }) {
  const n = Math.max(pages ?? 0, pageMs.length)
  if (!n) return null
  const max = Math.max(1, ...pageMs)
  const top = topPage(pageMs)
  return (
    <span className="pstrip" role="img" aria-label={label}>
      {Array.from({ length: n }, (_, k) => {
        const ms = pageMs[k] ?? 0
        return ms ? (
          <i key={k} className={k + 1 === top ? 'pstrip__bar pstrip__bar--top' : 'pstrip__bar'} style={{ height: `${Math.round(10 + 12 * (ms / max))}px` }} />
        ) : (
          <i key={k} className="pstrip__bar pstrip__bar--none" />
        )
      })}
    </span>
  )
}

export type PickedPdf = { file: File; pages: number }

/** A PDF under 50 MB that pdf.js can read, with its page count; or why not. */
export async function checkPdf(f: File): Promise<PickedPdf | string> {
  if (f.type !== PDF_TYPE && !/\.pdf$/i.test(f.name)) return 'Only PDFs upload here. Export it as PDF, or add Google Slides or Docs as a link.'
  if (f.size > MAX_UPLOAD_BYTES) return 'That file is over 50 MB. Export a lighter PDF and try again.'
  const pages = await countPages(f)
  return pages ? { file: f, pages } : 'That PDF can’t be read. Export it again and retry.'
}

/**
 * A PDF drop zone (click to browse, or drop): checks it's a PDF under 50 MB and
 * counts its pages with pdf.js. Breathes while a file is held over it.
 */
export function PdfDrop({ title, sub, picked, onPick, className, compact }: { title: ReactNode; sub?: ReactNode; picked: PickedPdf | null; onPick: (p: PickedPdf | null) => void; className?: string; compact?: boolean }) {
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const zone = useRef<HTMLDivElement>(null)
  const fail = (msg: string) => {
    setError(msg)
    onPick(null)
    play('nope')
    shake(zone.current)
  }
  async function take(f: File | undefined) {
    if (!f) return
    setBusy(true)
    const r = await checkPdf(f)
    setBusy(false)
    if (typeof r === 'string') return fail(r)
    setError('')
    onPick(r)
  }
  return (
    <>
      <div
        ref={zone}
        className={['pdrop', compact && 'pdrop--compact', over && 'is-over', picked && 'is-picked', error && 'is-bad', className].filter(Boolean).join(' ')}
        role="button"
        tabIndex={0}
        aria-label={picked ? `${picked.file.name}, ${picked.pages} pages. Choose another` : 'Choose a PDF'}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), input.current?.click())}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          void take(e.dataTransfer.files?.[0])
        }}
      >
        <Icon name={picked ? 'check' : 'upload'} size={20} className="pdrop__icon" />
        <span className="pdrop__text">
          <span className="pdrop__title">{busy ? 'Reading the PDF…' : picked ? picked.file.name : title}</span>
          {picked ? <span className="pdrop__sub">{picked.pages} page{picked.pages === 1 ? '' : 's'} · {(picked.file.size / 1048576).toFixed(1)} MB</span> : sub ? <span className="pdrop__sub">{sub}</span> : null}
        </span>
        <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => void take(e.target.files?.[0])} />
      </div>
      {error ? (
        <p className="mat-error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  )
}

/** Copy text, with a fallback for browsers without the async clipboard. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const t = document.createElement('textarea')
    t.value = text
    t.setAttribute('readonly', '')
    t.style.position = 'fixed'
    t.style.opacity = '0'
    document.body.appendChild(t)
    t.select()
    const ok = document.execCommand('copy')
    t.remove()
    return ok
  }
}
