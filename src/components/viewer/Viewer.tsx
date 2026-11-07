// PST-282: the public viewer at /d/<token>. No sign-in. It shows the document,
// Pesto's name and, if the link has it, "Questions? Reply to Dev"; nothing about
// Nest or other investors. PDFs render with pdf.js (lazy-loaded, page by page as
// they near the screen). Time per page goes back in small beacons every 5 s
// while the page is visible, and on page change; no third-party scripts.
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { BEAT_MS, embedUrl, isEmail } from '../../lib/materials'
import { openPdf } from '../../lib/pdf'
import type { PDFDocumentProxy } from 'pdfjs-dist'

export type ViewerDoc = { title: string; n: number; pages: number | null; kind: 'pdf' | 'link'; url: string | null; download: boolean; watermark: string | null; reply: string | null; from: 'Pesto' }
type State =
  | { s: 'loading' }
  | { s: 'email'; invalid: boolean; busy?: boolean }
  | { s: 'gone' }
  | { s: 'missing' }
  | { s: 'busy' }
  | { s: 'error' }
  | { s: 'open'; sessionId: string; doc: ViewerDoc }

/** The Convex HTTP routes: VITE_CONVEX_SITE_URL, or the deployment URL's .site twin. */
const SITE = ((import.meta.env.VITE_CONVEX_SITE_URL as string | undefined) || String(import.meta.env.VITE_CONVEX_URL ?? '').replace(/\.cloud\/?$/, '.site')).replace(/\/$/, '')
const EMAIL_KEY = 'pesto_viewer_email'
const IDLE_MS = 60_000

/** For the made-up preview (?preview): every call answered locally. */
export type ViewerApi = {
  open: (email?: string) => Promise<{ state: string; invalid?: boolean; sessionId?: string; doc?: ViewerDoc }>
  beat: (sessionId: string, page: number, ms: number, last?: boolean) => Promise<number>
  fileUrl: (sessionId: string, download?: boolean) => string
}

export function httpApi(token: string): ViewerApi {
  return {
    open: async (email) => {
      const res = await fetch(`${SITE}/d/open`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ token, ...(email ? { email } : {}) }) })
      return res.json()
    },
    beat: async (sessionId, page, ms, last) => {
      const body = JSON.stringify({ token, sessionId, page, ms: Math.round(ms) })
      if (last && typeof navigator.sendBeacon === 'function') return navigator.sendBeacon(`${SITE}/d/beat`, new Blob([body], { type: 'text/plain' })) ? 200 : 0
      const res = await fetch(`${SITE}/d/beat`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body, keepalive: true }).catch(() => null)
      return res?.status ?? 0
    },
    fileUrl: (sessionId, download) => `${SITE}/d/file?token=${encodeURIComponent(token)}&session=${encodeURIComponent(sessionId)}${download ? '&download=1' : ''}`,
  }
}

export function Viewer({ api }: { api: ViewerApi }) {
  const [state, setState] = useState<State>({ s: 'loading' })
  const open = useCallback(
    async (email?: string) => {
      try {
        const r = await api.open(email)
        if (r.state === 'ok' && r.sessionId && r.doc) {
          if (email) saveEmail(email)
          setState({ s: 'open', sessionId: r.sessionId, doc: r.doc })
        } else if (r.state === 'email') setState({ s: 'email', invalid: !!r.invalid })
        else setState({ s: r.state === 'expired' ? 'gone' : r.state === 'limited' ? 'busy' : r.state === 'missing' ? 'missing' : 'error' })
      } catch {
        setState({ s: 'error' })
      }
    },
    [api],
  )
  useEffect(() => {
    void open(savedEmail() || undefined)
  }, [open])

  return (
    <div className="dv">
      <header className="dv__bar">
        <span className="dv__brand">Pesto</span>
        {state.s === 'open' ? <span className="dv__title">{state.doc.title}</span> : null}
      </header>
      <main className="dv__main">
        {state.s === 'loading' ? (
          <div className="dv__pages" aria-busy="true">
            <div className="dv__page dv__page--blank" />
          </div>
        ) : state.s === 'email' ? (
          <EmailGate invalid={state.invalid} onSubmit={(email) => void open(email)} />
        ) : state.s === 'open' ? (
          <Doc api={api} sessionId={state.sessionId} doc={state.doc} onGone={() => setState({ s: 'gone' })} />
        ) : (
          <Note state={state.s} />
        )}
      </main>
    </div>
  )
}

function savedEmail() {
  try {
    return localStorage.getItem(EMAIL_KEY) ?? ''
  } catch {
    return ''
  }
}
function saveEmail(email: string) {
  try {
    localStorage.setItem(EMAIL_KEY, email)
  } catch {
    /* private mode */
  }
}

const NOTES = {
  gone: ['This link has expired', 'Ask the person who sent it for a fresh one. Thanks for taking a look.'],
  missing: ['This link doesn’t open anything', 'Check that the whole link was copied, or ask for a fresh one.'],
  busy: ['One moment', 'This link was opened a lot in the last minute. Try again shortly.'],
  error: ['This didn’t load', 'Check your connection and try again.'],
} as const

function Note({ state }: { state: keyof typeof NOTES }) {
  const [t, s] = NOTES[state]
  return (
    <section className="dv__note">
      <h1>{t}</h1>
      <p>{s}</p>
      {state === 'error' || state === 'busy' ? (
        <button type="button" className="dv__btn" onClick={() => location.reload()}>
          Try again
        </button>
      ) : null}
    </section>
  )
}

function EmailGate({ invalid, onSubmit }: { invalid: boolean; onSubmit: (email: string) => void }) {
  const [email, setEmail] = useState(savedEmail)
  const [tried, setTried] = useState(false)
  const bad = (tried && !isEmail(email.trim())) || (invalid && !tried)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setTried(true)
    if (isEmail(email.trim())) onSubmit(email.trim())
  }
  return (
    <form className="dv__note dv__gate" onSubmit={submit} noValidate>
      <h1>Pesto shared a document with you</h1>
      <p>Enter your email to open it.</p>
      <label className="dv__label" htmlFor="dv-email">
        Your email
      </label>
      <input id="dv-email" className={`dv__input${bad ? ' is-bad' : ''}`} type="email" inputMode="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={bad || undefined} aria-describedby={bad ? 'dv-email-msg' : undefined} />
      {bad ? (
        <p id="dv-email-msg" className="dv__err" role="alert">
          That doesn’t look like an email address.
        </p>
      ) : null}
      <button type="submit" className="dv__btn">
        Open the document
      </button>
    </form>
  )
}

/** Time on the page in view: flushed every 5 s while visible, on page change, and when the tab hides. */
function useBeacons(api: ViewerApi, sessionId: string, onGone: () => void) {
  const acc = useRef({ page: 1, since: 0, visible: true, active: 0, pending: new Map<number, number>() })
  const send = useCallback(
    (last = false) => {
      const a = acc.current
      const pending = [...a.pending.entries()]
      a.pending.clear()
      for (const [page, ms] of pending)
        void api.beat(sessionId, page, ms, last).then((status) => {
          if (status === 410) onGone()
        })
    },
    [api, sessionId, onGone],
  )
  /** Move the time since the last mark onto the current page (not while hidden or idle for a minute). */
  const mark = useCallback(() => {
    const a = acc.current
    const now = performance.now()
    const until = Math.min(now, a.active + IDLE_MS)
    if (a.visible && until > a.since) a.pending.set(a.page, (a.pending.get(a.page) ?? 0) + (until - a.since))
    a.since = now
  }, [])
  useEffect(() => {
    const a = acc.current
    a.since = a.active = performance.now()
    const tick = setInterval(() => {
      mark()
      send()
    }, BEAT_MS)
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        mark()
        a.visible = false
        send(true)
      } else {
        a.visible = true
        a.since = a.active = performance.now()
      }
    }
    const onHide = () => {
      mark()
      send(true)
    }
    const onAct = () => {
      if (performance.now() - a.active > IDLE_MS) a.since = performance.now()
      a.active = performance.now()
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pagehide', onHide)
    for (const ev of ['scroll', 'pointerdown', 'keydown', 'touchstart', 'wheel'] as const) window.addEventListener(ev, onAct, { passive: true })
    return () => {
      clearInterval(tick)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pagehide', onHide)
      for (const ev of ['scroll', 'pointerdown', 'keydown', 'touchstart', 'wheel'] as const) window.removeEventListener(ev, onAct)
      onHide()
    }
  }, [mark, send])
  /** A new page is in view: its time starts now, and the last page's goes out if there's a second of it. */
  return useCallback(
    (page: number) => {
      const a = acc.current
      if (page === a.page) return
      mark()
      a.page = page
      if ([...a.pending.values()].some((ms) => ms >= 1000)) send()
    },
    [mark, send],
  )
}

function Doc({ api, sessionId, doc, onGone }: { api: ViewerApi; sessionId: string; doc: ViewerDoc; onGone: () => void }) {
  const onPage = useBeacons(api, sessionId, onGone)
  const [current, setCurrent] = useState(1)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [failed, setFailed] = useState(false)
  const [ratio, setRatio] = useState(9 / 16)
  const count = pdf?.numPages ?? doc.pages ?? 1

  useEffect(() => {
    if (doc.kind !== 'pdf') return
    let doomed = false
    let loaded: PDFDocumentProxy | null = null
    openPdf({ url: api.fileUrl(sessionId) })
      .then(async (p) => {
        loaded = p
        if (doomed) return void p.loadingTask.destroy()
        const vp = (await p.getPage(1)).getViewport({ scale: 1 })
        setRatio(vp.height / vp.width)
        setPdf(p)
      })
      .catch(() => !doomed && setFailed(true))
    return () => {
      doomed = true
      void loaded?.loadingTask.destroy()
    }
  }, [api, sessionId, doc.kind])

  // The page most in view is the current one.
  const list = useRef<HTMLOListElement>(null)
  useEffect(() => {
    const root = list.current
    if (!root || typeof IntersectionObserver !== 'function') return
    const seen = new Map<number, number>()
    const io = new IntersectionObserver(
      (es) => {
        for (const e of es) seen.set(Number((e.target as HTMLElement).dataset.page), e.intersectionRatio)
        let best = 0
        let page = 1
        for (const [p, r] of seen) {
          if (r <= best) continue
          best = r
          page = p
        }
        if (best > 0) {
          setCurrent(page)
          onPage(page)
        }
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] },
    )
    root.querySelectorAll('[data-page]').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [count, onPage])

  return (
    <>
      <div className="dv__head">
        <h1 className="dv__h1">{doc.title}</h1>
        <div className="dv__tools">
          {doc.kind === 'pdf' ? (
            <span className="dv__count" aria-live="polite">
              {current} / {count}
            </span>
          ) : null}
          {doc.download ? (
            <a className="dv__btn dv__btn--quiet" href={api.fileUrl(sessionId, true)} download>
              Download PDF
            </a>
          ) : null}
        </div>
      </div>
      {doc.kind === 'link' ? (
        <LinkDoc doc={doc} />
      ) : failed ? (
        <Note state="error" />
      ) : (
        <ol className="dv__pages" ref={list}>
          {Array.from({ length: count }, (_, k) => (
            <Page key={k} n={k + 1} pdf={pdf} ratio={ratio} watermark={doc.watermark} />
          ))}
        </ol>
      )}
      <footer className="dv__foot">
        {doc.reply ? (
          <p>
            Questions?{' '}
            <a href={`mailto:${doc.reply}?subject=${encodeURIComponent(doc.title)}`}>Reply to Dev</a>
          </p>
        ) : null}
        <p className="dv__from">Shared by Pesto</p>
      </footer>
    </>
  )
}

/** One page: a placeholder at the right shape until it nears the screen, then a canvas at the device's pixel ratio (up to 2×). */
function Page({ n, pdf, ratio, watermark }: { n: number; pdf: PDFDocumentProxy | null; ratio: number; watermark: string | null }) {
  const box = useRef<HTMLLIElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [near, setNear] = useState(false)
  const [drawn, setDrawn] = useState(false)
  useEffect(() => {
    const el = box.current
    if (!el || near) return
    if (typeof IntersectionObserver !== 'function') return setNear(true)
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && (setNear(true), io.disconnect()), { rootMargin: '1200px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [near])
  useEffect(() => {
    if (!near || !pdf || !canvas.current || !box.current) return
    let task: { cancel: () => void } | null = null
    let stop = false
    void pdf.getPage(n).then((page) => {
      if (stop || !canvas.current || !box.current) return
      const base = page.getViewport({ scale: 1 })
      const scale = (box.current.clientWidth / base.width) * Math.min(2, window.devicePixelRatio || 1)
      const vp = page.getViewport({ scale })
      canvas.current.width = Math.floor(vp.width)
      canvas.current.height = Math.floor(vp.height)
      const t = page.render({ canvas: canvas.current, viewport: vp })
      task = t
      t.promise.then(() => !stop && setDrawn(true)).catch(() => {})
    })
    return () => {
      stop = true
      task?.cancel()
    }
  }, [near, pdf, n])
  return (
    <li ref={box} className={`dv__page${drawn ? ' is-drawn' : ''}`} data-page={n} style={{ aspectRatio: `1 / ${ratio}` }} aria-label={`Page ${n}`}>
      <canvas ref={canvas} onContextMenu={(e) => e.preventDefault()} />
      {watermark ? <Watermark email={watermark} /> : null}
    </li>
  )
}

function Watermark({ email }: { email: string }) {
  return (
    <div className="dv__wm" aria-hidden="true">
      {Array.from({ length: 12 }, (_, k) => (
        <span key={k}>{email}</span>
      ))}
    </div>
  )
}

/** A Google Slides or Docs version: embedded through its preview page, or a button out. */
function LinkDoc({ doc }: { doc: ViewerDoc }) {
  const src = doc.url ? embedUrl(doc.url) : null
  return (
    <div className="dv__pages">
      {src ? (
        <div className="dv__page dv__page--embed" data-page={1}>
          <iframe src={src} title={doc.title} allow="fullscreen" referrerPolicy="no-referrer" />
          {doc.watermark ? <Watermark email={doc.watermark} /> : null}
        </div>
      ) : (
        <section className="dv__note" data-page={1}>
          <p>This one lives on another site.</p>
          {doc.url ? (
            <a className="dv__btn" href={doc.url} target="_blank" rel="noreferrer noopener">
              Open {doc.title}
            </a>
          ) : null}
        </section>
      )}
    </div>
  )
}
