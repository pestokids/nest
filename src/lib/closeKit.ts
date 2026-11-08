// PST-291: the same-day close kit, allocation and tranche 2. Pure functions
// over plain data, shared by the UI and Convex (src/lib/close.ts has the
// closing records, the ladder and the SAFE maths).
//
// The close, step by step, with each step's deadline:
//   1. Written confirmation   by the end of the day they said yes (IST)
//   2. They accept            48 hours after the confirmation went
//   3. SAFE + questionnaire   the same day as the yes
//   4. Signed by both         countersign the same day as their signature
//   5. Wire in                10 business days after they accept
// Business days skip Saturdays and Sundays only (no holiday calendar).
import { isAngel, stepMap, suggestCut, type Closing, type CloseRow, type ClosingTerms } from './close'
import { formatDay, pad, todayIST, weekdayOf } from './dates'
import { exactMoney, money } from './money'
import type { Activity, Investor } from './pipeline'
import { COMMIT } from './stages'

export const OFFER_HOURS = 48
export const WIRE_BUSINESS_DAYS = 10
const HOUR = 3600_000
const IST_OFFSET_MS = 330 * 60 * 1000

/* ---------- days and times (IST) ---------- */

const weekday = (iso: string) => new Date(iso + 'T00:00:00Z').getUTCDay()
const addDay = (iso: string, n: number) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10)

export const isWeekend = (iso: string) => weekday(iso) === 0 || weekday(iso) === 6

/** `n` business days after `iso` (Saturdays and Sundays skipped). From a Friday, 1 business day is Monday. */
export function addBusinessDays(iso: string, n: number): string {
  let d = iso
  let left = n
  while (left > 0) {
    d = addDay(d, 1)
    if (!isWeekend(d)) left--
  }
  return d
}

/** 23:59 IST on a day, as epoch ms: "by the end of the day". */
export const endOfDayIST = (iso: string) => Date.parse(iso + 'T23:59:00+05:30')

/** A moment in IST: the day, weekday, "15:40". */
export function istParts(ms: number): { iso: string; weekday: string; time: string } {
  const d = new Date(ms + IST_OFFSET_MS)
  const iso = d.toISOString().slice(0, 10)
  return { iso, weekday: weekdayOf(iso), time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` }
}

/** "Tue 10 Nov at 15:40 IST": how the confirmation states the offer's end. */
export const offerUntil = (ms: number) => `${formatDay(ms)} at ${istParts(ms).time} IST`

/* ---------- the steps ---------- */

export const KIT_STEPS = ['confirm', 'accept', 'safe', 'signed', 'wire'] as const
export type KitStep = (typeof KIT_STEPS)[number]
export const KIT_LABEL: Record<KitStep, string> = {
  confirm: 'Written confirmation',
  accept: 'They accept',
  safe: 'SAFE + questionnaire sent',
  signed: 'Signed by both',
  wire: 'Wire in',
}
export const KIT_SUB: Record<KitStep, string> = {
  confirm: 'By the end of the verbal day',
  accept: '48 h offer window',
  safe: 'Same day as the yes',
  signed: 'Countersign the same day',
  wire: '10 business days',
}

export type KitClosing = Pick<Closing, 'steps' | 'confirmationSentAt' | 'acceptedAt' | 'questionnaire'>

/**
 * One step: done or not, and its deadline (epoch ms). `projected`: the
 * deadline is what it would be if the earlier steps happened now, shown as a
 * guide and never counted as due.
 */
export type KitRow = { key: KitStep; done: boolean; dueAt?: number; projected: boolean }

/**
 * The five steps for a commitment. A step counts as done when it is, or when
 * any later step has started (the SAFE or questionnaire out, their signature
 * in), so a record that went straight to the SAFE before the kit existed never
 * shows an old confirmation as overdue.
 */
export function kitSteps(c: KitClosing | null | undefined, { verbalDay, now }: { verbalDay?: string; now: number }): KitRow[] {
  const s = stepMap(c)
  const own: Record<KitStep, boolean> = {
    confirm: !!c?.confirmationSentAt,
    accept: !!c?.acceptedAt,
    safe: !!s.sent && !!c?.questionnaire,
    signed: !!s.countersigned,
    wire: !!s.wired,
  }
  const started: Record<KitStep, boolean> = { ...own, safe: !!s.sent || !!c?.questionnaire, signed: !!s.signed || !!s.countersigned }
  const done = (k: KitStep) => own[k] || KIT_STEPS.slice(KIT_STEPS.indexOf(k) + 1).some((x) => started[x])
  const sent = c?.confirmationSentAt
  const accepted = c?.acceptedAt
  const acceptBy = (sent ?? now) + OFFER_HOURS * HOUR
  const yesDay = todayIST(accepted ?? acceptBy)
  const due: Record<KitStep, { at?: number; projected: boolean }> = {
    confirm: { at: verbalDay ? endOfDayIST(verbalDay) : undefined, projected: false },
    accept: { at: acceptBy, projected: !sent },
    safe: { at: accepted ? endOfDayIST(todayIST(accepted)) : undefined, projected: false },
    signed: { at: s.signed ? endOfDayIST(s.signed) : undefined, projected: false },
    wire: { at: endOfDayIST(addBusinessDays(yesDay, WIRE_BUSINESS_DAYS)), projected: !accepted },
  }
  return KIT_STEPS.map((key) => ({ key, done: done(key), dueAt: due[key].at, projected: due[key].projected }))
}

/** The first step not done yet, or null when the wire is in. */
export const currentStep = (rows: readonly KitRow[]): KitStep | null => rows.find((r) => !r.done)?.key ?? null

/** The right-hand label: "Due 23:59" (today), "Overdue", "by Tue 15:40" (the offer), "by Tue 24 Nov". Empty with no deadline. */
export function dueText(r: KitRow, now: number): string {
  if (r.done || r.dueAt === undefined) return ''
  if (!r.projected && r.dueAt < now) return 'Overdue'
  const p = istParts(r.dueAt)
  if (!r.projected && p.iso === todayIST(now)) return `Due ${p.time}`
  return r.key === 'accept' ? `by ${p.weekday} ${p.time}` : `by ${formatDay(p.iso)}`
}

/** The day (and, from the server's records, the moment) an investor last moved to Verbal. */
export function verbalOf(investorId: string, acts: readonly Activity[]): { day: string; at?: number } | null {
  const a = acts
    .filter((x) => x.investorId === investorId && x.kind === 'stage' && x.stage === 'verbal')
    .sort((x, y) => y.date.localeCompare(x.date) || (y._creationTime ?? 0) - (x._creationTime ?? 0))[0]
  return a ? { day: a.date, ...(a._creationTime ? { at: a._creationTime } : {}) } : null
}

export type DueStep = { investorId: string; name: string; step: KitStep; label: string; dueAt: number; overdue: boolean }

/**
 * Close steps due today or overdue, soonest first, for every commitment in
 * Verbal or Signed: for Close now and PST-297's Inbox. Projected deadlines
 * never count, and a wired investor has nothing due.
 */
export function closeDue(now: number, { investors, closings, acts }: { investors: readonly Investor[]; closings: readonly Closing[]; acts: readonly Activity[] }): DueStep[] {
  const by = new Map(closings.map((c) => [c.investorId, c]))
  const endOfToday = endOfDayIST(todayIST(now))
  const out: DueStep[] = []
  for (const i of investors) {
    if (!COMMIT.has(i.stage) || i.stage === 'wired') continue
    for (const r of kitSteps(by.get(i._id), { verbalDay: verbalOf(i._id, acts)?.day, now })) {
      if (r.done || r.projected || r.dueAt === undefined || r.dueAt > endOfToday) continue
      out.push({ investorId: i._id, name: i.name, step: r.key, label: KIT_LABEL[r.key], dueAt: r.dueAt, overdue: r.dueAt < now })
    }
  }
  return out.sort((a, b) => a.dueAt - b.dueAt || a.name.localeCompare(b.name))
}

/* ---------- tranches ---------- */

/** Tranche 2: the higher post-money cap anything after tranche 1 is offered at. Kept on the round row. */
export type Tranche2 = { cap: number }

export const trancheOf = (c: { tranche?: number } | null | undefined): 1 | 2 => (c?.tranche === 2 ? 2 : 1)

/** The tranche a new commitment starts in: 2 once tranche 2 is set up. */
export const openTranche = (t2: Tranche2 | null | undefined): 1 | 2 => (t2 ? 2 : 1)

/** The cap a commitment converts at: tranche 2's for a tranche-2 commitment, else its own (or the round's). Same terms within a tranche. */
export function trancheCap(c: { tranche?: number; cap?: number } | null | undefined, round: { cap?: number }, t2: Tranche2 | null | undefined): number | undefined {
  if (trancheOf(c) === 2 && t2) return t2.cap
  return c?.cap || round.cap || undefined
}

/** Ownership per $100K at a post-money cap, as a share (0.00625 is 0.625%). */
export const perHundredK = (cap: number) => (cap > 0 ? 100_000 / cap : 0)

/** "0.63%", "0.5%": a small percentage to two places, trailing zeros dropped. */
export function ownPct(share: number): string {
  const hundredths = Math.round(share * 1e4 + 1e-9)
  return `${(hundredths / 100).toFixed(2).replace(/\.?0+$/, '')}%`
}

/** "Tranche 2 buyers own 0.5% per $100K instead of 0.63%." */
export const trancheLine = (cap1: number, cap2: number) => `Tranche 2 buyers own ${ownPct(perHundredK(cap2))} per $100K instead of ${ownPct(perHundredK(cap1))}.`

/** Why tranche 2's cap won't do (it has to be above tranche 1's), or null. */
export function checkTranche2(cap: number | undefined, cap1: number | undefined): string | null {
  if (!cap || !Number.isFinite(cap) || cap <= 0) return 'Enter tranche 2’s post-money cap.'
  if (cap1 && cap <= cap1) return `Make it higher than tranche 1’s ${money(cap1)} cap.`
  return null
}

/* ---------- what a commitment says ---------- */

export type CommitTerms = { amount?: number; instrument: string; cap?: number; tranche: 1 | 2 }

/** Amount, instrument, cap and tranche: the closing record's, else the investor's number and the round's terms (tranche 2's cap once it's set up). */
export function commitmentTerms(
  inv: Pick<Investor, 'committed' | 'expected'>,
  closing: (Pick<ClosingTerms, 'amount' | 'instrument' | 'cap'> & { tranche?: number }) | null | undefined,
  round: { cap?: number; instrument: string },
  t2: Tranche2 | null | undefined,
): CommitTerms {
  if (closing) return { amount: closing.amount, instrument: closing.instrument, cap: trancheCap(closing, round, t2), tranche: trancheOf(closing) }
  const tranche = openTranche(t2)
  return { amount: +(inv.committed || inv.expected || 0) || undefined, instrument: round.instrument || 'post-money SAFE', cap: trancheCap({ tranche }, round, t2), tranche }
}

const BLANK = '[__]'
/** "Kite Angels’", "Marigold Capital’s". */
export const possessive = (name: string) => (/s$/i.test(name.trim()) ? `${name.trim()}’` : `${name.trim()}’s`)
const hello = (name?: string) => {
  const first = name?.trim().split(/\s+/)[0]
  return first ? `Hi ${first},` : 'Hi there,'
}
const article = (s: string) => (/^[aeiou]/i.test(s) ? 'an' : 'a')
const instrumentPhrase = (t: Pick<CommitTerms, 'instrument' | 'cap'>) => `${article(t.instrument)} ${t.instrument} at a ${t.cap ? money(t.cap) : BLANK} cap`

/**
 * The written confirmation (draft type "confirm"). Every number comes from the
 * commitment and the round; a missing one is a [__] blank, which the drafts
 * system won't send. `now` is when the 48 hours start.
 */
export function confirmText({ company = 'Pesto', investorName, contactName, terms, now, verbalToday, me }: {
  company?: string
  investorName: string
  contactName?: string
  terms: CommitTerms
  now: number
  verbalToday: boolean
  me: string
}): { subject: string; body: string } {
  return {
    subject: `Confirming ${possessive(investorName)} ${terms.amount ? money(terms.amount) : BLANK} in ${company}`,
    body: [
      hello(contactName),
      `${verbalToday ? 'Thanks for today.' : 'Thanks again for the yes.'} Confirming what we discussed:`,
      [
        `• ${terms.amount ? exactMoney(terms.amount) : BLANK} on ${instrumentPhrase(terms)}`,
        `• This offer stands for ${OFFER_HOURS} hours, until ${offerUntil(now + OFFER_HOURS * HOUR)}`,
        `• Once you accept, funding within ${WIRE_BUSINESS_DAYS} business days`,
      ].join('\n'),
      'I’ll send the SAFE and a short investor questionnaire as soon as you reply.',
      me.trim() || 'Dev',
    ].join('\n\n'),
  }
}

/* ---------- allocation ---------- */

/** Where the SAFE link goes in an allocation email. Dev pastes it in; Send refuses while it's there. */
export const SAFE_LINK = '[SAFE link]'

export type AllocKind = 'Lead' | 'Fund' | 'Angel'
export const allocKind = (i: Pick<Investor, 'lead' | 'type'>): AllocKind => (i.lead ? 'Lead' : isAngel(i.type) ? 'Angel' : 'Fund')

/** What's saved for an investor: what they get (absent: the suggestion) and why. */
export type Allocation = { investorId: string; gets?: number; why: string }

export type AllocRow = { investorId: string; name: string; kind: AllocKind; wants: number; gets: number; why: string; suggested: boolean }

/**
 * A row per investor on the ladder (soft circles, verbals, signed and money
 * in), the lead first, then the biggest: what they want, what they get, and
 * why. Without a saved amount, "gets" is the suggested cut that fits the room,
 * keeping angels whole.
 */
export function allocationRows(rows: readonly CloseRow[], saved: readonly Allocation[], room: number): AllocRow[] {
  const by = new Map(saved.map((a) => [a.investorId, a]))
  const live = rows.filter((r) => r.amount > 0)
  const cut = new Map(suggestCut(live.map((r) => ({ id: r.investor._id, name: r.investor.name, amount: r.amount, angel: isAngel(r.investor.type) })), room).map((c) => [c.id, c.to]))
  return live
    .map((r) => {
      const a = by.get(r.investor._id)
      const gets = a?.gets ?? cut.get(r.investor._id) ?? r.amount
      return { investorId: r.investor._id, name: r.investor.name, kind: allocKind(r.investor), wants: r.amount, gets, why: a?.why ?? '', suggested: a?.gets === undefined }
    })
    .sort((a, b) => +(b.kind === 'Lead') - +(a.kind === 'Lead') || b.wants - a.wants || a.name.localeCompare(b.name))
}

export type AllocTotals = { wanted: number; allocated: number; room: number; /** Room minus what's allocated: negative when over. */ left: number; over: boolean }

export function allocationTotals(rows: readonly Pick<AllocRow, 'wants' | 'gets'>[], room: number): AllocTotals {
  const wanted = rows.reduce((a, r) => a + r.wants, 0)
  const allocated = rows.reduce((a, r) => a + r.gets, 0)
  return { wanted, allocated, room, left: room - allocated, over: oversubscribed(wanted, room) }
}

/** Soft circles, verbals and signed together want more than the round's room. */
export const oversubscribed = (wanted: number, room: number) => room > 0 && wanted > room

/** "$80K left to place", "$20K over the room", "All placed". */
export function leftText(left: number): string {
  if (Math.abs(left) < 500) return 'All placed'
  return left > 0 ? `${money(left)} left to place` : `${money(-left)} over the room`
}

/**
 * One allocation email (draft type "allocation"): what they get, the SAFE link
 * placeholder and the wire deadline. Dev sends each one himself.
 */
export function allocationText({ company = 'Pesto', contactName, row, terms, wireBy, me }: {
  company?: string
  contactName?: string
  row: Pick<AllocRow, 'wants' | 'gets'>
  terms: Pick<CommitTerms, 'instrument' | 'cap'>
  /** The wire deadline, YYYY-MM-DD. */
  wireBy: string
  me: string
}): { subject: string; body: string } {
  const full = row.gets >= row.wants
  return {
    subject: `Your allocation in ${company}: ${money(row.gets)}`,
    body: [
      hello(contactName),
      full
        ? `Thank you for backing ${company}. You get the full ${exactMoney(row.gets)} you asked for, on ${instrumentPhrase(terms)}.`
        : `Thank you for backing ${company}. The round came in above the room we have, so we’ve had to allocate: you get ${exactMoney(row.gets)} of the ${exactMoney(row.wants)} you asked for, on ${instrumentPhrase(terms)}.`,
      `Your SAFE: ${SAFE_LINK}\nPlease wire by ${formatDay(wireBy)}, within ${WIRE_BUSINESS_DAYS} business days.`,
      me.trim() || 'Dev',
    ].join('\n\n'),
  }
}
