// Settings · AI (PST-274, screens/raise-ai/settings-ai.png): whether Claude is set up
// on this deployment, this month's spend, the automatic-lookup switches and the
// last few runs. "What Claude sees" sits in the side column. The key lives only in
// Convex's environment (ANTHROPIC_API_KEY); nothing here ever sees it.
import { useState } from 'react'
import { cents, type AISettings, type RecentRun } from '../../lib/enrich'
import { todayIST } from '../../lib/dates'
import { timeOf } from '../../lib/google'
import { useRaise } from '../data'
import { useUI } from '../raise-ui'
import { Chip, Icon, Toggle } from '../ui'

const plural = (n: number, one: string) => n + ' ' + one + (n === 1 ? '' : 's')

function when(at: number) {
  const day = todayIST(at)
  if (day === todayIST()) return timeOf(at)
  if (day === todayIST(Date.now() - 864e5)) return 'Yesterday'
  return new Date(day + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

function runText(r: RecentRun) {
  const who = r.investor ?? r.email ?? 'someone'
  const verb = r.status === 'running' || r.status === 'queued' ? (r.wasInvestor ? 'Enriching ' : 'Looking up ') : r.wasInvestor ? 'Enriched ' : 'Looked up '
  const tail = r.status === 'failed' ? ' · didn’t finish' : r.status === 'stopped' ? ' · stopped' : r.status === 'done' && r.facts ? ' · ' + plural(r.facts, 'fact') : ''
  return verb + who + tail + (r.cached ? ' · from a recent lookup' : '')
}

export function AICard() {
  const { ai, aiDo } = useRaise()
  const ui = useUI()
  const [saving, setSaving] = useState<keyof AISettings | null>(null)

  async function set(k: 'lookups' | 'enrichNew', on: boolean) {
    setSaving(k)
    try {
      await aiDo.setAuto({ [k]: on })
    } catch (e) {
      ui.fail(e)
    } finally {
      setSaving(null)
    }
  }

  if (!ai.loaded)
    return (
      <section className="set-card set-ai" aria-labelledby="set-ai-title" aria-busy="true">
        <h2 id="set-ai-title">Claude</h2>
        <span className="sk" style={{ display: 'block', width: '100%', height: 96, borderRadius: 14, marginTop: 20 }} />
      </section>
    )

  const off = !ai.connected
  const switches: { k: keyof AISettings; title: string; sub: string; locked?: boolean }[] = [
    { k: 'lookups', title: 'Look up new people you meet', sub: 'Shows them in Who’s this? with who they are · about 3¢ each' },
    { k: 'enrichNew', title: 'Enrich investors when you add or import them', sub: 'About 4¢ each · at most 30 automatic runs a day' },
    { k: 'meetingNotes', title: 'Read meeting notes after investor meetings', sub: 'Needs Wispr Flow or pasted notes. Coming later.', locked: true },
  ]
  return (
    <section className="set-card set-ai" aria-labelledby="set-ai-title">
      <div className="enrich-eyebrow eyebrow-mono">
        <Icon name="spark" size={16} className={'enrich-spark' + (off ? ' enrich-spark--off' : '')} />
        AI
      </div>
      <div className="set-ai__head">
        <h2 id="set-ai-title">Claude</h2>
        {off ? (
          <Chip tone="muted" dot={false}>
            Not set up
          </Chip>
        ) : (
          <Chip tone="success">Connected</Chip>
        )}
      </div>
      <p className="set-card__lede">
        {off
          ? 'AI isn’t set up here. Add ANTHROPIC_API_KEY to this Convex deployment to turn on enrichment and Who’s this? lookups.'
          : 'Nest uses your Anthropic key to look up investors and the new people you meet, with web search.'}
      </p>
      {!off ? (
        <div className="set-ai__spend">
          <div>
            <span className="set-ai__k">Used this month</span>
            <strong className="set-ai__usd num">{'$' + ai.month.usd.toFixed(2)}</strong>
          </div>
          <span className="set-ai__counts">
            {plural(ai.month.lookups, 'lookup')} · {plural(ai.month.enrichments, 'enrichment')} · {ai.capLeft} automatic left today
          </span>
        </div>
      ) : null}
      <ul className="set-ai__switches">
        {switches.map((s) => (
          <li key={s.k} className={s.locked || off ? 'is-off' : undefined}>
            <div>
              <span className="set-ai__title" id={'set-ai-' + s.k}>
                {s.title}
              </span>
              <span className="set-ai__sub">{s.sub}</span>
            </div>
            <Toggle
              aria-labelledby={'set-ai-' + s.k}
              checked={!s.locked && ai.settings[s.k]}
              disabled={off || s.locked || saving === s.k}
              onChange={(e) => s.k !== 'meetingNotes' && void set(s.k, e.target.checked)}
            />
          </li>
        ))}
      </ul>
      {ai.recent.length ? (
        <>
          <h3 className="set-sub">Recent runs</h3>
          <ul className="set-ai__runs">
            {ai.recent.map((r) => (
              <li key={r._id}>
                <span className="set-ai__when">{when(r.at)}</span>
                <span className="set-ai__what">{runText(r)}</span>
                <span className="set-ai__cost num">{cents(r.costUsd)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  )
}

/** The side card: what goes to Claude, and what never does. */
export function ClaudeSees() {
  const items = [
    'Names, firms, email addresses and domains',
    'Your notes and next steps for that investor',
    'Subjects of matched emails and meeting titles, never bodies (Nest doesn’t store them)',
    'Pages it reads on the web, with links kept as sources',
  ]
  return (
    <section className="set-card set-ai-sees" aria-labelledby="set-ai-sees-title">
      <h2 id="set-ai-sees-title">What Claude sees</h2>
      <ul className="set-ai-sees__list">
        {items.map((x) => (
          <li key={x}>
            <span className="set-ai-sees__tick" aria-hidden="true">
              <Icon name="check" size={14} strokeWidth={2.5} />
            </span>
            {x}
          </li>
        ))}
      </ul>
      <p className="set-ai-sees__note">By default, Anthropic doesn’t train on API data.</p>
    </section>
  )
}
