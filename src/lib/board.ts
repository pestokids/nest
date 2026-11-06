// The Pipeline board's rules: which stages are columns, what a drop means
// (next, skip, back, passed, parked), its sounds and toast, the [ and ] keys,
// undo, and where a card lands in a column. Pure, shared by the UI and Convex.
import { dayDiff } from './dates'
import { applySave, type Investor, type InvestorFields } from './pipeline'
import { ACTIVE, COMMIT, IDX, type PipelineStage, type Stage } from './stages'
import type { PlayOptions, SoundName } from './sound'

/** Board columns in order ("Not contacted" lives in Investors, not on the board). */
export const BOARD_STAGES = ['ask', 'intro', 'booked', 'm1', 'm2', 'dd', 'verbal', 'signed', 'wired'] as const satisfies readonly PipelineStage[]
/** Hidden by default, shown at the end. */
export const HIDDEN_STAGES = ['passed', 'parked'] as const satisfies readonly Stage[]
export type BoardStage = (typeof BOARD_STAGES)[number] | (typeof HIDDEN_STAGES)[number]
export const BOARD_KEYS: BoardStage[] = [...BOARD_STAGES, ...HIDDEN_STAGES]
export const isBoardStage = (s: unknown): s is BoardStage => (BOARD_KEYS as unknown[]).includes(s)
export const isHiddenStage = (s: Stage): s is (typeof HIDDEN_STAGES)[number] => s === 'passed' || s === 'parked'

/** Column name, its rule (when a card belongs there) and dot colour, from the design. */
export const BOARD: Record<BoardStage, { label: string; rule: string; dot: string }> = {
  ask: { label: 'Asked', rule: 'You asked for an intro, or applied.', dot: '#7C8F84' },
  intro: { label: 'Intro', rule: 'The intro email went out.', dot: '#5E9E7A' },
  booked: { label: 'Booked', rule: 'A meeting is on the calendar.', dot: '#10884C' },
  m1: { label: '1st meeting', rule: 'First call done. Set the next step.', dot: '#10884C' },
  m2: { label: '2nd meeting', rule: 'Partner call or a deeper follow-up.', dot: '#0A5540' },
  dd: { label: 'Diligence', rule: 'They opened the data room.', dot: '#0A5540' },
  verbal: { label: 'Verbal', rule: 'They said a number. Confirm it in writing.', dot: '#86C20F' },
  signed: { label: 'Signed', rule: 'The SAFE is signed.', dot: '#86C20F' },
  wired: { label: 'Money in', rule: 'The wire landed. Celebrate.', dot: '#FF6420' },
  passed: { label: 'Passed', rule: 'They said no. Kept for next round.', dot: '#B4381A' },
  parked: { label: 'Parked', rule: 'Not now. Revisit later.', dot: '#A0998A' },
}
export const boardLabel = (s: Stage) => (isBoardStage(s) ? BOARD[s].label : s === 'todo' ? 'Not contacted' : s)

/* ---------- drops ---------- */

export type MoveKind = 'same' | 'next' | 'skip' | 'back' | 'passed' | 'parked' | 'reopen'
export type Move = { kind: MoveKind; /** Stages jumped over going forward (skip only). */ skipped: BoardStage[]; /** Signed or Money in. */ win: boolean }

/** What dropping a card from `from` onto `to` means. */
export function classifyMove(from: Stage, to: Stage): Move {
  const win = from !== to && (to === 'signed' || to === 'wired')
  if (from === to) return { kind: 'same', skipped: [], win: false }
  if (to === 'passed' || to === 'parked') return { kind: to, skipped: [], win: false }
  const a = IDX[from]
  const b = IDX[to]!
  if (a === undefined) return { kind: 'reopen', skipped: [], win }
  if (b === a + 1) return { kind: 'next', skipped: [], win }
  if (b > a + 1) return { kind: 'skip', skipped: BOARD_STAGES.filter((s) => IDX[s]! > a && IDX[s]! < b), win }
  return { kind: 'back', skipped: [], win: false }
}

export type Cue = { name: SoundName; opts?: PlayOptions }
/** The Sounds card in interactions.png, per drop. */
export function moveSounds(m: Move): Cue[] {
  if (m.kind === 'same') return [{ name: 'card-drop', opts: { volume: 0.7 } }]
  if (m.win) return [{ name: 'signed' }, { name: 'confetti', opts: { delay: 0.1 } }, ...(m.kind === 'skip' ? [{ name: 'rule-check' as const, opts: { delay: 0.5, volume: 0.7 } }] : [])]
  if (m.kind === 'skip') return [{ name: 'rule-check' }]
  if (m.kind === 'next') return [{ name: 'card-drop' }, { name: 'stage-up', opts: { delay: 0.12, volume: 0.8 } }]
  if (m.kind === 'parked') return [{ name: 'park' }]
  if (m.kind === 'back' || m.kind === 'passed') return [{ name: 'card-drop', opts: { rate: 0.85 } }]
  return [{ name: 'card-drop' }]
}

/** Toast copy after a move (none for a drop back where it was). */
export function moveToast(name: string, to: Stage, m: Move): string | null {
  const label = boardLabel(to)
  if (m.kind === 'same') return null
  if (m.kind === 'skip') return `Moved ${name} to ${label}. Skipped ${m.skipped.length === 1 ? 'a stage' : `${m.skipped.length} stages`}, so check its rule.`
  if (m.kind === 'back') return `Moved ${name} back to ${label}`
  if (m.kind === 'passed') return `${name} passed. Kept for next round.`
  if (m.kind === 'parked') return `Parked ${name}. Revisit later.`
  return `Moved ${name} to ${label}`
}

/** `[` and `]` on a focused card: the previous or next board stage, or null (nope). */
export function keyTarget(stage: Stage, key: '[' | ']'): BoardStage | null {
  const ix = (BOARD_STAGES as readonly Stage[]).indexOf(stage)
  if (ix < 0) return null
  const next = BOARD_STAGES[ix + (key === ']' ? 1 : -1)]
  return next ?? null
}
/** A swipe right on a phone: the next stage. */
export const swipeTarget = (stage: Stage) => keyTarget(stage, ']')

/* ---------- saving and undo ---------- */

type Saved = Pick<Investor, 'stage' | 'lastTouch' | 'maxStage'>
/** What a move writes (same rule as saving in the drawer: lastTouch today, maxStage only ever rises). */
export function applyMove(prev: InvestorFields & { maxStage: PipelineStage }, to: Stage, today: string) {
  const r = applySave(prev, { ...prev, stage: to }, today)
  return { patch: { stage: to, lastTouch: r.lastTouch, maxStage: r.maxStage } satisfies Saved, logStage: r.logStage }
}

/** Enough to put a moved card back exactly as it was. */
export type MoveRecord = { id: string; to: Stage; from: { stage: Stage; lastTouch?: string; maxStage: PipelineStage }; activityId?: string | null }

/** Undo patch, or null when the card has moved again since (another tab or another drop). */
export function applyUndo(current: Pick<Investor, 'stage'>, rec: MoveRecord): Saved | null {
  if (current.stage !== rec.to) return null
  return { stage: rec.from.stage, lastTouch: rec.from.lastTouch, maxStage: rec.from.maxStage }
}

/* ---------- column contents ---------- */

/** Live and uncommitted, with no touch in `quietDays`+ days (same rule as Today's quiet list). */
export function quietDaysOf(i: Pick<Investor, 'stage' | 'lastTouch'>, today: string, quietDays: number): number | null {
  if (!ACTIVE.has(i.stage) || COMMIT.has(i.stage)) return null
  if (!i.lastTouch) return Infinity
  const d = dayDiff(today, i.lastTouch)
  return d >= quietDays ? d : null
}

export type ColumnSort = 'attention' | 'amount' | 'name'
export const COLUMN_SORTS: { k: ColumnSort; l: string }[] = [
  { k: 'attention', l: 'Needs attention first' },
  { k: 'amount', l: 'Biggest cheque first' },
  { k: 'name', l: 'Name, A to Z' },
]

export const amountOf = (i: Pick<Investor, 'stage' | 'expected' | 'committed'>) =>
  COMMIT.has(i.stage) ? +(i.committed || i.expected || 0) : +(i.expected || 0)

/** Card order in a column: quiet first (longest quiet first), then by next date, then name. */
export function columnCompare(sort: ColumnSort, today: string, quietDays: number) {
  return (a: Investor, b: Investor) => {
    if (sort === 'amount') return amountOf(b) - amountOf(a) || a.name.localeCompare(b.name)
    if (sort === 'name') return a.name.localeCompare(b.name)
    const qa = quietDaysOf(a, today, quietDays) ?? -1
    const qb = quietDaysOf(b, today, quietDays) ?? -1
    if (qa !== qb) return qb - qa
    return (a.nextDate || '9').localeCompare(b.nextDate || '9') || a.name.localeCompare(b.name)
  }
}

/**
 * Where a card dropped on `to` will land among `others` (that column's cards,
 * without it): the board has no manual order, so the drop slot shows the
 * sorted position the card will take once saved (touched today).
 */
export function landingIndex(others: Investor[], card: Investor, to: Stage, sort: ColumnSort, today: string, quietDays: number) {
  const moved = { ...card, stage: to, lastTouch: card.stage === to ? card.lastTouch : today }
  const cmp = columnCompare(sort, today, quietDays)
  const ix = others.findIndex((o) => cmp(moved, o) < 0)
  return ix < 0 ? others.length : ix
}

/* ---------- filters ---------- */

export type BoardFilter = { q: string; wave: number | null; type: string | null }
export function matchesFilter(i: Investor, f: BoardFilter): boolean {
  if (f.wave && i.wave !== f.wave) return false
  if (f.type && i.type !== f.type) return false
  const q = f.q.trim().toLowerCase()
  if (!q) return true
  return [i.name, i.firm, i.path, i.nextStep, i.notes].some((s) => s && s.toLowerCase().includes(q))
}

/* ---------- keys on a focused card ---------- */

export type CardKey = { do: 'move'; to: BoardStage } | { do: 'nope' } | { do: 'open' } | null
/** Enter opens the card; [ and ] move it a stage back or forward ("nope" at either end or on a closed card). */
export function cardKeyAction(key: string, stage: Stage, mods: { meta?: boolean; ctrl?: boolean; alt?: boolean } = {}): CardKey {
  if (mods.meta || mods.ctrl || mods.alt) return null
  if (key === 'Enter') return { do: 'open' }
  if (key !== '[' && key !== ']') return null
  const to = keyTarget(stage, key)
  return to ? { do: 'move', to } : { do: 'nope' }
}

/* ---------- card text ---------- */

const WARM_SHORT: Record<Investor['warmth'], string> = { existing: 'Existing investor', warm: 'Warm', intro: 'Intro', cold: 'Cold' }
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
/** "Thu 12" */
export const dayLabel = (iso: string) => {
  const t = Date.parse(iso + 'T00:00:00Z')
  return Number.isNaN(t) ? '' : `${DAYS[new Date(t).getUTCDay()]} ${new Date(t).getUTCDate()}`
}
const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s)

export type CardText = {
  sub: string
  chip: string
  amount: string
  foot: string
  tone: 'default' | 'quiet' | 'late' | 'closed'
}
/** What a deal card says, from real fields (design: name, amount, "type · firm", warmth chip, next step or quiet warning). */
export function cardText(i: Investor, today: string, quietDays: number, money: (n: number) => string): CardText {
  const sub = [i.type, i.firm && i.firm.trim().toLowerCase() !== i.name.trim().toLowerCase() ? i.firm : ''].filter(Boolean).join(' · ')
  const amt = amountOf(i)
  if (i.stage === 'passed' || i.stage === 'parked') {
    const ago = i.lastTouch ? dayDiff(today, i.lastTouch) : null
    const verb = i.stage === 'passed' ? 'Passed' : 'Parked'
    return {
      sub,
      chip: i.nextStep ? `${verb} · ${lowerFirst(i.nextStep)}` : verb,
      amount: '–',
      foot: ago === null ? verb : ago <= 0 ? `${verb} today` : `${verb} ${ago} day${ago === 1 ? '' : 's'} ago`,
      tone: 'closed',
    }
  }
  const path = i.path.trim()
  const via = path && !/^(direct|cold|none|-|–)$/i.test(path) ? ` · via ${path}` : path.toLowerCase() === 'direct' ? ' · direct' : ''
  const chip = WARM_SHORT[i.warmth] + via
  const q = quietDaysOf(i, today, quietDays)
  if (q !== null) return { sub, chip, amount: amt ? money(amt) : '–', foot: `${q === Infinity ? 'Quiet' : `${q} days quiet`} · nudge or park`, tone: 'quiet' }
  const next = i.nextStep ? `Next: ${lowerFirst(i.nextStep)}${i.nextDate ? ` · ${dayLabel(i.nextDate)}` : ''}` : i.nextDate ? `Next step due ${dayLabel(i.nextDate)}` : 'No next step yet'
  return { sub, chip, amount: amt ? money(amt) : '–', foot: next, tone: i.nextDate && i.nextDate < today && i.stage !== 'wired' ? 'late' : 'default' }
}
