// PST-290: ⌘K actions on the investor you're searching for, with fuzzy
// matching of the investor plus verbs and stage abbreviations ("orch dd",
// "kite verbal", "log call fern"). Pure, so the matching is unit-tested.
import { rankInvestors, type PaletteInvestor } from './palette'
import { KEYS, type Combo } from './shortcuts'
import { nextStage, STAGE_TILE, type PipelineStage, type Stage } from './stages'

export type LogKind = 'call' | 'email' | 'meeting'
export type ActionKind = 'move' | 'log' | 'lead' | 'decide' | 'draft' | 'no' | 'park'
/** What the words around the investor's name ask for. */
export type Intent = { kind: ActionKind; stage?: PipelineStage; touch?: LogKind }

type Word = { kind?: ActionKind; stage?: PipelineStage; touch?: LogKind }
const WORDS: Record<string, Word> = {
  asked: { stage: 'ask' },
  intro: { stage: 'intro' },
  booked: { stage: 'booked' },
  book: { stage: 'booked' },
  m1: { stage: 'm1' },
  '1st': { stage: 'm1' },
  first: { stage: 'm1' },
  m2: { stage: 'm2' },
  '2nd': { stage: 'm2' },
  second: { stage: 'm2' },
  partner: { stage: 'm2' },
  dd: { stage: 'dd' },
  diligence: { stage: 'dd' },
  verbal: { stage: 'verbal' },
  signed: { stage: 'signed' },
  sign: { stage: 'signed' },
  wired: { stage: 'wired' },
  money: { stage: 'wired' },
  move: { kind: 'move' },
  advance: { kind: 'move' },
  log: { kind: 'log' },
  call: { kind: 'log', touch: 'call' },
  called: { kind: 'log', touch: 'call' },
  email: { kind: 'log', touch: 'email' },
  emailed: { kind: 'log', touch: 'email' },
  meeting: { kind: 'log', touch: 'meeting' },
  met: { kind: 'log', touch: 'meeting' },
  draft: { kind: 'draft' },
  follow: { kind: 'draft' },
  followup: { kind: 'draft' },
  no: { kind: 'no' },
  pass: { kind: 'no' },
  passed: { kind: 'no' },
  park: { kind: 'park' },
  parked: { kind: 'park' },
  lead: { kind: 'lead' },
  decide: { kind: 'decide' },
  deadline: { kind: 'decide' },
}
/** Small words around a command ("mark kite as no", "move orch to dd"), dropped once a command word is there. */
const FILLER = new Set(['to', 'a', 'an', 'the', 'with', 'for', 'as', 'mark', 'up', 'on', 'if', 'set', 'by', 'date', 'ask', 'they', 'theyll', 'will', 'until'])

const tokens = (q: string) => q.toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9]+/).filter(Boolean)

/** A command word, or a prefix of a long one ("dil", "verb", "meet"). */
function wordOf(w: string): Word | null {
  if (WORDS[w]) return WORDS[w]
  if (w.length < 3) return null
  const hit = Object.keys(WORDS).find((k) => k.length >= 5 && k.startsWith(w))
  return hit ? WORDS[hit] : null
}

function intentOf(words: Word[]): Intent | null {
  if (!words.length) return null
  const kinds = new Set(words.map((w) => w.kind).filter(Boolean))
  const stage = words.map((w) => w.stage).filter(Boolean).pop()
  const touch = words.map((w) => w.touch).filter(Boolean).pop()
  if (kinds.has('no')) return { kind: 'no' }
  if (kinds.has('park')) return { kind: 'park' }
  if (stage) return { kind: 'move', stage }
  if (kinds.has('log') || touch) return { kind: 'log', touch: touch ?? 'call' }
  for (const k of ['draft', 'lead', 'decide', 'move'] as const) if (kinds.has(k)) return { kind: k }
  return null
}

export type ActionQuery<T> = { investor: T | null; intent: Intent | null }

/**
 * Split a ⌘K query into the investor it names and what to do with them.
 * Command words are taken out and the rest is matched against names and firms;
 * a word that's part of the matched investor's name stays part of the name
 * ("first round dd" is First Round, to Diligence). When the rest matches nobody,
 * the whole query is a plain search.
 */
export function parseActionQuery<T extends PaletteInvestor>(investors: T[], query: string): ActionQuery<T> {
  const ws = tokens(query)
  const attempt = (isCommand: (w: string) => boolean): ActionQuery<T> | null => {
    const command = ws.filter(isCommand)
    const rest = ws.filter((w) => !isCommand(w) && !FILLER.has(w))
    if (!command.length || !rest.length) return null
    const investor = rankInvestors(investors, rest.join(' '), 1)[0]
    if (!investor) return null
    const named = new Set(tokens(investor.name + ' ' + investor.firm))
    return { investor, intent: intentOf(command.filter((w) => !named.has(w)).map((w) => wordOf(w)!)) }
  }
  // Prefixes of command words first ("dil"), then whole words only, in case a prefix was the name ("mon dd" for Monarch).
  return attempt((w) => !!wordOf(w)) ?? attempt((w) => !!WORDS[w]) ?? { investor: rankInvestors(investors, query, 1)[0] ?? null, intent: null }
}

/** Actions that only exist once their feature does (PST-293's decide-by date, PST-295's "Ask if they'll lead" draft). */
export type ActionFeatures = { decideBy: boolean; askLead: boolean }

export type InvestorAction = { kind: ActionKind; label: string; stage?: Stage; touch?: LogKind; /** The drawer key for it, shown on the row. */ key?: Combo }

const first = (name: string) => name.trim().split(/\s+/)[0] || name
const LOG_LABEL: Record<LogKind, string> = { call: 'a call', email: 'an email', meeting: 'a meeting' }

/** The actions for one investor, the one the query asked for first (system-cmdk-actions.png). */
export function investorActions(inv: { name: string; stage: Stage }, intent: Intent | null, features: ActionFeatures): InvestorAction[] {
  const next = nextStage(inv.stage)
  const to = intent?.kind === 'move' && intent.stage ? intent.stage : next
  const touch = intent?.kind === 'log' ? intent.touch ?? 'call' : 'call'
  const out: InvestorAction[] = [
    ...(to && to !== inv.stage ? [{ kind: 'move' as const, label: 'Move ' + inv.name + ' to ' + STAGE_TILE[to], stage: to, key: to === next ? KEYS.nextStage : undefined }] : []),
    { kind: 'log', label: 'Log ' + LOG_LABEL[touch] + ' with ' + inv.name, touch, key: KEYS.logTouch },
    ...(features.askLead ? [{ kind: 'lead' as const, label: 'Ask ' + first(inv.name) + ' if they’ll lead' }] : []),
    ...(features.decideBy ? [{ kind: 'decide' as const, label: 'Set a decide-by date' }] : []),
    { kind: 'draft', label: 'Draft a follow-up', key: KEYS.draft },
    ...(inv.stage !== 'passed' ? [{ kind: 'no' as const, label: 'Mark as no', key: KEYS.no }] : []),
    { kind: 'park', label: inv.stage === 'parked' ? 'Change the park date' : 'Park until a date' },
  ]
  const at = intent ? out.findIndex((a) => a.kind === intent.kind) : -1
  return at > 0 ? [out[at], ...out.slice(0, at), ...out.slice(at + 1)] : out
}
