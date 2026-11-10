// PST-289: Send feedback (round5/system-feedback.png). ⌘. on any screen, the
// avatar menu and ⌘K open it. A type, the text, and a screenshot of the page
// (on by default, taken in the browser with html-to-image and kept in Convex
// file storage). Send saves it in Nest and makes a Linear issue (convex/feedback.ts);
// without a Linear key, or when Linear says no, it waits in Settings › Feedback.
// Backed by Convex, or by FeedbackContext in ?preview (src/preview/feedbackFixture.tsx).
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useAction, useMutation, useQuery } from 'convex/react'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import {
  FEEDBACK_LABEL, FEEDBACK_TEXT_MAX, FEEDBACK_TYPES, isFeedbackShortcut, onOpenFeedback, openFeedback, pageLabel, viewportLabel,
  type FeedbackList, type FeedbackResult, type FeedbackType, type Viewport,
} from '../../lib/feedback'
import { agoShort } from '../../lib/google'
import { shake } from '../../lib/motion'
import { play } from '../../lib/sound'
import { Button, Chip, IconButton, Kbd, Toggle, useToast } from '../ui'
import { Modal, useTitleId } from './Modal'
import { useSaveAction } from './useSaveAction'

export type FeedbackDraft = { type: FeedbackType; text: string; path: string; viewport: Viewport; version: string }

export type FeedbackSource = {
  /** Save it (with the screenshot, if any), then try Linear. */
  send: (f: FeedbackDraft, screenshot: Blob | null) => Promise<FeedbackResult>
  /** Settings › Feedback (null while it loads). */
  list: FeedbackList | null
  sendNow: (id: string) => Promise<FeedbackResult>
  /** ?preview&feedback=open|sent|unsent: open with this text, or show this result's toast. */
  preview?: { open?: { type: FeedbackType; text: string }; result?: FeedbackResult }
}

/** Set by ?preview; the app reads Convex. */
export const FeedbackContext = createContext<FeedbackSource | null>(null)

/** The build, for the issue: the commit on Vercel, "dev" locally (vite.config.ts). */
const APP_VERSION: string = import.meta.env.VITE_APP_VERSION || 'dev'

/* ---------- the host: shortcut, opener and toasts ---------- */

export function Feedback() {
  const injected = useContext(FeedbackContext)
  return injected ? <Host send={injected.send} preview={injected.preview} /> : <LiveHost />
}

function LiveHost() {
  const uploadUrl = useMutation(api.feedback.uploadUrl)
  const submit = useMutation(api.feedback.submit)
  const sendNow = useAction(api.feedback.send)
  const send = useCallback(
    async (f: FeedbackDraft, screenshot: Blob | null): Promise<FeedbackResult> => {
      let screenshotId: Id<'_storage'> | undefined
      if (screenshot) {
        const res = await fetch(await uploadUrl({}), { method: 'POST', headers: { 'Content-Type': screenshot.type }, body: screenshot })
        if (!res.ok) throw new Error('upload failed')
        screenshotId = ((await res.json()) as { storageId: Id<'_storage'> }).storageId
      }
      const id = await submit({ ...f, screenshotId })
      // Saved: whatever Linear does now, nothing is lost.
      try {
        return await sendNow({ id })
      } catch {
        return { status: 'unsent', reason: 'error' }
      }
    },
    [uploadUrl, submit, sendNow],
  )
  return <Host send={send} />
}

/** The toast after a send: "Sent as PST-301. Thanks!" with Open, or where it's waiting. */
export function useFeedbackToast() {
  const toast = useToast()
  const navigate = useNavigate()
  return useCallback(
    (r: FeedbackResult) => {
      if (r.status === 'sent') {
        play('feedback-sent')
        toast({ message: `Sent as ${r.identifier}. Thanks!`, action: { label: 'Open', onClick: () => void window.open(r.url, '_blank', 'noopener') }, durationMs: 6000 })
        return
      }
      toast({
        tone: 'info',
        icon: 'check',
        message: r.reason === 'nokey' ? 'Saved. Not sent yet: Linear isn’t set up here.' : 'Saved. Not sent yet: Linear didn’t answer.',
        action: { label: 'Open', onClick: () => void navigate({ to: '/raise/settings', hash: 'set-feedback' }) },
        durationMs: 6000,
      })
    },
    [toast, navigate],
  )
}

function Host({ send, preview }: { send: FeedbackSource['send']; preview?: FeedbackSource['preview'] }) {
  const [open, setOpen] = useState(!!preview?.open)
  const showResult = useFeedbackToast()

  useEffect(() => onOpenFeedback(() => setOpen(true)), [])
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!isFeedbackShortcut(e)) return
      e.preventDefault()
      setOpen(true)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const previewResult = preview?.result
  useEffect(() => {
    if (!previewResult) return
    const t = setTimeout(() => showResult(previewResult), 400)
    return () => clearTimeout(t)
  }, [previewResult, showResult])

  if (!open) return null
  return (
    <FeedbackDialog
      send={send}
      initial={preview?.open}
      onClose={() => setOpen(false)}
      onDone={(r) => {
        setOpen(false)
        showResult(r)
      }}
    />
  )
}

/* ---------- the screenshot ---------- */

let fontCss: Promise<string> | null = null

/**
 * The page's Google fonts (latin only) as data URLs, fetched once, so the
 * screenshot draws in Nest's own type. html-to-image can't read the
 * cross-origin stylesheet itself; without these it falls back to system fonts.
 */
function embeddedFonts(): Promise<string> {
  fontCss ??= (async () => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="stylesheet"][href^="https://fonts.googleapis.com/"]')
    if (!link) return ''
    const css = await (await fetch(link.href)).text()
    const latin = css.split(/(?=\/\* [a-z-]+ \*\/)/).filter((b) => b.startsWith('/* latin */')).join('\n')
    const urls = [...new Set(latin.match(/https:\/\/fonts\.gstatic\.com\/[^)\s]+/g) ?? [])]
    const data = await Promise.all(
      urls.map(async (u) => {
        const blob = await (await fetch(u)).blob()
        return [u, await new Promise<string>((ok, no) => {
          const r = new FileReader()
          r.onload = () => ok(String(r.result))
          r.onerror = () => no(r.error)
          r.readAsDataURL(blob)
        })] as const
      }),
    )
    return data.reduce((s, [u, d]) => s.split(u).join(d), latin)
  })().catch(() => '')
  return fontCss
}

/** The page as a PNG, without the dialog or a toast. Long pages stop at 4000px. */
async function capturePage(): Promise<Blob | null> {
  const { toBlob } = await import('html-to-image')
  const body = document.body
  return toBlob(body, {
    pixelRatio: 1,
    width: body.clientWidth,
    height: Math.min(body.scrollHeight, 4000),
    backgroundColor: getComputedStyle(body).backgroundColor,
    fontEmbedCSS: await embeddedFonts(),
    filter: (n) => !(n instanceof HTMLElement && (n.classList.contains('sys-modal') || n.classList.contains('toast-region'))),
  })
}

/* ---------- the dialog ---------- */

type Shot = { blob: Blob; url: string } | 'taking' | 'failed'

function FeedbackDialog({ send, initial, onClose, onDone }: { send: FeedbackSource['send']; initial?: { type: FeedbackType; text: string }; onClose: () => void; onDone: (r: FeedbackResult) => void }) {
  const titleId = useTitleId()
  const save = useSaveAction()
  const path = useRouterState({ select: (s) => s.location.pathname })
  const [viewport] = useState<Viewport>(() => ({ w: window.innerWidth, h: window.innerHeight }))
  const [type, setType] = useState<FeedbackType>(initial?.type ?? 'bug')
  const [text, setText] = useState(initial?.text ?? '')
  const [withShot, setWithShot] = useState(true)
  const [shot, setShot] = useState<Shot>('taking')
  const [busy, setBusy] = useState(false)
  const taking = useRef<Promise<Blob | null> | null>(null)
  const box = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    let live = true
    let url: string | null = null
    const p = capturePage().catch(() => null)
    taking.current = p
    void p.then((blob) => {
      if (!live) return
      if (!blob) return setShot('failed')
      url = URL.createObjectURL(blob)
      setShot({ blob, url })
    })
    return () => {
      live = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [])

  const submit = async () => {
    if (busy) return
    if (!text.trim()) {
      play('nope')
      shake(box.current)
      box.current?.focus()
      return
    }
    setBusy(true)
    const blob = withShot ? (typeof shot === 'object' ? shot.blob : await taking.current) : null
    const r = await save(() => send({ type, text, path, viewport, version: APP_VERSION }, blob ?? null), { failMessage: 'Couldn’t send your feedback.' })
    setBusy(false)
    if (r) onDone(r)
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <Modal onClose={onClose} labelledBy={titleId} className="feedback" initialFocus=".feedback__text">
      <div onKeyDown={onKey}>
        <IconButton icon="close" label="Close" className="draft__close" onClick={onClose} />
        <p className="draft__eyebrow eyebrow-mono">Send feedback · ⌘.</p>
        <h2 id={titleId} className="draft__title">
          What’s wrong, slow or missing?
        </h2>

        <div className="draft__types" role="group" aria-label="What kind">
          {FEEDBACK_TYPES.map((t) => (
            <button key={t} type="button" className={'draft-chip' + (t === type ? ' is-on' : '')} aria-pressed={t === type} onClick={() => setType(t)}>
              {FEEDBACK_LABEL[t]}
            </button>
          ))}
        </div>

        <textarea
          ref={box}
          className="textarea feedback__text"
          aria-label="Your feedback"
          placeholder={PLACEHOLDER[type]}
          value={text}
          maxLength={FEEDBACK_TEXT_MAX}
          onChange={(e) => setText(e.target.value)}
        />

        <div className={'feedback__shot' + (withShot ? '' : ' is-off')}>
          <span className="feedback__thumb" aria-hidden="true">
            {typeof shot === 'object' ? <img src={shot.url} alt="" /> : shot === 'taking' ? <span className="sk" /> : null}
          </span>
          <span className="feedback__shot-text">
            <span className="feedback__shot-title">Screenshot of this page</span>
            <span className="feedback__shot-sub">
              {pageLabel(path)} · {viewportLabel(viewport)}
            </span>
            <span className="feedback__shot-note">{shot === 'failed' ? 'Couldn’t take one here. It sends without it.' : 'The screenshot may show investor names. It stays in Pesto’s Linear.'}</span>
          </span>
          <Toggle aria-label="Attach a screenshot of this page" checked={withShot && shot !== 'failed'} disabled={shot === 'failed'} onChange={(e) => setWithShot(e.target.checked)} />
        </div>

        <p className="feedback__note">Becomes an issue in Linear (Pesto › Nest, label Feedback) with the page and the viewport.</p>

        <footer className="feedback__foot">
          <p className="feedback__keys">
            <Kbd>⌘↵</Kbd> send <Kbd>Esc</Kbd> cancel
          </p>
          <Button variant="primary" onClick={() => void submit()} loading={busy} loadingLabel="Sending…">
            Send
          </Button>
        </footer>
      </div>
    </Modal>
  )
}

const PLACEHOLDER: Record<FeedbackType, string> = {
  bug: 'What happened, and what did you expect?',
  idea: 'What would make this better?',
  slow: 'What were you waiting for?',
  confusing: 'What didn’t make sense?',
}

/* ---------- Settings › Feedback ---------- */

export function FeedbackCard() {
  const injected = useContext(FeedbackContext)
  return injected ? <FeedbackCardView list={injected.list} sendNow={injected.sendNow} /> : <LiveFeedbackCard />
}

function LiveFeedbackCard() {
  const list = useQuery(api.feedback.list)
  const send = useAction(api.feedback.send)
  return <FeedbackCardView list={list ?? null} sendNow={(id) => send({ id: id as Id<'feedback'> })} />
}

const SENT_SHOWN = 5

function FeedbackCardView({ list, sendNow }: Pick<FeedbackSource, 'list' | 'sendNow'>) {
  const save = useSaveAction()
  const toast = useToast()
  const showResult = useFeedbackToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [now] = useState(() => Date.now())

  const retry = async (id: string) => {
    setBusy(id)
    const r = await save(() => sendNow(id), { failMessage: 'Couldn’t send it.' })
    setBusy(null)
    if (!r) return
    if (r.status === 'unsent' && r.reason === 'nokey') toast({ tone: 'info', message: 'Linear isn’t set up here yet. It sends once LINEAR_API_KEY is set.' })
    else if (r.status === 'unsent') toast({ tone: 'error', message: 'Linear didn’t take it. Nest tries again within the hour.' })
    else showResult(r)
  }

  const head = (
    <div className="set-card__head">
      <h2 id="set-feedback-title">Feedback</h2>
      {list ? (
        list.linear ? (
          <Chip tone="success">Sends to Linear</Chip>
        ) : (
          <Chip tone="muted" dot={false}>
            Linear not set up
          </Chip>
        )
      ) : null}
    </div>
  )

  if (!list)
    return (
      <section className="set-card set-feedback" id="set-feedback" aria-labelledby="set-feedback-title" aria-busy="true">
        {head}
        <span className="sk" style={{ display: 'block', width: '100%', height: 56, borderRadius: 14, marginTop: 20 }} />
      </section>
    )

  const waiting = list.rows.filter((r) => r.status !== 'sent')
  const rows = [...waiting, ...list.rows.filter((r) => r.status === 'sent').slice(0, SENT_SHOWN)]
  return (
    <section className="set-card set-feedback" id="set-feedback" aria-labelledby="set-feedback-title">
      {head}
      <p className="set-card__lede">
        What you send with <Kbd>⌘.</Kbd> becomes an issue in Linear (Pesto › Nest, label Feedback).
        {list.linear ? '' : ' Until LINEAR_API_KEY is set, it waits here and sends within the hour once it is.'}
      </p>
      {rows.length ? (
        <ul className="set-feedback__list">
          {rows.map((r) => (
            <li key={r._id}>
              <span className="set-feedback__what">
                <strong>{r.title}</strong>
                <span>
                  {FEEDBACK_LABEL[r.type]} · {pageLabel(r.path)} · {r.by} · {agoShort(r.createdAt, now)}
                </span>
              </span>
              {r.status === 'sent' && r.issue ? (
                <a className="set-feedback__issue" href={r.issue.url} target="_blank" rel="noreferrer">
                  {r.issue.identifier}
                </a>
              ) : (
                <span className="set-feedback__wait">
                  <Chip tone="waiting">{r.status === 'sending' ? 'Sending' : 'Not sent yet'}</Chip>
                  <Button variant="secondary" size="sm" loading={busy === r._id} loadingLabel="Sending…" disabled={r.status === 'sending' || (!!busy && busy !== r._id)} onClick={() => void retry(r._id)}>
                    Send now
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className="set-feedback__empty">
          <p>Nothing sent yet. Press ⌘. on any screen, or start here.</p>
          <Button variant="secondary" onClick={openFeedback}>
            Send feedback
          </Button>
        </div>
      )}
    </section>
  )
}
