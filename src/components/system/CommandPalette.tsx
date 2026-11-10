import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { QUESTION_MAX } from '../../lib/ask'
import { cents } from '../../lib/enrich'
import { estimate, MODEL_INFO, modelFor, MODELS, type Model } from '../../lib/models'
import { onOpenCommandPalette, recentInvestors, rememberInvestor } from '../../lib/commandPalette'
import { openFeedback } from '../../lib/feedback' // PST-289
import { formatDay, todayIST } from '../../lib/dates'
import { addressesOf, gmailSearchLink } from '../../lib/google'
import { dayLabel, isQuiet } from '../../lib/investorView'
import { matchScore, rankInvestors, searchNotes, searchSections, titleCase } from '../../lib/palette'
import { searchQuestions } from '../../lib/qanda'
import type { Investor } from '../../lib/pipeline'
import { play } from '../../lib/sound'
import { STAGE_TILE } from '../../lib/stages'
import { applicationChip } from '../../lib/applications' // PST-302
import { DRAFT_TYPES, type DraftType } from '../../lib/drafts'
import { investorActions, parseActionQuery, type InvestorAction } from '../../lib/paletteActions'
import { GO_TO, KEYS, keyLabel, matches, singleKeyOk } from '../../lib/shortcuts'
import { useInstant } from './useInstant'
import { ASK_NOTE, askFollowUp } from '../../lib/today'
import { errorMessage, useRaise } from '../data'
import { openDraft } from '../drafts/data'
import { NestEmpty } from '../illustrations'
import { useQanda } from '../qanda/data'
import { openPanel, playPrepOpen } from '../qanda/panels'
import { AskBody } from './AskNest'
import { Menu } from './Menu'
import type { OpenOptions } from '../raise-ui'
import { Icon, Kbd, useToast, type IconName } from '../ui'
import { Modal } from './Modal'
import { PREVIEW_ASK_QUESTIONS, usePreviewState } from '../preview-state'
import { useSaveAction } from './useSaveAction'

/** `action`: an action on the matched investor (its chevron turns into an arrow while active). */
type Item = { id: string; icon: IconName; label: ReactNode; meta?: ReactNode; keys?: string[]; action?: boolean; run: () => void }
type Group = { title: string; items: Item[] }

const first = (name: string) => name.trim().split(/\s+/)[0]
/** PST-295 adds the "Ask if they'll lead" draft; until then the action stays hidden. */
const LEAD_DRAFT = (DRAFT_TYPES as readonly string[]).includes('lead') ? ('lead' as string as DraftType) : null

type Mode = 'search' | 'ask'

/**
 * ⌘K (system/cmdk-*.png): search investors by name and firm, act on the top
 * match, jump to a section. ↑↓ move, ↵ opens, Esc closes. A full-height sheet
 * on phones. Also owns the single-key shortcuts it advertises (N, I, G then P…).
 * PST-279: Tab (or the chips) switches to Ask, where ↵ asks Nest the question.
 * PST-290: actions on the investor you're searching for ("orch dd", "log call fern"),
 * and the single keys come from the shortcut registry (src/lib/shortcuts.ts).
 */
export function CommandPalette() {
  const flags = usePreviewState()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [mode, setMode] = useState<Mode>('search')
  const [autoAsk, setAutoAsk] = useState(false)

  useEffect(
    () =>
      onOpenCommandPalette((query) => {
        setQ(query ?? '')
        setMode('search')
        setAutoAsk(false)
        setOpen(true)
      }),
    [],
  )

  // ?preview&system=cmdk|cmdk-empty|cmdk-none|cmdk-actions
  useEffect(() => {
    const s = flags?.system
    const query = { cmdk: 'orch', 'cmdk-none': 'nightjar', 'cmdk-empty': '', 'cmdk-actions': 'orch dd' }[s ?? '']
    if (query !== undefined) {
      setQ(query)
      setOpen(true)
    }
  }, [flags?.system])

  // ?preview&ask=…: open in Ask mode, asking that state's question.
  useEffect(() => {
    const s = flags?.ask
    if (!s) return
    const question = PREVIEW_ASK_QUESTIONS[s] ?? ''
    setQ(question)
    setMode('ask')
    setAutoAsk(!!question)
    setOpen(true)
  }, [flags?.ask])

  const actions = usePaletteActions()

  // Single-key shortcuts outside text fields: N add, I import, G then a letter to jump.
  useEffect(() => {
    let g = 0
    const onKey = (e: KeyboardEvent) => {
      if (open || !singleKeyOk(e) || document.querySelector('.sys-modal, [aria-modal="true"]')) return
      if (Date.now() - g < 1200) {
        g = 0
        const to = e.shiftKey ? undefined : GO_TO[e.key.toLowerCase()]
        if (to) {
          e.preventDefault()
          actions.go(to)
        }
        return
      }
      if (matches(e, KEYS.goTo)) g = Date.now()
      else if (matches(e, KEYS.addInvestor)) {
        e.preventDefault()
        actions.addInvestor()
      } else if (matches(e, KEYS.importCsv)) {
        e.preventDefault()
        actions.importCsv()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, actions])

  if (!open) return null
  return <Palette initial={q} initialMode={mode} autoAsk={autoAsk} onClose={() => setOpen(false)} actions={actions} recentsFallback={flags?.system === 'cmdk-empty'} />
}

function usePaletteActions() {
  const navigate = useNavigate()
  const path = useRouterState({ select: (s) => s.location.pathname })
  const inRaise = path.startsWith('/raise/')
  const d = useRaise()
  const toast = useToast()
  const save = useSaveAction()
  return useMemo(() => {
    // The drawer belongs to the Raise views: go there (or stay) and hand the Raise layout an open request,
    // which it passes to useUI().open(id, opts).
    const openDrawer = (id: string | null, opts?: OpenOptions) =>
      void navigate({ to: inRaise ? path : '/raise/today', search: inRaise ? true : undefined, state: (s) => ({ ...s, drawer: { id, opts } }) })
    return {
      go: (to: string, search?: Record<string, string>) => void navigate({ to, ...(search ? { search: search as never } : {}) }), // PST-305: search (Network)
      openInvestor: (i: Investor, opts?: OpenOptions) => {
        rememberInvestor(i._id)
        openDrawer(i._id, opts)
      },
      addInvestor: (name?: string) => openDrawer(null, name ? { name } : undefined),
      importCsv: () => void navigate({ to: '/raise/investors', search: { import: true } }),
      // PST-275: the suggestions list lives on Today.
      reviewSuggestions: () => void navigate({ to: '/raise/today', state: (s) => ({ ...s, suggestions: true }) }),
      // PST-281: a question from the bank opens its Answer panel on Q&A.
      openQuestion: (id: string) => void navigate({ to: '/raise/qanda', state: (s) => ({ ...s, question: id }) }),
      // PST-279: Ask Nest's buttons. The prep brief lives in the Raise views; open it there.
      openPrep: (meetingId: string) => {
        if (!inRaise) void navigate({ to: '/raise/today' })
        playPrepOpen(meetingId)
        openPanel({ kind: 'prep', meetingId })
      },
      // PST-278's draft dialog, which also lives in the Raise views.
      draft: (i: Investor, type?: DraftType) => {
        if (!inRaise) void navigate({ to: '/raise/today' })
        openDraft({ investorId: i._id, type })
      },
      logAsk: (i: Investor) => {
        const next = askFollowUp(todayIST())
        void save(() => d.logNote(i._id, ASK_NOTE, { touch: 'ask', next }), {
          failMessage: `Couldn’t log the ask for ${i.name}.`,
          onDone: () => {
            play('ask')
            toast(`Ask logged for ${i.name}. Follow-up set for ${formatDay(next.date)}.`)
          },
        })
      },
      advance: (i: Investor) =>
        void save(() => d.advance(i._id), {
          failMessage: `Couldn’t move ${i.name}.`,
          onDone: (r) => {
            if (!r) return
            play('stage-up')
            toast(`${i.name} → ${r.label}. Set the next step.`)
          },
        }),
    }
  }, [inRaise, path, navigate, d, toast, save])
}

type Actions = ReturnType<typeof usePaletteActions>

function Palette({
  initial, initialMode, autoAsk, onClose, actions, recentsFallback,
}: { initial: string; initialMode: Mode; autoAsk: boolean; onClose: () => void; actions: Actions; recentsFallback: boolean }) {
  const d = useRaise()
  const { investors, round, google, suggestions } = d
  const { questions } = useQanda()
  const [q, setQ] = useState(initial)
  const [mode, setMode] = useState<Mode>(initialMode)
  const [runId, setRunId] = useState<string | null>(null)
  const [askError, setAskError] = useState<string | null>(null)
  /** PST-273: the Ask chip's model, for the next question only (null: Settings › AI's Ask model). */
  const [oneOff, setOneOff] = useState<Model | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const asking = mode === 'ask'
  const instant = useInstant()

  const ask = useCallback(
    async (question: string) => {
      const text = question.trim()
      if (!text || !d.ai.connected) return
      setQ(text)
      setAskError(null)
      setRunId(null)
      setOneOff(null)
      try {
        setRunId(await d.ask(text, oneOff ?? undefined))
      } catch (e) {
        setAskError(errorMessage(e))
      }
    },
    [d, oneOff],
  )
  const asked = useRef(false)
  useEffect(() => {
    if (!autoAsk || asked.current || !d.loaded || !d.ai.loaded) return
    asked.current = true
    void ask(initial)
  }, [autoAsk, d.loaded, d.ai.loaded, ask, initial])
  const switchMode = (m: Mode) => {
    setMode(m)
    input.current?.focus()
  }
  const [active, setActive] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const today = todayIST()
  const query = q.trim()

  const meta = useCallback(
    (i: Investor, long: boolean) => {
      const quiet = isQuiet(i, today, round.quietDays)
      const bits = long ? [i.type, STAGE_TILE[i.stage]] : [STAGE_TILE[i.stage]]
      // PST-302: the application, apart from the stage.
      const app = applicationChip(i.application)
      if (app) bits.push(app)
      if (quiet) bits.push('quiet')
      else if (long && i.nextDate && i.nextDate >= today) bits.push(`due ${dayLabel(i.nextDate, today)}`)
      return bits.join(' · ')
    },
    [today, round.quietDays],
  )

  const groups = useMemo<Group[]>(() => {
    const close = (fn: () => void) => () => {
      onClose()
      fn()
    }
    const person = (i: Investor, long: boolean): Item => ({ id: 'i-' + i._id, icon: 'user', label: i.name, meta: meta(i, long), run: close(() => actions.openInvestor(i)) })
    const n = suggestions.length
    const review: Item = { id: 'a-suggestions', icon: 'spark', label: `Review ${n} suggestion${n === 1 ? '' : 's'}`, meta: 'Suggestions', run: close(actions.reviewSuggestions) }
    // PST-289: Send feedback (⌘.), in Quick actions and when the search asks for it.
    const feedback: Item = { id: 'a-feedback', icon: 'note', label: 'Send feedback', keys: ['⌘', '.'], run: close(openFeedback) }
    if (!query) {
      let recent = recentInvestors()
        .map((id) => investors.find((i) => i._id === id))
        .filter((i): i is Investor => !!i)
        .slice(0, 3)
      if (!recent.length && recentsFallback) recent = investors.filter((i) => i.stage !== 'todo').slice(0, 2)
      const quick: Item[] = [
        { id: 'a-add', icon: 'plus', label: 'Add an investor', keys: ['N'], run: close(() => actions.addInvestor()) },
        { id: 'a-import', icon: 'upload', label: 'Import a CSV', keys: ['I'], run: close(actions.importCsv) },
        { id: 'a-pipeline', icon: 'arrow-right', label: 'Go to Pipeline', keys: ['G', 'P'], run: close(() => actions.go('/raise/pipeline')) },
      ]
      return [
        ...(recent.length ? [{ title: 'Recent', items: recent.map((i) => person(i, false)) }] : []),
        { title: 'Quick actions', items: [...(n ? [review, ...quick] : quick), feedback] },
      ]
    }
    // PST-290: the investor the query names, and what it asks to do with them ("orch dd").
    const { investor: top, intent } = parseActionQuery(investors, query)
    const found = intent && top ? [top] : rankInvestors(investors, query, 5)
    const out: Group[] = []
    const people: Group | null = found.length ? { title: 'Investors', items: found.map((i) => person(i, true)) } : null
    if (people && !intent) out.push(people)
    if (top) {
      // PST-293: the decide-by date is in the drawer's decision.
      const features = { decideBy: true, askLead: !!LEAD_DRAFT }
      const run = (a: InvestorAction) => {
        rememberInvestor(top._id)
        if (a.kind === 'move' && a.stage) instant.move(top, a.stage)
        else if (a.kind === 'no') instant.pass(top)
        else if (a.kind === 'log') actions.openInvestor(top, { mode: 'touch', touch: a.touch })
        else if (a.kind === 'park') actions.openInvestor(top, { mode: 'park' })
        else if (a.kind === 'draft') actions.draft(top, 'followup')
        else if (a.kind === 'lead' && LEAD_DRAFT) actions.draft(top, LEAD_DRAFT)
        // PST-293: opens on the decision's decide-by date.
        else if (a.kind === 'decide') actions.openInvestor(top, { decide: true })
        else actions.openInvestor(top)
      }
      out.push({
        title: `Actions for ${top.name}`,
        items: [
          ...investorActions(top, intent, features).map((a): Item => ({ id: 'x-' + a.kind, icon: 'chevron-right', action: true, label: a.label, keys: a.key ? [keyLabel(a.key)] : undefined, run: close(() => run(a)) })),
          // PST-263: their threads in your Gmail (a search for their addresses and firm domains).
          ...(google.me && google.threads.some((t) => t.investorIds.includes(top._id))
            ? [{
                id: 'x-mail', icon: 'mail' as IconName, label: `Open ${first(top.name)}’s emails`, meta: 'Gmail',
                run: close(() => void window.open(gmailSearchLink(google.me!.email, addressesOf(top)), '_blank', 'noopener')),
              }]
            : []),
        ],
      })
    }
    if (people && intent) out.push(people)
    if (n && ['review suggestions', 'suggestions', 'suggested fixes', 'fix the list'].some((t) => matchScore(t, query) > 0)) out.push({ title: 'Suggestions', items: [review] })
    if (['send feedback', 'feedback', 'report a bug', 'bug', 'idea'].some((t) => matchScore(t, query) > 0)) out.push({ title: 'Feedback', items: [feedback] }) // PST-289
    const sections = searchSections(query)
    if (sections.length) out.push({ title: 'Jump to', items: sections.map((s) => ({ id: 's-' + s.label, icon: 'arrow-right', label: `Go to ${s.label}`, keys: s.keys, run: close(() => actions.go(s.to, s.search)) })) })
    const notes = searchNotes(investors, query, new Set(found.map((i) => i._id)))
    if (notes.length) out.push({ title: 'In notes', items: notes.map(({ i, quote }) => ({ id: 'n-' + i._id, icon: 'note', label: `${i.name}: “${quote}”`, run: close(() => actions.openInvestor(i)) })) })
    const asked = searchQuestions(questions, query, 3)
    if (asked.length) out.push({ title: 'Questions', items: asked.map(({ q, quote }) => ({ id: 'q-' + q._id, icon: 'spark', label: q.text, meta: quote ?? (q.bestAnswer.trim() ? q.theme : 'Needs an answer'), run: close(() => actions.openQuestion(q._id)) })) })
    return out
  }, [query, investors, actions, meta, onClose, recentsFallback, google, suggestions.length, questions, instant])

  const none = !!query && !groups.length
  const items: Item[] = none ? [{ id: 'add-new', icon: 'plus', label: `Add “${titleCase(query)}” as an investor`, keys: ['↵'], run: () => (onClose(), actions.addInvestor(titleCase(query))) }] : groups.flatMap((g) => g.items)
  const at = Math.min(active, items.length - 1)

  useEffect(() => setActive(0), [query])
  useEffect(() => {
    list.current?.querySelector(`[data-ix="${at}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [at])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      switchMode(asking ? 'search' : 'ask')
    } else if (asking) {
      if (e.key === 'Enter') {
        e.preventDefault()
        void ask(q)
      }
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const n = items.length
      if (n) setActive((x) => (Math.min(x, n - 1) + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      items[at]?.run()
    }
  }

  let ix = 0
  const option = (it: Item) => {
    const n = ix++
    return (
      <div
        key={it.id}
        id={`cmdk-${it.id}`}
        data-ix={n}
        role="option"
        aria-selected={n === at}
        className={`cmdk-item${n === at ? ' is-active' : ''}`}
        style={{ '--i': n } as CSSProperties}
        onMouseMove={() => n !== at && setActive(n)}
        onClick={it.run}
      >
        <Icon name={it.action && n === at ? 'arrow-right' : it.icon} size={18} className="cmdk-item__icon" />
        <span className="cmdk-item__label">{it.label}</span>
        {it.meta ? <span className="cmdk-item__meta">{it.meta}</span> : null}
        {it.keys ? (
          <span className="cmdk-item__keys">
            {it.keys.map((k) => (
              <Kbd key={k}>{k}</Kbd>
            ))}
          </span>
        ) : null}
      </div>
    )
  }

  return (
    <Modal onClose={onClose} label={asking ? 'Ask Nest' : 'Search Nest'} variant="palette" className={`cmdk${asking ? ' cmdk--ask' : ''}`}>
      <div className="cmdk-search">
        {asking ? <Icon name="spark" size={20} className="enrich-spark" /> : <Icon name="search" size={20} />}
        <input
          ref={input}
          autoFocus
          className="cmdk-input"
          role="combobox"
          aria-expanded={!asking}
          aria-controls="cmdk-list"
          aria-autocomplete={asking ? 'none' : 'list'}
          aria-activedescendant={!asking && items[at] ? `cmdk-${items[at].id}` : undefined}
          aria-label={asking ? 'Ask Nest a question about the raise' : 'Search investors, or type a command'}
          placeholder={asking ? 'Ask about the raise…' : 'Search investors, or type a command…'}
          value={q}
          maxLength={asking ? QUESTION_MAX : undefined}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          enterKeyHint={asking ? 'send' : 'go'}
          autoComplete="off"
          spellCheck={asking}
        />
        {asking ? <span className="cmdk-ask-tag" aria-hidden="true">Ask</span> : null}
        {asking && d.ai.connected ? <AskModelChip oneOff={oneOff} onPick={setOneOff} /> : null}
        <button type="button" className="cmdk-close" onClick={onClose} aria-label="Close search">
          <Icon name="close" size={20} />
        </button>
      </div>
      <div className="cmdk-modes" role="group" aria-label="Search or ask">
        {(['search', 'ask'] as const).map((m) => (
          <button key={m} type="button" className="cmdk-mode" aria-pressed={mode === m} onClick={() => switchMode(m)}>
            {m === 'search' ? 'Search' : 'Ask'}
          </button>
        ))}
      </div>
      {asking ? (
        <div className="cmdk-list cmdk-list--ask" id="cmdk-list">
          <AskBody runId={runId} error={askError} onAsk={(x) => void ask(x)} onClose={onClose} actions={actions} />
        </div>
      ) : (
        <div className="cmdk-list" id="cmdk-list" role="listbox" aria-label="Results" ref={list}>
          {none ? (
            <>
              <div className="cmdk-none">
                <NestEmpty size={72} />
                <div>
                  <p className="cmdk-none__title">Nothing in the nest for “{query}”.</p>
                  <p className="cmdk-none__sub">Check the spelling, or add them now.</p>
                </div>
              </div>
              {items.map(option)}
            </>
          ) : (
            groups.map((g) => (
              <div role="group" aria-label={g.title} key={g.title} className="cmdk-group">
                <div className="cmdk-group__title" aria-hidden="true">
                  {g.title}
                </div>
                {g.items.map(option)}
              </div>
            ))
          )}
        </div>
      )}
      <div className="cmdk-foot" aria-hidden="true">
        {asking ? null : (
          <span className="cmdk-foot__key">
            <Kbd>↑↓</Kbd> move
          </span>
        )}
        <span className="cmdk-foot__key">
          <Kbd>↵</Kbd> {asking ? 'ask' : 'run'}
        </span>
        <span className="cmdk-foot__key">
          <Kbd>Tab</Kbd> {asking ? 'search' : 'ask'}
        </span>
        <span className="cmdk-foot__key">
          <Kbd>Esc</Kbd> close
        </span>
        <span className="cmdk-foot__sp" />
        <Kbd>{keyLabel(KEYS.palette)}</Kbd>
      </div>
    </Modal>
  )
}

/**
 * PST-273: Ask's model chip ("Haiku ▾"). A pick applies to the next question
 * only; each choice shows what a question on it should cost.
 */
function AskModelChip({ oneOff, onPick }: { oneOff: Model | null; onPick: (m: Model | null) => void }) {
  const d = useRaise()
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
  const usual = modelFor(d.ai.models, 'ask')
  const now = oneOff ?? usual
  const cost = (m: Model) => estimate('ask', m, d.ai.features.ask.real).usd
  return (
    <>
      <button
        type="button"
        className={'cmdk-model' + (oneOff ? ' is-picked' : '')}
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        aria-label={'Model for this question: ' + MODEL_INFO[now].name}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
      >
        {MODEL_INFO[now].name}
        <Icon name="chevron-down" size={14} />
      </button>
      {anchor ? (
        <Menu
          anchor={anchor}
          title="Model for this question"
          onClose={() => setAnchor(null)}
          items={MODELS.map((m) => ({
            label: MODEL_INFO[m].name + ' · ≈ ' + cents(cost(m)) + (m === usual ? ' · usual' : ''),
            checked: m === now,
            onSelect: () => onPick(m === usual ? null : m),
          }))}
        />
      ) : null}
    </>
  )
}
