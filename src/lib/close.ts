// PST-283 Close: closing records, the money ladder, reminders, the round
// modeller and the cap table after the close. Pure functions over plain data,
// shared by the UI and Convex.
//
// Nest tracks signing only. SAFEs are signed outside Nest, in any tool; each
// step (sent, viewed, signed, countersigned, wire instructions, wired) is a
// tick with a date that someone sets by hand.
import { boardLabel, classifyMove } from './board'
import { dayDiff, formatDay, isISODate, weekdayOf } from './dates'
import { exactMoney, money } from './money'
import type { Investor } from './pipeline'
import { COMMIT, type Stage } from './stages'

/* ---------- closing records ---------- */

export const STEP_KEYS = ['sent', 'viewed', 'signed', 'countersigned', 'wireSent', 'wired'] as const
export type StepKey = (typeof STEP_KEYS)[number]
export type Step = { key: StepKey; at: string }

export const CLOSE_INSTRUMENTS = ['post-money SAFE', 'pre-money SAFE', 'convertible note'] as const
export const DEFAULT_INSTRUMENT = 'post-money SAFE'

/** What a closing record says about the cheque. `discount` is a share: 0.2 = 20%. */
export type ClosingTerms = {
  amount: number
  instrument: string
  cap: number
  discount?: number
  proRata: boolean
  mfn: boolean
  sideLetter?: string
  signedUrl?: string
  requestUrl?: string
  signerName?: string
  signerEmail?: string
}
/** PST-291: questionnaire status; absent means not sent yet. */
export type Questionnaire = 'sent' | 'received'
/**
 * PST-291 (all optional): the tranche (absent = 1), when the written
 * confirmation went (starts the 48-hour offer), when they accepted (epoch ms),
 * and the investor questionnaire. See src/lib/closeKit.ts.
 */
export type ClosingKit = { tranche?: number; confirmationSentAt?: number; acceptedAt?: number; questionnaire?: Questionnaire }
export type Closing = ClosingTerms & ClosingKit & { _id: string; investorId: string; steps: Step[] }

/**
 * Each step, the step that has to be ticked before it, and whether it can be
 * left out. "Viewed" depends on the signing tool, and some investors wire
 * without separate instructions, so those two are optional.
 */
export const STEPS: Record<StepKey, { label: string; after: StepKey | null; optional?: boolean }> = {
  sent: { label: 'SAFE sent', after: null },
  viewed: { label: 'Viewed', after: 'sent', optional: true },
  signed: { label: 'Signed by them', after: 'sent' },
  countersigned: { label: 'Countersigned', after: 'signed' },
  wireSent: { label: 'Wire instructions sent', after: 'countersigned', optional: true },
  wired: { label: 'Wired', after: 'countersigned' },
}

export type StepMap = Partial<Record<StepKey, string>>
export const stepMap = (c: Pick<Closing, 'steps'> | null | undefined): StepMap => Object.fromEntries((c?.steps ?? []).map((s) => [s.key, s.at]))

const dependents = (key: StepKey) => STEP_KEYS.filter((k) => STEPS[k].after === key)

/**
 * Whether `key` can be ticked (or, when already ticked, moved) to day `at`.
 * Returns the reason when it can't: steps go in order, a step can't be dated
 * before the one it follows or after the ones that follow it, or in the future.
 */
export function checkTick(steps: Step[], key: StepKey, at: string, today: string): string | null {
  if (!isISODate(at)) return 'Pick a date.'
  if (at > today) return 'Can’t be in the future.'
  const s = stepMap({ steps })
  const after = STEPS[key].after
  if (after && !s[after]) return `Tick “${STEPS[after].label}” first.`
  if (after && s[after]! > at) return `Can’t be before “${STEPS[after].label}”.`
  for (const d of dependents(key)) if (s[d] && s[d]! < at) return `Can’t be after “${STEPS[d].label}”.`
  return null
}

/** Whether `key` can be unticked: nothing ticked may depend on it. */
export function checkUntick(steps: Step[], key: StepKey): string | null {
  const s = stepMap({ steps })
  if (!s[key]) return 'Not ticked.'
  const d = dependents(key).find((k) => s[k])
  return d ? `Untick “${STEPS[d].label}” first.` : null
}

/** Steps with `key` set to `at` (null unticks), in step order. */
export function setStep(steps: Step[], key: StepKey, at: string | null): Step[] {
  const rest = steps.filter((s) => s.key !== key)
  const next = at ? [...rest, { key, at }] : rest
  return next.sort((a, b) => STEP_KEYS.indexOf(a.key) - STEP_KEYS.indexOf(b.key))
}

/** The pipeline stage a step stands for: a signed SAFE is Signed, a wire is Money in. */
const STEP_STAGE: Partial<Record<StepKey, 'signed' | 'wired'>> = { signed: 'signed', wired: 'wired' }

export type StageMove = { to: Stage | null; error?: string }

/**
 * What ticking (or unticking) a step does to the investor's pipeline stage,
 * using the board's rules (src/lib/board.ts classifyMove):
 *
 * - Ticking "Signed by them" moves Verbal → Signed; ticking "Wired" moves
 *   Signed → Money in. Only a one-stage move forward is made.
 * - A tick that would skip a stage (Diligence → Signed) is refused, so the
 *   card never jumps past a stage whose rule isn't true.
 * - A card that is already further along, passed or parked stays put; only
 *   the record changes.
 * - Unticking undoes the move the tick made, and only while the card is still
 *   in that stage: Money in → Signed, Signed → Verbal.
 */
export function stageMove(stage: Stage, key: StepKey, ticked: boolean): StageMove {
  const target = STEP_STAGE[key]
  if (!target) return { to: null }
  if (!ticked) return stage === target ? { to: target === 'wired' ? 'signed' : 'verbal' } : { to: null }
  const m = classifyMove(stage, target)
  if (m.kind === 'next') return { to: target }
  if (m.kind === 'skip') {
    const before = target === 'wired' ? 'signed' : 'verbal'
    return { to: null, error: `That would skip ${m.skipped.length === 1 ? 'a stage' : `${m.skipped.length} stages`} on the pipeline. Move them to ${boardLabel(before)} first.` }
  }
  return { to: null }
}

/**
 * One tick, re-date (`at` on a ticked step) or untick (`at: null`): the new steps
 * and the stage to move to, or why it can't be done. Re-dating moves nothing.
 * Convex (closings.tick) and the preview both write through this.
 */
export function planTick(c: Pick<Closing, 'steps'>, stage: Stage, key: StepKey, at: string | null, today: string): { error: string } | { steps: Step[]; to: Stage | null } {
  const redate = !!at && !!stepMap(c)[key]
  const err = at ? checkTick(c.steps, key, at, today) : checkUntick(c.steps, key)
  if (err) return { error: err }
  const move = redate ? { to: null } : stageMove(stage, key, !!at)
  if (move.error) return { error: move.error }
  return { steps: setStep(c.steps, key, at), to: move.to }
}

/* ---------- the money ladder ---------- */

export const RUNGS = ['soft', 'verbal', 'sent', 'signed', 'wired'] as const
export type Rung = (typeof RUNGS)[number]
export const RUNG_LABEL: Record<Rung, string> = { soft: 'Soft circle', verbal: 'Verbal', sent: 'SAFE sent', signed: 'Signed', wired: 'Wired' }

/** Stages where an Expected amount counts as a soft circle: past a first meeting, before a number. */
export const SOFT_STAGES = new Set<Stage>(['m2', 'dd'])

/** The rung an investor is on, or null when they aren't on the ladder. Committed stages win over the record. */
export function rungOf(i: Pick<Investor, 'stage' | 'expected'>, c?: Pick<Closing, 'steps'> | null): Rung | null {
  const s = stepMap(c)
  if (COMMIT.has(i.stage)) {
    if (i.stage === 'wired' || s.wired) return 'wired'
    if (i.stage === 'signed' || s.signed) return 'signed'
    return s.sent ? 'sent' : 'verbal'
  }
  return SOFT_STAGES.has(i.stage) && (i.expected ?? 0) > 0 ? 'soft' : null
}

/** The amount on the ladder: the closing record's, else Committed (or Expected) once committed, else Expected. */
export const ladderAmount = (i: Pick<Investor, 'stage' | 'expected' | 'committed'>, c?: Pick<Closing, 'amount'> | null) =>
  c?.amount ?? (COMMIT.has(i.stage) ? +(i.committed || i.expected || 0) : +(i.expected || 0))

export type NextAction = 'confirm' | 'record' | 'remind' | 'countersign' | 'wired' | null
export const ACTION_LABEL: Record<Exclude<NextAction, null>, string> = {
  confirm: 'Confirm amount', record: 'Record SAFE sent', remind: 'Remind', countersign: 'Countersign', wired: 'Mark wired',
}

/** The one button on a closing row. */
export function nextAction(rung: Rung, c?: Pick<Closing, 'steps'> | null): NextAction {
  if (rung === 'soft') return 'confirm'
  if (rung === 'wired') return null
  const s = stepMap(c)
  if (!s.sent) return 'record'
  if (!s.signed) return 'remind'
  if (!s.countersigned) return 'countersign'
  return s.wired ? null : 'wired'
}

export type CloseRow = { investor: Investor; closing: Closing | null; rung: Rung; amount: number; action: NextAction }

export type Ladder = {
  rows: CloseRow[]
  rungs: Record<Rung, { amount: number; count: number }>
  /** Verbal and later: the same "committed" as Today and Plan (soft circles aren't in it). */
  committed: number
  /** Everything on the ladder, soft circles included. */
  total: number
}

/** The ladder and the closing table, furthest along first, then biggest cheque. */
export function ladder(investors: Investor[], closings: Closing[]): Ladder {
  const by = new Map(closings.map((c) => [c.investorId, c]))
  const rows: CloseRow[] = []
  for (const investor of investors) {
    const closing = by.get(investor._id) ?? null
    const rung = rungOf(investor, closing)
    if (!rung) continue
    rows.push({ investor, closing, rung, amount: ladderAmount(investor, closing), action: nextAction(rung, closing) })
  }
  rows.sort((a, b) => RUNGS.indexOf(b.rung) - RUNGS.indexOf(a.rung) || b.amount - a.amount || a.investor.name.localeCompare(b.investor.name))
  const rungs = Object.fromEntries(RUNGS.map((r) => [r, { amount: 0, count: 0 }])) as Ladder['rungs']
  for (const r of rows) {
    rungs[r.rung].amount += r.amount
    rungs[r.rung].count++
  }
  const total = rows.reduce((a, r) => a + r.amount, 0)
  return { rows, rungs, committed: total - rungs.soft.amount, total }
}

/* ---------- how a row reads ---------- */

/** "today", "Tue" within the last 6 days, else "Tue 3 Nov". */
export function stepDay(iso: string, today: string): string {
  if (!isISODate(iso)) return ''
  const n = dayDiff(today, iso)
  if (n === 0) return 'today'
  if (n > 0 && n <= 6) return weekdayOf(iso)
  return formatDay(iso)
}

/** The SAFE column, and whether it waits on someone (shown in orange). */
export function safeStatus(c: Pick<Closing, 'steps'> | null | undefined, today: string): { text: string; waiting: boolean } {
  const s = stepMap(c)
  if (s.countersigned) return { text: `Signed both sides · ${stepDay(s.countersigned, today)}`, waiting: false }
  if (s.signed) return { text: `Signed ${stepDay(s.signed, today)} · your turn`, waiting: true }
  if (s.viewed) return { text: `Viewed ${stepDay(s.viewed, today)} · not signed`, waiting: true }
  if (s.sent) return { text: `Sent ${stepDay(s.sent, today)} · not signed`, waiting: true }
  return { text: 'Not sent', waiting: false }
}

/** The wire column. */
export function wireStatus(c: Pick<Closing, 'steps'> | null | undefined, today: string): string {
  const s = stepMap(c)
  if (s.wired) return `Wired ${stepDay(s.wired, today)}`
  if (s.wireSent) return 'Instructions sent'
  return '–'
}

/** "$16M post cap · 20% discount · pro-rata · MFN · side letter". */
export function termsLine(t: Partial<ClosingTerms> | null | undefined): string {
  if (!t || !t.cap) return '–'
  const inst = t.instrument ?? DEFAULT_INSTRUMENT
  const kind = inst.startsWith('post') ? ' post' : inst.startsWith('pre') ? ' pre' : ''
  return [
    `${money(t.cap)}${kind} cap`,
    t.discount ? `${Math.round(t.discount * 100)}% discount` : '',
    t.proRata ? 'pro-rata' : '',
    t.mfn ? 'MFN' : '',
    t.sideLetter?.trim() ? 'side letter' : '',
  ].filter(Boolean).join(' · ')
}

/* ---------- validation ---------- */

export const isUrl = (s: string) => /^https?:\/\/[^\s/$.?#][^\s]*$/i.test(s.trim())
const isEmailish = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim())
const pos = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x > 0

/** Field-keyed errors for a closing record's terms. Empty when valid. */
export function validateTerms(t: ClosingTerms): Record<string, string> {
  const e: Record<string, string> = {}
  if (!pos(t.amount)) e.amount = 'Must be more than $0.'
  if (!pos(t.cap)) e.cap = 'Must be more than $0.'
  if (!t.instrument.trim()) e.instrument = 'Required, e.g. post-money SAFE.'
  if (t.discount !== undefined && (!Number.isFinite(t.discount) || t.discount < 0 || t.discount >= 1)) e.discount = 'Between 0% and 99%, or leave empty.'
  if (t.signerEmail?.trim() && !isEmailish(t.signerEmail)) e.signerEmail = 'Not an email address.'
  if (t.requestUrl?.trim() && !isUrl(t.requestUrl)) e.requestUrl = 'A link starting with https://'
  if (t.signedUrl?.trim() && !isUrl(t.signedUrl)) e.signedUrl = 'A link starting with https://'
  return e
}

const OPTIONAL_TEXT = ['sideLetter', 'signedUrl', 'requestUrl', 'signerName', 'signerEmail'] as const

/** Just the terms of a stored record (drops ids, steps and bookkeeping), to save it again with a change. */
export function termsOf(c: ClosingTerms): ClosingTerms {
  const out: ClosingTerms = { amount: c.amount, instrument: c.instrument, cap: c.cap, proRata: c.proRata, mfn: c.mfn }
  if (c.discount !== undefined) out.discount = c.discount
  for (const k of OPTIONAL_TEXT) if (c[k] !== undefined) out[k] = c[k]
  return out
}

/** Trim, and drop empty optional strings and a zero discount. */
export function cleanTerms(t: ClosingTerms): ClosingTerms {
  const out: ClosingTerms = { amount: t.amount, instrument: t.instrument.trim(), cap: t.cap, proRata: t.proRata, mfn: t.mfn }
  if (t.discount) out.discount = t.discount
  for (const k of OPTIONAL_TEXT) {
    const v = t[k]?.trim()
    if (v) out[k] = v
  }
  return out
}

/* ---------- reminders ---------- */

export type ReminderKind = 'sign' | 'wire'

/** Which reminder fits: signing until they sign, the wire once both sides have. Null when it's on you, or done. */
export function reminderKind(c: Pick<Closing, 'steps'> | null | undefined): ReminderKind | null {
  const s = stepMap(c)
  if (!s.sent || s.wired) return null
  if (!s.signed) return 'sign'
  return s.countersigned ? 'wire' : null
}

const sentPhrase = (iso: string, today: string) => {
  const n = dayDiff(today, iso)
  if (n <= 0) return 'today'
  if (n === 1) return 'yesterday'
  if (n <= 6) return `on ${weekdayOf(iso)}`
  return `on ${formatDay(iso)}`
}

/**
 * A short, polite reminder to copy, share on WhatsApp or email. Says what was
 * sent and when, links the signing request when there is one, and is signed
 * with your first name.
 */
export function reminderText({ kind, investorName, closing, me, today }: {
  kind: ReminderKind
  investorName: string
  closing: Pick<Closing, 'amount' | 'steps' | 'signerName' | 'requestUrl'>
  me: string
  today: string
}): { subject: string; text: string } {
  const s = stepMap(closing)
  const first = closing.signerName?.trim().split(/\s+/)[0]
  const hi = first ? `Hi ${first},` : `Hi ${investorName.trim() || 'there'} team,`
  const amount = exactMoney(closing.amount)
  const bye = me.trim() ? `\n\nThanks so much,\n${me.trim()}` : '\n\nThanks so much'
  if (kind === 'sign') {
    const when = s.sent ? ` I sent it ${sentPhrase(s.sent, today)}.` : ''
    const link = closing.requestUrl ? `\n\nHere’s the link again: ${closing.requestUrl}` : ''
    return {
      subject: `Your SAFE for ${amount}: a gentle reminder`,
      text: `${hi}\n\nA gentle nudge on the SAFE for your ${amount} investment, whenever you have a moment.${when}${link}\n\nHappy to jump on a call if anything in it needs a second look.${bye}`,
    }
  }
  const instructions = s.wireSent
    ? ` The wire instructions went out ${sentPhrase(s.wireSent, today)}; I can send them again if that helps.`
    : ' I can send the wire instructions again if that helps.'
  return {
    subject: `Your ${amount} wire: a gentle reminder`,
    text: `${hi}\n\nThank you again for signing. A gentle reminder that the ${amount} wire is the last step.${instructions}\n\nLet me know once it’s on its way, so I can look out for it.${bye}`,
  }
}

/** WhatsApp's share link with the text filled in (you pick who to send it to). */
export const whatsappUrl = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`

/* ---------- the round modeller ---------- */

/*
 * SAFE conversion maths, for post-money SAFEs (the YC post-money SAFE).
 * Estimates only: the documents and a lawyer decide.
 *
 * A post-money SAFE buys a fixed share of the company as it stands just before
 * the next priced round. That base (the "company capitalization") counts every
 * SAFE converting at the same time and the option pool, so each SAFE's share
 * doesn't depend on the others:
 *
 *   ownership = amount ÷ post-money valuation cap
 *
 * With a discount, the SAFE converts at the priced round's price × (1 − discount)
 * when that's the lower price. Measured against the same base, that is the
 * same as valuing the company at (1 − discount) × the next round's pre-money
 * valuation, so the SAFE takes whichever valuation is lower:
 *
 *   ownership = amount ÷ min(cap, (1 − discount) × next pre-money)
 *
 * Without a next pre-money to compare with, the discount can't be priced and
 * the cap is used.
 *
 * MFN (most favoured nation): the holder gets the best terms of the other SAFEs
 * in the model, the lowest cap and the highest discount, when they beat their own.
 *
 * Founders and the pool share what's left:
 *
 *   SAFE holders = Σ ownership
 *   option pool  = the pool's share after the round
 *   founders     = 1 − SAFE holders − option pool
 *
 * The three add up to 100% by construction.
 */
export type Safe = { id: string; name: string; amount: number; cap: number; discount?: number; mfn?: boolean; proRata?: boolean; angel?: boolean }
export type Converted = Safe & { terms: { cap: number; discount: number }; valuation: number; ownership: number }

/** The cap and discount a SAFE converts on: its own, or for MFN, the best of the others' when better. */
export function effectiveTerms(safe: Safe, all: Safe[]): { cap: number; discount: number } {
  const own = { cap: safe.cap, discount: safe.discount ?? 0 }
  if (!safe.mfn) return own
  const others = all.filter((s) => s.id !== safe.id)
  return {
    cap: Math.min(own.cap, ...others.map((s) => s.cap)),
    discount: Math.max(own.discount, ...others.map((s) => s.discount ?? 0)),
  }
}

/** Each SAFE's share of the company once it converts (see the formulas above). */
export function convertSafes(safes: Safe[], { nextPreMoney }: { nextPreMoney?: number } = {}): Converted[] {
  return safes.map((s) => {
    const terms = effectiveTerms(s, safes)
    const byDiscount = terms.discount > 0 && nextPreMoney && nextPreMoney > 0 ? (1 - terms.discount) * nextPreMoney : Infinity
    const valuation = Math.min(terms.cap, byDiscount)
    return { ...s, terms, valuation, ownership: s.amount / valuation }
  })
}

export type Dilution = { safes: Converted[]; safeTotal: number; pool: number; founders: number; /** SAFEs and the pool want more than 100%. */ over: boolean }

/** Who owns what after the SAFEs convert: SAFE holders, the pool, and founders with the rest. */
export function dilution(safes: Safe[], { poolPct, nextPreMoney }: { poolPct: number; nextPreMoney?: number }): Dilution {
  const converted = convertSafes(safes, { nextPreMoney })
  const safeTotal = converted.reduce((a, s) => a + s.ownership, 0)
  const pool = Math.max(0, poolPct)
  const founders = 1 - safeTotal - pool
  return { safes: converted, safeTotal, pool, founders, over: founders < 0 }
}

/** Two caps to compare with: 25% below and above, to the nearest $1M (at least $1M). */
export function compareCaps(cap: number): [number, number] {
  const r = (x: number) => Math.max(1e6, Math.round(x / 1e6) * 1e6)
  return [r(cap * 0.75), r(cap * 1.25)]
}

export type Cut = { id: string; name: string; from: number; to: number; angel: boolean }

/**
 * Oversubscribed: a suggested cut to fit `room`, keeping angels whole. Funds
 * share the cut in proportion to their cheques (each loses the same
 * percentage). When the angels alone are more than the room, everyone is cut
 * by the same percentage. Cut amounts round down to the nearest $1,000.
 */
export function suggestCut(rows: { id: string; name: string; amount: number; angel: boolean }[], room: number): Cut[] {
  const total = rows.reduce((a, r) => a + r.amount, 0)
  const same = (r: (typeof rows)[number], to: number): Cut => ({ id: r.id, name: r.name, from: r.amount, to, angel: r.angel })
  if (total <= room) return rows.map((r) => same(r, r.amount))
  const angels = rows.filter((r) => r.angel).reduce((a, r) => a + r.amount, 0)
  const funds = total - angels
  const keepAngels = angels <= room && funds > 0
  const k = keepAngels ? (room - angels) / funds : room / total
  return rows.map((r) => same(r, keepAngels && r.angel ? r.amount : Math.floor((r.amount * k) / 1000) * 1000))
}

/** Angels (and large angels) are kept whole in a cut. */
export const isAngel = (type: string) => type === 'Angel' || type === 'Large angel'

/**
 * The SAFEs a scenario models: every commitment at the scenario's cap and
 * discount (pro-rata and MFN per investor), then either the money still to
 * raise as one more SAFE, or, when oversubscribed, the commitments cut to fit.
 * PST-291: a commitment with its own `cap` (tranche 2) keeps it; the scenario's cap is tranche 1's.
 */
export function scenarioSafes(
  commitments: { id: string; name: string; amount: number; angel: boolean; proRata?: boolean; mfn?: boolean; cap?: number }[],
  { cap, discount, raise }: { cap: number; discount?: number; raise: number },
): { safes: Safe[]; cut: Cut[] | null; gap: number } {
  const total = commitments.reduce((a, c) => a + c.amount, 0)
  const cut = total > raise ? suggestCut(commitments, raise) : null
  const amountOf = (id: string, a: number) => cut?.find((c) => c.id === id)?.to ?? a
  const safes: Safe[] = commitments.map((c) => ({ id: c.id, name: c.name, amount: amountOf(c.id, c.amount), cap: c.cap ?? cap, discount, mfn: c.mfn, proRata: c.proRata, angel: c.angel }))
  const gap = Math.max(0, raise - total)
  if (gap > 0) safes.push({ id: 'gap', name: 'Still to raise', amount: gap, cap, discount })
  return { safes, cut, gap }
}

/* ---------- the cap table after the close ---------- */

/** Entered in Settings › Round: founders' shares, the option pool and earlier SAFEs. */
export type CapTable = {
  founders: { name: string; shares: number }[]
  optionPool: number
  safes?: { name: string; amount: number; cap: number; mfn?: boolean }[]
}

export const hasCapTable = (c: CapTable | null | undefined): c is CapTable => !!c && c.founders.some((f) => f.shares > 0)

/** Trimmed names; no empty list of earlier SAFEs. */
export function cleanCapTable(c: CapTable): CapTable {
  const safes = (c.safes ?? []).map((s) => ({ ...s, name: s.name.trim() }))
  return { founders: c.founders.map((f) => ({ name: f.name.trim(), shares: f.shares })), optionPool: c.optionPool, ...(safes.length ? { safes } : {}) }
}

/** One line for the change log: "2 founders, 9,000,000 shares · pool 1,000,000 · 1 earlier SAFE". */
export function capTableSummary(c: CapTable | null | undefined): string {
  if (!c) return ''
  const n = c.founders.length
  const total = c.founders.reduce((a, f) => a + f.shares, 0)
  const safes = c.safes?.length ?? 0
  return [
    `${n} founder${n === 1 ? '' : 's'}, ${shares(total)} shares`,
    `pool ${shares(c.optionPool)}`,
    safes ? `${safes} earlier SAFE${safes === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(' · ')
}

/** Field-keyed errors for the cap table card. */
export function validateCapTable(c: CapTable): Record<string, string> {
  const e: Record<string, string> = {}
  const whole = (x: number) => Number.isInteger(x) && x >= 0
  if (!c.founders.length) e.founders = 'Add at least one founder.'
  c.founders.forEach((f, i) => {
    if (!f.name.trim()) e[`founders.${i}.name`] = 'Required.'
    if (!whole(f.shares) || f.shares <= 0) e[`founders.${i}.shares`] = 'A whole number of shares.'
  })
  if (!whole(c.optionPool)) e.optionPool = 'A whole number of shares, or 0.'
  ;(c.safes ?? []).forEach((s, i) => {
    if (!s.name.trim()) e[`safes.${i}.name`] = 'Required.'
    if (!pos(s.amount)) e[`safes.${i}.amount`] = 'Must be more than $0.'
    if (!pos(s.cap)) e[`safes.${i}.cap`] = 'Must be more than $0.'
  })
  return e
}

export type CapRow = { holder: string; kind: 'Common' | 'Reserved' | 'SAFE'; invested?: number; before: { shares: number; pct: number }; after: { shares: number; pct: number } }

/**
 * The cap table before and after the close, every SAFE converted at its cap
 * (MFN applied). Post-money SAFEs make it closed-form:
 *
 *   σ = Σ amountᵢ ÷ capᵢ                       the SAFEs' combined share
 *   T = (founder shares + pool shares) ÷ (1 − σ)   fully diluted shares after
 *   SAFE i gets (amountᵢ ÷ capᵢ) × T shares
 *
 * Before the close only founders and the pool hold shares. Null when there
 * are no shares yet, or when the SAFEs would own 100% or more.
 */
export function capTableAfter(cap: CapTable, roundSafes: { name: string; amount: number; cap: number; mfn?: boolean }[]): { rows: CapRow[]; before: number; after: number } | null {
  const safes: Safe[] = [
    ...(cap.safes ?? []).map((s, i) => ({ id: `e${i}`, name: s.name, amount: s.amount, cap: s.cap, mfn: s.mfn })),
    ...roundSafes.map((s, i) => ({ id: `r${i}`, name: s.name, amount: s.amount, cap: s.cap, mfn: s.mfn })),
  ]
  const converted = convertSafes(safes)
  const sigma = converted.reduce((a, s) => a + s.ownership, 0)
  const before = cap.founders.reduce((a, f) => a + f.shares, 0) + cap.optionPool
  if (sigma >= 1 || before <= 0) return null
  const after = before / (1 - sigma)
  const row = (holder: string, kind: CapRow['kind'], shares: number, afterShares: number, invested?: number): CapRow => ({
    holder,
    kind,
    ...(invested !== undefined ? { invested } : {}),
    before: { shares, pct: shares / before },
    after: { shares: afterShares, pct: afterShares / after },
  })
  return {
    rows: [
      ...cap.founders.map((f) => row(f.name, 'Common', f.shares, f.shares)),
      row('Option pool', 'Reserved', cap.optionPool, cap.optionPool),
      ...converted.map((s) => row(s.name, 'SAFE', 0, s.ownership * after, s.amount)),
    ],
    before,
    after,
  }
}

/** The cap table as CSV (Export CSV). Shares round to whole shares, percentages to 0.01%. */
export function capTableCsv(rows: CapRow[]): string {
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  const p = (x: number) => (x * 100).toFixed(2)
  const lines = [['holder', 'type', 'invested', 'shares before', '% before', 'shares after', '% after']]
  for (const r of rows) lines.push([r.holder, r.kind, r.invested ? String(Math.round(r.invested)) : '', String(Math.round(r.before.shares)), p(r.before.pct), String(Math.round(r.after.shares)), p(r.after.pct)])
  return lines.map((l) => l.map(q).join(',')).join('\n') + '\n'
}

/** "9.4%", and two decimals under 1% ("0.75%"). */
export const pct = (x: number) => `${(x * 100).toFixed(Math.abs(x) < 0.01 && x !== 0 ? 2 : 1)}%`

/** "4,500,000" shares. */
export const shares = (n: number) => Math.round(n).toLocaleString('en-US')
