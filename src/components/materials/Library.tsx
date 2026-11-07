// PST-282: Raise › Materials (raise-materials/library.png, empty.png; the phone
// layouts in iphone-17-pro-max/materials.png): the summary, the library, recent views.
import { useEffect, useMemo, useState, type DragEvent } from 'react'
import { duration, furthestPage, pagesSeen, sumPages, topPage, whenOf, materialCounts, dayOfMs, linkSource, type Material, type ShareLink } from '../../lib/materials'
import { pop, usePop } from '../../lib/motion'
import { play } from '../../lib/sound'
import { useRaise } from '../data'
import { NestEmpty } from '../illustrations'
import { usePreviewState } from '../preview-state'
import { openOnKey, useUI } from '../raise-ui'
import { Modal, useTitleId } from '../system/Modal'
import { ViewSkeleton } from '../system/Skeleton'
import { Button, Card, Chip, IconButton } from '../ui'
import { useMaterials } from './data'
import { MaterialPanel, type PanelTab } from './Panel'
import { checkPdf, FileBadge, PageStrip, PdfDrop, ReadChip, useIndex, VersionChip, versionName, type PickedPdf } from './parts'
import { ShareDialog, type ShareStart } from './Share'
import { AddDialog } from './Upload'

type PanelState = { id: string; tab: PanelTab; file?: PickedPdf | null }

export function MaterialsView() {
  const m = useMaterials()
  const d = useRaise()
  const preview = usePreviewState()
  const [panel, setPanel] = useState<PanelState | null>(null)
  const [sharing, setSharing] = useState<ShareStart | null>(null)
  const [adding, setAdding] = useState<{ file?: PickedPdf } | null>(null)
  const [room, setRoom] = useState(false)

  // Preview: open the asked-for state once the data is in.
  const state = preview?.materials
  useEffect(() => {
    if (!state || !m.loaded) return
    const deck = m.materials.find((x) => x.kind === 'deck')
    if ((state === 'versions' || state === 'views') && deck) setPanel({ id: deck._id, tab: state })
    if ((state === 'share' || state === 'sent' || state === 'noemail') && deck) setSharing({ materialId: deck._id, investorIds: d.investors.filter((i) => i.name === 'Kite Angels' || i.name === 'Orchard Capital').map((i) => i._id), sent: state !== 'share' })
    if (state === 'upload') setAdding({})
  }, [state, m.loaded]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!m.loaded) return <ViewSkeleton />
  const share = (materialId: string, investorIds?: string[]) => setSharing({ materialId, investorIds })
  const main = m.materials.filter((x) => x.kind !== 'data-room').sort(byKind)
  const room_ = m.materials.filter((x) => x.kind === 'data-room')

  return (
    <section className="mat" aria-label="Materials">
      {m.materials.length ? (
        <>
          <Summary />
          <header className="mat__head">
            <div>
              <h2 className="today__h2">Library</h2>
              <p className="mat__lede">Everything you send investors. One version of each is current; older ones stay readable.</p>
            </div>
            <div className="mat__actions">
              {room_.length ? (
                <Button variant="secondary" className="only-desk" onClick={() => setRoom(true)}>
                  Open data room
                </Button>
              ) : null}
              <Button variant="primary" onClick={() => setAdding({})}>
                <span className="only-desk">Upload a file</span>
                <span className="only-phone">Upload</span>
              </Button>
            </div>
          </header>
          <ul className="mat-grid">
            {main.map((x, k) => (
              <MaterialCard key={x._id} material={x} rise={k + 1} onOpen={(file) => setPanel({ id: x._id, tab: 'versions', file })} onShare={() => share(x._id)} />
            ))}
            {room_.length ? <DataRoomCard files={room_} rise={main.length + 1} onOpen={() => setRoom(true)} /> : null}
            <li className="mat-grid__drop only-desk">
              <PdfDrop className="mat-drop" title="Drop a file to add it" sub="Or drop a new version on any card above." picked={null} onPick={(f) => f && setAdding({ file: f })} />
            </li>
          </ul>
          <RecentViews onShare={share} />
        </>
      ) : (
        <Empty onUpload={() => setAdding({})} />
      )}
      {panel ? <MaterialPanel key={panel.id} materialId={panel.id} tab={panel.tab} file={panel.file} onClose={() => setPanel(null)} onShare={(ids) => share(panel.id, ids)} /> : null}
      {sharing ? <ShareDialog start={sharing} onClose={() => setSharing(null)} /> : null}
      {adding ? <AddDialog file={adding.file} onClose={() => setAdding(null)} /> : null}
      {room ? <DataRoom files={room_} onClose={() => setRoom(false)} onOpen={(id) => (setRoom(false), setPanel({ id, tab: 'versions' }))} onShare={(id) => (setRoom(false), share(id))} /> : null}
    </section>
  )
}

const KIND_ORDER = ['deck', 'memo', 'one-pager', 'model', 'other', 'data-room']
const byKind = (a: Material, b: Material) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.createdAt - b.createdAt

/* ---------- summary ---------- */

function Summary() {
  const m = useMaterials()
  const ix = useIndex()
  const deck = m.materials.find((x) => x.kind === 'deck')
  const cur = deck ? ix.current(deck._id) : undefined
  const opened = m.links.filter((l) => ix.stat(l)?.opens).length
  const top = cur?.pages ? topPage(sumPages(m.stats.filter((s) => s.versionId === cur._id), cur.pages)) : null
  const openedRef = usePop<HTMLSpanElement>(opened)
  return (
    <div className="mat-sum card card--white m-rise" style={{ ['--rise-i' as string]: 0 }}>
      <div className="mat-sum__tile">
        <span className="mat-sum__label eyebrow-mono">Current deck</span>
        <span className="mat-sum__value">{cur ? `v${cur.n} · ${dayOfMs(cur.createdAt)}` : 'Not uploaded'}</span>
      </div>
      <div className="mat-sum__tile only-desk">
        <span className="mat-sum__label eyebrow-mono">Links sent</span>
        <span className="mat-sum__value num">{m.links.length}</span>
      </div>
      <div className="mat-sum__tile mat-sum__tile--good">
        <span className="mat-sum__label eyebrow-mono">Opened</span>
        <span className="mat-sum__value num" ref={openedRef}>
          {opened} of {m.links.length}
        </span>
      </div>
      <div className="mat-sum__tile only-desk">
        <span className="mat-sum__label eyebrow-mono">Most-read page</span>
        <span className="mat-sum__value">{top ? `p${top} of the deck` : '–'}</span>
      </div>
    </div>
  )
}

/* ---------- library cards ---------- */

function MaterialCard({ material, rise, onOpen, onShare }: { material: Material; rise: number; onOpen: (file?: PickedPdf) => void; onShare: () => void }) {
  const m = useMaterials()
  const ix = useIndex()
  const cur = ix.current(material._id)
  const c = materialCounts(material._id, m.links, m.stats)
  const [over, setOver] = useState(false)
  const sub = ['Current', cur?.pages ? `${cur.pages} page${cur.pages === 1 ? '' : 's'}` : cur?.url ? linkSource(cur.url) : '', cur ? dayOfMs(cur.createdAt) : ''].filter(Boolean).join(' · ')
  // Drop a PDF on the card: it opens with that file ready as the next version.
  const onDrop = async (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    const f = e.dataTransfer.files?.[0]
    if (!f) return
    const r = await checkPdf(f)
    if (typeof r === 'string') return play('nope')
    onOpen(r)
  }
  return (
    <li
      className={`mcard m-rise${over ? ' is-over' : ''}`}
      style={{ ['--rise-i' as string]: rise }}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => void onDrop(e)}
    >
      <div className="mcard__main" role="button" tabIndex={0} onClick={() => onOpen()} onKeyDown={openOnKey(() => onOpen())} aria-label={`${versionName(material, cur)}: versions and views`}>
        <div className="mcard__top">
          <FileBadge material={material} version={cur} />
          {cur ? <VersionChip n={cur.n} className="only-desk" /> : null}
        </div>
        <h3 className="mcard__title">{material.title}</h3>
        <p className="mcard__sub">
          <span className="only-desk">{sub}</span>
          <span className="only-phone">{[cur ? `v${cur.n}` : '', ...sub.split(' · ').slice(1)].filter(Boolean).join(' · ')}</span>
        </p>
        {cur?.note ? <p className="mcard__note only-desk">{cur.note}</p> : null}
      </div>
      <div className="mcard__foot">
        <span className="mcard__counts eyebrow-mono">
          Sent {c.sent} · Opened {c.opened}
        </span>
        <Button variant="secondary" className="mcard__share" onClick={onShare} aria-label={`Share ${material.title}`}>
          Share
        </Button>
      </div>
    </li>
  )
}

function DataRoomCard({ files, rise, onOpen }: { files: Material[]; rise: number; onOpen: () => void }) {
  const m = useMaterials()
  const ids = new Set(files.map((f) => f._id))
  const links = m.links.filter((l) => ids.has(l.materialId))
  const people = new Set(links.map((l) => l.investorId).filter(Boolean)).size
  const views = m.stats.filter((s) => links.some((l) => l._id === s.linkId)).reduce((n, s) => n + s.opens, 0)
  const list = files.map((f) => f.title).join(', ')
  return (
    <li className="mcard mcard--room m-rise only-desk" style={{ ['--rise-i' as string]: rise }}>
      <div className="mcard__main" role="button" tabIndex={0} onClick={onOpen} onKeyDown={openOnKey(onOpen)} aria-label="Data room: its files">
        <div className="mcard__top">
          <FileBadge material={{ kind: 'data-room' }} />
          <Chip tone="neutral" dot={false} className="vchip">
            {files.length} file{files.length === 1 ? '' : 's'}
          </Chip>
        </div>
        <h3 className="mcard__title">Data room</h3>
        <p className="mcard__sub">Opens at Diligence · {people} investor{people === 1 ? '' : 's'} in</p>
        <p className="mcard__note">{list}.</p>
      </div>
      <div className="mcard__foot">
        <span className="mcard__counts eyebrow-mono">
          Access {people} · Views {views}
        </span>
        <Button variant="secondary" className="mcard__share" onClick={onOpen}>
          Open
        </Button>
      </div>
    </li>
  )
}

function DataRoom({ files, onClose, onOpen, onShare }: { files: Material[]; onClose: () => void; onOpen: (id: string) => void; onShare: (id: string) => void }) {
  const m = useMaterials()
  const ix = useIndex()
  const titleId = useTitleId()
  return (
    <Modal onClose={onClose} labelledBy={titleId} className="share room">
      <IconButton icon="close" label="Close" className="share__close" onClick={onClose} />
      <div className="share__body">
        <p className="share__eyebrow eyebrow-mono">Library · data room</p>
        <h2 className="share__title" id={titleId}>
          Data room
        </h2>
        <p className="share__lede">Files for diligence. Share each with the investors who are in diligence; every link is tracked like the deck.</p>
        <ul className="room__list">
          {files.map((f) => {
            const cur = ix.current(f._id)
            const c = materialCounts(f._id, m.links, m.stats)
            return (
              <li key={f._id} className="room__row">
                <button type="button" className="room__main" onClick={() => onOpen(f._id)}>
                  <FileBadge material={f} version={cur} size="sm" />
                  <span className="room__text">
                    <span className="room__title">{versionName(f, cur)}</span>
                    <span className="room__sub eyebrow-mono">
                      Sent {c.sent} · Opened {c.opened}
                    </span>
                  </span>
                </button>
                <Button variant="secondary" size="sm" onClick={() => onShare(f._id)}>
                  Share
                </Button>
              </li>
            )
          })}
        </ul>
      </div>
    </Modal>
  )
}

/* ---------- recent views ---------- */

const MAX_RECENT = 6

function RecentViews({ onShare }: { onShare: (materialId: string, investorIds?: string[]) => void }) {
  const m = useMaterials()
  const d = useRaise()
  const ui = useUI()
  const ix = useIndex()
  const [nudged, setNudged] = useState<ReadonlySet<string>>(() => new Set())
  const byId = useMemo(() => new Map(d.investors.map((i) => [i._id, i])), [d.investors])
  const now = Date.now()
  const rows = m.links
    .filter((l) => l.investorId && byId.has(l.investorId) && ix.stat(l)?.opens)
    .sort((a, b) => ix.stat(b)!.lastAt - ix.stat(a)!.lastAt)
    .slice(0, MAX_RECENT)

  async function nudge(l: ShareLink, el: HTMLElement) {
    const i = byId.get(l.investorId!)
    if (!i) return
    setNudged((s) => new Set(s).add(l._id))
    play('nudge')
    requestAnimationFrame(() => pop(el.parentElement?.querySelector('.recent__nudged')))
    try {
      await d.logNote(i._id, `Sent a nudge about ${ix.mat.get(l.materialId)?.title ?? 'the deck'}.`, { touch: 'nudge' })
    } catch (e) {
      setNudged((s) => new Set([...s].filter((x) => x !== l._id)))
      ui.fail(e)
    }
  }

  return (
    <section className="recent" aria-labelledby="recent-title">
      <h2 id="recent-title" className="today__h2">
        Recent views
      </h2>
      <p className="mat__lede">Opening a link counts as a touch, so they leave Gone quiet.</p>
      {rows.length ? (
        <Card className="recent__card" riseIndex={8} as="div">
          <ul className="recent__list">
            {rows.map((l) => {
              const i = byId.get(l.investorId!)!
              const material = ix.mat.get(l.materialId)
              const v = ix.shown(l)
              const s = ix.stat(l)!
              const status = ix.status(l)
              const cur = ix.current(l.materialId)
              const pages = v?.pages ?? 0
              const top = topPage(s.pageMs)
              const insight =
                status === 'old'
                  ? 'Still on an old version'
                  : status === 'back'
                    ? `Opened it ${s.opens === 2 ? 'twice' : `${s.opens} times`}`
                    : status === 'dropped'
                      ? `Stopped at p${furthestPage(s)}`
                      : pages > 1 && top
                        ? `Longest on p${top}`
                        : pages > 1
                          ? `Read ${pagesSeen(s)} of ${pages} pages`
                          : 'Opened it'
              const openInv = () => ui.open(i._id, { tab: 'materials' })
              return (
                <li key={l._id} className={`recent__row recent__row--${status}`}>
                  <div className="recent__who" role="button" tabIndex={0} onClick={openInv} onKeyDown={openOnKey(openInv)} aria-label={`Open ${i.name}`}>
                    <span className="row__name">{i.name}</span>
                    <span className="row__sub">
                      {versionName(material, v)} · {whenOf(s.lastAt, now)}
                      <span className="only-phone"> · {duration(s.totalMs)}</span>
                    </span>
                  </div>
                  <span className="recent__time mono only-desk">{duration(s.totalMs)}</span>
                  <span className="only-desk recent__strip">
                    <PageStrip pageMs={s.pageMs} pages={pages} label={`${pagesSeen(s)} of ${pages || 1} pages read`} />
                  </span>
                  <span className={`recent__insight only-desk${status === 'old' ? ' is-old' : ''}`}>{insight}</span>
                  <ReadChip status={status} />
                  <span className="recent__act only-desk">
                    {status === 'old' && cur ? (
                      <Button variant="primary" size="sm" onClick={() => onShare(l.materialId, [i._id])}>
                        Send v{cur.n}
                      </Button>
                    ) : status === 'dropped' ? (
                      nudged.has(l._id) ? (
                        <Chip tone="live" className="recent__nudged">
                          Nudged
                        </Chip>
                      ) : (
                        <Button variant="secondary" size="sm" onClick={(e) => void nudge(l, e.currentTarget)}>
                          Nudge
                        </Button>
                      )
                    ) : (
                      <button type="button" className="recent__open" onClick={openInv}>
                        Open
                      </button>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        </Card>
      ) : (
        <div className="empty-state empty-state--cream">
          <NestEmpty size={72} />
          <div>
            <p className="empty-state__title">No opens yet.</p>
            <p>When an investor opens a link, it shows here with the time they spent on each page.</p>
          </div>
        </div>
      )}
    </section>
  )
}

/* ---------- empty ---------- */

const STEPS = [
  { t: 'Upload your deck', s: 'A PDF, a Keynote export, or a Google Slides link.' },
  { t: 'Share per investor', s: 'One link each, on nest.pestokids.com, so you know who read what.' },
  { t: 'See who read it', s: 'Opens and time on every page. An open counts as a touch.' },
]

function Empty({ onUpload }: { onUpload: () => void }) {
  return (
    <Card className="mat-empty" riseIndex={0}>
      <span className="m-wobble-hover mat-empty__illo" tabIndex={-1}>
        <NestEmpty size={96} className="m-wobble-target" />
      </span>
      <h2 className="mat-empty__title">Nothing in the nest yet</h2>
      <p className="mat-empty__lede">Upload your deck and memo here, so you always send the latest version and see who read it.</p>
      <ol className="mat-empty__steps">
        {STEPS.map((x, k) => (
          <li key={x.t} className="m-rise" style={{ ['--rise-i' as string]: k + 1 }}>
            <span className="mat-empty__n">{k + 1}</span>
            <span className="mat-empty__t">{x.t}</span>
            <span className="mat-empty__s">{x.s}</span>
          </li>
        ))}
      </ol>
      <Button variant="primary" icon="upload" onClick={onUpload}>
        Upload your deck
      </Button>
    </Card>
  )
}
