// PST-279: Ask Nest, the Ask mode of ⌘K (screens/raise-ai/ask-nest.png). The
// answer streams in from Claude, which reads Nest through the MCP read tools.
// Investors it names are chips that open the drawer; what it suggests doing is
// one of the buttons Nest already has (Open, the prep brief, Draft, Log the ask), and
// nothing happens until Dev clicks one. Generating makes no sound.
import { useMemo, type ReactNode } from 'react'
import { parseAnswer, sourcesLine, suggestedQuestions, workingLine, type AnswerAction, type AskRun, type Inline } from '../../lib/ask'
import { todayIST } from '../../lib/dates'
import { dayOf } from '../../lib/google'
import type { Investor } from '../../lib/pipeline'
import { useRaise } from '../data'
import { useMaterials } from '../materials/data'
import { Button, Icon } from '../ui'

export type AskActions = {
  openInvestor: (i: Investor) => void
  openPrep: (meetingId: string) => void
  draft: (i: Investor) => void
  logAsk: (i: Investor) => void
}

/** The current pitch deck's version, for "Who hasn't seen deck vN?". */
function useDeckVersion(): number | undefined {
  const m = useMaterials()
  const deck = m.materials.filter((x) => x.kind === 'deck').sort((a, b) => b.createdAt - a.createdAt)[0]
  return m.versions.find((v) => v._id === deck?.currentVersionId)?.n
}

export function AskBody({ runId, error, onAsk, onClose, actions }: { runId: string | null; error: string | null; onAsk: (q: string) => void; onClose: () => void; actions: AskActions }) {
  const d = useRaise()
  const run = d.useAskRun(runId)
  const questions = suggestedQuestions(useDeckVersion())
  const busy = !!runId && (run === undefined || run?.status === 'thinking' || run?.status === 'answering')
  if (d.ai.loaded && !d.ai.connected)
    return (
      <div className="ask-off">
        <Icon name="spark" size={20} className="enrich-spark enrich-spark--off" />
        <div>
          <p className="ask-off__title">AI isn’t set up here.</p>
          <p className="ask-off__sub">Add ANTHROPIC_API_KEY to this Convex deployment to ask Nest about the raise. Search still works: press Tab.</p>
        </div>
      </div>
    )
  return (
    <div className="ask">
      {error ? (
        <div className="ask-card ask-card--failed" role="alert">
          <p>{error}</p>
        </div>
      ) : runId ? (
        run ? (
          <Answer run={run} onClose={onClose} onAsk={onAsk} actions={actions} />
        ) : (
          <Working tools={[]} />
        )
      ) : null}
      <div className="ask-try">
        <p className="ask-try__title" id="ask-try-title">
          Try
        </p>
        <div className="ask-try__chips" role="group" aria-labelledby="ask-try-title">
          {questions.map((q) => (
            <button key={q} type="button" className="ask-try__chip" disabled={busy} onClick={() => onAsk(q)}>
              {q}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function Working({ tools }: { tools: readonly string[] }) {
  return (
    <div className="ask-card ask-card--working" aria-live="polite" aria-busy="true">
      <span className="ask-working">{workingLine(tools)}</span>
      <span className="ask-working__bar" aria-hidden="true" />
    </div>
  )
}

function Answer({ run, onClose, onAsk, actions }: { run: AskRun; onClose: () => void; onAsk: (q: string) => void; actions: AskActions }) {
  const d = useRaise()
  const byId = useMemo(() => new Map(d.investors.map((i) => [i._id, i])), [d.investors])
  const done = run.status === 'done'
  const { blocks, actions: wants } = useMemo(() => parseAnswer(run.text, !done), [run.text, done])
  if (run.status === 'failed')
    return (
      <div className="ask-card ask-card--failed" role="alert">
        <p>Nest couldn’t answer that. {run.error ?? ''}</p>
        <Button size="sm" onClick={() => onAsk(run.question)}>
          Try again
        </Button>
      </div>
    )
  if (!run.text) return <Working tools={run.tools} />

  const chip = (p: Extract<Inline, { kind: 'investor' }>, k: number) => {
    const i = byId.get(p.id)
    if (!i) return <span key={k}>{p.name}</span>
    return (
      <button
        key={k}
        type="button"
        className="ask-chip"
        onClick={() => {
          onClose()
          actions.openInvestor(i)
        }}
      >
        <span className="ask-chip__dot" aria-hidden="true" />
        {i.name}
      </button>
    )
  }
  const parts = (xs: Inline[]): ReactNode[] => xs.map((p, k) => (p.kind === 'investor' ? chip(p, k) : p.kind === 'bold' ? <strong key={k}>{p.text}</strong> : <span key={k}>{p.text}</span>))
  /** A list item that starts with an investor: the chip on top, what to do under it. */
  const item = (xs: Inline[]) => {
    if (xs[0]?.kind !== 'investor') return <span className="ask-list__text">{parts(xs)}</span>
    const rest = xs.slice(1)
    if (rest[0]?.kind === 'text') rest[0] = { kind: 'text', text: rest[0].text.replace(/^[\s:,–—-]+/, '') }
    return (
      <>
        <span className="ask-list__who">{chip(xs[0], -1)}</span>
        <span className="ask-list__text">{parts(rest)}</span>
      </>
    )
  }

  const button = (a: AnswerAction) => {
    const close = (fn: () => void) => () => {
      onClose()
      fn()
    }
    if (a.kind === 'prep') {
      const m = d.google.meetings.find((x) => x._id === a.id)
      // Upcoming, or earlier today (the brief then says it ended).
      if (!m || (m.end <= Date.now() && dayOf(m.start) !== todayIST())) return null
      return (
        <Button key={'prep' + a.id} size="sm" variant="primary" icon="note" onClick={close(() => actions.openPrep(m._id))}>
          Open prep brief
        </Button>
      )
    }
    const i = byId.get(a.id)
    if (!i) return null
    if (a.kind === 'draft')
      return (
        <Button key={'draft' + a.id} size="sm" variant="secondary" icon="spark" onClick={close(() => actions.draft(i))}>
          Draft · {i.name}
        </Button>
      )
    if (a.kind === 'ask')
      return (
        <Button key={'ask' + a.id} size="sm" variant="orange" onClick={close(() => actions.logAsk(i))}>
          Log the ask · {i.name}
        </Button>
      )
    return (
      <Button key={'open' + a.id} size="sm" variant="secondary" onClick={close(() => actions.openInvestor(i))}>
        Open {i.name}
      </Button>
    )
  }
  const buttons = done ? wants.map(button).filter(Boolean) : []

  return (
    <div className="ask-card" aria-live="polite" aria-busy={!done}>
      <div className="ask-answer">
        {blocks.map((b, k) =>
          b.kind === 'p' ? (
            <p key={k}>{parts(b.parts)}</p>
          ) : b.kind === 'ol' ? (
            <ol key={k} className="ask-list">
              {b.items.map((x, n) => (
                <li key={n}>
                  <span className="ask-list__n" aria-hidden="true">
                    {n + 1}
                  </span>
                  <span className="ask-list__body">{item(x)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <ul key={k} className="ask-bullets">
              {b.items.map((x, n) => (
                <li key={n}>{parts(x)}</li>
              ))}
            </ul>
          ),
        )}
      </div>
      {buttons.length ? <div className="ask-card__actions">{buttons}</div> : null}
      {done ? <p className="ask-card__foot">{sourcesLine(run.sources, run.costUsd, run.model)}</p> : null}
    </div>
  )
}
