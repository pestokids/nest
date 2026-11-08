// Settings · Calendar and Gmail (PST-263): not connected, syncing (the first read
// of the inbox), connected, and needs reconnecting. screens/raise-settings/
// default.png, google-syncing.png and google-connected.png. Each teammate
// connects their own account; nothing here ever sees a token.
import { useEffect, useMemo, useState } from 'react'
import { todayIST } from '../../lib/dates'
import { DAY_MS, scanProgress, whoIsThis } from '../../lib/google'
import { play } from '../../lib/sound'
import { useRaise } from '../data'
import { EggCracking } from '../illustrations'
import { useSaveAction } from '../system/useSaveAction'
import { Button, Chip, Icon } from '../ui'

/** Re-render every `ms` (for "2 min ago"). */
function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

const ago = (ms: number, now: number) => {
  const min = Math.max(0, Math.round((now - ms) / 6e4))
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`
}

/** Monday of this IST week, as a timestamp (for "meetings this week"). */
function weekBounds(now: number) {
  const today = todayIST(now)
  const dow = (new Date(today + 'T00:00:00Z').getUTCDay() + 6) % 7
  const start = Date.parse(today + 'T00:00:00+05:30') - dow * DAY_MS
  return [start, start + 7 * DAY_MS] as const
}

export function GoogleCard() {
  const { google, googleDo, investors } = useRaise()
  const save = useSaveAction()
  const now = useNow(30e3)
  const [going, setGoing] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const me = google.me

  const found = useMemo(() => {
    const [from, to] = weekBounds(now)
    return {
      threads: google.threads.filter((t) => t.mine).length,
      meetings: new Set(google.meetings.filter((m) => m.mine && m.investorIds.length && m.start >= from && m.start < to).map((m) => m.eventId)).size,
      people: whoIsThis(google.meetings.filter((m) => m.mine), investors, now).length,
    }
  }, [google, investors, now])

  const connect = () =>
    save(
      async () => {
        setGoing(true)
        try {
          const url = await googleDo.connect()
          if (url) window.location.assign(url)
          else setGoing(false)
        } catch (e) {
          setGoing(false)
          throw e
        }
      },
      { failMessage: 'Couldn’t connect Google.' },
    )
  const syncNow = () => save(() => googleDo.syncNow(), { failMessage: 'Couldn’t start a sync.' })
  const disconnect = () =>
    save(() => googleDo.disconnect(), {
      failMessage: 'Couldn’t disconnect Google.',
      onDone: () => {
        setConfirm(false)
        play('undo', { volume: 0.6 })
      },
    })

  /** Why the last run stopped short (it retries on the next one). */
  const lastTry = me?.lastError ? <p className="set-google__error">Last try didn’t finish: {me.lastError.replace(/\.?$/, '.')} Trying again in 10 minutes.</p> : null

  const others = google.team.filter((t) => !t.mine && t.status !== 'reconnect').map((t) => t.name)
  const team = others.length ? <p className="set-google__team">{others.join(' and ')} {others.length === 1 ? 'is' : 'are'} connected too. Everyone sees investor meetings and threads from both.</p> : null

  if (!google.loaded)
    return (
      <section className="set-card set-google" aria-labelledby="set-google-title" aria-busy="true">
        <h2 id="set-google-title">Calendar and Gmail</h2>
        <span className="sk" style={{ display: 'block', width: '100%', height: 56, borderRadius: 14, marginTop: 20 }} />
      </section>
    )

  if (!me)
    return (
      <section className="set-card set-google" aria-labelledby="set-google-title">
        <div className="set-card__head">
          <h2 id="set-google-title">Calendar and Gmail</h2>
          <Chip tone="muted" dot={false}>
            Not connected
          </Chip>
        </div>
        <p className="set-card__lede">Connect Google so meetings and investor emails land on Today by themselves. Read-only: Nest never sends mail.</p>
        <ul className="set-google__list">
          {['Meetings today, from Calendar', 'Waiting on you, from Gmail', 'Who’s this? for new people'].map((x) => (
            <li key={x}>
              <Icon name="check" size={18} strokeWidth={2.2} />
              {x}
            </li>
          ))}
        </ul>
        <Button variant="secondary" block icon="google" className="set-google__btn" onClick={() => void connect()} disabled={going} aria-describedby="set-google-title">
          {going ? 'Opening Google…' : 'Connect Google'}
        </Button>
        {team}
      </section>
    )

  if (me.status === 'syncing') {
    const p = scanProgress(me.scan ?? { done: 0, startedAt: now }, now)
    const skipped = me.scan?.skipped ?? 0
    return (
      <section className="set-card set-google" aria-labelledby="set-google-title">
        <div className="set-card__head">
          <h2 id="set-google-title">Calendar and Gmail</h2>
          <Chip tone="live">Syncing</Chip>
        </div>
        <div className="set-google__reading">
          <EggCracking size={48} className="set-google__egg" />
          <div>
            <p className="set-google__strong">Reading your inbox for investor emails…</p>
            <p className="set-google__muted" aria-live="polite">
              {me.scan ? `${p.done} of ${p.total} emails · ${p.left}.` : 'Starting with your calendar.'}
              {skipped ? ` ${skipped} ${skipped === 1 ? 'thread' : 'threads'} skipped.` : ''} You can leave this page.
            </p>
          </div>
        </div>
        <div className="set-google__track" role="progressbar" aria-label="Reading your inbox" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p.pct * 100)}>
          <div className="set-google__fill" style={{ width: `${Math.max(4, p.pct * 100)}%` }} />
        </div>
        {lastTry}
        <p className="set-google__found eyebrow-mono">Found so far</p>
        <ul className="set-google__counts">
          <li>
            <strong className="num">{found.threads}</strong> threads matched to investors
          </li>
          <li>
            <strong className="num">{found.meetings}</strong> meetings this week
          </li>
          <li>
            <strong className="num">{found.people}</strong> new {found.people === 1 ? 'person' : 'people'} to check
          </li>
        </ul>
      </section>
    )
  }

  const reconnect = me.status === 'reconnect'
  return (
    <section className="set-card set-google" aria-labelledby="set-google-title">
      <div className="set-card__head">
        <h2 id="set-google-title">Calendar and Gmail</h2>
        {reconnect ? <Chip tone="waiting">Needs reconnecting</Chip> : <Chip tone="success">Connected</Chip>}
      </div>
      <div className={`set-google__account${reconnect ? ' set-google__account--warn' : ''}`}>
        <Icon name="google" size={18} />
        <div className="set-google__who">
          <strong>{me.email}</strong>
          <span aria-live="polite">
            {reconnect
              ? 'Google stopped letting Nest read this account. Reconnect to pick up where it left off.'
              : me.running
                ? 'Syncing now…'
                : `Last sync ${me.lastSyncAt ? ago(me.lastSyncAt, now) : 'not yet'} · every 10 min`}
          </span>
        </div>
      </div>
      {!reconnect ? lastTry : null}
      <p className="set-google__note">Read-only. Nest keeps meeting titles, subjects, dates and addresses, never email bodies. Jev reads each new email from an investor once, for signals.</p>
      {confirm ? (
        <div className="set-google__confirm" role="group" aria-label="Disconnect Google">
          <p>Disconnect and delete the meetings and emails synced from {me.email}? Stage moves already made stay.</p>
          <div className="set-google__actions">
            <Button variant="danger" onClick={() => void disconnect()}>
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
            <Button variant="primary" icon="google" onClick={() => void connect()} disabled={going}>
              {going ? 'Opening Google…' : 'Reconnect Google'}
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => void syncNow()} disabled={me.running}>
              Sync now
            </Button>
          )}
          <button type="button" className="set-google__text" onClick={() => setConfirm(true)}>
            Disconnect
          </button>
        </div>
      )}
      {team}
    </section>
  )
}

/** What `?connect=<result>` (the OAuth callback's redirect) means, as a toast. */
export function connectMessage(r: string | null): { tone: 'info' | 'error'; message: string } | null {
  switch (r) {
    case 'ok':
      return { tone: 'info', message: 'Google connected. Reading the last 30 days now.' }
    case 'denied':
      return { tone: 'error', message: 'Google wasn’t connected: access wasn’t allowed.' }
    case 'expired':
      return { tone: 'error', message: 'That took too long. Try Connect Google again.' }
    case 'nokey':
      return { tone: 'error', message: 'Google can’t be connected yet: the server is missing GOOGLE_TOKEN_KEY. Nothing was stored.' }
    case 'scopes':
      return { tone: 'error', message: 'Tick both Calendar and Gmail on Google’s screen, then try again.' }
    case 'account':
      return { tone: 'error', message: 'Connect the Google account you sign in to Nest with.' }
    case 'error':
      return { tone: 'error', message: 'Couldn’t connect Google. Try again.' }
    default:
      return null
  }
}
