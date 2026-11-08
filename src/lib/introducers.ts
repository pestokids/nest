// PST-294: Introducers as people, and the six dated steps of a double opt-in
// intro (asked → yes → forwardable sent → intro made → thanked → reported back).
// Pure functions over plain data, shared by the UI and Convex.
import { dayDiff } from './dates'
import type { DecisionStatus } from './decisions'
import { dayMonth } from './home'
import { domainOf, normEmail } from './google'
import { committedOf, type Investor } from './pipeline'
import { COMMIT, IDX } from './stages'

export const RELATIONS = ['portfolio', 'angel', 'friend', 'committed', 'other'] as const
export type Relation = (typeof RELATIONS)[number]
export const RELATION_LABEL: Record<Relation, string> = {
  portfolio: 'Portfolio founder', angel: 'Angel', friend: 'Friend', committed: 'Committed investor', other: 'Other',
}
/** What Dev picks from when adding someone: committed investors come from the list, never typed in. */
export const PICK_RELATIONS = RELATIONS.filter((r) => r !== 'committed')

export const STEPS = ['asked', 'yes', 'sent', 'made', 'thanked', 'reported'] as const
export type Step = (typeof STEPS)[number]
/** The introducer panel's bar labels. */
export const STEP_SHORT: Record<Step, string> = { asked: 'Asked', yes: 'Yes', sent: 'Sent', made: 'Intro', thanked: 'Thanked', reported: 'Reported' }
/** The drawer's checklist, with the introducer's first name. */
export function stepLabel(s: Step, who: string): string {
  switch (s) {
    case 'asked': return 'Asked ' + who
    case 'yes': return who + ' said yes'
    case 'sent': return 'Forwardable email sent'
    case 'made': return 'Intro made'
    case 'thanked': return 'Thanked ' + who
    case 'reported': return 'Report back'
  }
}

/** Each step's day (YYYY-MM-DD, IST); a step without one isn't done. */
export type Steps = Partial<Record<Step, string>>

export type Introducer = { _id: string; name: string; email?: string; relation: Relation; notes: string; createdAt?: number }
/** One intro: an introducer (a person, or a committed investor) to one investor. */
export type Intro = {
  _id: string
  investorId: string
  introducerId?: string
  /** A committed investor making the intro (derived introducers have no row of their own). */
  viaInvestorId?: string
  steps: Steps
  /** The day Dev last nudged the introducer for a reply. */
  nudgedAt?: string
  /** The free-text warm path this intro was migrated from (normalised), so the migration runs once per text. */
  fromPath?: string
  createdAt?: number
}

/** An introducer as every view shows them: a person, or a committed investor (key "inv:<id>"). */
export type Person = { key: string; name: string; email?: string; relation: Relation; notes: string; introducerId?: string; investorId?: string }

export const personKey = (x: { introducerId?: string; viaInvestorId?: string }) => (x.introducerId ? x.introducerId : 'inv:' + x.viaInvestorId)
export const firstName = (name: string) => name.trim().split(/\s+/)[0] || name

/* ---------- names and the old free-text warm paths ---------- */

/** "  Ánkur   MEHTA " → "ankur mehta": how the same person is recognised. */
export const normName = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z\s'-]/g, ' ').replace(/\s+/g, ' ').trim()

/** Warm paths that aren't a person. */
const NOT_A_PERSON = /^(cold|direct|applied|application|apply|inbound|outbound|website|linkedin|twitter|x|email|none|n\/?a|na|tbd|-+|demo day|event|yc|self|me|us)$/i

export type PathPerson = { name: string; hint: string }

/**
 * The people a free-text warm path names: "Ankur (portfolio founder) / Ria" →
 * [{ name: 'Ankur', hint: 'portfolio founder' }, { name: 'Ria', hint: '' }].
 * "cold", "Applied" and "Direct" name nobody.
 */
export function parsePath(path: string): PathPerson[] {
  const out: PathPerson[] = []
  const seen = new Set<string>()
  for (const raw of path.split(/[,/&+;]|\band\b|\bor\b|\bvia\b/i)) {
    const hint = [...raw.matchAll(/\(([^)]*)\)/g)].map((m) => m[1].trim()).filter(Boolean).join(', ')
    const name = raw.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()
    const n = normName(name)
    if (!n || NOT_A_PERSON.test(n) || /\bcold\b/.test(n) || n.split(' ').length > 3 || seen.has(n)) continue
    seen.add(n)
    out.push({ name: name.replace(/(^|\s)(\p{Ll})/gu, (_, s: string, c: string) => s + c.toUpperCase()), hint })
  }
  return out
}

/** A guess at the relation from the warm path's note ("portfolio founder", "angel", "ex-colleague"). */
export function relationFromHint(hint: string): Relation {
  const h = hint.toLowerCase()
  if (/portfolio|founder/.test(h)) return 'portfolio'
  if (/angel|invest/.test(h)) return 'angel'
  if (/friend|colleague|cousin|classmate|batch|school|college|family|brother|sister/.test(h)) return 'friend'
  return 'other'
}

/** A warm path as the key it was migrated under (whitespace collapsed, lowercased). */
export const pathKey = (path: string) => path.trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * The existing person a name is: the same normalised name, else a lone first
 * name ("Ria") that matches exactly one person's first name.
 */
export function matchIntroducer<T extends { name: string }>(name: string, people: readonly T[]): T | undefined {
  const n = normName(name)
  const same = people.find((p) => normName(p.name) === n)
  if (same || n.includes(' ')) return same
  const firsts = people.filter((p) => normName(p.name).split(' ')[0] === n)
  return firsts.length === 1 ? firsts[0] : undefined
}

export type MigrationPlan = {
  /** New people, with a temporary key ("new:<n>") the links point at. */
  create: { key: string; name: string; relation: Relation; notes: string }[]
  /** One intro per person and investor; existing when that intro row is already there (only its fromPath changes). */
  link: { investorId: string; introducer: string; fromPath: string; existing?: string }[]
}

/**
 * What the migration does: every investor whose warm path text hasn't been
 * linked yet (no intro carries that text) gets an intro per person it names,
 * the same person (by normalised name) created once across investors.
 * Planning again over its own result plans nothing.
 */
export function migrationPlan(
  investors: readonly Pick<Investor, '_id' | 'path'>[],
  introducers: readonly Pick<Introducer, '_id' | 'name'>[],
  intros: readonly Pick<Intro, '_id' | 'investorId' | 'introducerId' | 'fromPath'>[],
): MigrationPlan {
  const plan: MigrationPlan = { create: [], link: [] }
  const people: { key: string; name: string }[] = introducers.map((p) => ({ key: p._id, name: p.name }))
  for (const inv of investors) {
    if (!needsMigration(inv, intros)) continue
    const key = pathKey(inv.path)
    const mine = intros.filter((x) => x.investorId === inv._id)
    for (const p of parsePath(inv.path)) {
      let who = matchIntroducer(p.name, people)
      if (!who) {
        who = { key: 'new:' + plan.create.length, name: p.name }
        people.push(who)
        plan.create.push({ key: who.key, name: p.name, relation: relationFromHint(p.hint), notes: p.hint })
      }
      const k = who.key
      if (plan.link.some((l) => l.investorId === inv._id && l.introducer === k)) continue
      const existing = mine.find((x) => x.introducerId === k)
      plan.link.push({ investorId: inv._id, introducer: k, fromPath: key, ...(existing ? { existing: existing._id } : {}) })
    }
  }
  return plan
}

/** An investor has a warm path the migration hasn't linked yet. */
export const needsMigration = (inv: Pick<Investor, '_id' | 'path'>, intros: readonly Pick<Intro, 'investorId' | 'fromPath'>[]) =>
  parsePath(inv.path ?? '').length > 0 && !intros.some((x) => x.investorId === inv._id && x.fromPath === pathKey(inv.path))

/* ---------- steps ---------- */

/** The index of the last step done, or -1. */
export const lastDone = (s: Steps) => STEPS.reduce((a, k, i) => (s[k] ? i : a), -1)
export const nextStepOf = (s: Steps): Step | null => STEPS[lastDone(s) + 1] ?? null

/**
 * Tick a step on a day: the steps before it that aren't done are done that day
 * too, and none of them stays later than it. Untick (day null): that step and
 * every one after it are undone. So the done steps are always the first few,
 * in order, and their days never go backwards.
 */
export function setStep(s: Steps, step: Step, day: string | null): Steps {
  const at = STEPS.indexOf(step)
  const out: Steps = {}
  for (let i = 0; i < STEPS.length; i++) {
    const k = STEPS[i]
    const was = s[k]
    if (day === null) {
      if (i >= at || !was) break
      out[k] = was
    } else if (i < at) out[k] = was && was <= day ? was : day
    else if (i === at) out[k] = day
    else if (was && was >= day) out[k] = was
    else break
  }
  return out
}

/** An investor as Introducers reads it: with PST-293's decision, when there is one. */
export type IntroInvestor = Investor & { decision?: DecisionStatus }
type Decided = Pick<Investor, 'stage'> & { decision?: DecisionStatus }

/** The investor has decided (a yes or a no, on PST-293's decision or by their stage): time to report back. */
export const hasDecided = (inv: Decided) => inv.decision === 'yes' || inv.decision === 'no' || COMMIT.has(inv.stage) || inv.stage === 'passed'
/** Their answer was a no. */
export const saidNo = (inv: Decided) => inv.decision === 'no' || (inv.decision !== 'yes' && inv.stage === 'passed')

/* ---------- the people, and each one's numbers ---------- */

/** Committed investors, as introducers (derived: no rows of their own). */
export function committedPeople(investors: readonly Investor[]): Person[] {
  return investors
    .filter((i) => COMMIT.has(i.stage))
    .map((i) => ({ key: 'inv:' + i._id, name: i.name, email: i.email, relation: 'committed' as const, notes: i.firm && i.firm !== i.name ? i.firm : '', investorId: i._id }))
}

export function allPeople(introducers: readonly Introducer[], investors: readonly Investor[]): Person[] {
  return [
    ...introducers.map((p) => ({ key: p._id, name: p.name, email: p.email, relation: p.relation, notes: p.notes, introducerId: p._id })),
    ...committedPeople(investors),
  ]
}

export type IntroSources = { introducers: readonly Introducer[]; intros: readonly Intro[]; investors: readonly IntroInvestor[] }

export type PersonStats = { asked: number; made: number; meetings: number; committed: number }

/** Asked, made, meetings (a 1st meeting or further) and money in, over one person's intros. */
export function statsOf(intros: readonly Intro[], investors: readonly Investor[]): PersonStats {
  const byId = new Map(investors.map((i) => [i._id, i]))
  const s: PersonStats = { asked: 0, made: 0, meetings: 0, committed: 0 }
  for (const x of intros) {
    const inv = byId.get(x.investorId)
    if (x.steps.asked) s.asked++
    if (!x.steps.made) continue
    s.made++
    if (inv && (IDX[inv.maxStage] ?? -1) >= IDX.m1!) s.meetings++
    if (inv) s.committed += committedOf(inv)
  }
  return s
}

export const NUDGE_AFTER = 3

/** Days since the ask (or the last nudge) with no yes, once it's been 3; null otherwise. */
export function waitingDays(x: Pick<Intro, 'steps' | 'nudgedAt'>, today: string): number | null {
  if (!x.steps.asked || x.steps.yes) return null
  const from = x.nudgedAt && x.nudgedAt > x.steps.asked ? x.nudgedAt : x.steps.asked
  const n = dayDiff(today, from)
  return n >= NUDGE_AFTER ? n : null
}

export type NextKind = 'thank' | 'report' | 'nudge' | 'send' | 'wait' | 'ask' | 'done'
export type Next = { text: string; tone: 'hot' | 'warn' | 'plain'; kind: NextKind }

/** What's next on one intro, as the panel shows it on the right. */
export function introNext(x: Intro, inv: (Pick<Investor, 'name' | 'stage'> & { decision?: DecisionStatus }) | undefined, who: string, today: string): Next {
  const s = x.steps
  const name = inv?.name ?? 'them'
  if (s.made && !s.thanked) return { kind: 'thank', tone: 'hot', text: s.made >= today ? 'Thank today' : 'Thank ' + who }
  if (s.thanked && !s.reported) return inv && hasDecided(inv) ? { kind: 'report', tone: 'hot', text: 'Report back' } : { kind: 'wait', tone: 'plain', text: 'Once ' + firstName(name) + ' decides' }
  if (s.reported) return { kind: 'done', tone: 'plain', text: 'Done' }
  if (s.sent) return { kind: 'wait', tone: 'plain', text: 'Waiting on ' + who }
  if (s.yes) return { kind: 'send', tone: 'warn', text: 'Send the forwardable' }
  if (s.asked) return waitingDays(x, today) !== null ? { kind: 'nudge', tone: 'warn', text: 'Nudge ' + who } : { kind: 'wait', tone: 'plain', text: 'Waiting on ' + who }
  return { kind: 'ask', tone: 'plain', text: 'Ask ' + who }
}

/** "today", "yesterday", "Tue" within the week, else "4 Nov". */
export function dayWord(day: string, today: string): string {
  const n = dayDiff(today, day)
  if (n <= 0) return 'today'
  if (n === 1) return 'yesterday'
  const [wd, d, m] = dayMonth(day).split(' ')
  return n < 7 ? wd : d + ' ' + m
}

/** The line under an intro's steps: "Forwardable sent Tue · waiting on Ankur". */
export function introLine(x: Intro, inv: (Pick<Investor, 'name' | 'stage'> & { decision?: DecisionStatus }) | undefined, who: string, today: string): string {
  const s = x.steps
  const name = firstName(inv?.name ?? 'them')
  if (s.reported) return 'Reported back ' + dayWord(s.reported, today) + '. Done.'
  if (s.thanked) return 'Thanked · ' + (inv && hasDecided(inv) ? 'report back on ' + name + '’s ' + (saidNo(inv) ? 'no' : 'yes') : 'report back once they decide')
  if (s.made) return s.made >= today ? 'Intro made today' : 'Intro made ' + dayWord(s.made, today) + ' · not thanked yet'
  if (s.sent) return 'Forwardable sent ' + dayWord(s.sent, today) + ' · waiting on ' + who
  if (s.yes) return who + ' said yes ' + dayWord(s.yes, today) + ' · send the forwardable'
  if (s.asked) {
    const n = waitingDays(x, today)
    return 'Asked ' + dayWord(s.asked, today) + (n !== null ? ' · no reply in ' + n + ' days' : ' · waiting on a reply')
  }
  return 'Not asked yet'
}

export type Tone = 'hot' | 'warn' | 'plain'

/** The Introducers table's Next for one person: the most pressing of their intros. */
export function personNext(intros: readonly Intro[], investors: readonly IntroInvestor[], who: string, today: string): { text: string; tone: Tone } {
  const byId = new Map(investors.map((i) => [i._id, i]))
  const all = intros.map((x) => ({ x, inv: byId.get(x.investorId), n: introNext(x, byId.get(x.investorId), who, today) }))
  const of = (k: NextKind) => all.find((y) => y.n.kind === k)
  const short = (i: { name: string } | undefined) => firstName(i?.name ?? 'the intro')
  const thank = of('thank')
  if (thank) return { tone: 'hot', text: 'Thank ' + who + ' for ' + short(thank.inv) + (thank.x.steps.made! >= today ? ' today' : '') }
  const report = of('report')
  if (report) return { tone: 'hot', text: 'Report back on ' + short(report.inv) }
  const nudge = of('nudge')
  if (nudge) return { tone: 'warn', text: 'Asked ' + waitingDays(nudge.x, today) + ' days ago, no reply' }
  const send = of('send')
  if (send) return { tone: 'plain', text: 'Send the forwardable for ' + short(send.inv) }
  const forwarding = intros.filter((x) => x.steps.sent && !x.steps.made).length
  if (forwarding) return { tone: 'plain', text: 'Waiting on ' + who + ' to forward' + (forwarding > 1 ? ' ' + forwarding : '') }
  const asked = intros.filter((x) => x.steps.asked && !x.steps.yes).length
  if (asked) return { tone: 'plain', text: asked === 1 ? 'Asked, waiting on a reply' : 'Asked for ' + asked + ' intros' }
  if (intros.some((x) => x.steps.made)) return { tone: 'plain', text: 'All reported back' }
  return { tone: 'plain', text: intros.length ? 'Ask for the intro' : 'Not asked yet' }
}

export type PersonRow = Person & { intros: Intro[]; stats: PersonStats; next: { text: string; tone: Tone } }

/** Every introducer with their intros and numbers: something to do first, then by intros made. */
export function personRows(src: IntroSources, today: string): PersonRow[] {
  const rows = allPeople(src.introducers, src.investors).map((p) => {
    const intros = src.intros.filter((x) => personKey(x) === p.key)
    return { ...p, intros, stats: statsOf(intros, src.investors), next: personNext(intros, src.investors, firstName(p.name), today) }
  })
  const rank = (r: PersonRow) => (r.next.tone === 'hot' ? 0 : r.next.tone === 'warn' ? 1 : r.intros.length ? 2 : 3)
  return rows.sort((a, b) => rank(a) - rank(b) || b.stats.made - a.stats.made || b.stats.asked - a.stats.asked || a.name.localeCompare(b.name))
}

/** One line about a person: "Founder of Tinkerly · portfolio founder". */
export const personSub = (p: Pick<Person, 'relation' | 'notes'>) =>
  [p.notes.trim(), p.relation === 'other' ? '' : RELATION_LABEL[p.relation].toLowerCase()].filter(Boolean).join(' · ') || RELATION_LABEL[p.relation]

/** Two initials for the avatar. */
export const initials = (name: string) =>
  name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?'

/* ---------- the warm path to an investor (PST-296's Find more uses this too) ---------- */

export type WarmPath = { person: Person; intro?: Intro; line: string }

const mentions = (text: string, name: string) => {
  const n = normName(name)
  return n.length >= 3 && (' ' + normName(text) + ' ').includes(' ' + n + ' ')
}

/**
 * The best warm path to an investor, in the list or not yet (a Find more
 * result): an intro already under way (the furthest along), else someone whose
 * notes name the investor or firm, else someone with an address at the firm's
 * domain. Null when Nest knows nobody.
 */
export function warmPathFor(investor: { _id?: string; name: string; firm?: string; domains?: readonly string[] }, src: IntroSources): WarmPath | null {
  const people = allPeople(src.introducers, src.investors).filter((p) => !investor._id || p.investorId !== investor._id)
  const byKey = new Map(people.map((p) => [p.key, p]))
  if (investor._id) {
    const best = src.intros
      .filter((x) => x.investorId === investor._id && byKey.has(personKey(x)))
      .sort((a, b) => lastDone(b.steps) - lastDone(a.steps) || (b.createdAt ?? 0) - (a.createdAt ?? 0))[0]
    if (best) {
      const person = byKey.get(personKey(best))!
      const step = lastDone(best.steps)
      return { person, intro: best, line: firstName(person.name) + (step < 0 ? ' can introduce you' : ' · ' + STEP_SHORT[STEPS[step]].toLowerCase()) }
    }
  }
  const names = [investor.name, investor.firm ?? ''].filter((s) => s.trim())
  const named = people.find((p) => names.some((n) => mentions(p.notes, n)))
  if (named) return { person: named, line: firstName(named.name) + ' knows them' }
  const domains = new Set((investor.domains ?? []).map((d) => d.toLowerCase()))
  const there = people.find((p) => p.email && domains.has(domainOf(normEmail(p.email))))
  if (there) return { person: there, line: firstName(there.name) + ' works there' }
  return null
}
