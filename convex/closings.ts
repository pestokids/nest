// PST-283: Close. Closing records and the cap table inputs. Nest tracks
// signing only: each step is ticked by hand, and the signed and wired ticks
// move the pipeline stage by the board's rules (src/lib/close.ts stageMove).
import { ConvexError, v } from 'convex/values'
import { action, internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { requireUser } from './lib/access'
import { emailReady, sendEmail } from './lib/email'
import { getRoundRow } from './lib/round'
import { closingTermFields, vCapTable, vQuestionnaire, vStepKey } from './closeSchema'
import { applyMove } from '../src/lib/board'
import { logStageMove } from './lib/stageLog' // PST-302
import { todayIST } from '../src/lib/dates'
import { capTableSummary, checkTick, cleanCapTable, cleanTerms, planTick, reminderKind, setStep, validateCapTable, validateTerms } from '../src/lib/close'
import { COMMIT } from '../src/lib/stages'
import { checkTranche2, commitmentTerms, trancheOf } from '../src/lib/closeKit'
import { money } from '../src/lib/money'

/** Every closing record, the cap table inputs (null until someone enters them), and whether reminders can go by email. */
export const data = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx)
    const closings = await ctx.db.query('closings').collect()
    const row = await getRoundRow(ctx)
    // PST-291: tranche 2 and the allocation rows.
    const allocations = (await ctx.db.query('allocations').collect()).map((a) => ({ investorId: a.investorId, gets: a.gets, why: a.why }))
    return { closings, capTable: row?.capTable ?? null, emailReady: emailReady(), tranche2: row?.tranche2 ?? null, allocations }
  },
})

const fieldErrors = (errors: Record<string, string>) => {
  if (Object.keys(errors).length) throw new ConvexError({ message: 'Fix the highlighted fields', errors })
}

/**
 * Create or update an investor's closing record (the client sends every term,
 * links included). With `sentAt`, also ticks "SAFE sent" on that day: Record
 * SAFE sent. A new record needs the investor in Verbal or later. The amount
 * becomes the investor's Committed.
 */
export const save = mutation({
  args: { investorId: v.id('investors'), terms: v.object(closingTermFields), sentAt: v.optional(v.string()) },
  handler: async (ctx, { investorId, terms, sentAt }) => {
    const { userId } = await requireUser(ctx)
    const inv = await ctx.db.get(investorId)
    if (!inv) throw new ConvexError('That investor was deleted')
    const body = cleanTerms(terms)
    fieldErrors(validateTerms(body))
    const prev = await ctx.db.query('closings').withIndex('by_investor', (q) => q.eq('investorId', investorId)).unique()
    if (!prev && !COMMIT.has(inv.stage)) throw new ConvexError(`Move ${inv.name} to Verbal first. Closing records start at a verbal yes.`)
    let steps = prev?.steps ?? []
    if (sentAt) {
      const err = checkTick(steps, 'sent', sentAt, todayIST())
      if (err) fieldErrors({ sentAt: err })
      steps = setStep(steps, 'sent', sentAt)
    }
    const now = Date.now()
    // The SAFE's amount is what they committed: keep Today and Plan in step with it.
    if (inv.committed !== body.amount) await ctx.db.patch(investorId, { committed: body.amount, updatedAt: now, updatedBy: userId })
    const kit = prev ? { tranche: prev.tranche, confirmationSentAt: prev.confirmationSentAt, acceptedAt: prev.acceptedAt, questionnaire: prev.questionnaire } : {}
    const doc = { investorId, ...body, steps, ...kit, updatedAt: now, updatedBy: userId }
    if (!prev) return await ctx.db.insert('closings', doc)
    await ctx.db.replace(prev._id, doc)
    return prev._id
  },
})

/**
 * Tick a step on a day, re-date it, or untick it (`at: null`). Ticking "Signed by
 * them" moves Verbal → Signed and "Wired" moves Signed → Money in, with the
 * same write as a board move (lastTouch today, maxStage only rises, a stage
 * activity); unticking undoes that move. A tick that would skip a stage is
 * refused. `firstMoney`: the investor reached Money in for the first time.
 */
export const tick = mutation({
  args: { id: v.id('closings'), key: vStepKey, at: v.union(v.string(), v.null()) },
  handler: async (ctx, { id, key, at }) => {
    const { userId } = await requireUser(ctx)
    const c = await ctx.db.get(id)
    if (!c) throw new ConvexError('That closing record was removed')
    const inv = await ctx.db.get(c.investorId)
    if (!inv) throw new ConvexError('That investor was deleted')
    const today = todayIST()
    const plan = planTick(c, inv.stage, key, at, today)
    if ('error' in plan) throw new ConvexError(plan.error)
    const now = Date.now()
    await ctx.db.patch(id, { steps: plan.steps, updatedAt: now, updatedBy: userId })
    if (!plan.to) return { to: null, firstMoney: false }
    const { patch, logStage } = applyMove(inv, plan.to, today)
    await ctx.db.patch(inv._id, { ...patch, updatedAt: now, updatedBy: userId })
    if (logStage) await logStageMove(ctx, { investorId: inv._id, from: inv.stage, to: logStage, userId, date: today }) // PST-302
    return { to: plan.to, firstMoney: plan.to === 'wired' && inv.maxStage !== 'wired' }
  },
})

/** Remove a closing record (the pipeline stage stays where it is). */
export const remove = mutation({
  args: { id: v.id('closings') },
  handler: async (ctx, { id }) => {
    await requireUser(ctx)
    if (await ctx.db.get(id)) await ctx.db.delete(id)
    return null
  },
})

/** Save (or clear, with null) the cap table inputs on the round row; one change-log row when they change. */
export const setCapTable = mutation({
  args: { capTable: v.union(vCapTable, v.null()) },
  handler: async (ctx, { capTable }) => {
    const { userId } = await requireUser(ctx)
    const row = await getRoundRow(ctx)
    if (!row) throw new ConvexError('Save the round first, then add the cap table.')
    const next = capTable ? cleanCapTable(capTable) : null
    if (next) fieldErrors(validateCapTable(next))
    const from = capTableSummary(row.capTable)
    const to = capTableSummary(next)
    if (from === to && JSON.stringify(row.capTable ?? null) === JSON.stringify(next)) return 0
    await ctx.db.patch(row._id, { capTable: next ?? undefined })
    await ctx.db.insert('settingsLog', { userId, at: Date.now(), field: 'capTable', from, to })
    return 1
  },
})

const MAX_SUBJECT = 200
const MAX_REMINDER = 4000

/** Who a reminder goes to: the signer's email on the record. Checks the caller's access. */
export const reminderTo = internalQuery({
  args: { id: v.id('closings') },
  handler: async (ctx, { id }) => {
    await requireUser(ctx)
    const c = await ctx.db.get(id)
    if (!c) throw new ConvexError('That closing record was removed')
    const to = c.signerEmail?.trim().toLowerCase()
    if (!to) throw new ConvexError('Add the signer’s email on the SAFE first.')
    return { to, investorId: c.investorId, kind: reminderKind(c) ?? 'sign' }
  },
})

/** An emailed reminder is a touch (Email), like logging one by hand. */
export const logReminder = internalMutation({
  args: { investorId: v.id('investors'), note: v.string() },
  handler: async (ctx, { investorId, note }) => {
    const { userId } = await requireUser(ctx)
    const i = await ctx.db.get(investorId)
    if (!i) return
    const today = todayIST()
    await ctx.db.insert('activities', { investorId, kind: 'note', note, touch: 'email', date: today, userId })
    if (!i.lastTouch || i.lastTouch < today) await ctx.db.patch(investorId, { lastTouch: today, updatedAt: Date.now(), updatedBy: userId })
  },
})

/** "Send by email": the reminder to the signer, through Resend (convex/lib/email.ts). Only offered when RESEND_API_KEY is set. */
export const emailReminder = action({
  args: { id: v.id('closings'), subject: v.string(), text: v.string() },
  handler: async (ctx, { id, subject, text }): Promise<{ to: string }> => {
    const s = subject.trim().slice(0, MAX_SUBJECT)
    const body = text.trim().slice(0, MAX_REMINDER)
    if (!s || !body) throw new ConvexError('Write the reminder first.')
    const r = await ctx.runQuery(internal.closings.reminderTo, { id })
    if (!emailReady()) throw new ConvexError('Email isn’t set up here. Copy the text instead.')
    const sent = await sendEmail({ to: r.to, subject: s, text: body })
    if (!sent.sent) throw new ConvexError(sent.reason === 'no-key' ? 'Email isn’t set up here. Copy the text instead.' : `Couldn’t send it: ${sent.message ?? 'the email service refused it'}.`)
    await ctx.runMutation(internal.closings.logReminder, { investorId: r.investorId, note: r.kind === 'sign' ? 'Emailed a reminder to sign the SAFE' : 'Emailed a reminder about the wire' })
    return { to: r.to }
  },
})

/** An investor was deleted: its closing record (and PST-291's allocation row) goes too. */
export async function forgetClosing(ctx: MutationCtx, investorId: Id<'investors'>) {
  for (const c of await ctx.db.query('closings').withIndex('by_investor', (q) => q.eq('investorId', investorId)).collect()) await ctx.db.delete(c._id)
  for (const a of await ctx.db.query('allocations').withIndex('by_investor', (q) => q.eq('investorId', investorId)).collect()) await ctx.db.delete(a._id)
}

/* ---------- PST-291: the same-day close kit, allocation and tranche 2 ---------- */

/** Who a confirmation is for, and why it can't start the clock (thrown), checked before anything is sent. */
export async function confirmationTarget(ctx: QueryCtx, investorId: Id<'investors'>) {
  const inv = await ctx.db.get(investorId)
  if (!inv) throw new ConvexError('That investor was deleted')
  const prev = await ctx.db.query('closings').withIndex('by_investor', (q) => q.eq('investorId', investorId)).unique()
  const row = await getRoundRow(ctx)
  const terms = commitmentTerms(inv, prev, { cap: row?.cap, instrument: row?.instrument ?? '' }, row?.tranche2)
  if (prev) return { inv, prev, terms }
  if (!COMMIT.has(inv.stage)) throw new ConvexError(`Move ${inv.name} to Verbal first. Closing records start at a verbal yes.`)
  if (!terms.amount || !terms.cap) throw new ConvexError('Add the amount and the round’s cap first, so the confirmation can state them.')
  return { inv, prev, terms }
}

/**
 * The written confirmation went (sent from nest@, or "I sent it" after Copy):
 * stamps confirmationSentAt, which starts the 48-hour offer. Sending another
 * restarts it. With no closing record yet, makes one from the investor's
 * number and the round's terms (in the open tranche), the way the draft said.
 * Called by convex/drafts.ts for drafts of type "confirm".
 */
export async function stampConfirmation(ctx: MutationCtx, userId: Id<'users'>, investorId: Id<'investors'>, at: number) {
  const { inv, prev, terms: t } = await confirmationTarget(ctx, investorId)
  const now = Date.now()
  if (prev) return void (await ctx.db.patch(prev._id, { confirmationSentAt: at, updatedAt: now, updatedBy: userId }))
  if (!t.amount || !t.cap) return
  if (inv.committed !== t.amount) await ctx.db.patch(investorId, { committed: t.amount, updatedAt: now, updatedBy: userId })
  await ctx.db.insert('closings', {
    investorId, amount: t.amount, instrument: t.instrument, cap: t.cap, proRata: false, mfn: false, steps: [],
    ...(t.tranche === 2 ? { tranche: 2 } : {}), confirmationSentAt: at, updatedAt: now, updatedBy: userId,
  })
}

/**
 * The kit's own steps on a record: they accepted (now) or not, the
 * questionnaire's status, and the tranche (moving tranche sets the record's
 * cap to that tranche's: the same terms within a tranche).
 */
export const setKit = mutation({
  args: {
    id: v.id('closings'),
    accepted: v.optional(v.boolean()),
    questionnaire: v.optional(v.union(vQuestionnaire, v.literal('none'))),
    tranche: v.optional(v.union(v.literal(1), v.literal(2))),
  },
  handler: async (ctx, { id, accepted, questionnaire, tranche }) => {
    const { userId } = await requireUser(ctx)
    const c = await ctx.db.get(id)
    if (!c) throw new ConvexError('That closing record was removed')
    const patch: Partial<typeof c> = { updatedAt: Date.now(), updatedBy: userId }
    if (accepted === true && !c.acceptedAt) {
      if (!c.confirmationSentAt) throw new ConvexError('Send the written confirmation first: their yes is to that offer.')
      patch.acceptedAt = Date.now()
    }
    if (accepted === false) patch.acceptedAt = undefined
    if (questionnaire) patch.questionnaire = questionnaire === 'none' ? undefined : questionnaire
    if (tranche && tranche !== trancheOf(c)) {
      const row = await getRoundRow(ctx)
      if (tranche === 2) {
        if (!row?.tranche2) throw new ConvexError('Set up tranche 2 first, in Close › Allocation.')
        patch.tranche = 2
        patch.cap = row.tranche2.cap
      } else {
        patch.tranche = undefined
        if (row?.cap) patch.cap = row.cap
      }
    }
    await ctx.db.patch(id, patch)
    return null
  },
})

/**
 * Set up tranche 2 at a higher post-money cap, change it (every tranche-2
 * record follows: the same terms within a tranche), or take it away (null;
 * only once nothing is in it). One change-log row.
 */
export const setTranche2 = mutation({
  args: { cap: v.union(v.number(), v.null()) },
  handler: async (ctx, { cap }) => {
    const { userId } = await requireUser(ctx)
    const row = await getRoundRow(ctx)
    if (!row) throw new ConvexError('Save the round first, then add tranche 2.')
    const inTwo = (await ctx.db.query('closings').collect()).filter((c) => trancheOf(c) === 2)
    if (cap === null) {
      if (inTwo.length) throw new ConvexError(`Move ${inTwo.length === 1 ? 'the commitment' : `the ${inTwo.length} commitments`} in tranche 2 back to tranche 1 first.`)
    } else {
      const err = checkTranche2(cap, row.cap)
      if (err) fieldErrors({ cap: err })
    }
    const from = row.tranche2 ? money(row.tranche2.cap) + ' post' : ''
    const to = cap === null ? '' : money(cap) + ' post'
    if (from === to) return 0
    await ctx.db.patch(row._id, { tranche2: cap === null ? undefined : { cap } })
    if (cap !== null) for (const c of inTwo) await ctx.db.patch(c._id, { cap, updatedAt: Date.now(), updatedBy: userId })
    await ctx.db.insert('settingsLog', { userId, at: Date.now(), field: 'tranche2', from, to })
    return 1
  },
})

const MAX_WHY = 200

/** Allocation: what an investor gets (null: back to the suggestion) and why. */
export const setAllocation = mutation({
  args: { investorId: v.id('investors'), gets: v.optional(v.union(v.number(), v.null())), why: v.optional(v.string()) },
  handler: async (ctx, { investorId, gets, why }) => {
    const { userId } = await requireUser(ctx)
    if (!(await ctx.db.get(investorId))) throw new ConvexError('That investor was deleted')
    if (typeof gets === 'number' && (!Number.isFinite(gets) || gets < 0)) fieldErrors({ gets: 'Zero or more.' })
    const prev = await ctx.db.query('allocations').withIndex('by_investor', (q) => q.eq('investorId', investorId)).unique()
    const next = {
      investorId,
      gets: gets === undefined ? prev?.gets : gets === null ? undefined : Math.round(gets),
      why: why === undefined ? prev?.why ?? '' : why.trim().slice(0, MAX_WHY),
      updatedAt: Date.now(),
      updatedBy: userId,
    }
    if (prev) await ctx.db.replace(prev._id, next)
    else await ctx.db.insert('allocations', next)
    return null
  },
})
