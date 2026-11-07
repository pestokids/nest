// Settings · Wispr Flow (PST-285), beside Calendar and Gmail and in its style:
// not connected (paste the MCP URL from Wispr Flow › Settings › MCP, then
// Connect, which opens Wispr Flow's sign-in), connected (last fetched, Fetch past
// 30 days, Disconnect), fetching, and needs reconnecting. Backed by Convex
// (convex/wispr.ts), or by WisprContext in ?preview (src/preview/wisprFixture.tsx).
// Nothing here ever sees a token or a note.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useAction, useMutation, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { cleanUrl, EVERY_MIN, fetchedLine, wisprConnectMessage, type WisprCardData } from '../../lib/wispr'
import { play } from '../../lib/sound'
import { useSaveAction } from '../system/useSaveAction'
import { Button, Chip, Icon, Input, useToast } from '../ui'

export type WisprSource = {
  /** Null while it loads. */
  data: WisprCardData | null
  /** The sign-in URL to open (null: nothing to open, as in preview). */
  connect: (url: string) => Promise<string | null>
  fetchPast: () => Promise<unknown>
  disconnect: () => Promise<unknown>
}

/** Set by ?preview; the live card reads Convex. */
export const WisprContext = createContext<WisprSource | null>(null)

export function WisprCard() {
  const injected = useContext(WisprContext)
  return (
    <>
      <ConnectToast />
      {injected ? <WisprCardView {...injected} /> : <LiveWisprCard />}
    </>
  )
}

function LiveWisprCard() {
  const data = useQuery(api.wispr.status)
  const connect = useAction(api.wispr.connect)
  const fetchPast = useMutation(api.wispr.fetchPast)
  const disconnect = useMutation(api.wispr.disconnect)
  return <WisprCardView data={data ?? null} connect={(url) => connect({ url })} fetchPast={() => fetchPast({})} disconnect={() => disconnect({})} />
}

/** Back from Wispr Flow's sign-in (?wisprConnect=ok|denied|…): say how it went once, then drop the param. */
function ConnectToast() {
  const toast = useToast()
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const m = wisprConnectMessage(q.get('wisprConnect'))
    if (!m) return
    if (m.tone === 'error') play('save-failed')
    toast({ tone: m.tone, ...(m.tone === 'info' ? { icon: 'check' as const } : {}), message: m.message })
    q.delete('wisprConnect')
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${q.size ? `?${q}` : ''}${window.location.hash}`)
  }, [toast])
  return null
}

/** Re-render every `ms` (for "2 min ago"). */
function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

const URL_HELP = 'From Wispr Flow › Settings › MCP. The same URL Claude and ChatGPT use.'

export function WisprCardView({ data, connect, fetchPast, disconnect }: WisprSource) {
  const save = useSaveAction()
  const now = useNow(30e3)
  const [url, setUrl] = useState('')
  const [urlError, setUrlError] = useState<string | null>(null)
  const [going, setGoing] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const prefill = data?.url ?? ''
  useEffect(() => {
    if (prefill) setUrl((u) => u || prefill)
  }, [prefill])

  const start = () => {
    const clean = cleanUrl(url || prefill)
    if (!clean) {
      setUrlError('Paste the https URL from Wispr Flow › Settings › MCP.')
      play('nope')
      return
    }
    setUrlError(null)
    return save(
      async () => {
        setGoing(true)
        try {
          const to = await connect(clean)
          if (to) window.location.assign(to)
          else setGoing(false)
        } catch (e) {
          setGoing(false)
          throw e
        }
      },
      { failMessage: 'Couldn’t connect Wispr Flow.' },
    )
  }
  const backfill = () => save(() => fetchPast(), { failMessage: 'Couldn’t start fetching.' })
  const drop = () =>
    save(() => disconnect(), {
      failMessage: 'Couldn’t disconnect Wispr Flow.',
      onDone: () => {
        setConfirm(false)
        play('undo', { volume: 0.6 })
      },
    })

  const head = (chip: ReactNode) => (
    <div className="set-card__head">
      <h2 id="set-wispr-title">Wispr Flow</h2>
      {chip}
    </div>
  )

  if (!data)
    return (
      <section className="set-card set-google set-wispr" aria-labelledby="set-wispr-title" aria-busy="true">
        <h2 id="set-wispr-title">Wispr Flow</h2>
        <span className="sk" style={{ display: 'block', width: '100%', height: 56, borderRadius: 14, marginTop: 20 }} />
      </section>
    )

  if (data.status === 'off')
    return (
      <section className="set-card set-google set-wispr" aria-labelledby="set-wispr-title">
        {head(
          <Chip tone="muted" dot={false}>
            Not connected
          </Chip>,
        )}
        <p className="set-card__lede">Connect Wispr Flow so notes from investor meetings come in by themselves. Nest reads them and suggests updates; nothing changes until you accept.</p>
        <form
          className="set-wispr__form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            void start()
          }}
        >
          <Input
            label="MCP URL"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://…/mcp"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value)
              if (urlError) setUrlError(null)
            }}
            error={urlError ?? undefined}
            help={URL_HELP}
          />
          <Button type="submit" variant="secondary" block className="set-google__btn set-wispr__btn" disabled={going}>
            {going ? 'Opening Wispr Flow…' : 'Connect'}
          </Button>
        </form>
        <p className="set-google__team">Read-only. You’ll sign in to Wispr Flow and approve Nest in your browser.</p>
      </section>
    )

  const reconnect = data.status === 'reconnect'
  const fetching = !reconnect && data.fetching
  return (
    <section className="set-card set-google set-wispr" aria-labelledby="set-wispr-title">
      {head(reconnect ? <Chip tone="waiting">Needs reconnecting</Chip> : fetching ? <Chip tone="live">Fetching</Chip> : <Chip tone="success">Connected</Chip>)}
      <div className={`set-google__account${reconnect ? ' set-google__account--warn' : ''}`}>
        <Icon name={reconnect ? 'alert' : 'note'} size={18} />
        <div className="set-google__who">
          <strong>{data.host ?? 'Wispr Flow'}</strong>
          <span aria-live="polite">
            {reconnect
              ? 'Wispr Flow stopped accepting Nest’s sign-in. Reconnect to pick up where it left off.'
              : fetching
                ? 'Fetching notes from the past 30 days…'
                : `${fetchedLine(data, now)} · every ${EVERY_MIN}\u00a0min`}
          </span>
        </div>
      </div>
      {!reconnect && data.lastError ? <p className="set-google__error">Last try didn’t finish: {data.lastError.replace(/\.?$/, '.')} Trying again in {EVERY_MIN} minutes.</p> : null}
      <p className="set-google__note">
        {data.reads
          ? 'After each investor meeting, Nest saves the note on the investor and reads it. What it proposes waits in Suggestions.'
          : 'After each investor meeting, Nest saves the note on the investor. “Read meeting notes” is off in Settings › AI, so nothing reads them.'}
      </p>
      {confirm ? (
        <div className="set-google__confirm" role="group" aria-label="Disconnect Wispr Flow">
          <p>Disconnect Wispr Flow? Notes already fetched stay on each investor.</p>
          <div className="set-google__actions">
            <Button variant="danger" onClick={() => void drop()}>
              Disconnect
            </Button>
            <button type="button" className="set-google__text" onClick={() => setConfirm(false)} data-autofocus>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="set-google__actions">
          {reconnect ? (
            <Button variant="primary" onClick={() => void start()} disabled={going}>
              {going ? 'Opening Wispr Flow…' : 'Reconnect'}
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => void backfill()} disabled={fetching}>
              {fetching ? 'Fetching…' : 'Fetch past 30 days'}
            </Button>
          )}
          <button type="button" className="set-google__text" onClick={() => setConfirm(true)}>
            Disconnect
          </button>
        </div>
      )}
    </section>
  )
}
