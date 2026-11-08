// Settings · AI (PST-274, screens/raise-ai/settings-ai.png): whether Claude is set up
// on this deployment, this month's spend, the automatic-lookup switches and the
// last few runs. "What Claude sees" sits in the side column. The key lives only in
// Convex's environment (ANTHROPIC_API_KEY); nothing here ever sees it.
// PST-273: the Model section (a default model and each feature's own, with what a
// run and a month at Dev's pace would cost) and this month's spend by model and feature.
// PST-292: the Jev row (TypeSafe's yes/no model): on/off, this month's spend of its cap, the
// cap itself and what it does. Jev shows in the spend view as its own model.
import { useState } from 'react'
import { JEV_MAX_CAP } from '../../lib/jev'
import { cents, type AIData, type AISettings, type RecentRun } from '../../lib/enrich'
import { formatDay, todayIST } from '../../lib/dates'
import { timeOf } from '../../lib/google'
import { exactMoney } from '../../lib/money'
import { estimate, FEATURE_LABEL, FEATURES, MODEL_INFO, modelFor, modelName, MODELS, monthPace, PRICES, type Feature, type Model } from '../../lib/models'
import { useRaise } from '../data'
import { useUI } from '../raise-ui'
import { Chip, Icon, Select, Toggle } from '../ui'

const plural = (n: number, one: string) => n + ' ' + one + (n === 1 ? '' : 's')
/** "≈ 4¢", or "<0.1¢" as it is. */
const approx = (usd: number) => (cents(usd).startsWith('<') ? cents(usd) : '≈ ' + cents(usd))
const perMTok = (usd: number) => exactMoney(usd, !Number.isInteger(usd))

/** What one run of a feature costs on its model now, from its real runs once it has enough. */
const runCost = (ai: AIData, f: Feature) => estimate(f, modelFor(ai.models, f), ai.features[f].real)

function when(at: number) {
  const day = todayIST(at)
  if (day === todayIST()) return timeOf(at)
  if (day === todayIST(Date.now() - 864e5)) return 'Yesterday'
  return formatDay(day)
}

function runText(r: RecentRun) {
  // PST-279: Ask Nest questions (only yours show their words) and morning briefs.
  if (r.kind === 'ask') {
    const q = r.question ? (r.question.length > 48 ? `Asked “${r.question.slice(0, 47)}…”` : `Asked “${r.question}”`) : 'Asked Nest a question'
    return q + (r.status === 'failed' ? ' · didn’t finish' : r.tools ? ' · ' + plural(r.tools, 'lookup') : '')
  }
  if (r.kind === 'brief') return 'Morning brief · ' + plural(r.moves ?? 0, 'move')
  const who = r.investor ?? r.email ?? 'someone'
  const verb = r.status === 'running' || r.status === 'queued' ? (r.wasInvestor ? 'Enriching ' : 'Looking up ') : r.wasInvestor ? 'Enriched ' : 'Looked up '
  const tail = r.status === 'failed' ? ' · didn’t finish' : r.status === 'stopped' ? ' · stopped' : r.status === 'done' && r.facts ? ' · ' + plural(r.facts, 'fact') : ''
  return verb + who + tail + (r.cached ? ' · from a recent lookup' : '')
}

export function AICard() {
  const { ai, aiDo } = useRaise()
  const ui = useUI()
  const [saving, setSaving] = useState<keyof AISettings | Feature | 'model' | null>(null)

  async function set(k: keyof AISettings, on: boolean) {
    setSaving(k)
    try {
      await aiDo.setAuto({ [k]: on })
    } catch (e) {
      ui.fail(e)
    } finally {
      setSaving(null)
    }
  }

  async function pick(feature: Feature | null, model: Model | null) {
    setSaving(feature ?? 'model')
    try {
      await aiDo.setModel(feature, model)
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
  const switches: { k: keyof AISettings; title: string; sub: string }[] = [
    { k: 'lookups', title: 'Look up new people you meet', sub: 'Shows them in Who’s this? with who they are · ' + approx(runCost(ai, 'enrich').usd) + ' each' },
    { k: 'enrichNew', title: 'Enrich investors when you add or import them', sub: approx(runCost(ai, 'enrich').usd) + ' each · at most 30 automatic runs a day' },
    { k: 'meetingNotes', title: 'Read meeting notes after investor meetings', sub: 'Pasted or from Wispr Flow: a summary and updates to apply · ' + approx(runCost(ai, 'notes').usd) + ' a note' },
    { k: 'morningBrief', title: 'Morning brief at 08:00', sub: 'Since yesterday and today’s three moves, on Today · ' + approx(runCost(ai, 'brief').usd) + ' a day' },
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
          ? 'AI isn’t set up here. Add ANTHROPIC_API_KEY to this Convex deployment to turn on enrichment, Who’s this? lookups, reading meeting notes and Ask Nest. The morning brief still comes, with Today’s own reasons.'
          : 'Nest uses your Anthropic key to look up investors and the new people you meet, with web search, to read your meeting notes, for Ask Nest and for the morning brief.'}
      </p>
      {!off ? (
        <div className="set-ai__spend">
          <div>
            <span className="set-ai__k">Used this month</span>
            <strong className="set-ai__usd num">{exactMoney(ai.month.usd, true)}</strong>
          </div>
          <span className="set-ai__counts">
            {plural(ai.month.lookups, 'lookup')} · {plural(ai.month.enrichments, 'enrichment')}
            {ai.month.noteReads ? ' · ' + plural(ai.month.noteReads, 'note') + ' read' : ''}
            {ai.month.asks ? ' · ' + plural(ai.month.asks, 'question') : ''}
            {ai.jev.calls ? ' · ' + plural(ai.jev.calls, 'Jev check') : ''} · {ai.capLeft} automatic left today
          </span>
          {ai.month.usd > 0 ? <SpendSplit ai={ai} /> : null}
        </div>
      ) : null}
      <ul className="set-ai__switches">
        {switches.map((s) => (
          <li key={s.k} className={off && s.k !== 'morningBrief' ? 'is-off' : undefined}>
            <div>
              <span className="set-ai__title" id={'set-ai-' + s.k}>
                {s.title}
              </span>
              <span className="set-ai__sub">{s.sub}</span>
            </div>
            <Toggle
              aria-labelledby={'set-ai-' + s.k}
              checked={ai.settings[s.k]}
              disabled={(off && s.k !== 'morningBrief') || saving === s.k}
              onChange={(e) => void set(s.k, e.target.checked)}
            />
          </li>
        ))}
      </ul>
      <JevSection ai={ai} />
      <ModelSection ai={ai} off={off} saving={saving} onPick={pick} />
      {ai.recent.length ? (
        <>
          <h3 className="set-sub">Recent runs</h3>
          <ul className="set-ai__runs">
            {ai.recent.map((r) => (
              <li key={r._id}>
                <span className="set-ai__when">{when(r.at)}</span>
                <span className="set-ai__what">{runText(r)}</span>
                <span className="set-ai__cost num">
                  {r.model ? (
                    <Chip tone="outline" dot={false} className="chip--sm">
                      {modelName(r.model)}
                    </Chip>
                  ) : null}
                  <span className="set-ai__cost-n">{cents(r.costUsd)}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  )
}

/**
 * PST-292: Jev, for quick yes/no checks: on/off, this month's spend of the cap, and the
 * cap (Jev stops for the month when it's reached; everything works as before without it).
 */
function JevSection({ ai }: { ai: AIData }) {
  const { aiDo } = useRaise()
  const ui = useUI()
  const j = ai.jev
  const off = !j.connected
  const [text, setText] = useState(j.capUsd.toFixed(2))
  const [busy, setBusy] = useState<'on' | 'cap' | null>(null)
  const cap = Number(text.replace(/^\s*\$/, '').trim())
  const bad = !text.trim() || !Number.isFinite(cap) || cap < 0 || cap > JEV_MAX_CAP

  async function save(k: 'on' | 'cap', patch: { on?: boolean; capUsd?: number }) {
    setBusy(k)
    try {
      await aiDo.setJev(patch)
    } catch (e) {
      ui.fail(e)
    } finally {
      setBusy(null)
    }
  }
  const saveCap = () => {
    if (bad) return setText(j.capUsd.toFixed(2))
    setText(cap.toFixed(2))
    if (Math.round(cap * 100) !== Math.round(j.capUsd * 100)) void save('cap', { capUsd: cap })
  }

  return (
    <>
      <h3 className="set-sub" id="set-ai-jev">
        Jev
      </h3>
      <ul className="set-ai__switches set-ai__jev" aria-labelledby="set-ai-jev">
        <li className={off ? 'is-off' : undefined}>
          <div>
            <span className="set-ai__title" id="set-ai-jev-on">
              Quick yes/no checks with Jev
            </span>
            <span className="set-ai__sub">Asks whether a new person is likely an investor before a lookup, whose notes are whose, and spots duplicate firms and repeat questions.</span>
            <span className="set-ai__sub set-ai__jev-month">
              {off ? 'Not set up: add TYPESAFE_API_KEY to this Convex deployment.' : 'This month ' + exactMoney(j.monthUsd, true) + ' of ' + exactMoney(j.capUsd, true) + (j.monthUsd >= j.capUsd ? ' · paused until next month' : '')}
            </span>
          </div>
          <Toggle aria-labelledby="set-ai-jev-on" checked={!off && j.on} disabled={off || busy === 'on'} onChange={(e) => void save('on', { on: e.target.checked })} />
        </li>
        <li className={off ? 'is-off' : undefined}>
          <div>
            <span className="set-ai__title" id="set-ai-jev-cap">
              Monthly cap
            </span>
            <span className="set-ai__sub">{bad ? 'Between $0 and $' + JEV_MAX_CAP + '.' : 'Jev stops for the month when its checks reach this.'}</span>
          </div>
          <span className="input set-ai__cap">
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              aria-labelledby="set-ai-jev-cap"
              aria-invalid={bad || undefined}
              value={text}
              disabled={off || busy === 'cap'}
              onChange={(e) => setText(e.target.value)}
              onBlur={saveCap}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
          </span>
        </li>
      </ul>
    </>
  )
}

/** IST: today's date in the month, and the month's length (for "a month at your pace"). */
function monthDays() {
  const [y, m, d] = todayIST().split('-').map(Number)
  return { day: d, days: new Date(Date.UTC(y, m, 0)).getUTCDate() }
}

/** The default model as three cards, then each feature with its own picker and what it costs. */
function ModelSection({ ai, off, saving, onPick }: { ai: AIData; off: boolean; saving: string | null; onPick: (f: Feature | null, m: Model | null) => void }) {
  const { day, days } = monthDays()
  return (
    <>
      <h3 className="set-sub" id="set-ai-model">
        Model
      </h3>
      <div className="set-ai__models" role="radiogroup" aria-labelledby="set-ai-model">
        {MODELS.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={ai.models.default === m}
            className="set-ai__model"
            disabled={off || saving === 'model'}
            onClick={() => ai.models.default !== m && onPick(null, m)}
          >
            <span className="set-ai__model-name">
              {MODEL_INFO[m].name}
              {ai.models.default === m ? <Icon name="check" size={16} strokeWidth={2.5} className="set-ai__model-check" /> : null}
            </span>
            <span className="set-ai__model-price num">
              {perMTok(PRICES[m].input)} in · {perMTok(PRICES[m].output)} out
            </span>
            <span className="set-ai__model-unit">per million tokens</span>
            <span className="set-ai__model-good">{MODEL_INFO[m].goodFor}</span>
          </button>
        ))}
      </div>
      <ul className="set-ai__switches set-ai__features">
        {FEATURES.map((f) => {
          const own = ai.models.features[f]
          const e = runCost(ai, f)
          const { month, real } = ai.features[f]
          return (
            <li key={f} className={off ? 'is-off' : undefined}>
              <div>
                <span className="set-ai__title" id={'set-ai-model-' + f}>
                  {FEATURE_LABEL[f]}
                </span>
                <span className="set-ai__sub">
                  {approx(e.usd)} a run{e.real && real ? ', from your last ' + plural(real.runs, 'run') : ', typical'} ·{' '}
                  {month ? approx(monthPace(month, day, days) * e.usd) + ' a month at your pace' : 'not used yet this month'}
                </span>
              </div>
              <Select
                className="set-ai__pick"
                aria-labelledby={'set-ai-model-' + f}
                value={own ?? 'default'}
                disabled={off || saving === f}
                onChange={(ev) => onPick(f, ev.target.value === 'default' ? null : (ev.target.value as Model))}
              >
                <option value="default">Default · {MODEL_INFO[ai.models.default].name}</option>
                {MODELS.map((m) => (
                  <option key={m} value={m}>
                    {MODEL_INFO[m].name}
                  </option>
                ))}
              </Select>
            </li>
          )
        })}
      </ul>
    </>
  )
}

/** This month's spend as two stacked bars, by model and by feature, each with its legend. */
function SpendSplit({ ai }: { ai: AIData }) {
  const total = ai.month.usd
  const bar = (title: string, parts: { key: string; label: string; usd: number }[]) => {
    const shown = parts.filter((p) => p.usd > 0)
    return (
      <div className="set-ai__split">
        <span className="set-ai__k">{title}</span>
        <div className="set-ai__bar" role="img" aria-label={title + ': ' + shown.map((p) => p.label + ' ' + cents(p.usd)).join(', ')}>
          {shown.map((p) => (
            <span key={p.key} className={'set-ai__seg set-ai__seg--' + p.key} style={{ width: (p.usd / total) * 100 + '%' }} />
          ))}
        </div>
        <ul className="set-ai__legend" aria-hidden="true">
          {shown.map((p) => (
            <li key={p.key}>
              <span className={'set-ai__swatch set-ai__seg--' + p.key} />
              {p.label} <span className="num">{cents(p.usd)}</span>
            </li>
          ))}
        </ul>
      </div>
    )
  }
  return (
    <div className="set-ai__splits">
      {bar('By model', [...MODELS.map((m) => ({ key: MODEL_INFO[m].name.toLowerCase(), label: MODEL_INFO[m].name, usd: ai.spend.byModel[m] })), { key: 'jev', label: 'Jev', usd: ai.jev.monthUsd }])}
      {bar('By feature', [...FEATURES.map((f) => ({ key: f, label: FEATURE_LABEL[f], usd: ai.spend.byFeature[f] })), { key: 'jev', label: 'Jev checks', usd: ai.jev.monthUsd }])}
    </div>
  )
}

/** The side card: what goes to Claude, and what never does. */
export function ClaudeSees() {
  const items = [
    'Names, firms, email addresses and domains',
    'Your notes and next steps for that investor',
    'Subjects of matched emails and meeting titles, never bodies (Nest doesn’t store them)',
    'Meeting notes you paste or send in, and the questions in your Q&A bank',
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
