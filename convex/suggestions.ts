// PST-275: Suggested fixes. The rule checks (src/lib/suggestions.ts) fill a
// queue, unique by key; nothing changes until someone accepts. Accept applies
// the patch with the investor mutations' own write rules (applyMove for stages,
// logNote's touch, the drawer's domains) and keeps what Undo needs on the row.
// The checks run every morning at 09:00 IST (crons.ts), after each Google sync
// (googleSync.ts) and on demand (`run`). Other features add rows through
// `addSuggestion` / `insertSuggestion`: enrichment, meeting notes (PST-277), and
// agents through the Nest MCP server (PST-276, convex/mcp.ts).
import { ConvexError, v, type Infer, type ObjectType } from 'convex/values'
import { internalMutation, mutation, query, type MutationCtx } from './_generated/server'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { requireUser } from './lib/access'
import { autoEnrich, forgetInvestor } from './lib/enrichQueue'
import { saveInvestor } from './investors'
import { addNoteQuestions, removeNoteQuestions } from './qanda'
import { carryFindScore } from './lib/fitScores' // PST-296
import { vSuggestionKind, vSuggestionPatch, vSuggestionSource, type vSuggestionUndo } from './validators'
import { applyMove, applyUndo } from '../src/lib/board'
import { dupKey } from '../src/lib/csv'
import { isISODate, todayIST } from '../src/lib/dates'
import { cleanDomains, cleanEmails, DAY_MS } from '../src/lib/google'
import { NEW_INVESTOR, touchDay } from '../src/lib/pipeline'
import { IDX } from '../src/lib/stages'
import { acceptsTogether, CHECK_PREFIX, reconcile, ruleSuggestions, sortSuggestions, sourceLabel, type SuggestionDraft } from '../src/lib/suggestions'
import { applicationAfter, noOpReason, notesAfter, outreachChanges } from '../src/lib/suggestions' // PST-302
import { logStageMove } from './lib/stageLog' // PST-302
import { addTargetsFor } from './network' // PST-305
import { normName } from '../src/lib/introducers' // PST-305
import { normEmail } from '../src/lib/google' // PST-305

type Row = Doc<'suggestions'>
type Inv = Doc<'investors'>
type Undo = Infer<typeof vSuggestionUndo>
type Stamp = { updatedAt: number; updatedBy: Id<'users'> }

const openRows = (ctx: MutationCtx) =>
  ctx.db
    .query('suggestions')
    .withIndex('by_status', (q) => q.eq('status', 'open'))
    .collect()

/** Open suggestions, best first. Rows about a deleted investor are left out. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx)
    const rows = await ctx.db
      .query('suggestions')
      .withIndex('by_status', (q) => q.eq('status', 'open'))
      .collect()
    const out = []
    for (const s of rows) {
      if (s.investorId && !(await ctx.db.get(s.investorId))) continue
      if (s.otherInvestorId && !(await ctx.db.get(s.otherInvestorId))) continue
      const { undo: _u, decidedBy: _d, ...rest } = s
      out.push(rest)
    }
    return sortSuggestions(out)
  },
})

/* ---------- the checks ---------- */

const fieldsOf = (d: SuggestionDraft) => ({
  ...d,
  // The rule checks never make a notes patch, the only kind holding ids.
  patch: d.patch as Row['patch'],
  investorId: d.investorId as Id<'investors'> | undefined,
  otherInvestorId: d.otherInvestorId as Id<'investors'> | undefined,
})

/**
 * Run the rule checks: add new suggestions (never a key that exists in any
 * status, so dismissed ones stay gone), refresh the wording of open ones, and
 * withdraw open ones whose rule no longer fires or whose investor is gone.
 */
export async function runChecks(ctx: MutationCtx, now = Date.now()) {
  const investors = await ctx.db.query('investors').collect()
  const acts: Doc<'activities'>[] = []
  for (const i of investors)
    if (i.stage === 'booked')
      acts.push(
        ...(await ctx.db
          .query('activities')
          .withIndex('by_investor', (q) => q.eq('investorId', i._id))
          .collect()),
      )
  const meetings = await ctx.db
    .query('meetings')
    .withIndex('by_start', (q) => q.gte('start', now - 31 * DAY_MS))
    .collect()
  const threads = await ctx.db
    .query('emailTouches')
    .withIndex('by_last', (q) => q.gte('lastAt', now - 45 * DAY_MS))
    .collect()
  const drafts = ruleSuggestions({ investors, acts, meetings, threads, today: todayIST(now), now })
  const rows = await ctx.db.query('suggestions').collect()
  const { add, update, withdraw } = reconcile(rows, drafts)
  const ids = new Set<string>(investors.map((i) => i._id))
  const gone = rows.filter((r) => r.status === 'open' && ((r.investorId && !ids.has(r.investorId)) || (r.otherInvestorId && !ids.has(r.otherInvestorId)))).map((r) => r._id)
  for (const d of add) await ctx.db.insert('suggestions', { ...fieldsOf(d), status: 'open', createdAt: now })
  for (const u of update) await ctx.db.patch(u.id, fieldsOf(u.draft))
  const drop = new Set([...withdraw, ...gone])
  for (const id of drop) await ctx.db.delete(id)
  return { added: add.length, updated: update.length, withdrawn: drop.size }
}

/** The cron (09:00 IST) and the end of each Google sync. */
export const check = internalMutation({ args: {}, handler: (ctx) => runChecks(ctx) })

/** On demand: opening the list runs the checks again. */
export const run = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx)
    return await runChecks(ctx)
  },
})

/* ---------- accept ---------- */

type Fields = Partial<Pick<Inv, 'nextStep' | 'nextDate' | 'expected' | 'domains' | 'notes' | /* PST-302 */ 'path' | 'warmth' | 'source' | 'application'>>

/** Patch some fields and remember what they were (a key missing from `before` was empty). */
async function setFields(ctx: MutationCtx, i: Inv, set: Fields, stamp: Stamp): Promise<Undo> {
  const keys = Object.keys(set) as (keyof Fields)[]
  const before = Object.fromEntries(keys.filter((k) => i[k] !== undefined).map((k) => [k, i[k]]))
  await ctx.db.patch(i._id, { ...set, ...stamp })
  return { op: 'fields', keys, before }
}

const orNone = <T,>(xs: T[]) => (xs.length ? xs : undefined)

/**
 * Merge two cards for the same firm: the dropped card's activities, email
 * threads and meetings move to the kept one (so both histories stay), its
 * addresses join the kept card's and fill its blanks, then it's deleted.
 */
async function merge(ctx: MutationCtx, keep: Inv, drop: Inv, stamp: Stamp): Promise<Undo> {
  const acts = await ctx.db
    .query('activities')
    .withIndex('by_investor', (q) => q.eq('investorId', drop._id))
    .collect()
  for (const a of acts) await ctx.db.patch(a._id, { investorId: keep._id })
  const swap = (ids: Id<'investors'>[]) => [...new Set(ids.map((x) => (x === drop._id ? keep._id : x)))]
  const meetings: { id: Id<'meetings'>; investorIds: Id<'investors'>[] }[] = []
  for (const m of await ctx.db.query('meetings').collect()) {
    if (!m.investorIds.includes(drop._id)) continue
    meetings.push({ id: m._id, investorIds: m.investorIds })
    await ctx.db.patch(m._id, { investorIds: swap(m.investorIds) })
  }
  const threads: { id: Id<'emailTouches'>; investorIds: Id<'investors'>[] }[] = []
  for (const t of await ctx.db.query('emailTouches').collect()) {
    if (!t.investorIds.includes(drop._id)) continue
    threads.push({ id: t._id, investorIds: t.investorIds })
    await ctx.db.patch(t._id, { investorIds: swap(t.investorIds) })
  }
  const email = keep.email ?? drop.email
  const merged: Partial<Inv> = {
    email,
    emails: orNone(cleanEmails([...(keep.emails ?? []), ...(drop.emails ?? []), ...(drop.email ? [drop.email] : [])], email)),
    domains: orNone(cleanDomains([...(keep.domains ?? []), ...(drop.domains ?? [])])),
    expected: keep.expected ?? drop.expected,
    committed: keep.committed ?? drop.committed,
    lastTouch: [keep.lastTouch, drop.lastTouch].filter((x): x is string => !!x).sort().pop(),
    maxStage: IDX[drop.maxStage]! > IDX[keep.maxStage]! ? drop.maxStage : keep.maxStage,
    notes: [...new Set([keep.notes.trim(), drop.notes.trim()].filter(Boolean))].join('\n\n'),
    ...(keep.nextStep.trim() ? {} : { nextStep: drop.nextStep, nextDate: drop.nextDate }),
  }
  const keepKeys = Object.keys(merged) as (keyof Inv)[]
  const keepBefore = Object.fromEntries(keepKeys.filter((k) => keep[k] !== undefined).map((k) => [k, keep[k]]))
  await ctx.db.patch(keep._id, { ...merged, ...stamp })
  const { _id, _creationTime: _c, ...dropped } = drop
  await ctx.db.delete(_id)
  return { op: 'merge', dropId: _id, dropped, activityIds: acts.map((a) => a._id), meetings, threads, keepKeys, keepBefore }
}

/**
 * PST-276: an agent's add_investor. Creates the investor with the usual write
 * (and looks them up like any new one), unless someone with that name and firm
 * is on the list by now. The row then points at the new investor, for Undo.
 */
async function addInvestor(ctx: MutationCtx, s: Row, p: Extract<Row['patch'], { op: 'new_investor' }>, userId: Id<'users'>): Promise<Undo | null> {
  const key = dupKey(p.name, p.firm)
  if ((await ctx.db.query('investors').collect()).some((i) => dupKey(i.name, i.firm) === key)) return null
  // PST-296: Find more's wave, type and firm domain, when it gave them.
  const found = { ...(p.wave ? { wave: p.wave } : {}), ...(p.type ? { type: p.type } : {}), ...(p.domain ? { domains: cleanDomains([p.domain]) } : {}) }
  const investorId = await saveInvestor(ctx, userId, undefined, { ...NEW_INVESTOR, ...found, name: p.name, firm: p.firm, email: p.email, notes: p.note ?? '', source: `Suggested by ${sourceLabel(s)}` })
  await autoEnrich(ctx, [investorId])
  await ctx.db.patch(s._id, { investorId })
  if (s.source === 'find_more') await carryFindScore(ctx, s._id, investorId)
  return { op: 'new_investor', investorId }
}

/* ---------- PST-305: an agent's Network suggestions ---------- */

/** A new person in the Network, unless someone with that name or email is there by now. */
async function addNetworkPerson(ctx: MutationCtx, p: Extract<Row['patch'], { op: 'network_person' }>, userId: Id<'users'>): Promise<Undo | null> {
  const key = normName(p.name)
  const email = normEmail(p.email)
  const people = await ctx.db.query('introducers').collect()
  if (!key || people.some((x) => x.key === key || (!!email && normEmail(x.email) === email))) return null
  const introducerId = await ctx.db.insert('introducers', {
    name: p.name.trim(), key, ...(email ? { email } : {}), relation: p.relation, notes: (p.note ?? '').trim(), ...(p.company?.trim() ? { company: p.company.trim() } : {}), createdAt: Date.now(), createdBy: userId,
  })
  return { op: 'network_person', introducerId }
}

/** An investor on a person's list ("to ask"): one in Nest, or a new firm added as Not contacted. Null when the person is gone or it's already there. */
async function addNetworkTarget(ctx: MutationCtx, p: Extract<Row['patch'], { op: 'network_target' }>, userId: Id<'users'>): Promise<Undo | null> {
  if (!(await ctx.db.get(p.introducerId))) return null
  const r = await addTargetsFor(ctx, userId, { introducerId: p.introducerId }, p.investorId ? [p.investorId] : [], p.firm ? [{ firm: p.firm, ...(p.partner ? { partner: p.partner } : {}) }] : [])
  return r.made.length ? { op: 'network_target', introIds: r.made, investorIds: r.createdIds } : null
}
/* ---------- end PST-305 ---------- */

/** Apply one suggestion's patch. Null when it no longer fits (the investor is gone, or the stage moved since). */
async function apply(ctx: MutationCtx, s: Row, userId: Id<'users'>): Promise<Undo | null> {
  const p = s.patch
  if (p.op === 'review') throw new ConvexError('This one needs a look in the drawer.')
  if (p.op === 'new_investor') return await addInvestor(ctx, s, p, userId)
  if (p.op === 'network_person') return await addNetworkPerson(ctx, p, userId) // PST-305
  if (p.op === 'network_target') return await addNetworkTarget(ctx, p, userId) // PST-305
  const i = s.investorId ? await ctx.db.get(s.investorId) : null
  if (!i) return null
  const today = todayIST()
  const stamp = { updatedAt: Date.now(), updatedBy: userId }
  switch (p.op) {
    case 'stage': {
      if (i.stage !== p.from) return null
      const { patch, logStage } = applyMove(i, p.to, today)
      await ctx.db.patch(i._id, { ...patch, ...stamp })
      // PST-302: one activity, from → to, marked as an agent's when it came from one.
      const activityId = logStage ? await logStageMove(ctx, { investorId: i._id, from: i.stage, to: logStage, userId, date: today, ...(s.source === 'agent' ? { via: 'agent' as const } : {}) }) : undefined
      return { op: 'stage', to: p.to, from: { stage: i.stage, lastTouch: i.lastTouch, maxStage: i.maxStage }, activityId }
    }
    case 'next_step':
      return await setFields(ctx, i, { nextStep: p.step.trim(), nextDate: p.date && isISODate(p.date) ? p.date : undefined }, stamp)
    case 'expected':
      // From meeting notes, Expected is only ever filled when empty (the drawer shows the clash instead).
      if (s.source === 'notes' && i.expected) return null
      return await setFields(ctx, i, { expected: Math.max(0, p.amount) }, stamp)
    case 'domain': {
      const d = cleanDomains([p.domain])[0]
      if (!d) return null
      const undo = await setFields(ctx, i, { domains: cleanDomains([...(i.domains ?? []), d]) }, stamp)
      // Calendar and Gmail: match again, and read the last 30 days of Gmail for the new domain.
      await ctx.scheduler.runAfter(0, internal.google.rematch, { rescan: true })
      return undo
    }
    case 'touch': {
      const day = touchDay(p.date, today)
      const activityId = await ctx.db.insert('activities', { investorId: i._id, kind: 'note', note: p.note.trim() || 'Touch', touch: p.touch, date: day, userId })
      await ctx.db.patch(i._id, { lastTouch: !i.lastTouch || i.lastTouch < day ? day : i.lastTouch, ...stamp })
      return { op: 'touch', activityId, lastTouch: i.lastTouch }
    }
    case 'merge': {
      const drop = s.otherInvestorId ? await ctx.db.get(s.otherInvestorId) : null
      if (!drop || drop._id === i._id) return null
      return await merge(ctx, i, drop, stamp)
    }
    case 'questions':
      return await addNoteQuestions(ctx, userId, p.noteId, p.items)
    case 'warm_path': {
      const line = 'Warm path: ' + p.text.trim()
      if (i.notes.includes(line)) return null
      return await setFields(ctx, i, { notes: [i.notes.trim(), line].filter(Boolean).join('\n') }, stamp)
    }
    // PST-302: agents' fixes. Nothing to do when the record already has it; a replace waits for the notes it was written against.
    case 'notes':
      if (noOpReason(i, p) || (p.mode === 'replace' && i.notes.trim() !== p.before.trim())) return null
      return await setFields(ctx, i, { notes: notesAfter(i.notes, p) }, stamp)
    case 'outreach': {
      const set = outreachChanges(i, p)
      return Object.keys(set).length ? await setFields(ctx, i, set, stamp) : null
    }
    case 'application':
      if (noOpReason(i, p)) return null
      return await setFields(ctx, i, { application: applicationAfter(i.application, p) }, stamp)
  }
}

/** Accept one open suggestion; false (and the row goes) when it no longer fits. Also how the drawer applies a note's proposals. */
export async function acceptOne(ctx: MutationCtx, s: Row, userId: Id<'users'>): Promise<boolean> {
  const undo = await apply(ctx, s, userId)
  if (!undo) {
    await ctx.db.delete(s._id)
    return false
  }
  await ctx.db.patch(s._id, { status: 'accepted', decidedAt: Date.now(), decidedBy: userId, undo })
  // Other open suggestions about the merged-away card no longer apply.
  if (undo.op === 'merge') for (const o of await openRows(ctx)) if (o.investorId === undo.dropId || o.otherInvestorId === undo.dropId) await ctx.db.delete(o._id)
  return true
}

/** Accept (or Merge) one suggestion. `applied: false` when it had already stopped fitting. */
export const accept = mutation({
  args: { id: v.id('suggestions') },
  handler: async (ctx, { id }) => {
    const { userId } = await requireUser(ctx)
    const s = await ctx.db.get(id)
    if (!s || s.status !== 'open') throw new ConvexError('That suggestion was already handled.')
    return { applied: await acceptOne(ctx, s, userId) }
  },
})

/** "Accept N safe ones": every open suggestion marked safe, never a merge, a review or one from an agent. */
export const acceptSafe = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireUser(ctx)
    const ids: Id<'suggestions'>[] = []
    for (const s of sortSuggestions(await openRows(ctx))) if (acceptsTogether(s) && (await acceptOne(ctx, s, userId))) ids.push(s._id)
    return { ids }
  },
})

/** Dismiss for good: the key stays taken, so the checks never suggest it again. */
export const dismiss = mutation({
  args: { id: v.id('suggestions') },
  handler: async (ctx, { id }) => {
    const { userId } = await requireUser(ctx)
    const s = await ctx.db.get(id)
    if (!s || s.status !== 'open') return null
    await ctx.db.patch(id, { status: 'dismissed', decidedAt: Date.now(), decidedBy: userId })
    return id
  },
})

/* ---------- undo ---------- */

/** Put back what an accept changed. Returns the new id of a card a merge had deleted. */
async function revert(ctx: MutationCtx, s: Row, u: Undo, userId: Id<'users'>): Promise<Id<'investors'> | undefined> {
  // PST-305: the person, or the intros and new investors, an agent's Network suggestion added.
  if (u.op === 'network_person') {
    for (const x of await ctx.db.query('intros').collect()) if (x.introducerId === u.introducerId) await ctx.db.delete(x._id)
    if (await ctx.db.get(u.introducerId)) await ctx.db.delete(u.introducerId)
    return
  }
  if (u.op === 'network_target') {
    for (const id of u.introIds) if (await ctx.db.get(id)) await ctx.db.delete(id)
    for (const id of u.investorIds) {
      if (!(await ctx.db.get(id))) continue
      for (const a of await ctx.db.query('activities').withIndex('by_investor', (q) => q.eq('investorId', id)).collect()) await ctx.db.delete(a._id)
      await ctx.db.delete(id)
      await forgetInvestor(ctx, id)
    }
    return
  }
  const i = s.investorId ? await ctx.db.get(s.investorId) : null
  if (!i) throw new ConvexError('That investor was deleted')
  const stamp = { updatedAt: Date.now(), updatedBy: userId }
  switch (u.op) {
    case 'stage': {
      const back = applyUndo(i, { id: i._id, to: u.to, from: u.from, activityId: u.activityId })
      if (!back) throw new ConvexError('It moved again since, so there’s nothing to undo')
      await ctx.db.patch(i._id, { ...back, ...stamp })
      if (u.activityId && (await ctx.db.get(u.activityId))) await ctx.db.delete(u.activityId)
      return
    }
    case 'fields': {
      await ctx.db.patch(i._id, { ...Object.fromEntries(u.keys.map((k) => [k, u.before[k]])), ...stamp })
      if (u.keys.includes('domains')) await ctx.scheduler.runAfter(0, internal.google.rematch, { rescan: false })
      return
    }
    case 'touch': {
      if (await ctx.db.get(u.activityId)) await ctx.db.delete(u.activityId)
      await ctx.db.patch(i._id, { lastTouch: u.lastTouch, ...stamp })
      return
    }
    case 'new_investor': {
      for (const a of await ctx.db.query('activities').withIndex('by_investor', (q) => q.eq('investorId', i._id)).collect()) await ctx.db.delete(a._id)
      await ctx.db.delete(i._id)
      await forgetInvestor(ctx, i._id)
      if (i.email) await ctx.scheduler.runAfter(0, internal.google.rematch, { rescan: false })
      return
    }
    case 'merge': {
      const back = await ctx.db.insert('investors', u.dropped)
      for (const a of u.activityIds) if (await ctx.db.get(a)) await ctx.db.patch(a, { investorId: back })
      const restore = (ids: Id<'investors'>[]) => ids.map((x) => (x === u.dropId ? back : x))
      for (const m of u.meetings) if (await ctx.db.get(m.id)) await ctx.db.patch(m.id, { investorIds: restore(m.investorIds) })
      for (const t of u.threads) if (await ctx.db.get(t.id)) await ctx.db.patch(t.id, { investorIds: restore(t.investorIds) })
      await ctx.db.patch(i._id, { ...Object.fromEntries(u.keepKeys.map((k) => [k, u.keepBefore[k]])), ...stamp })
      return back
    }
    case 'questions':
      await removeNoteQuestions(ctx, u)
      return
  }
}

/** Put one accepted or dismissed suggestion back to open (an accept is reverted first). */
export async function reopen(ctx: MutationCtx, s: Row, userId: Id<'users'>) {
  if (s.status === 'open') return false
  let otherInvestorId = s.otherInvestorId
  if (s.status === 'accepted') {
    if (!s.undo) throw new ConvexError('That one can’t be undone.')
    otherInvestorId = (await revert(ctx, s, s.undo, userId)) ?? otherInvestorId
  }
  const created = s.undo?.op === 'new_investor' ? { investorId: undefined } : {}
  await ctx.db.patch(s._id, { status: 'open', decidedAt: undefined, decidedBy: undefined, undo: undefined, otherInvestorId, ...created })
  return true
}

/** Undo accepts and dismissals (one, or the batch from "Accept N safe ones"): each goes back to open. */
export const undo = mutation({
  args: { ids: v.array(v.id('suggestions')) },
  handler: async (ctx, { ids }) => {
    const { userId } = await requireUser(ctx)
    let n = 0
    for (const id of [...ids].reverse()) {
      const s = await ctx.db.get(id)
      if (s && (await reopen(ctx, s, userId))) n++
    }
    return n
  },
})

/* ---------- for other features ---------- */

const suggestionArgs = {
  kind: vSuggestionKind,
  investorId: v.optional(v.id('investors')),
  otherInvestorId: v.optional(v.id('investors')),
  title: v.string(),
  fix: v.string(),
  patch: vSuggestionPatch,
  source: vSuggestionSource,
  agentName: v.optional(v.string()),
  safe: v.optional(v.boolean()),
  key: v.string(),
}

/**
 * Add one suggestion from another feature: enrichment (PST-274), and agents
 * through the Nest MCP server (PST-276: source "agent" with `agentName`, shown
 * as "From Grok Bot"). Returns null when the key exists in any status, so
 * a dismissed suggestion never comes back. Merges, reviews, enrichment and
 * anything from an agent are never safe to accept in bulk.
 */
export async function insertSuggestion(ctx: MutationCtx, a: ObjectType<typeof suggestionArgs>) {
  if (a.key.startsWith(CHECK_PREFIX)) throw new ConvexError(`Keys starting with “${CHECK_PREFIX}” belong to the rule checks.`)
  const taken = await ctx.db
    .query('suggestions')
    .withIndex('by_key', (q) => q.eq('key', a.key))
    .first()
  if (taken) return null
  const row = { ...a, title: a.title.trim().slice(0, 300), fix: a.fix.trim().slice(0, 200), agentName: a.agentName?.trim().slice(0, 60) || undefined }
  return await ctx.db.insert('suggestions', { ...row, safe: !!a.safe && acceptsTogether({ ...row, safe: true }), status: 'open', createdAt: Date.now() })
}

export const addSuggestion = internalMutation({ args: suggestionArgs, handler: insertSuggestion })
