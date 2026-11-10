// PST-282: the investor drawer's Materials tab (drawer/materials.png): what this
// investor was sent, which versions, whether and how they read it, and Share.
import { Link } from '@tanstack/react-router'
import { useId, useState } from 'react'
import { duration, linkState, pagesSeen, shareUrl, whenOf, type ShareLink } from '../../lib/materials'
import { pop } from '../../lib/motion'
import { play } from '../../lib/sound'
import { formatDay, todayIST } from '../../lib/dates'
import type { Investor } from '../../lib/pipeline'
import { Egg } from '../illustrations'
import { useSaveAction } from '../system/useSaveAction'
import { Button, buttonClass, Chip, useToast } from '../ui'
import { useMaterials } from './data'
import { copyText, FileBadge, PageStrip, ReadChip, useIndex, versionName } from './parts'
import { ShareForm } from './Share'
import { SkeletonRows } from '../system/Skeleton'

export function DrawerMaterials({ inv }: { inv: Investor }) {
  const m = useMaterials()
  const ix = useIndex()
  const titleId = 'dm' + useId().replace(/:/g, '')
  const [sharing, setSharing] = useState<{ materialId?: string } | null>(null)
  const links = m.links.filter((l) => l.investorId === inv._id).sort((a, b) => b.createdAt - a.createdAt)

  if (sharing)
    return (
      <div className="dmat dmat--share">
        <ShareForm titleId={titleId} start={{ materialId: sharing.materialId, investorIds: [inv._id] }} pickMaterial={!sharing.materialId} onDone={() => setSharing(null)} />
      </div>
    )

  // "Last touch: today, from the deck": when the last touch was a first open.
  const today = todayIST()
  const fromOpen = links.find((l) => l.firstOpenedAt && todayIST(l.firstOpenedAt) === inv.lastTouch)
  const touchDay = inv.lastTouch ? (inv.lastTouch === today ? 'today' : formatDay(inv.lastTouch)) : ''
  return (
    <div className="dmat">
      <div className="dmat__head">
        <h3 className="dmat__h">What they have</h3>
        <Button variant="secondary" onClick={() => setSharing({})} disabled={!m.materials.length}>
          Share something
        </Button>
      </div>
      {!m.loaded ? (
        <SkeletonRows action={false} />
      ) : links.length ? (
        <ul className="dmat__list">
          {links.map((l) => (
            <LinkCard key={l._id} link={l} onSendNew={() => setSharing({ materialId: l.materialId })} />
          ))}
        </ul>
      ) : (
        <div className="drawer-empty">
          <Egg size={40} />
          <p>{m.materials.length ? 'Nothing sent yet. Share the deck and see what they read.' : 'Nothing in the library yet. Upload the deck under Materials first.'}</p>
          {m.materials.length ? null : (
            <Link to="/raise/materials" className={buttonClass({ variant: 'secondary' })}>
              Open Materials
            </Link>
          )}
        </div>
      )}
      {links.length ? (
        <p className="dmat__note">
          Opening a link counts as a touch.
          {touchDay ? <> Last touch: {touchDay}{fromOpen ? <>, from the {ix.mat.get(fromOpen.materialId)?.title.toLowerCase() ?? 'link'}</> : null}.</> : null}
        </p>
      ) : null}
    </div>
  )
}

function LinkCard({ link: l, onSendNew }: { link: ShareLink; onSendNew: () => void }) {
  const m = useMaterials()
  const ix = useIndex()
  const save = useSaveAction()
  const toast = useToast()
  const material = ix.mat.get(l.materialId)
  const v = ix.shown(l)
  const s = ix.stat(l)
  const status = ix.status(l)
  const cur = ix.current(l.materialId)
  const now = Date.now()
  const state = linkState(l, now)
  const pages = v?.pages ?? 0
  const sent = [`Sent ${formatDay(l.createdAt)}`, state === 'revoked' ? 'link revoked' : state === 'expired' ? 'link expired' : l.expiresAt ? `link expires ${formatDay(l.expiresAt)}` : 'link never expires']
  const read = s?.opens
    ? [`Opened ${whenOf(s.lastAt, now)}`, duration(s.totalMs), pages > 1 ? (pagesSeen(s) >= pages ? `all ${pages} pages` : `${pagesSeen(s)} of ${pages} pages`) : s.opens > 1 ? `${s.opens} opens` : ''].filter(Boolean).join(' · ')
    : 'Not opened yet'

  async function copy(el: HTMLElement) {
    if (await copyText(shareUrl(l.token, location.origin))) {
      pop(el)
      toast({ tone: 'info', icon: 'link', message: 'Link copied.' })
    }
  }
  async function revoke() {
    await save(() => m.act.revoke(l._id), {
      failMessage: 'Couldn’t revoke the link.',
      onDone: () => {
        play('toggle-off')
        toast({ tone: 'info', icon: 'lock', message: 'Revoked. The link now says it has expired.' })
      },
    })
  }

  return (
    <li className={`dlink dlink--${status}${state !== 'live' ? ' dlink--dead' : ''}`}>
      <FileBadge material={material} version={v} />
      <div className="dlink__main">
        <div className="dlink__top">
          <span className="dlink__title">{versionName(material, v)}</span>
          {state === 'live' ? <ReadChip status={status} /> : <Chip tone="muted" dot={false}>{state === 'revoked' ? 'Revoked' : 'Expired'}</Chip>}
        </div>
        <p className="dlink__sub">{sent.join(' · ')}</p>
        <p className="dlink__read">{read}</p>
        {s?.opens && pages > 1 ? <PageStrip pageMs={s.pageMs} pages={pages} label={`${pagesSeen(s)} of ${pages} pages read`} /> : null}
        {state === 'live' ? (
          <div className="dlink__actions">
            {status === 'old' && cur ? (
              <Button variant="primary" size="sm" onClick={onSendNew}>
                Send v{cur.n}
              </Button>
            ) : null}
            <button type="button" className="drawer__textbtn" onClick={(e) => void copy(e.currentTarget)}>
              Copy link
            </button>
            <button type="button" className="drawer__textbtn drawer__textbtn--danger" onClick={() => void revoke()}>
              Revoke
            </button>
          </div>
        ) : null}
      </div>
    </li>
  )
}
