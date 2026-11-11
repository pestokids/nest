// PST-307: Settings › AI › Advisor (round6/settings-advisor.png): the default model,
// the monthly cap, web search, what it can see and memory (edit or delete each
// fact, with Undo), and the side card with what an answer costs.
import { useRouterState } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { advisorModelName, costTable, MAX_CAP_USD, monthLine, rangeLine, FACT_MAX } from '../../lib/advisor'
import { formatDay } from '../../lib/dates'
import { OPUS, PRICES, SONNET } from '../../lib/models'
import { play } from '../../lib/sound'
import { errorMessage } from '../data'
import { Menu } from '../system/Menu'
import { Modal, useTitleId } from '../system/Modal'
import { Button, Icon, IconButton, Toggle, useToast } from '../ui'
import { useAdvisor, type MemoryRow } from './data'

declare module '@tanstack/react-router' {
  interface HistoryState {
    /** Open Settings on the Advisor card (the cap notice's "Open Settings"). */
    advisorSettings?: boolean
  }
}

const usd = (n: number) => '$' + (Number.isInteger(n) ? String(n) : n.toFixed(2))

export function AdvisorCard() {
  const a = useAdvisor()
  const toast = useToast()
  const o = a.overview
  const card = useRef<HTMLElement>(null)
  const [menu, setMenu] = useState(false)
  const [capEdit, setCapEdit] = useState<string | null>(null)
  const [memory, setMemory] = useState(false)
  const modelBtn = useRef<HTMLButtonElement>(null)
  const jump = useRouterState({ select: (s) => s.location.state.advisorSettings })
  useEffect(() => {
    if (jump && o) card.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [jump, o])

  const set = (p: Parameters<typeof a.setSettings>[0]) =>
    a.setSettings(p).then(
      () => play('save'),
      (e) => {
        play('save-failed')
        toast({ tone: 'error', message: errorMessage(e) })
      },
    )
  const saveCap = () => {
    const n = Number((capEdit ?? '').replace(/[$,\s]/g, ''))
    setCapEdit(null)
    if (!Number.isFinite(n) || n < 0 || n > MAX_CAP_USD) {
      toast({ tone: 'error', message: 'The cap has to be between $0 and $' + MAX_CAP_USD + '.' })
      return
    }
    if (o && n !== o.settings.capUsd) void set({ capUsd: n })
  }

  if (!o)
    return (
      <section className="set-card adv-set" aria-labelledby="adv-set-title" aria-busy="true">
        <h2 id="adv-set-title">Advisor</h2>
        <span className="sk" style={{ display: 'block', width: '100%', height: 200, borderRadius: 14, marginTop: 20 }} />
      </section>
    )
  const s = o.settings
  return (
    <section ref={card} id="advisor" className="set-card adv-set" aria-labelledby="adv-set-title">
      <h2 id="adv-set-title">Advisor</h2>
      <p className="set-card__lede">A fundraising coach and storyteller that reads all of Nest. It drafts and suggests; it never sends or changes anything itself.</p>
      <ul className="adv-set__rows">
        <li>
          <div>
            <span className="adv-set__title">Default model</span>
            <span className="adv-set__sub">{advisorModelName(s.model)} · switch any chat to {advisorModelName(s.model === OPUS ? SONNET : OPUS)} for {s.model === OPUS ? 'quick questions' : 'hard questions'}</span>
          </div>
          <button ref={modelBtn} type="button" className="adv-set__chip" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(true)}>
            {advisorModelName(s.model)} <Icon name="chevron-down" size={14} />
          </button>
        </li>
        <li>
          <div>
            <label className="adv-set__title" htmlFor="adv-set-cap">
              Monthly cap
            </label>
            <span className="adv-set__sub">Stops before it goes over; you can raise it any time</span>
          </div>
          {capEdit !== null ? (
            <input
              id="adv-set-cap"
              className="adv-set__cap"
              inputMode="decimal"
              autoFocus
              value={capEdit}
              onChange={(e) => setCapEdit(e.target.value)}
              onBlur={saveCap}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveCap()
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  setCapEdit(null)
                }
              }}
            />
          ) : (
            <button id="adv-set-cap" type="button" className="adv-set__chip num" aria-label={'Monthly cap ' + usd(s.capUsd) + ', change'} onClick={() => setCapEdit(String(s.capUsd))}>
              {usd(s.capUsd)}
            </button>
          )}
        </li>
        <li>
          <div>
            <span className="adv-set__title" id="adv-set-web">
              Web search
            </span>
            <span className="adv-set__sub">For firm facts and market data, with sources shown</span>
          </div>
          <Toggle aria-labelledby="adv-set-web" checked={s.web} onChange={(e) => void set({ web: e.target.checked })} />
        </li>
        <li>
          <div>
            <span className="adv-set__title">What it can see</span>
            <span className="adv-set__sub">Investors, notes, emails Nest has read, the round, plan, Q&A and materials. Read-only.</span>
          </div>
          <span className="adv-set__chip is-static">All of Nest</span>
        </li>
        <li>
          <div>
            <span className="adv-set__title">Memory</span>
            <span className="adv-set__sub">
              Facts it keeps between chats ({o.memoryCount}), each one only after you said yes. You can edit or delete any.
            </span>
          </div>
          <Button size="sm" onClick={() => setMemory(true)}>
            Review
          </Button>
        </li>
      </ul>
      {!o.connected ? <p className="adv-set__off">AI isn’t set up here: add ANTHROPIC_API_KEY to this Convex deployment to use the Advisor.</p> : null}
      {menu ? (
        <Menu
          anchor={modelBtn.current}
          title="Default model"
          onClose={() => setMenu(false)}
          items={([SONNET, OPUS] as const).map((m) => ({ label: advisorModelName(m), checked: s.model === m, onSelect: () => void set({ model: m }) }))}
        />
      ) : null}
      {memory ? <MemoryDialog onClose={() => setMemory(false)} /> : null}
    </section>
  )
}

/** The side card: what an answer costs, and this month against the cap. */
export function AdvisorCosts() {
  const o = useAdvisor().overview
  if (!o) return null
  const m = monthLine(o.monthUsd, o.settings.capUsd)
  return (
    <section className="set-card adv-costs" aria-labelledby="adv-costs-title">
      <h2 id="adv-costs-title" className="adv-eyebrow">
        What it costs
      </h2>
      <ul className="adv-costs__rows">
        {costTable().map((r) => (
          <li key={r.label}>
            <span>
              <span className="adv-costs__label">{r.label}</span>
              <span className="adv-costs__model">{r.model}</span>
            </span>
            <span className="adv-costs__usd num">{rangeLine(r.usd)}</span>
          </li>
        ))}
        <li>
          <span>
            <span className="adv-costs__label">Web search</span>
            <span className="adv-costs__model">per search</span>
          </span>
          <span className="adv-costs__usd num">{Math.round(PRICES.webSearch * 100)}¢</span>
        </li>
      </ul>
      <p className="adv-costs__month">
        This month: {m.text} · {o.monthAnswers} answer{o.monthAnswers === 1 ? '' : 's'}
      </p>
    </section>
  )
}

function MemoryDialog({ onClose }: { onClose: () => void }) {
  const a = useAdvisor()
  const toast = useToast()
  const rows = a.useMemory()
  const titleId = useTitleId()
  const [editing, setEditing] = useState<string | null>(null)
  const [text, setText] = useState('')
  const fail = (e: unknown) => {
    play('save-failed')
    toast({ tone: 'error', message: errorMessage(e) })
  }
  const save = (r: MemoryRow) => {
    const t = text.replace(/\s+/g, ' ').trim()
    setEditing(null)
    if (t && t !== r.fact) void a.editMemory(r._id, t).then(() => play('save'), fail)
  }
  const remove = (r: MemoryRow) => {
    play('remove')
    const gone = a.deleteMemory(r._id)
    gone.catch(fail)
    toast({
      tone: 'info',
      icon: 'trash',
      message: 'Forgot “' + (r.fact.length > 40 ? r.fact.slice(0, 39) + '…' : r.fact) + '”.',
      action: {
        label: 'Undo',
        onClick: () => {
          play('undo')
          void gone.then((b) => b && a.restoreMemory(b)).catch(fail)
        },
      },
    })
  }
  return (
    <Modal onClose={onClose} labelledBy={titleId} className="adv-memory-dialog">
      <h2 id={titleId}>Memory</h2>
      <p className="adv-memory-dialog__lede">What the Advisor keeps between chats. Each came from a “Remember this?” you said yes to.</p>
      {!rows ? (
        <span className="sk" style={{ display: 'block', height: 120, borderRadius: 14 }} />
      ) : rows.length ? (
        <ul className="adv-memory-dialog__list">
          {rows.map((r) => (
            <li key={r._id}>
              {editing === r._id ? (
                <input
                  className="adv-memory-dialog__input"
                  value={text}
                  maxLength={FACT_MAX}
                  aria-label="The fact"
                  autoFocus
                  onChange={(e) => setText(e.target.value)}
                  onBlur={() => save(r)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') save(r)
                    if (e.key === 'Escape') {
                  e.stopPropagation()
                  setEditing(null)
                }
                  }}
                />
              ) : (
                <div className="adv-memory-dialog__fact">
                  <span>{r.fact}</span>
                  <span className="adv-memory-dialog__meta">
                    {formatDay(r.createdAt)}
                    {r.chat ? ' · from “' + r.chat + '”' : ''}
                  </span>
                </div>
              )}
              <span className="adv-memory-dialog__tools">
                <IconButton
                  icon="edit"
                  label={'Edit “' + r.fact + '”'}
                  size="sm"
                  onClick={() => {
                    setText(r.fact)
                    setEditing(r._id)
                  }}
                />
                <IconButton icon="trash" label={'Delete “' + r.fact + '”'} size="sm" onClick={() => remove(r)} />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="adv-memory-dialog__none">Nothing yet. When the Advisor learns something worth keeping, it asks “Remember this?” first.</p>
      )}
      <div className="adv-memory-dialog__foot">
        <Button onClick={onClose}>Done</Button>
      </div>
    </Modal>
  )
}
