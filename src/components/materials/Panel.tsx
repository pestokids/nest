// PST-282: one material in a side panel (a bottom sheet on phones):
// Versions (raise-materials/versions.png) and Views (deck-views.png).
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { formatDay } from '../../lib/dates'
import { averagePages, duration, furthestPage, linkSource, pagesSeen, topPage, whenOf, onOldVersion, type MaterialVersion, type ViewStat } from '../../lib/materials'
import { pop, scrollBehavior } from '../../lib/motion'
import { play } from '../../lib/sound'
import { useRaise } from '../data'
import { useUI } from '../raise-ui'
import { useSaveAction } from '../system/useSaveAction'
import { Button, Chip, Icon, Select, SubTabButtons, useToast } from '../ui'
import { useMaterials } from './data'
import { badgeOf } from '../../lib/materials'
import { useIndex, type PickedPdf } from './parts'
import { VersionForm } from './Upload'

export type PanelTab = 'versions' | 'views'
const names = (xs: string[]) => (xs.length <= 2 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function useMedia(q: string) {
  const [on, setOn] = useState(() => typeof matchMedia === 'function' && matchMedia(q).matches)
  useEffect(() => {
    const mq = matchMedia(q)
    const fn = () => setOn(mq.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [q])
  return on
}

/** Open a version to read in a new tab (opened before the URL is fetched, so it isn't blocked). */
export function useOpenVersion() {
  const m = useMaterials()
  const toast = useToast()
  return useCallback(
    async (v: MaterialVersion) => {
      const w = window.open('', '_blank')
      const url = await m.act.fileUrl(v._id).catch(() => null)
      if (!url) {
        w?.close()
        return toast({ tone: 'error', message: 'That file isn’t available any more.' })
      }
      if (w) {
        w.opener = null
        w.location.href = url
      } else window.open(url, '_blank', 'noopener')
    },
    [m.act, toast],
  )
}

export function MaterialPanel({ materialId, tab: startTab, file, onClose, onShare }: { materialId: string; tab: PanelTab; file?: PickedPdf | null; onClose: () => void; onShare: (investorIds?: string[]) => void }) {
  const m = useMaterials()
  const ix = useIndex()
  const save = useSaveAction()
  const sheet = useMedia('(max-width: 720px)')
  const uid = useId()
  const material = ix.mat.get(materialId)
  const cur = ix.current(materialId)
  const links = m.links.filter((l) => l.materialId === materialId)
  const [tab, setTab] = useState<PanelTab>(startTab)
  const [closing, setClosing] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  const close = useCallback(() => {
    if (closing) return
    setClosing(true)
    setTimeout(onClose, 200)
  }, [closing, onClose])
  // Deleted (here or in another tab): close.
  useEffect(() => {
    if (m.loaded && !material) onClose()
  }, [m.loaded, material, onClose])
  useEffect(() => {
    box.current?.focus({ preventScroll: true })
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])
  // Esc closes; Tab stays inside (unless a dialog opened over the panel has focus).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const root = box.current
      if (!root || (e.target as Element | null)?.closest?.('.sys-modal')) return
      if (e.key === 'Escape') {
        e.preventDefault()
        if (confirm) setConfirm(false)
        else close()
        return
      }
      if (e.key !== 'Tab') return
      const els = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null)
      if (!els.length) return
      const a = els[0]
      const z = els[els.length - 1]
      const to = !root.contains(document.activeElement) ? a : e.shiftKey && document.activeElement === a ? z : !e.shiftKey && document.activeElement === z ? a : null
      if (!to) return
      e.preventDefault()
      to.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [close, confirm])

  if (!material) return null
  const kindLabel = badgeOf(cur)
  const opened = links.filter((l) => ix.stat(l)?.opens).length
  const curStats = cur ? m.stats.filter((s) => s.versionId === cur._id && links.some((l) => l._id === s.linkId)) : []
  const avgMs = curStats.length ? curStats.reduce((a, s) => a + s.totalMs, 0) / curStats.length : 0
  const investors = new Set(links.map((l) => l.investorId).filter(Boolean)).size
  const sub =
    tab === 'views' && cur
      ? [`v${cur.n}`, `${opened} of ${links.length} opened`, avgMs ? `average ${duration(avgMs)}` : ''].filter(Boolean).join(' · ')
      : [cur?.pages ? `${cur.pages} page${cur.pages === 1 ? '' : 's'}` : cur?.url ? linkSource(cur.url) : '', cur ? `v${cur.n} is current` : '', `${investors} investor${investors === 1 ? ' has' : 's have'} a link`].filter(Boolean).join(' · ')

  const upload = () => {
    setTab('versions')
    requestAnimationFrame(() => {
      const zone = box.current?.querySelector<HTMLElement>('.vform .pdrop')
      zone?.scrollIntoView({ behavior: scrollBehavior(), block: 'center' })
      zone?.click()
    })
  }
  async function remove() {
    await save(() => m.act.remove(materialId), {
      failMessage: `Couldn’t delete ${material!.title}.`,
      onDone: () => {
        play('park')
        onClose()
      },
    })
  }

  return (
    <>
      <div className={`scrim${closing ? ' scrim--leaving' : ''}`} onClick={close} aria-hidden="true" />
      <div ref={box} className={['drawer', 'matpanel', sheet ? 'drawer--sheet' : 'drawer--side', closing && 'drawer--leaving'].filter(Boolean).join(' ')} role="dialog" aria-modal="true" aria-labelledby={`${uid}-title`} tabIndex={-1}>
        <div className="drawer__top">
          {sheet ? <div className="drawer__handle" aria-hidden="true" /> : null}
          <header className="drawer__head">
            <div className="drawer__eyebrow eyebrow-mono">Material · {material.kind === 'data-room' ? 'Data room · ' : ''}{kindLabel}</div>
            <div className="drawer__tools">
              <button type="button" className="drawer__icon" aria-label="Close" onClick={close}>
                <Icon name="close" size={22} />
              </button>
            </div>
            <h2 id={`${uid}-title`} className="drawer__title">
              {material.title}
            </h2>
            <p className="drawer__sub">{sub}</p>
            <div className="drawer__actions">
              <Button variant="primary" icon="upload" onClick={upload}>
                Upload new version
              </Button>
              {cur ? (
                <Button variant="secondary" onClick={() => onShare()}>
                  Share v{cur.n}
                </Button>
              ) : null}
            </div>
          </header>
        </div>
        <SubTabButtons label="Material" idPrefix={uid} value={tab} onChange={setTab} items={[{ value: 'versions', label: 'Versions' }, { value: 'views', label: 'Views' }]} />
        <div className="drawer__body matpanel__body" id={`${uid}-panel`} role="tabpanel" aria-labelledby={`${uid}-tab-${tab}`}>
          {tab === 'versions' ? <Versions materialId={materialId} file={file} onShare={onShare} /> : <Views materialId={materialId} onClose={onClose} />}
          <div className="matpanel__danger">
            {confirm ? (
              <div className="matpanel__confirm" role="group" aria-label="Delete this material?">
                <p>
                  Delete {material.title}? Every version goes, and {links.length ? `its ${links.length} link${links.length === 1 ? '' : 's'} stop opening` : 'nothing was shared yet'}.
                </p>
                <div>
                  <Button variant="ghost" onClick={() => setConfirm(false)}>
                    Keep it
                  </Button>
                  <Button variant="danger" onClick={() => void remove()}>
                    Delete
                  </Button>
                </div>
              </div>
            ) : (
              <button type="button" className="drawer__textbtn drawer__textbtn--danger" onClick={() => setConfirm(true)}>
                Delete material
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

function Versions({ materialId, file, onShare }: { materialId: string; file?: PickedPdf | null; onShare: (investorIds?: string[]) => void }) {
  const m = useMaterials()
  const d = useRaise()
  const ix = useIndex()
  const save = useSaveAction()
  const toast = useToast()
  const openVersion = useOpenVersion()
  const material = ix.mat.get(materialId)!
  const versions = ix.versionsOf(materialId)
  const cur = ix.current(materialId)
  const byId = new Map(d.investors.map((i) => [i._id, i]))
  const old = onOldVersion(material, m.links, m.versions)
  const fresh = useRef(cur?._id)
  const curCard = useRef<HTMLElement>(null)
  useEffect(() => {
    if (fresh.current !== cur?._id) pop(curCard.current?.querySelector('.vcard__chip'))
    fresh.current = cur?._id
  }, [cur?._id])

  async function makeCurrent(v: MaterialVersion) {
    await save(() => m.act.makeCurrent(v._id), {
      failMessage: `Couldn’t make v${v.n} current.`,
      onDone: () => {
        play('card-drop')
        toast(`v${v.n} is current again.`)
      },
    })
  }

  return (
    <div className="vlist">
      {versions.map((v) => {
        const isCur = v._id === cur?._id
        const links = m.links.filter((l) => l.materialId === materialId && ix.shown(l)?._id === v._id)
        const opened = links.filter((l) => ix.stat(l)?.opens).length
        const stuck = isCur ? [] : old.filter((o) => o.versionId === v._id).map((o) => o.investorId)
        return (
          <article key={v._id} ref={isCur ? curCard : undefined} className={`vcard${isCur ? ' vcard--current' : ''}`} aria-label={`Version ${v.n}${isCur ? ', current' : ''}`}>
            <header className="vcard__head">
              <h3 className="vcard__n">v{v.n}</h3>
              {isCur ? (
                <Chip tone="success" className="vcard__chip">
                  Current
                </Chip>
              ) : (
                <button type="button" className="vcard__make" onClick={() => void makeCurrent(v)}>
                  Make current
                </button>
              )}
            </header>
            <p className="vcard__meta">{[formatDay(v.createdAt), v.by ? `by ${v.by}` : '', v.pages ? `${v.pages} page${v.pages === 1 ? '' : 's'}` : v.url ? linkSource(v.url) : ''].filter(Boolean).join(' · ')}</p>
            {v.note ? <p className="vcard__note">{v.note}</p> : null}
            <footer className="vcard__foot">
              <span className="eyebrow-mono">
                Sent {links.length}
                {links.length ? <> · Opened {opened}</> : null}
              </span>
              <button type="button" className="drawer__icon vcard__open" aria-label={`Read v${v.n}`} title={`Read v${v.n}`} onClick={() => void openVersion(v)}>
                <Icon name={v.url ? 'link' : 'download'} size={20} />
              </button>
            </footer>
            {stuck.length && cur ? (
              <div className="vcard__old">
                <p>
                  {stuck.length === 1 ? '1 investor still has' : `${stuck.length} investors still have`} v{v.n}: {names(stuck.map((id) => byId.get(id)?.name ?? 'a deleted investor'))}.
                </p>
                <Button variant="primary" size="sm" onClick={() => onShare(stuck)}>
                  Send them v{cur.n}
                </Button>
              </div>
            ) : null}
          </article>
        )
      })}
      <VersionForm materialId={materialId} next={(versions[0]?.n ?? 0) + 1} file={file} />
    </div>
  )
}

/** Average time per page across viewers of one version, the pages that stand out, and who opened it. */
function Views({ materialId, onClose }: { materialId: string; onClose: () => void }) {
  const m = useMaterials()
  const d = useRaise()
  const ui = useUI()
  const ix = useIndex()
  const cur = ix.current(materialId)
  const versions = ix.versionsOf(materialId)
  const links = useMemo(() => m.links.filter((l) => l.materialId === materialId), [m.links, materialId])
  const seenVersions = versions.filter((v) => m.stats.some((s) => s.versionId === v._id && links.some((l) => l._id === s.linkId)))
  const [vid, setVid] = useState(cur?._id ?? '')
  const ver = ix.ver.get(vid) ?? cur
  const byId = new Map(d.investors.map((i) => [i._id, i]))
  const stats: (ViewStat & { investorId?: string })[] = m.stats
    .filter((s) => s.versionId === ver?._id)
    .map((s) => ({ ...s, investorId: links.find((l) => l._id === s.linkId)?.investorId }))
    .filter((s) => links.some((l) => l._id === s.linkId))
    .sort((a, b) => b.lastAt - a.lastAt)
  const now = Date.now()
  if (!ver) return null
  const pages = ver.pages ?? 0
  const avg = pages ? averagePages(stats, pages) : []
  const viewers = stats.filter((s) => s.totalMs > 0).length
  const max = Math.max(1, ...avg)
  const top = topPage(avg)
  // A tail: the last 3+ pages all under a third of the most-read page.
  let tail = 0
  for (let k = avg.length - 1; k >= 0 && avg[k] < max / 3; k--) tail++
  const tailFrom = tail >= 3 && pages >= 6 ? pages - tail + 1 : null
  // Where people stopped: the most common last page among those who didn't finish.
  const stops = new Map<number, number>()
  for (const s of stats) {
    const f = furthestPage(s)
    if (f && f < pages) stops.set(f, (stops.get(f) ?? 0) + 1)
  }
  const stop = [...stops.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]
  const open = (investorId?: string) => {
    if (!investorId || !byId.has(investorId)) return
    onClose()
    ui.open(investorId, { tab: 'materials' })
  }

  return (
    <div className="views">
      {seenVersions.length > 1 ? (
        <Select aria-label="Version" value={ver._id} onChange={(e) => setVid(e.target.value)} className="views__pick">
          {versions.map((v) => (
            <option key={v._id} value={v._id}>
              v{v.n}
              {v._id === cur?._id ? ' (current)' : ''}
            </option>
          ))}
        </Select>
      ) : null}
      {pages > 1 ? (
        <section className="views__chart" aria-labelledby="views-chart-title">
          <h3 id="views-chart-title" className="views__h">
            Average time on each page
          </h3>
          <p className="views__sub">
            v{ver.n} · {viewers} viewer{viewers === 1 ? '' : 's'}
          </p>
          {viewers ? (
            <ol className="bars" style={{ ['--pages' as string]: pages }}>
              {avg.map((ms, k) => (
                <li key={k} className={['bars__bar', k + 1 === top && 'bars__bar--top', tailFrom && k + 1 >= tailFrom && 'bars__bar--tail'].filter(Boolean).join(' ')} aria-label={`Page ${k + 1}: ${Math.round(ms / 1000)} seconds on average`}>
                  {k + 1 === top ? <span className="bars__val">{Math.round(ms / 1000)}s</span> : null}
                  <i style={{ height: `${Math.max(4, Math.round((ms / max) * 100))}%` }} />
                  <span className="bars__n">{k + 1}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="views__empty">Nobody has opened v{ver.n} yet. Page times show here after the first open.</p>
          )}
        </section>
      ) : null}
      {viewers && pages > 1 ? (
        <ul className="insights">
          {top ? (
            <li>
              <Chip tone="success">p{top}</Chip>
              <span>Read the longest, {Math.round(avg[top - 1] / 1000)} s on average.</span>
            </li>
          ) : null}
          {tailFrom ? (
            <li>
              <Chip tone="waiting">p{tailFrom} onwards</Chip>
              <span>Viewers skim the last {tail} pages. Worth cutting?</span>
            </li>
          ) : null}
          {stop && stop[1] >= 2 ? (
            <li>
              <Chip tone="error" dot={false}>
                p{stop[0]}
              </Chip>
              <span>Where {stop[1]} people stopped reading.</span>
            </li>
          ) : null}
        </ul>
      ) : null}
      <h3 className="views__h views__h--who">Who opened it</h3>
      {stats.length ? (
        <ul className="who">
          {stats.map((s) => (
            <li key={s.linkId}>
              <button type="button" className="who__row" onClick={() => open(s.investorId)} disabled={!s.investorId || !byId.has(s.investorId)}>
                <span className="who__name">{(s.investorId && byId.get(s.investorId)?.name) || 'Deleted investor'}</span>
                <span className="who__time mono">{duration(s.totalMs)}</span>
                <span className="who__pages">{pages ? `${pagesSeen(s)} / ${pages} pages` : s.opens > 1 ? `${s.opens} opens` : '1 open'}</span>
                <span className="who__when">{whenOf(s.lastAt, now)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="views__empty">{links.length ? 'Nobody has opened it yet.' : 'Not shared yet. Share it to see who reads what.'}</p>
      )}
      {ver.url ? <p className="views__note">Google links record opens and time, not pages.</p> : null}
    </div>
  )
}
