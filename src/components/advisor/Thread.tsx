// PST-307: one Advisor conversation: its messages (the answer's text, blocks,
// "From:" chips and buttons) and the composer (model, Coach / Storyteller,
// + Context, the cost estimate and the cap). The Raise › Advisor tab, the ⌘J
// panel and the phone view all draw it.
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  advisorModelName, answerParts, capCheck, estimateLine, eyebrow, MAX_PINNED, MESSAGE_MAX, plainText, SOURCE_ROUTE,
  type AdvisorMessage, type AdvisorMode, type AdvisorModel, type Pinned, type ScreenContext, type Source,
} from '../../lib/advisor'
import { fillInto, planStep, type Block } from '../../lib/advisorBlocks'
import { parseAnswer, type Inline } from '../../lib/ask'
import { todayIST } from '../../lib/dates'
import { cents } from '../../lib/enrich'
import { OPUS, SONNET } from '../../lib/models'
import { fieldsOf, type Investor } from '../../lib/pipeline'
import { play } from '../../lib/sound'
import { errorMessage, useRaise } from '../data'
import { openDraft, useDrafts } from '../drafts/data'
import { useMaterials } from '../materials/data'
import { openPanel, playPrepOpen } from '../qanda/panels'
import { Menu } from '../system/Menu'
import { Modal, useTitleId } from '../system/Modal'
import { Button, Icon, useToast } from '../ui'
import { BlockEnvContext, BlockView, SourceChips, type BlockEnv } from './Blocks'
import { isCapError, nextCost, useAdvisor, type AdvisorChat } from './data'

type Of<K extends Block['kind']> = Extract<Block, { kind: K }>

/** Where Dev goes from an answer: the drawer, Drafts, a view. Leaving the ⌘J panel closes it. */
function useGo(onLeave?: () => void) {
  const navigate = useNavigate()
  const path = useRouterState({ select: (s) => s.location.pathname })
  const inRaise = path.startsWith('/raise/')
  return useMemo(() => {
    const leave = () => onLeave?.()
    return {
      inRaise,
      investor: (i: Investor) => {
        leave()
        void navigate({ to: inRaise ? path : '/raise/today', search: inRaise ? true : undefined, state: (s) => ({ ...s, drawer: { id: i._id, opts: {} } }) })
      },
      raise: () => {
        if (!inRaise) void navigate({ to: '/raise/today' })
      },
      to: (to: string, o: { view?: string; state?: Record<string, unknown> } = {}) => {
        leave()
        void navigate({ to, ...(o.view ? { search: { view: o.view } as never } : {}), ...(o.state ? { state: (s) => ({ ...s, ...o.state }) } : {}) })
      },
      leave,
    }
  }, [navigate, path, inRaise, onLeave])
}

export function Thread({
  chatId, onChat, compact, panel, screen, placeholder, empty, onLeave,
}: {
  chatId: string | null
  /** A new chat was started (its first message sent). */
  onChat: (id: string) => void
  /** The ⌘J panel and the phone: smaller blocks and chips. */
  compact?: boolean
  /** The ⌘J panel: Coach only, so no mode chips. */
  panel?: boolean
  /** From ⌘J: the screen the panel was opened on (kept with a new chat). */
  screen?: ScreenContext
  placeholder: string
  /** What shows before the first message (the starters). */
  empty?: (start: (text: string, mode: AdvisorMode) => void) => ReactNode
  onLeave?: () => void
}) {
  const a = useAdvisor()
  const d = useRaise()
  const toast = useToast()
  const view = a.useChat(chatId)
  const chat = view?.chat ?? null
  const messages = useMemo(() => view?.messages ?? [], [view])
  const settings = a.overview?.settings
  const [mode, setMode] = useState<AdvisorMode>(chat?.mode ?? 'coach')
  const [model, setModelHere] = useState<AdvisorModel | null>(null)
  const [pinnedHere, setPinnedHere] = useState<Pinned[]>([])
  const [capMsg, setCapMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)

  // A chat opened keeps its own mode; a new one starts as Coach.
  useEffect(() => {
    setMode(chat?.mode ?? 'coach')
    setModelHere(null)
    setPinnedHere([])
    setCapMsg(null)
  }, [chat?._id]) // eslint-disable-line react-hooks/exhaustive-deps

  const useModel: AdvisorModel = model ?? (chat ? (chat.model === OPUS ? OPUS : SONNET) : (settings?.model ?? SONNET))
  const pinned = chat ? chat.pinnedContext : pinnedHere
  const streaming = messages.find((m) => m.status === 'streaming') ?? null
  const est = a.overview ? nextCost(a.overview, useModel, mode, messages) : null
  const capped = a.overview && est !== null ? capCheck(a.overview.monthUsd, est, a.overview.settings.capUsd) : { ok: true as const }
  const notice = capMsg ?? (capped.ok ? null : capped.message)

  // Follow the answer as it writes, unless Dev scrolled up to read.
  const last = messages[messages.length - 1]
  const lastLen = last ? last.text.length + last.blocks.length + messages.length : 0
  const pinnedBottom = useRef(true)
  const shownChat = useRef<string | null>(null)
  useEffect(() => {
    const el = scroller.current
    if (!el || !lastLen) return
    // A chat just opened starts at its last question; after that, the answer is followed as it writes.
    if (chat && shownChat.current !== chat._id) {
      shownChat.current = chat._id
      const asked = [...el.querySelectorAll<HTMLElement>('.adv-msg--user')].pop()
      el.scrollTop = asked ? asked.offsetTop - el.offsetTop - 16 : el.scrollHeight
      return
    }
    if (pinnedBottom.current) el.scrollTop = el.scrollHeight
  }, [lastLen, chat])

  const fail = (e: unknown) => {
    if (isCapError(e)) {
      play('nope')
      setCapMsg(errorMessage(e))
      return
    }
    play('save-failed')
    toast({ tone: 'error', message: errorMessage(e) })
  }

  const send = async (text: string, as: AdvisorMode = mode) => {
    const t = text.trim()
    if (!t || busy) return false
    setBusy(true)
    setCapMsg(null)
    pinnedBottom.current = true
    try {
      play('ask')
      const r = await a.send({ ...(chat ? { chatId: chat._id } : {}), text: t, mode: as, ...(model && model !== chat?.model ? { model } : {}), ...(!chat && pinnedHere.length ? { pinned: pinnedHere } : {}), ...(!chat && screen ? { screen } : {}) })
      if (!chat) onChat(r.chatId)
      if (as !== mode) setMode(as)
      return true
    } catch (e) {
      fail(e)
      return false
    } finally {
      setBusy(false)
    }
  }

  const setModel = (m: AdvisorModel) => {
    setModelHere(m)
    if (chat && m !== chat.model) void a.setModel(chat._id, m).catch(fail)
  }
  const setPinned = (p: Pinned[]) => {
    if (chat) void a.setContext(chat._id, p).catch(fail)
    else setPinnedHere(p)
  }

  const lastAnswer = [...messages].reverse().find((m) => m.role === 'assistant')
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')

  return (
    <div className={'adv-thread' + (compact ? ' adv-thread--compact' : '')}>
      <div
        className="adv-scroll"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget
          pinnedBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
      >
        {chatId && view === undefined ? (
          <div className="adv-loading" aria-busy="true">
            <span className="sk" style={{ display: 'block', width: '60%', height: 40, borderRadius: 14, marginLeft: 'auto' }} />
            <span className="sk" style={{ display: 'block', width: '90%', height: 120, borderRadius: 14 }} />
          </div>
        ) : messages.length ? (
          <ol className="adv-messages" aria-label="Messages">
            {messages.map((m) =>
              m.role === 'user' ? (
                <UserMessage key={m._id} m={m} editable={m._id === lastUser?._id && !streaming && !!chat} onEdit={(t) => chat && a.editLast(chat._id, t).catch(fail)} />
              ) : (
                <Answer key={m._id} m={m} chat={chat} last={m._id === lastAnswer?._id} compact={compact} onAsk={(q) => void send(q)} onFail={fail} onLeave={onLeave} />
              ),
            )}
          </ol>
        ) : (
          (empty?.((t, md) => {
            setMode(md)
            void send(t, md)
          }) ?? null)
        )}
      </div>
      {notice ? <CapNotice message={notice} onLeave={onLeave} /> : null}
      <Composer
        key={chat?._id ?? 'new'}
        placeholder={placeholder}
        compact={compact}
        panel={panel}
        mode={mode}
        onMode={setMode}
        model={useModel}
        onModel={setModel}
        pinned={pinned}
        onPinned={setPinned}
        investors={d.investors}
        estimate={est !== null && settings ? estimateLine(est, settings.web) : ''}
        blocked={!!notice || !a.overview?.connected}
        offline={a.overview ? !a.overview.connected : false}
        streaming={streaming}
        onStop={() => streaming && void a.stop(streaming._id).catch(fail)}
        onSend={send}
      />
    </div>
  )
}

function CapNotice({ message, onLeave }: { message: string; onLeave?: () => void }) {
  const go = useGo(onLeave)
  return (
    <div className="adv-cap" role="status">
      <Icon name="alert" size={18} />
      <p>{message}</p>
      <Button size="sm" onClick={() => go.to('/raise/settings', { state: { advisorSettings: true } })}>
        Open Settings
      </Button>
    </div>
  )
}

/* ---------- messages ---------- */

function UserMessage({ m, editable, onEdit }: { m: AdvisorMessage; editable: boolean; onEdit: (text: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(m.text)
  if (editing)
    return (
      <li className="adv-msg adv-msg--user is-editing">
        <textarea className="adv-edit" value={text} maxLength={MESSAGE_MAX} aria-label="Edit your message" autoFocus onChange={(e) => setText(e.target.value)} />
        <div className="adv-actions">
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="dark"
            disabled={!text.trim()}
            onClick={() => {
              setEditing(false)
              if (text.trim() !== m.text) onEdit(text)
            }}
          >
            Ask again
          </Button>
        </div>
      </li>
    )
  return (
    <li className="adv-msg adv-msg--user">
      <div className="adv-bubble">{m.text}</div>
      {editable ? (
        <button
          type="button"
          className="adv-msg__edit"
          aria-label="Edit your message"
          onClick={() => {
            setText(m.text)
            setEditing(true)
          }}
        >
          <Icon name="edit" size={14} />
        </button>
      ) : null}
    </li>
  )
}

/** An answer's words: paragraphs, numbered steps and **bold**, with investors as links to their drawer. */
export function AnswerText({ text, streaming, investor, onInvestor }: { text: string; streaming: boolean; investor: (id: string) => Investor | undefined; onInvestor: (i: Investor) => void }) {
  const { blocks } = useMemo(() => parseAnswer(text, streaming), [text, streaming])
  const parts = (xs: Inline[]) =>
    xs.map((p, k) => {
      if (p.kind === 'bold') return <strong key={k}>{p.text}</strong>
      if (p.kind === 'text') return <span key={k}>{p.text}</span>
      const i = investor(p.id)
      return i ? (
        <button key={k} type="button" className="adv-who" onClick={() => onInvestor(i)}>
          {i.name}
        </button>
      ) : (
        <span key={k}>{p.name}</span>
      )
    })
  return (
    <div className="adv-text">
      {blocks.map((b, k) =>
        b.kind === 'p' ? (
          <p key={k}>{parts(b.parts)}</p>
        ) : b.kind === 'ol' ? (
          <ol key={k} className="adv-steps">
            {b.items.map((x, n) => (
              <li key={n}>
                <span className="adv-steps__n" aria-hidden="true">
                  {n + 1}
                </span>
                <span className="adv-steps__body">{parts(x)}</span>
              </li>
            ))}
          </ol>
        ) : (
          <ul key={k} className="adv-bullets">
            {b.items.map((x, n) => (
              <li key={n}>{parts(x)}</li>
            ))}
          </ul>
        ),
      )}
    </div>
  )
}

/**
 * PST-308: an answer's words and blocks in the order the model wrote them (an
 * answer saved before that shows its words, then its blocks). Blocks next to each
 * other share one column. Inside the answer's BlockEnvContext.
 */
export function AnswerBody({ m, investor, onInvestor }: { m: Pick<AdvisorMessage, 'text' | 'blocks' | 'parts' | 'status'>; investor: (id: string) => Investor | undefined; onInvestor: (i: Investor) => void }) {
  const streaming = m.status === 'streaming'
  const runs = answerParts(m).reduce<({ text: string } | { blocks: number[] })[]>((out, p) => {
    const prev = out[out.length - 1]
    if ('text' in p) out.push(p)
    else if (prev && 'blocks' in prev) prev.blocks.push(p.block)
    else out.push({ blocks: [p.block] })
    return out
  }, [])
  if (!runs.length) return streaming ? <p className="adv-reading">Reading Nest…</p> : null
  return runs.map((r, k) =>
    'text' in r ? (
      <AnswerText key={k} text={r.text} streaming={streaming && k === runs.length - 1} investor={investor} onInvestor={onInvestor} />
    ) : (
      <div key={k} className="adv-blocks">
        {r.blocks.map((i) => (
          <BlockView key={i} block={m.blocks[i]} index={i} />
        ))}
      </div>
    ),
  )
}

function Answer({ m, chat, last, compact, onAsk, onFail, onLeave }: { m: AdvisorMessage; chat: AdvisorChat | null; last: boolean; compact?: boolean; onAsk: (q: string) => void; onFail: (e: unknown) => void; onLeave?: () => void }) {
  const a = useAdvisor()
  const env = useBlockEnv(m, onAsk, onFail, onLeave, compact)
  const streaming = m.status === 'streaming'
  const follow = last && !streaming ? m.blocks.findIndex((b) => b.kind === 'follow_ups') : -1
  const model = m.model ?? chat?.model ?? SONNET
  return (
    <li className="adv-msg adv-msg--answer" aria-busy={streaming}>
      <div className="adv-eyebrow adv-msg__eyebrow">
        <Icon name="spark" size={16} className="adv-spark" />
        {eyebrow({ ...m, model })}
      </div>
      <BlockEnvContext.Provider value={env}>
        <AnswerBody m={m} investor={env.investor} onInvestor={env.openInvestor} />
        {m.status === 'failed' ? (
          <div className="adv-failed" role="alert">
            <span>{m.error ?? 'It didn’t finish.'}</span>
          </div>
        ) : null}
        {m.status === 'stopped' ? <p className="adv-stopped">Stopped.</p> : null}
        {!streaming ? <SourceChips sources={m.sources} /> : null}
        <div className="adv-msg__actions">
          {streaming ? (
            <button type="button" className="adv-link" onClick={() => void a.stop(m._id).catch(onFail)}>
              Stop
            </button>
          ) : (
            <>
              {m.text ? (
                <button type="button" className="adv-link" onClick={() => env.copy(plainText(m.text))}>
                  Copy
                </button>
              ) : null}
              {model !== OPUS ? (
                <button type="button" className="adv-link" onClick={() => void a.regenerate(m._id, OPUS).catch(onFail)}>
                  Ask Opus instead
                </button>
              ) : null}
              <button type="button" className="adv-link" onClick={() => void a.regenerate(m._id).catch(onFail)}>
                {m.status === 'failed' ? 'Try again' : 'Regenerate'}
              </button>
              {m.costUsd > 0 ? <span className="adv-msg__cost num">{cents(m.costUsd)}</span> : null}
            </>
          )}
        </div>
        {follow >= 0 ? <BlockView block={m.blocks[follow]} index={follow} /> : null}
      </BlockEnvContext.Provider>
    </li>
  )
}

function useBlockEnv(m: AdvisorMessage, onAsk: (q: string) => void, onFail: (e: unknown) => void, onLeave: (() => void) | undefined, compact: boolean | undefined): BlockEnv {
  const a = useAdvisor()
  const d = useRaise()
  const toast = useToast()
  const go = useGo(onLeave)
  const drafts = useDrafts()
  const byId = useMemo(() => new Map(d.investors.map((i) => [i._id, i])), [d.investors])
  const meetings = d.google.meetings
  return useMemo<BlockEnv>(() => {
    const investor = (id: string | undefined) => (id ? byId.get(id) : undefined)
    const update = (index: number, b: Block) => void a.updateBlock(m._id, index, b).catch(onFail)
    const nextMeeting = (i: Investor) => meetings.filter((x) => x.investorIds.includes(i._id) && x.end > Date.now()).sort((x, y) => x.start - y.start)[0]
    const outcome = (o: { added: boolean; message: string }, yes: string) => {
      if (o.added) play('save')
      toast(o.added ? { message: yes, action: { label: 'Review', onClick: () => go.to('/raise/today', { state: { suggestions: true } }) } } : { tone: 'info', icon: 'check', message: o.message || 'It’s already in Suggestions.' })
    }
    return {
      today: todayIST(),
      done: m.status !== 'streaming',
      compact,
      investor,
      openInvestor: go.investor,
      openDraft: (b: Of<'draft'>) => {
        if (!b.investorId) return
        go.leave()
        go.raise()
        openDraft({ investorId: b.investorId, ...(b.draftType ? { type: b.draftType } : {}), ...(b.draftId ? { draftId: b.draftId } : {}) })
      },
      hasMeeting: (i) => !!nextMeeting(i),
      prep: (i) => {
        const x = nextMeeting(i)
        if (!x) return
        go.leave()
        go.raise()
        playPrepOpen(x._id)
        openPanel({ kind: 'prep', meetingId: x._id })
      },
      ask: onAsk,
      update,
      tick: (index, b, items, on) => {
        const ticked = on ? [...new Set([...b.ticked, ...items])] : b.ticked.filter((k) => !items.includes(k))
        update(index, { ...b, ticked })
        if (!on) return
        const changes = items.flatMap((k) => {
          const i = investor(b.items[k]?.investorId)
          return i ? [{ i, ...planStep(i, b.items[k]) }] : []
        })
        play('save')
        if (!changes.length) return
        const saved = Promise.all(changes.map((c) => d.save(c.i._id, { ...fieldsOf(c.i), ...c.set })))
        saved.catch(onFail)
        toast({
          message: changes.length === 1 ? 'Next step set for ' + changes[0].i.name + ': ' + changes[0].set.nextStep + '.' : changes.length + ' next steps set in Today.',
          action: {
            label: 'Undo',
            onClick: () => {
              play('undo')
              update(index, { ...b, ticked: b.ticked })
              void saved.then(() => Promise.all(changes.map((c) => d.save(c.i._id, { ...fieldsOf(c.i), ...c.undo })))).catch(onFail)
            },
          },
        })
      },
      pick: (index, b, k) => {
        play('select')
        update(index, { ...b, picked: k })
        onAsk('Going with ' + String.fromCharCode(65 + k) + ': ' + b.options[k].label + '.')
      },
      suggestMove: (index, i, stage) => void a.suggestMove(m._id, index, stage).then((o) => outcome(o, 'Sent to Suggestions: the move waits for your OK.')).catch(onFail),
      tryAnother: (index, beat) => a.tryAnother(m._id, index, beat).catch(onFail),
      useInStory: (index, b, value) => {
        const hit = fillInto(m.blocks, b.label, value, b.unit)
        if (!hit) {
          toast({ tone: 'info', icon: 'check', message: 'No blank in this answer’s story is for ' + b.label.toLowerCase() + '. Click the line to add it yourself.' })
          return
        }
        play('save')
        update(hit.index, hit.block)
        update(index, { ...b, value: value.trim(), saved: 'story' })
      },
      editDraft: (index, b, body) => {
        update(index, { ...b, body })
        if (b.draftKind === 'email' && b.draftId && b.investorId)
          void drafts.save({ draftId: b.draftId, investorId: b.investorId, type: b.draftType ?? 'followup', to: '', subject: b.subject ?? b.title, body }).catch(onFail)
        play('save')
      },
      blankToPlan: (index, value) => void a.blankToPlan(m._id, index, value).then((o) => outcome(o, 'Sent to Suggestions. Once you accept it, the Advisor keeps the number.')).catch(onFail),
      saveToQanda: (index) =>
        void a
          .saveToQanda(m._id, index)
          .then((id) => {
            play('save')
            toast({ message: 'Saved in Q&A.', action: { label: 'Open', onClick: () => go.to('/raise/qanda', { state: { question: id } }) } })
          })
          .catch(onFail),
      sendSuggestion: (index) => void a.sendSuggestion(m._id, index).then((o) => outcome(o, 'Sent to Suggestions.')).catch(onFail),
      answerMemory: (index, yes, fact) =>
        void a
          .answerMemory(m._id, index, yes, fact)
          .then(() => {
            if (!yes) return
            play('save')
            toast({ message: 'Remembered. The Advisor uses it from the next answer.' })
          })
          .catch(onFail),
      openSource: (s: Source) => {
        const i = investor(s.investorId)
        if (i) return go.investor(i)
        if (s.kind === 'race') return go.to('/raise/pipeline', { view: 'race' })
        const to = SOURCE_ROUTE[s.kind]
        if (to) go.to(to)
      },
      copy: (text) => {
        void navigator.clipboard?.writeText(text).then(
          () => toast({ tone: 'info', icon: 'check', message: 'Copied.' }),
          () => toast({ tone: 'error', message: 'Couldn’t copy. Select the text instead.' }),
        )
      },
    }
  }, [a, d, m, byId, meetings, toast, go, drafts, onAsk, onFail, compact])
}

/* ---------- the composer ---------- */

function Composer({
  placeholder, compact, panel, mode, onMode, model, onModel, pinned, onPinned, investors, estimate, blocked, offline, streaming, onStop, onSend,
}: {
  placeholder: string
  compact?: boolean
  panel?: boolean
  mode: AdvisorMode
  onMode: (m: AdvisorMode) => void
  model: AdvisorModel
  onModel: (m: AdvisorModel) => void
  pinned: Pinned[]
  onPinned: (p: Pinned[]) => void
  investors: readonly Investor[]
  estimate: string
  blocked: boolean
  offline: boolean
  streaming: AdvisorMessage | null
  onStop: () => void
  onSend: (text: string) => Promise<boolean>
}) {
  const [text, setText] = useState('')
  const [menu, setMenu] = useState<'model' | 'context' | null>(null)
  const modelBtn = useRef<HTMLButtonElement>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const can = !!text.trim() && !blocked && !streaming

  useEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(220, el.scrollHeight) + 'px'
  }, [text])

  const submit = async () => {
    if (!can) return
    const t = text
    setText('')
    if (!(await onSend(t))) setText(t)
  }
  return (
    <form
      className="adv-composer"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <textarea
        ref={area}
        className="adv-composer__input"
        rows={2}
        value={text}
        maxLength={MESSAGE_MAX}
        placeholder={offline ? 'AI isn’t set up here: add ANTHROPIC_API_KEY to Convex.' : placeholder}
        aria-label="Ask the Advisor"
        data-advisor-input=""
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            void submit()
          }
        }}
      />
      <div className="adv-composer__bar">
        <div className="adv-composer__chips">
          <button ref={modelBtn} type="button" className="adv-chip is-on" aria-haspopup="menu" aria-expanded={menu === 'model'} onClick={() => setMenu('model')}>
            {compact ? advisorModelName(model).split(' ')[0] : advisorModelName(model)}
            <Icon name="chevron-down" size={14} />
          </button>
          {panel ? null : (
            <>
              <button type="button" className={'adv-chip' + (mode === 'coach' ? ' is-on' : '')} aria-pressed={mode === 'coach'} onClick={() => onMode('coach')}>
                Coach
              </button>
              <button type="button" className={'adv-chip' + (mode === 'storyteller' ? ' is-on' : '')} aria-pressed={mode === 'storyteller'} onClick={() => onMode('storyteller')}>
                Storyteller
              </button>
            </>
          )}
          {pinned.map((p) => (
            <span key={p.kind + p.id} className="adv-chip adv-chip--pinned">
              {p.label.split(' ')[0]}
              <button type="button" aria-label={'Remove ' + p.label} onClick={() => onPinned(pinned.filter((x) => x !== p))}>
                <Icon name="close" size={12} />
              </button>
            </span>
          ))}
          {pinned.length < MAX_PINNED ? (
            <button type="button" className="adv-chip" aria-haspopup="dialog" aria-expanded={menu === 'context'} onClick={() => setMenu('context')}>
              + Context
            </button>
          ) : null}
        </div>
        <span className="adv-composer__cost">{estimate}</span>
        {streaming ? (
          <button type="button" className="adv-send adv-send--stop" aria-label="Stop the answer" onClick={onStop}>
            <span className="adv-send__square" />
          </button>
        ) : (
          <button type="submit" className="adv-send" aria-label="Send" disabled={!can}>
            <Icon name="arrow-right" size={20} strokeWidth={2.2} />
          </button>
        )}
      </div>
      {menu === 'model' ? (
        <Menu
          anchor={modelBtn.current}
          title="Model"
          align="start"
          placement="above"
          onClose={() => setMenu(null)}
          items={([SONNET, OPUS] as const).map((m) => ({
            label: advisorModelName(m) + (m === SONNET ? ' · fast, the default' : ' · for hard questions'),
            checked: m === model,
            onSelect: () => onModel(m),
          }))}
        />
      ) : null}
      {menu === 'context' ? <ContextPicker pinned={pinned} investors={investors} onPick={(p) => onPinned([...pinned, p])} onClose={() => setMenu(null)} /> : null}
    </form>
  )
}

/** "+ Context": pin an investor or a material to the chat, so the Advisor reads it first. */
function ContextPicker({ pinned, investors, onPick, onClose }: { pinned: Pinned[]; investors: readonly Investor[]; onPick: (p: Pinned) => void; onClose: () => void }) {
  const mats = useMaterials()
  const [q, setQ] = useState('')
  const titleId = useTitleId()
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const has = (p: Pinned) => pinned.some((x) => x.kind === p.kind && x.id === p.id)
  const all: Pinned[] = [
    ...investors.filter((i) => i.stage !== 'passed').map((i) => ({ kind: 'investor' as const, id: i._id, label: i.name })),
    ...mats.materials.map((x) => ({ kind: 'material' as const, id: x._id, label: x.title })),
  ]
  const found = all.filter((p) => !has(p) && words.every((w) => p.label.toLowerCase().includes(w))).slice(0, 8)
  return (
    <Modal onClose={onClose} labelledBy={titleId} className="adv-context">
      <h2 id={titleId} className="adv-context__title">
        Add context
      </h2>
      <p className="adv-context__lede">The Advisor reads what you pin first, in every answer of this chat.</p>
      <input className="adv-context__search" placeholder="Find an investor or material" aria-label="Find an investor or material" autoFocus value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="adv-context__list">
        {found.map((p) => (
          <li key={p.kind + p.id}>
            <button
              type="button"
              className="adv-context__item"
              onClick={() => {
                onPick(p)
                onClose()
              }}
            >
              <Icon name={p.kind === 'investor' ? 'user' : 'note'} size={16} />
              {p.label}
              {p.kind === 'material' ? <span className="adv-context__kind">Material</span> : null}
            </button>
          </li>
        ))}
        {found.length ? null : <li className="adv-context__none">Nothing matches.</li>}
      </ul>
    </Modal>
  )
}
