// PST-307: the Advisor's interactive answer blocks (round6/advisor-interactive-blocks.png).
// Each block draws from the BlockEnv its answer gives it, so a test can render
// them with a made-up one (Blocks.test.ts). Nothing here changes Nest by itself:
// a tick sets a next step through the investor's normal save (with Undo), a pick
// is sent back as the next message, and the rest open, draft or suggest.
import { createContext, useContext, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { BLANK, sourceChips, SOURCE_ROUTE, type Source } from '../../lib/advisor'
import { CHANGE_LABEL, moveBeat, type Block } from '../../lib/advisorBlocks'
import { dayDiff, formatDay, weekdayOf } from '../../lib/dates'
import type { Investor } from '../../lib/pipeline'
import { IDX, LABEL, PIPELINE_KEYS, STAGES, type Stage } from '../../lib/stages'
import { Menu } from '../system/Menu'
import { Avatar, Button, Chip, Icon } from '../ui'

type Of<K extends Block['kind']> = Extract<Block, { kind: K }>

/** What a message's blocks can read and do. Every action is bound to that message. */
export type BlockEnv = {
  today: string
  /** False while the answer streams: buttons wait for it. */
  done: boolean
  investor: (id: string | undefined) => Investor | undefined
  openInvestor: (i: Investor) => void
  /** Open an email draft in Drafts (it was saved there as a draft; nothing is sent). */
  openDraft: (b: Of<'draft'>) => void
  /** Open the prep brief for this investor's next meeting, when there is one. */
  prep: ((i: Investor) => void) | null
  hasMeeting: (i: Investor) => boolean
  /** Send a question into this chat (a follow-up, or the option picked). */
  ask: (text: string) => void
  /** Keep an edit to a block (a reorder, a beat, a draft's text). */
  update: (index: number, b: Block) => void
  /** Tick or untick plan steps: a ticked step becomes its investor's next step (Undo puts the old one back). */
  tick: (index: number, b: Of<'plan'>, items: number[], on: boolean) => void
  pick: (index: number, b: Of<'options'>, option: number) => void
  suggestMove: (index: number, i: Investor, stage: Stage) => void
  tryAnother: (index: number, beat: number) => Promise<unknown>
  useInStory: (index: number, b: Of<'blank'>, value: string) => void
  blankToPlan: (index: number, value: string) => void
  saveToQanda: (index: number) => void
  /** Keep an edit to a draft's text (an email's also goes to its row in Drafts). */
  editDraft: (index: number, b: Of<'draft'>, body: string) => void
  sendSuggestion: (index: number) => void
  answerMemory: (index: number, yes: boolean, fact: string) => void
  openSource: (s: Source) => void
  copy: (text: string) => void
  /** The ⌘J panel: smaller cards. */
  compact?: boolean
}

export const BlockEnvContext = createContext<BlockEnv | null>(null)
const useEnv = () => {
  const e = useContext(BlockEnvContext)
  if (!e) throw new Error('A block outside its answer')
  return e
}

const first = (name: string) => name.trim().split(/\s+/)[0] || name
const letter = (n: number) => String.fromCharCode(65 + n)

/** "Today", "Tomorrow", "Thu", or "Mon 23 Nov" further out. */
export function dayLabel(day: string, today: string): string {
  const n = dayDiff(day, today)
  if (n === 0) return 'Today'
  if (n === 1) return 'Tomorrow'
  if (n > 1 && n < 7) return weekdayOf(day)
  return formatDay(day)
}

/** A line with its [__] blanks drawn as blanks. */
function Blanks({ text }: { text: string }) {
  const parts = text.split(BLANK)
  return (
    <>
      {parts.map((p, k) => (
        <span key={k}>
          {p}
          {k < parts.length - 1 ? <span className="adv-blank-mark" aria-label="a number Nest doesn’t have">[__]</span> : null}
        </span>
      ))}
    </>
  )
}

export function BlockView({ block, index }: { block: Block; index: number }): ReactNode {
  switch (block.kind) {
    case 'investor_card':
      return <InvestorCard b={block} index={index} />
    case 'plan':
      return <Plan b={block} index={index} />
    case 'options':
      return <Options b={block} index={index} />
    case 'race':
      return <Race b={block} />
    case 'story':
      return <Story b={block} index={index} />
    case 'blank':
      return <BlankForm b={block} index={index} />
    case 'draft':
      return <Draft b={block} index={index} />
    case 'follow_ups':
      return <FollowUps b={block} />
    case 'suggestion':
      return <SuggestionCard b={block} index={index} />
    case 'memory':
      return <Memory b={block} index={index} />
  }
}

function InvestorCard({ b, index }: { b: Of<'investor_card'>; index: number }) {
  const env = useEnv()
  const i = env.investor(b.investorId)
  if (!i) return null
  const at = IDX[i.stage]
  const ahead = at !== undefined ? PIPELINE_KEYS.slice(at + 1) : []
  return (
    <div className="adv-block adv-card">
      <Avatar name={i.name} size={44} />
      <div className="adv-card__main">
        <div className="adv-card__name">{i.name}</div>
        <div className="adv-card__meta">{b.note ?? [i.type, i.lead ? 'can lead' : null].filter(Boolean).join(' · ')}</div>
        <div className="adv-actions">
          <Button size="sm" onClick={() => env.openInvestor(i)}>
            Open
          </Button>
          {ahead.length ? <MoveTo index={index} i={i} stages={ahead} /> : null}
          {env.prep && env.hasMeeting(i) ? (
            <Button size="sm" onClick={() => env.prep?.(i)}>
              Prep brief
            </Button>
          ) : null}
        </div>
      </div>
      <div className="adv-card__chips">
        <Chip tone="success" dot={false}>
          {LABEL[i.stage]}
        </Chip>
      </div>
    </div>
  )
}

/** "Move to ▾": the stages ahead, each sent to Suggestions for Dev's OK (nothing moves here). */
function MoveTo({ index, i, stages }: { index: number; i: Investor; stages: Stage[] }) {
  const env = useEnv()
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  return (
    <>
      <Button ref={btn} size="sm" disabled={!env.done} aria-haspopup="menu" aria-expanded={open} title="Sends the move to Suggestions for your OK" onClick={() => setOpen(true)}>
        Move to {LABEL[stages[0]]} <Icon name="chevron-down" size={14} />
      </Button>
      {open ? (
        <Menu
          anchor={btn.current}
          title={'Suggest a move for ' + i.name}
          align="start"
          onClose={() => setOpen(false)}
          items={[...stages, 'passed' as const].map((s) => ({ label: LABEL[s], onSelect: () => env.suggestMove(index, i, s) }))}
        />
      ) : null}
    </>
  )
}

function Plan({ b, index }: { b: Of<'plan'>; index: number }) {
  const env = useEnv()
  const open = b.items.map((_, k) => k).filter((k) => !b.ticked.includes(k))
  return (
    <div className="adv-block adv-plan">
      {b.title ? <div className="adv-eyebrow">{b.title}</div> : null}
      <ul className="adv-plan__items">
        {b.items.map((it, k) => {
          const on = b.ticked.includes(k)
          return (
            <li key={k} className={on ? 'is-done' : undefined}>
              <label className="adv-plan__row">
                <input type="checkbox" className="adv-check" checked={on} disabled={!env.done} onChange={(e) => env.tick(index, b, [k], e.target.checked)} />
                <span className="adv-plan__text">{it.text}</span>
                <span className="adv-plan__day">{dayLabel(it.date, env.today)}</span>
              </label>
            </li>
          )
        })}
      </ul>
      <div className="adv-plan__foot">
        <span>Ticked ones become next steps in Today</span>
        {open.length > 1 ? (
          <button type="button" className="adv-link" disabled={!env.done} onClick={() => env.tick(index, b, open, true)}>
            Add all to Today
          </button>
        ) : null}
      </div>
    </div>
  )
}

function Options({ b, index }: { b: Of<'options'>; index: number }) {
  const env = useEnv()
  return (
    <div className="adv-block-wrap">
      {b.question ? <div className="adv-eyebrow">{b.question}</div> : null}
      <div className="adv-options">
        {b.options.map((o, k) => {
          const picked = b.picked === k
          return (
            <div key={k} className={'adv-option' + (picked ? ' is-picked' : b.picked !== undefined ? ' is-other' : '')}>
              <div className="adv-option__label">
                {letter(k)} · {o.label}
              </div>
              <p className="adv-option__up">{o.upside}</p>
              <p className="adv-option__risk">Risk: {o.risk}</p>
              {picked ? (
                <span className="adv-option__going">Going with {letter(k)}</span>
              ) : (
                <Button size="sm" disabled={!env.done || b.picked !== undefined} onClick={() => env.pick(index, b, k)}>
                  Choose {letter(k)}
                </Button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Race({ b }: { b: Of<'race'> }) {
  const env = useEnv()
  const rows = b.investorIds.flatMap((id) => {
    const i = env.investor(id)
    return i ? [i] : []
  })
  const pct = (s: Stage) => Math.round((((IDX[s] ?? 0) + 1) / STAGES.length) * 100)
  const top = Math.max(0, ...rows.map((i) => pct(i.stage)))
  const ahead = rows.filter((i) => pct(i.stage) === top).length === 1
  return (
    <div className="adv-block adv-race">
      {rows.length ? (
        <ul className="adv-race__rows">
          {rows.map((i) => (
            <li key={i._id}>
              <button type="button" className="adv-race__name" onClick={() => env.openInvestor(i)}>
                {i.name}
              </button>
              <span className="adv-race__track" role="img" aria-label={i.name + ': ' + LABEL[i.stage]}>
                <span className={'adv-race__bar' + (ahead && pct(i.stage) === top ? ' is-ahead' : '')} style={{ width: pct(i.stage) + '%' }} />
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <a className="adv-link" href="/raise/pipeline?view=race" onClick={(e) => {
          e.preventDefault()
          env.openSource({ kind: 'race', label: 'Race' })
        }}>
        {b.note ? b.note + ' · ' : ''}Open the race <Icon name="arrow-right" size={14} />
      </a>
    </div>
  )
}

function Story({ b, index }: { b: Of<'story'>; index: number }) {
  const env = useEnv()
  const [editing, setEditing] = useState<number | null>(null)
  const [text, setText] = useState('')
  const [drag, setDrag] = useState<number | null>(null)
  const [trying, setTrying] = useState<number | null>(null)
  const save = (k: number) => {
    const t = text.trim()
    setEditing(null)
    if (t && t !== b.beats[k].text) env.update(index, { ...b, beats: b.beats.map((x, n) => (n === k ? { ...x, text: t.slice(0, 300) } : x)) })
  }
  const move = (from: number, to: number) => env.update(index, { ...b, beats: moveBeat(b.beats, from, to) })
  const drop = (e: DragEvent, to: number) => {
    e.preventDefault()
    if (drag !== null && drag !== to) move(drag, to)
    setDrag(null)
  }
  return (
    <div className="adv-block adv-story">
      <ol className="adv-story__beats">
        {b.beats.map((x, k) => (
          <li
            key={x.label + k}
            className={'adv-beat' + (drag === k ? ' is-dragging' : '')}
            draggable={env.done && editing === null && !env.compact}
            onDragStart={() => setDrag(k)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => drop(e, k)}
            onDragEnd={() => setDrag(null)}
          >
            {env.compact ? null : (
              <span
                className="adv-beat__grip"
                role="button"
                tabIndex={env.done ? 0 : -1}
                aria-label={'Move ' + x.label + ' (arrow keys)'}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowUp' && k > 0) {
                    e.preventDefault()
                    move(k, k - 1)
                  }
                  if (e.key === 'ArrowDown' && k < b.beats.length - 1) {
                    e.preventDefault()
                    move(k, k + 1)
                  }
                }}
              >
                <Icon name="drag" size={14} />
              </span>
            )}
            <span className="adv-beat__label">{x.label}</span>
            {editing === k ? (
              <input
                className="adv-beat__input"
                autoFocus
                value={text}
                maxLength={300}
                aria-label={x.label}
                onChange={(e) => setText(e.target.value)}
                onBlur={() => save(k)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') save(k)
                  if (e.key === 'Escape') {
                  e.stopPropagation()
                  setEditing(null)
                }
                }}
              />
            ) : (
              <button
                type="button"
                className="adv-beat__text"
                disabled={!env.done}
                onClick={() => {
                  setText(x.text)
                  setEditing(k)
                }}
              >
                <Blanks text={x.text} />
              </button>
            )}
            {env.compact ? null : (
              <Button
                size="sm"
                className="adv-beat__again"
                disabled={!env.done || trying !== null}
                onClick={() => {
                  setTrying(k)
                  void env.tryAnother(index, k).finally(() => setTrying(null))
                }}
              >
                {trying === k ? 'Writing…' : 'Try another'}
              </Button>
            )}
          </li>
        ))}
      </ol>
      {env.compact ? null : <p className="adv-story__hint">Drag to reorder · click a line to edit · blanks [__] ask you for the number</p>}
    </div>
  )
}

function BlankForm({ b, index }: { b: Of<'blank'>; index: number }) {
  const env = useEnv()
  const [value, setValue] = useState(b.value ?? '')
  const id = 'adv-blank-' + index
  return (
    <div className="adv-block adv-blankform">
      <label className="adv-blankform__label" htmlFor={id}>
        {b.label}
      </label>
      {b.why ? <p className="adv-blankform__why">{b.why}</p> : null}
      <div className="adv-blankform__row">
        <span className="adv-blankform__field">
          <input id={id} className="adv-blankform__input" value={value} maxLength={40} inputMode="decimal" disabled={!env.done} onChange={(e) => setValue(e.target.value)} />
          {b.unit ? <span className="adv-blankform__unit">{b.unit}</span> : null}
        </span>
        <Button size="sm" variant="dark" disabled={!env.done || !value.trim()} onClick={() => env.useInStory(index, b, value)}>
          {b.saved === 'story' ? 'In the story' : 'Use in this story'}
        </Button>
        <Button size="sm" disabled={!env.done || !value.trim() || b.saved === 'plan'} onClick={() => env.blankToPlan(index, value)}>
          {b.saved === 'plan' ? 'Sent to Suggestions' : 'Save to Plan'}
        </Button>
      </div>
    </div>
  )
}

/** The draft's text, edited in place (click it). */
function DraftBody({ b, index }: { b: Of<'draft'>; index: number }) {
  const env = useEnv()
  const [text, setText] = useState<string | null>(null)
  if (text !== null)
    return (
      <div className="adv-draft__edit">
        <textarea className="adv-draft__area" value={text} maxLength={6000} aria-label={'Edit “' + b.title + '”'} autoFocus onChange={(e) => setText(e.target.value)} />
        <div className="adv-actions">
          <Button size="sm" variant="ghost" onClick={() => setText(null)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="dark"
            disabled={!text.trim()}
            onClick={() => {
              if (text.trim() !== b.body) env.editDraft(index, b, text.trim())
              setText(null)
            }}
          >
            Keep
          </Button>
        </div>
      </div>
    )
  return (
    <button type="button" className="adv-draft__body" disabled={!env.done || !!b.questionId} title="Click to edit" onClick={() => setText(b.body)}>
      <Blanks text={b.body} />
    </button>
  )
}

function Draft({ b, index }: { b: Of<'draft'>; index: number }) {
  const env = useEnv()
  const i = env.investor(b.investorId)
  if (b.draftKind === 'email')
    return (
      <div className="adv-block adv-draft">
        <div className="adv-draft__main">
          <div className="adv-eyebrow">Draft</div>
          <div className="adv-draft__title">{b.title}</div>
          <p className="adv-draft__sub">{b.subject ? b.subject + ' · ' : ''}Opens in Drafts; nothing is sent.</p>
          {env.compact ? null : <DraftBody b={b} index={index} />}
        </div>
        <div className="adv-actions">
          {env.compact ? null : (
            <Button size="sm" variant="ghost" onClick={() => env.copy(b.body)}>
              Copy
            </Button>
          )}
          <Button variant="secondary" disabled={!env.done} onClick={() => env.openDraft(b)}>
            {env.compact ? 'Open' : 'Open draft'}
          </Button>
        </div>
      </div>
    )
  const saved = !!b.questionId
  return (
    <div className="adv-block adv-draft">
      <div className="adv-draft__main">
        <div className="adv-eyebrow">Draft</div>
        <div className="adv-draft__title">{saved ? 'Saved as “' + b.title + '” in Q&A' : 'Save as “' + b.title + '” in Q&A'}</div>
        <p className="adv-draft__sub">{b.question ? 'Answers “' + b.question + '”. ' : ''}Kept with your answers{i ? ', so prep for ' + first(i.name) + ' uses it' : ''}.</p>
        {env.compact ? null : <DraftBody b={b} index={index} />}
      </div>
      <div className="adv-actions">
        <Button size="sm" variant="ghost" onClick={() => env.copy(b.body)}>
          Copy
        </Button>
        <Button variant="secondary" disabled={!env.done || saved} onClick={() => env.saveToQanda(index)}>
          {saved ? 'Saved' : 'Save'}
        </Button>
      </div>
    </div>
  )
}

function FollowUps({ b }: { b: Of<'follow_ups'> }) {
  const env = useEnv()
  return (
    <div className="adv-follow" role="group" aria-label="Ask next">
      {b.questions.map((q) => (
        <button key={q} type="button" className="adv-follow__chip" disabled={!env.done} onClick={() => env.ask(q)}>
          {q}
        </button>
      ))}
    </div>
  )
}

/** "Set Juniper’s decide-by to Fri 20 Nov". */
export function suggestionTitle(b: Of<'suggestion'>, name: string): string {
  const who = first(name) + '’s'
  if (b.change === 'decide_by') return 'Set ' + who + ' decide-by to ' + formatDay(b.date)
  if (b.change === 'stage') {
    const k = b.value?.toLowerCase() as Stage | undefined
    return 'Move ' + first(name) + ' to ' + (k && LABEL[k] ? LABEL[k] : b.value)
  }
  if (b.change === 'next_step') return 'Set ' + who + ' next step: ' + b.value + (b.date ? ' (' + formatDay(b.date) + ')' : '')
  return 'Set ' + who + ' ' + CHANGE_LABEL[b.change] + ' to ' + (b.value ?? '').replace(/_/g, ' ')
}

function SuggestionCard({ b, index }: { b: Of<'suggestion'>; index: number }) {
  const env = useEnv()
  const i = env.investor(b.investorId)
  return (
    <div className="adv-block adv-suggest">
      <div className="adv-draft__main">
        <div className="adv-eyebrow adv-eyebrow--orange">Suggestion</div>
        <div className="adv-draft__title">{suggestionTitle(b, i?.name ?? 'This investor')}</div>
        <p className="adv-draft__sub">
          {b.state === 'proposed' ? b.why + ' Goes to Suggestions for your OK. Nest won’t change anything on its own.' : b.state === 'sent' ? 'In Suggestions, waiting for your OK.' : b.note || 'Not added.'}
        </p>
      </div>
      {b.state === 'proposed' ? (
        <Button variant="secondary" disabled={!env.done} onClick={() => env.sendSuggestion(index)}>
          Send to Suggestions
        </Button>
      ) : b.state === 'sent' ? (
        <Chip tone="success">Sent</Chip>
      ) : null}
    </div>
  )
}

function Memory({ b, index }: { b: Of<'memory'>; index: number }) {
  const env = useEnv()
  const [fact, setFact] = useState(b.fact)
  if (b.state === 'dismissed') return <p className="adv-memory__gone">Not remembered.</p>
  if (b.state === 'saved')
    return (
      <div className="adv-block adv-memory is-saved">
        <Icon name="check" size={16} />
        <span>
          Remembered: “{b.fact}” <span className="adv-memory__where">Edit or delete it in Settings › AI › Advisor.</span>
        </span>
      </div>
    )
  return (
    <div className="adv-block adv-memory">
      <div className="adv-eyebrow">Remember this?</div>
      <input className="adv-memory__input" value={fact} maxLength={300} aria-label="The fact to remember" disabled={!env.done} onChange={(e) => setFact(e.target.value)} />
      <div className="adv-actions">
        <Button size="sm" variant="dark" disabled={!env.done || !fact.trim()} onClick={() => env.answerMemory(index, true, fact)}>
          Yes, remember
        </Button>
        <Button size="sm" disabled={!env.done} onClick={() => env.answerMemory(index, false, fact)}>
          No
        </Button>
      </div>
    </div>
  )
}

/** The "From:" chips under an answer: an investor opens their drawer, a web chip its page, the rest their view. */
export function SourceChips({ sources }: { sources: readonly Source[] }) {
  const env = useEnv()
  const chips = sourceChips(sources)
  if (!chips.length) return null
  return (
    <div className="adv-from">
      <span className="adv-from__k">From</span>
      {chips.map((c) =>
        c.source.kind === 'web' && c.source.url ? (
          <a key={c.key} className="adv-from__chip" href={c.source.url} target="_blank" rel="noreferrer noopener">
            {c.text}
          </a>
        ) : c.source.investorId || SOURCE_ROUTE[c.source.kind] ? (
          <button key={c.key} type="button" className="adv-from__chip" onClick={() => env.openSource(c.source)}>
            {c.text}
          </button>
        ) : (
          <span key={c.key} className="adv-from__chip">
            {c.text}
          </span>
        ),
      )}
    </div>
  )
}
