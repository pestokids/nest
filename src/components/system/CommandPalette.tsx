import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { QUESTION_MAX } from '../../lib/ask'
import { onOpenCommandPalette, recentInvestors, rememberInvestor } from '../../lib/commandPalette'
import { todayIST } from '../../lib/dates'
import { addressesOf, gmailSearchLink } from '../../lib/google'
import { dayMonth } from '../../lib/home'
import { dayLabel, isQuiet } from '../../lib/investorView'
import { matchScore, rankInvestors, searchNotes, searchSections, titleCase } from '../../lib/palette'
import { searchQuestions } from '../../lib/qanda'
import type { Investor } from '../../lib/pipeline'
import { play } from '../../lib/sound'
import { IDX, STAGE_TILE, STAGES } from '../../lib/stages'
import { ASK_NOTE, askFollowUp } from '../../lib/today'
import { errorMessage, useRaise } from '../data'
import { openDraft } from '../drafts/data'
import { NestEmpty } from '../illustrations'
import { useQanda } from '../qanda/data'
import { openPanel, playPrepOpen } from '../qanda/panels'
import { AskBody } from './AskNest'
import type { OpenOptions } from '../raise-ui'
import { Icon, Kbd, useToast, type IconName } from '../ui'
import { Modal } from './Modal'
import { PREVIEW_ASK_QUESTIONS, usePreviewState } from '../preview-state'
import { useSaveAction } from './useSaveAction'

type Item = { id: string; icon: IconName; label: ReactNode; meta?: ReactNode; keys?: string[]; run: () => void }
type Group = { title: string; items: Item[] }

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
const first = (name: string) => name.trim().split(/\s+/)[0]

type Mode = 'search' | 'ask'

/**
 * ⌘K (system/cmdk-*.png): search investors by name and firm, act on the top
 * match, jump to a section. ↑↓ move, ↵ opens, Esc closes. A full-height sheet
 * on phones. Also owns the single-key shortcuts it advertises (N, I, G then P…).
 * PST-279: Tab (or the chips) switches to Ask, where ↵ asks Nest the question.
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

  // ?preview&system=cmdk|cmdk-empty|cmdk-none
  useEffect(() => {
    const s = flags?.system
    if (s === 'cmdk' || s === 'cmdk-empty' || s === 'cmdk-none') {
      setQ(s === 'cmdk' ? 'orch' : s === 'cmdk-none' ? 'nightjar' : '')
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
      if (open || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || document.querySelector('.sys-modal, [aria-modal="true"]')) return
      const k = e.key.toLowerCase()
      if (Date.now() - g < 1200) {
        g = 0
        const to = { h: '/', t: '/raise/today', p: '/raise/pipeline', i: '/raise/investors', q: '/raise/qanda', l: '/raise/plan', s: '/raise/settings' }[k]
        if (to) {
          e.preventDefault()
          actions.go(to)
        }
        return
      }
      if (k === 'g') g = Date.now()
      else if (k === 'n') {
        e.preventDefault()
        actions.addInvestor()
      } else if (k === 'i') {
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
      go: (to: string) => void navigate({ to }),
      openInvestor: (i: Investor) => {
        rememberInvestor(i._id)
        openDrawer(i._id)
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
      draft: (i: Investor) => {
        if (!inRaise) void navigate({ to: '/raise/today' })
        openDraft({ investorId: i._id })
      },
      logAsk: (i: Investor) => {
        const next = askFollowUp(todayIST())
        void save(() => d.logNote(i._id, ASK_NOTE, { touch: 'ask', next }), {
          failMessage: `Couldn’t log the ask for ${i.name}.`,
          onDone: () => {
            play('ask-logged')
            toast(`Ask logged for ${i.name}. Follow-up set for ${dayMonth(next.date)}.`)
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
  const input = useRef<HTMLInputElement>(null)
  const asking = mode === 'ask'

  const ask = useCallback(
    async (question: string) => {
      const text = question.trim()
      if (!text || !d.ai.connected) return
      setQ(text)
      setAskError(null)
      setRunId(null)
      try {
        setRunId(await d.ask(text))
      } catch (e) {
        setAskError(errorMessage(e))
      }
    },
    [d],
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
      if (quiet) bits.push('quiet')
      else if (long && i.nextDate && i.nextDate >= today) bits.push(`due ${dayLabel(i.nextDate, today).split(' ')[0]}`)
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
        { title: 'Quick actions', items: n ? [review, ...quick] : quick },
      ]
    }
    const found = rankInvestors(investors, query, 5)
    const top = found[0]
    const out: Group[] = []
    if (found.length) out.push({ title: 'Investors', items: found.map((i) => person(i, true)) })
    if (top) {
      const nx = IDX[top.stage] !== undefined && IDX[top.stage]! < STAGES.length - 1 ? STAGES[IDX[top.stage]! + 1] : null
      out.push({
        title: 'Actions',
        items: [
          { id: 'x-log', icon: 'note', label: `Log a touch for ${first(top.name)}`, run: close(() => actions.openInvestor(top)) },
          ...(nx ? [{ id: 'x-move', icon: 'arrow-right' as IconName, label: `Move ${first(top.name)} to ${STAGE_TILE[nx.k]}`, run: close(() => actions.advance(top)) }] : []),
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
    if (n && ['review suggestions', 'suggestions', 'suggested fixes', 'fix the list'].some((t) => matchScore(t, query) > 0)) out.push({ title: 'Suggestions', items: [review] })
    const sections = searchSections(query)
    if (sections.length) out.push({ title: 'Jump to', items: sections.map((s) => ({ id: 's-' + s.to, icon: 'arrow-right', label: `Go to ${s.label}`, keys: s.keys, run: close(() => actions.go(s.to)) })) })
    const notes = searchNotes(investors, query, new Set(found.map((i) => i._id)))
    if (notes.length) out.push({ title: 'In notes', items: notes.map(({ i, quote }) => ({ id: 'n-' + i._id, icon: 'note', label: `${i.name}: “${quote}”`, run: close(() => actions.openInvestor(i)) })) })
    const asked = searchQuestions(questions, query, 3)
    if (asked.length) out.push({ title: 'Questions', items: asked.map(({ q, quote }) => ({ id: 'q-' + q._id, icon: 'spark', label: q.text, meta: quote ?? (q.bestAnswer.trim() ? q.theme : 'Needs an answer'), run: close(() => actions.openQuestion(q._id)) })) })
    return out
  }, [query, investors, actions, meta, onClose, recentsFallback, google, suggestions.length, questions])

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
        <Icon name={it.icon} size={18} className="cmdk-item__icon" />
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
        {asking ? (
          <span>↵ to ask</span>
        ) : (
          <>
            <span>↑↓ to move</span>
            <span>·</span>
            <span>↵ to open</span>
          </>
        )}
        <span>·</span>
        <span>tab to {asking ? 'search' : 'ask'}</span>
        <span>·</span>
        <span>esc to close</span>
        <span className="cmdk-foot__sp" />
        <Kbd>⌘K</Kbd>
      </div>
    </Modal>
  )
}
