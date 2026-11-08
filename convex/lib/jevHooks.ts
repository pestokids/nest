// PST-292: where Jev's housekeeping starts. Each hook runs inside the mutation of its
// own event (a new calendar attendee, notes Nest couldn't match, an investor added or
// renamed, a question added from notes), picks the few candidates worth asking about,
// and schedules one action in jevHousekeeping.ts only when there is something to ask
// and Jev is ready (a key, switched on, under the cap). Nothing here ever sweeps the
// whole list on a timer.
import type { MutationCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { internal } from '../_generated/api'
import { jevReady } from './jev'
import { firmDomain } from '../../src/lib/enrich'
import { dayOf, domainOf, isOurs, normEmail } from '../../src/lib/google'
import { mostSimilar, THRESHOLDS, trigramSimilarity, type WhoState } from '../../src/lib/jev'
import { normFirm } from '../../src/lib/suggestions'

/** Where a new Who's this? person was met: the invite's title and everyone on it. */
export type Invite = { title: string; people: string[] }

/**
 * Who's this?: the state Jev reads for each new person (their domain, the invite
 * title, the other attendees' domains, whether the domain is a known investor's
 * firm), then one action that asks and queues the likely ones' lookups.
 */
export async function precheckWho(ctx: MutationCtx, emails: string[], invites: Record<string, Invite>): Promise<string[]> {
  if (!emails.length || !(await jevReady(ctx))) return emails
  const known = new Set((await ctx.db.query('investors').collect()).flatMap((i) => [...(i.domains ?? []), firmDomain(i) ?? '']).filter(Boolean))
  const items: { email: string; state: WhoState }[] = []
  const rest: string[] = []
  for (const email of emails) {
    const inv = invites[email]
    if (!inv) {
      rest.push(email)
      continue
    }
    const d = domainOf(email)
    const others = [...new Set(inv.people.map(normEmail).filter((e): e is string => !!e && e !== email && !isOurs(e)).map(domainOf))].sort()
    items.push({ email, state: { email_domain: d, invite_title: inv.title, other_attendee_domains: others, domain_is_known_investor_firm: known.has(d) } })
  }
  if (items.length) await ctx.scheduler.runAfter(0, internal.jevHousekeeping.whosThis, { items })
  return rest
}

const titleKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Unmatched notes: the investors at the note's meeting (the one named, else same title that day), asked about when there are any. */
export async function matchNoteLater(
  ctx: MutationCtx,
  id: Id<'unmatchedNotes'>,
  n: { meetingId?: Id<'meetings'>; meetingTitle: string; date: string },
  meetings: Doc<'meetings'>[],
) {
  const named = n.meetingId ? meetings.find((m) => m._id === n.meetingId) ?? (await ctx.db.get(n.meetingId)) : null
  const at = named ? [named] : meetings.filter((m) => dayOf(m.start) === n.date && titleKey(m.title) === titleKey(n.meetingTitle))
  const investorIds = [...new Set(at.flatMap((m) => m.investorIds))]
  if (!investorIds.length || !(await jevReady(ctx))) return
  await ctx.scheduler.runAfter(0, internal.jevHousekeeping.unmatchedNote, { id, investorIds })
}

const firmOf = (i: Pick<Doc<'investors'>, 'firm' | 'name'>) => i.firm.trim() || i.name.trim()
export const pairKey = (a: string, b: string) => [a, b].sort().join(':')

/**
 * Duplicate firms: an investor was added or renamed. Only the investors whose name
 * or firm is at least 0.6 similar (trigrams) are asked about, never one the rule
 * checks already catch (the same firm once normalised) or a pair already suggested.
 */
export async function checkDuplicatesLater(ctx: MutationCtx, investorId: Id<'investors'>) {
  const me = await ctx.db.get(investorId)
  if (!me || !(await jevReady(ctx))) return
  const sim = (o: Doc<'investors'>) => Math.max(trigramSimilarity(me.name, o.name), trigramSimilarity(firmOf(me), firmOf(o)))
  const close = (await ctx.db.query('investors').collect())
    .filter((o) => o._id !== me._id && normFirm(firmOf(o)) !== normFirm(firmOf(me)))
    .map((o) => ({ o, s: sim(o) }))
    .filter((x) => x.s >= THRESHOLDS.dupSimilar)
    .sort((a, b) => b.s - a.s)
  const others: Id<'investors'>[] = []
  for (const { o } of close) {
    if (others.length >= THRESHOLDS.dupCandidates) break
    const k = pairKey(me._id, o._id)
    const seen = await ctx.db.query('suggestions').withIndex('by_key', (q) => q.eq('key', 'check:duplicate:' + k)).first() ?? (await ctx.db.query('suggestions').withIndex('by_key', (q) => q.eq('key', 'jev:duplicate:' + k)).first())
    if (!seen) others.push(o._id)
  }
  if (others.length) await ctx.scheduler.runAfter(0, internal.jevHousekeeping.duplicateFirm, { investorId, others })
}

/** Q&A repeats: a question was added from notes. The five closest live questions (trigrams) are the options. */
export async function checkRepeatLater(ctx: MutationCtx, questionId: Id<'questions'>) {
  const q = await ctx.db.get(questionId)
  if (!q || !(await jevReady(ctx))) return
  const live = (await ctx.db.query('questions').collect()).filter((o) => o._id !== questionId && !o.removedAt && !o.mergedInto)
  const close = mostSimilar(q.text, live, (o) => o.text, THRESHOLDS.qaCandidates, THRESHOLDS.qaSimilar)
  if (close.length) await ctx.scheduler.runAfter(0, internal.jevHousekeeping.qaRepeat, { questionId, candidates: close.map((x) => x.item._id) })
}
