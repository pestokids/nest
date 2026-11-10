// PST-278: Drafts. Claude (no web tools) writes an intro ask, follow-up, nudge,
// thank-you or data-room note as Dev, from the investor record and what Nest
// has kept about them. Dev edits it, then copies it, shares it on WhatsApp or
// sends it from nest@pestokids.com (only when RESEND_API_KEY is set). Sending
// logs one email touch; Copy and WhatsApp log nothing until Dev ticks "I sent it".
// Logs carry ids only: never names, addresses or the text.
import { ConvexError, v } from 'convex/values'
import { action, internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { firstName, requireUser } from './lib/access'
import { AIError, complete, errorTag, hasAIKey, NoAIKey, usageRow } from './lib/anthropic'
import { draftPrompt, DRAFT_SYSTEM, parseDraft, parseForwardable, type DraftContext, type LinkedMaterial } from './lib/draftPrompt'
import { markAsked } from './introducers' // PST-294
import { emailReady, sendEmail } from './lib/email'
import { randomToken } from './lib/token'
import { siteOrigin } from './materials'
import { vDraftType, vTweak } from './draftsSchema'
import { vModel, vUsage } from './validators'
import { noteLeadAsked } from './race' // PST-295
import { blanks, firstLine, isAiType, isEmail, LINK_SLOTS, mainContact, MAX_BODY, MAX_SUBJECT, touchNote, warmPathContact, type Known } from '../src/lib/drafts'
import { SAFE_LINK } from '../src/lib/closeKit'
import { confirmationTarget, stampConfirmation } from './closings'
import { fieldLabel, NO_AI_KEY } from '../src/lib/enrich'
import { todayIST } from '../src/lib/dates'
import { normEmail } from '../src/lib/google'
import { DEFAULT_OPTIONS, shareUrl, type MaterialKind } from '../src/lib/materials'
import { LABEL } from '../src/lib/stages'
import { addRunUsage } from '../src/lib/models'
import { askByDate } from '../src/lib/decisions' // PST-293
import { decisionFor } from './decisions' // PST-293
import { RELATION_LABEL, relationOf } from '../src/lib/introducers'
import { WHY_SLOT } from '../src/lib/network' // PST-305

const noKey = () => new ConvexError({ code: NO_AI_KEY, message: 'AI isn’t set up here.' })
// PST-294: a forwardable intro also carries its intro and the second email.
const vForward = v.object({ subject: v.string(), body: v.string() })
// PST-305: the intro ask carries its intros.
const vInput = { draftId: v.optional(v.id('drafts')), investorId: v.id('investors'), type: vDraftType, to: v.string(), subject: v.string(), body: v.string(), introId: v.optional(v.id('intros')), forward: v.optional(vForward), introIds: v.optional(v.array(v.id('intros'))) }
type Forward = { subject: string; body: string }
type Input = { draftId?: Id<'drafts'>; investorId: Id<'investors'>; type: Doc<'drafts'>['type']; to: string; subject: string; body: string; introId?: Id<'intros'>; forward?: Forward; introIds?: Id<'intros'>[] }

/* ---------- what the dialog and the drawer read ---------- */

/** The newest material of a kind that has a version. */
async function currentMaterial(ctx: QueryCtx, kind: MaterialKind) {
  const all = (await ctx.db.query('materials').collect()).filter((m) => m.kind === kind && m.currentVersionId)
  return all.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
}

/** The investor's newest link to a material that still opens. */
async function liveLink(ctx: QueryCtx, investorId: Id<'investors'>, materialId: Id<'materials'>, now = Date.now()) {
  const links = await ctx.db.query('shareLinks').withIndex('by_investor', (q) => q.eq('investorId', investorId)).collect()
  return links.filter((l) => l.materialId === materialId && l.revokedAt === undefined && (l.expiresAt === undefined || l.expiresAt > now)).sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
}

/** The main contact, and the warm-path person (someone the path names, from Gmail or Calendar). */
async function recipients(ctx: QueryCtx, inv: Doc<'investors'>, self?: string) {
  const people = await ctx.db.query('people').withIndex('by_investor', (q) => q.eq('investorId', inv._id)).collect()
  const contact = mainContact(people, inv.email)
  if (!inv.path.trim()) return { people, contact, warm: null }
  const known: Known[] = []
  for (const m of await ctx.db.query('meetings').withIndex('by_start').order('desc').take(500)) for (const p of m.people) known.push({ email: p.email, name: p.name, at: m.start })
  for (const t of await ctx.db.query('emailTouches').withIndex('by_last').order('desc').take(1000)) for (const e of t.participants) known.push({ email: e, at: t.lastAt })
  const warm = warmPathContact(inv.path, known, { exclude: [inv.email, ...(inv.emails ?? []), ...people.map((p) => p.email)], excludeDomains: inv.domains, self })
  return { people, contact, warm }
}

export const forInvestor = query({
  args: { investorId: v.id('investors') },
  handler: async (ctx, { investorId }) => {
    const { user } = await requireUser(ctx)
    const inv = await ctx.db.get(investorId)
    if (!inv) return null
    const { contact, warm } = await recipients(ctx, inv, user.email)
    const drafts = await ctx.db.query('drafts').withIndex('by_investor', (q) => q.eq('investorId', investorId)).order('desc').take(5)
    return {
      aiReady: hasAIKey(),
      emailReady: emailReady(),
      contact,
      warm,
      hasDeck: !!(await currentMaterial(ctx, 'deck')),
      drafts: drafts.map(({ createdBy: _, ...d }) => d),
    }
  },
})

/* ---------- writing one ---------- */

async function linked(ctx: QueryCtx, investorId: Id<'investors'>, kind: MaterialKind): Promise<LinkedMaterial | null> {
  const m = await currentMaterial(ctx, kind)
  const ver = m?.currentVersionId ? await ctx.db.get(m.currentVersionId) : null
  if (!m || !ver) return null
  const link = await liveLink(ctx, investorId, m._id)
  return { title: m.title, version: ver.n, note: ver.note, ...(link ? { url: shareUrl(link.token, siteOrigin()) } : {}) }
}

/** What the prompt gets. Checks the caller's access. */
export const context = internalQuery({
  args: { investorId: v.id('investors'), introId: v.optional(v.id('intros')) },
  handler: async (ctx, { investorId, introId }): Promise<DraftContext> => {
    const { user } = await requireUser(ctx)
    const inv = await ctx.db.get(investorId)
    if (!inv) throw new ConvexError('That investor was deleted')
    const { contact, warm } = await recipients(ctx, inv, user.email)
    const facts = (await ctx.db.query('facts').withIndex('by_investor', (q) => q.eq('investorId', investorId)).collect())
      .filter((f) => f.status === 'kept')
      .map((f) => fieldLabel(f.group, f.field) + ': ' + f.value)
    const note = (await ctx.db.query('notes').withIndex('by_investor', (q) => q.eq('investorId', investorId)).collect())
      .filter((n) => n.removedAt === undefined)
      .sort((a, b) => b.date.localeCompare(a.date) || b._creationTime - a._creationTime)[0]
    // PST-277's summary of those notes, when Nest has read them.
    const read = note
      ? (await ctx.db.query('noteReads').withIndex('by_note', (q) => q.eq('noteId', note._id)).order('desc').take(5)).find((r) => r.status !== 'reading' && r.status !== 'failed' && r.summary.length)
      : undefined
    const answers: DraftContext['answers'] = []
    const seen = new Set<string>()
    for (const a of await ctx.db.query('questionAsks').withIndex('by_investor', (q) => q.eq('investorId', investorId)).collect()) {
      if (seen.has(a.questionId)) continue
      seen.add(a.questionId)
      const q = await ctx.db.get(a.questionId)
      if (q && q.removedAt === undefined && !q.mergedInto && q.bestAnswer.trim()) answers.push({ q: q.text, a: q.bestAnswer.trim() })
    }
    const sent: (DraftContext['sent'][number] & { at: number })[] = []
    for (const t of await ctx.db.query('emailTouches').withIndex('by_last').order('desc').take(1000))
      if (t.lastFrom === 'us' && t.investorIds.includes(investorId)) sent.push({ at: t.lastAt, date: todayIST(t.lastAt), subject: t.subject })
    for (const d of await ctx.db.query('drafts').withIndex('by_investor', (q) => q.eq('investorId', investorId)).order('desc').take(20))
      if (d.status === 'sent') sent.push({ at: d.sentAt ?? d.createdAt, date: todayIST(d.sentAt ?? d.createdAt), subject: d.subject, firstLine: firstLine(d.body) })
    return {
      me: firstName(user),
      investor: {
        name: inv.name, firm: inv.firm, type: inv.type, stage: LABEL[inv.stage], path: inv.path, warmth: inv.warmth, nextStep: inv.nextStep, nextDate: inv.nextDate,
        notes: inv.notes.slice(0, 1000), lastTouch: inv.lastTouch, expected: inv.expected, committed: inv.committed,
      },
      contact,
      warm,
      facts: facts.slice(0, 30),
      lastNote: note ? { date: note.date, title: note.title, summary: read?.summary ?? [], text: note.text.slice(0, read ? 1500 : 3000) } : null,
      answers: answers.slice(0, 6),
      deck: await linked(ctx, investorId, 'deck'),
      dataRoom: await linked(ctx, investorId, 'data-room'),
      sent: sent.sort((a, b) => b.at - a.at).slice(0, 5).map(({ at: _, ...s }) => s),
      // PST-293
      askBy: askByDate((await decisionFor(ctx, investorId)).decideBy, todayIST()),
      ...(introId ? await introContext(ctx, introId, investorId) : {}),
    }
  },
})

/** PST-294: who makes a forwardable intro, and Dev's best saved answers about Pesto (the most-asked questions with an answer). */
async function introContext(ctx: QueryCtx, introId: Id<'intros'>, investorId: Id<'investors'>): Promise<Pick<DraftContext, 'introducer' | 'bank'>> {
  const x = await ctx.db.get(introId)
  if (!x || x.investorId !== investorId) throw new ConvexError('That intro was deleted')
  const p = x.introducerId ? await ctx.db.get(x.introducerId) : null
  const via = x.viaInvestorId ? await ctx.db.get(x.viaInvestorId) : null
  const introducer = p
    ? { name: p.name, email: p.email, relation: RELATION_LABEL[relationOf(p.relation)], notes: p.notes }
    : via
      ? { name: via.name, email: via.email, relation: RELATION_LABEL.committed, notes: via.firm && via.firm !== via.name ? via.firm : '' }
      : null
  if (!introducer) throw new ConvexError('That introducer was deleted')
  const bank = (await ctx.db.query('questions').collect())
    .filter((q) => q.removedAt === undefined && !q.mergedInto && q.bestAnswer.trim())
    .sort((a, b) => b.askedCount - a.askedCount)
    .slice(0, 4)
    .map((q) => ({ q: q.text, a: q.bestAnswer.trim() }))
  return { introducer, bank }
}

/** A generated draft: a new row, or the dialog's row rewritten (its cost and usage added up). A sent draft is never rewritten. */
export const saveGenerated = internalMutation({
  args: { draftId: v.optional(v.id('drafts')), investorId: v.id('investors'), type: vDraftType, subject: v.string(), body: v.string(), costUsd: v.number(), model: vModel, usage: vUsage, introId: v.optional(v.id('intros')), forward: v.optional(vForward) },
  handler: async (ctx, a) => {
    const { userId } = await requireUser(ctx)
    const prev = a.draftId ? await ctx.db.get(a.draftId) : null
    if (prev && prev.investorId === a.investorId && prev.status !== 'sent') {
      const costUsd = prev.costUsd + a.costUsd
      await ctx.db.patch(prev._id, { type: a.type, subject: a.subject, body: a.body, costUsd, model: a.model, usage: prev.usage ? addRunUsage(prev.usage, a.usage) : a.usage, introId: a.introId, forward: a.forward })
      return { draftId: prev._id, costUsd }
    }
    const draftId = await ctx.db.insert('drafts', {
      investorId: a.investorId, type: a.type, subject: a.subject, body: a.body, status: 'draft', costUsd: a.costUsd, model: a.model, usage: a.usage, createdAt: Date.now(), createdBy: userId,
      ...(a.introId ? { introId: a.introId } : {}), ...(a.forward ? { forward: a.forward } : {}),
    })
    return { draftId, costUsd: a.costUsd }
  },
})

/**
 * Write (or rewrite) a draft with Claude. A tweak rewrites the current text
 * with one instruction. Resolves with the draft and what it has cost so far.
 */
export const generate = action({
  args: {
    draftId: v.optional(v.id('drafts')),
    investorId: v.id('investors'),
    type: vDraftType,
    tweak: v.optional(vTweak),
    current: v.optional(v.object({ subject: v.string(), body: v.string() })),
    introId: v.optional(v.id('intros')),
  },
  handler: async (ctx, a): Promise<{ draftId: Id<'drafts'>; subject: string; body: string; costUsd: number; forward?: Forward }> => {
    // PST-291: the written confirmation and allocation emails are Close's fixed text, never Claude's.
    if (!isAiType(a.type)) throw new ConvexError('Nest fills this one in from Close. Edit it by hand.')
    const type = a.type
    if (!hasAIKey()) throw noKey()
    if (a.type === 'forwardable' && !a.introId) throw new ConvexError('Pick who makes the intro first.')
    const introId = a.type === 'forwardable' ? a.introId : undefined
    const c: DraftContext = await ctx.runQuery(internal.drafts.context, { investorId: a.investorId, introId })
    if (a.tweak === 'deck' && !c.deck) throw new ConvexError('There’s no deck in Materials yet. Add it there, then Nest can link it.')
    const model = await ctx.runQuery(internal.enrich.modelOf, { feature: 'drafts' })
    let out
    try {
      const prompt = draftPrompt(c, type, { tweak: a.tweak, current: a.current })
      const r = await complete({ model, system: DRAFT_SYSTEM, prompt, maxTokens: 2000 })
      out = { ...(type === 'forwardable' ? parseForwardable(r.text, prompt) : { ...parseDraft(r.text), forward: undefined }), costUsd: r.costUsd, usage: usageRow(r.usage) }
    } catch (e) {
      if (e instanceof NoAIKey) throw noKey()
      console.warn('drafts.generate failed', a.investorId, 'error=' + errorTag(e))
      throw new ConvexError(e instanceof AIError ? 'Couldn’t write it: ' + e.message + '. Try again.' : 'Couldn’t write it. Try again.')
    }
    const saved: { draftId: Id<'drafts'>; costUsd: number } = await ctx.runMutation(internal.drafts.saveGenerated, {
      draftId: a.draftId, investorId: a.investorId, type: a.type, subject: out.subject, body: out.body, costUsd: out.costUsd, model, usage: out.usage, introId, forward: out.forward,
    })
    return { draftId: saved.draftId, subject: out.subject, body: out.body, costUsd: saved.costUsd, ...(out.forward ? { forward: out.forward } : {}) }
  },
})

/* ---------- keeping, copying and sending ---------- */

const clean = (a: Input) => ({ to: normEmail(a.to), subject: a.subject.trim().replace(/\s+/g, ' ').slice(0, MAX_SUBJECT), body: a.body.replace(/\r\n/g, '\n').trim().slice(0, MAX_BODY) })
const cleanForward = (f: Forward): Forward => ({ subject: f.subject.trim().replace(/\s+/g, ' ').slice(0, MAX_SUBJECT), body: f.body.replace(/\r\n/g, '\n').trim().slice(0, MAX_BODY) })

/** The dialog's row, updated with what's in the fields; a new row when there's none yet (Dev wrote it, or AI isn't set up). */
async function upsert(ctx: MutationCtx, userId: Id<'users'>, a: Input, body: string, patch: Partial<Doc<'drafts'>> = {}) {
  const c = clean(a)
  const fields = {
    type: a.type, subject: c.subject, body, ...(c.to ? { to: c.to } : {}), ...(a.introId ? { introId: a.introId } : {}), ...(a.forward ? { forward: cleanForward(a.forward) } : {}),
    ...(a.introIds ? { introIds: a.introIds } : {}), // PST-305
    ...patch,
  }
  const prev = a.draftId ? await ctx.db.get(a.draftId) : null
  if (prev && prev.investorId === a.investorId) {
    await ctx.db.patch(prev._id, fields)
    return prev._id
  }
  if (!(await ctx.db.get(a.investorId))) throw new ConvexError('That investor was deleted')
  return await ctx.db.insert('drafts', { investorId: a.investorId, status: 'draft', costUsd: 0, createdAt: Date.now(), createdBy: userId, ...fields })
}

/**
 * Swap [deck link] and [data room link] for the investor's share link: the
 * live one they already have, else a new one (always the current version).
 */
async function fillLinks(ctx: MutationCtx, userId: Id<'users'>, investorId: Id<'investors'>, body: string) {
  let out = body
  for (const { slot, kind } of LINK_SLOTS) {
    if (!out.includes(slot)) continue
    const m = await currentMaterial(ctx, kind)
    if (!m) throw new ConvexError('There’s no ' + (kind === 'deck' ? 'deck' : 'data room') + ' in Materials yet. Add it there, or take ' + slot + ' out.')
    let token = (await liveLink(ctx, investorId, m._id))?.token
    if (!token) {
      token = randomToken()
      await ctx.db.insert('shareLinks', { token, investorId, materialId: m._id, versionId: 'current', options: DEFAULT_OPTIONS, createdBy: userId, createdAt: Date.now() })
    }
    out = out.split(slot).join(shareUrl(token, siteOrigin()))
  }
  return out
}

/** PST-294: the note to forward, its links filled in too. */
async function filledForward(ctx: MutationCtx, userId: Id<'users'>, a: Input): Promise<Forward | undefined> {
  if (!a.forward) return undefined
  const f = cleanForward(a.forward)
  return { subject: f.subject, body: await fillLinks(ctx, userId, a.investorId, f.body) }
}

/** One email touch (the subject as its note) and Last touch today. */
async function logTouch(ctx: MutationCtx, userId: Id<'users'>, d: Doc<'drafts'>) {
  const i = await ctx.db.get(d.investorId)
  if (!i) return
  const today = todayIST()
  const whatsapp = d.via === 'whatsapp'
  await ctx.db.insert('activities', { investorId: i._id, kind: 'note', note: (whatsapp ? 'On WhatsApp: ' : '') + touchNote(d.subject), touch: whatsapp ? 'note' : 'email', date: today, userId })
  if (!i.lastTouch || i.lastTouch < today) await ctx.db.patch(i._id, { lastTouch: today, updatedAt: Date.now(), updatedBy: userId })
}

/** Keep what's in the fields (closing the dialog after editing). */
export const save = mutation({
  args: vInput,
  handler: async (ctx, a) => {
    const { userId } = await requireUser(ctx)
    const prev = a.draftId ? await ctx.db.get(a.draftId) : null
    if (prev?.status === 'sent') return prev._id
    return await upsert(ctx, userId, a, clean(a).body)
  },
})

/** Copy or WhatsApp: the text with its links filled in, and the row marked copied. Logs nothing. */
export const copied = mutation({
  args: { ...vInput, via: v.union(v.literal('copy'), v.literal('whatsapp')) },
  handler: async (ctx, { via, ...a }) => {
    const { userId } = await requireUser(ctx)
    const prev = a.draftId ? await ctx.db.get(a.draftId) : null
    const body = await fillLinks(ctx, userId, a.investorId, clean(a).body)
    if (!body) throw new ConvexError('Write the message first.')
    const forward = await filledForward(ctx, userId, a)
    const draftId = await upsert(ctx, userId, a, body, { ...(forward ? { forward } : {}), ...(prev?.status === 'sent' ? {} : { status: 'copied' as const, via }) })
    return { draftId, body, ...(forward ? { forward } : {}) }
  },
})

/** "I sent it" after Copy or WhatsApp: the one touch, once. */
export const markSent = mutation({
  args: { draftId: v.id('drafts') },
  handler: async (ctx, { draftId }) => {
    const { userId } = await requireUser(ctx)
    const d = await ctx.db.get(draftId)
    if (!d) throw new ConvexError('That draft was deleted')
    if (d.status === 'sent') return { logged: false }
    const at = Date.now()
    await ctx.db.patch(draftId, { status: 'sent', sentAt: at })
    // PST-305: the intro ask goes to the person, not the investors: no investor touch, "Asked" on each intro instead.
    if (d.type !== 'introAsk') await logTouch(ctx, userId, d)
    for (const x of d.introIds ?? []) await markAsked(ctx, x)
    // PST-291: a written confirmation that went starts the 48-hour offer.
    if (d.type === 'confirm') await stampConfirmation(ctx, userId, d.investorId, at)
    if (d.introId) await markAsked(ctx, d.introId)
    if (d.type === 'lead') await noteLeadAsked(ctx, d.investorId) // PST-295
    return { logged: true }
  },
})

/** Before sending: checks, links filled in, the row saved. Refuses a draft that already went. */
export const prepareSend = internalMutation({
  args: vInput,
  handler: async (ctx, a) => {
    const { userId } = await requireUser(ctx)
    const c = clean(a)
    if (!isEmail(c.to)) throw new ConvexError('Add who it goes to: an email address.')
    if (!c.subject) throw new ConvexError('Add a subject.')
    if (!c.body) throw new ConvexError('Write the message first.')
    const n = blanks(c.subject + '\n' + c.body)
    if (n) throw new ConvexError('Fill in the ' + (n === 1 ? 'blank' : n + ' blanks') + ' ([__]) before sending.')
    if (c.body.includes(SAFE_LINK)) throw new ConvexError('Paste the SAFE link in place of ' + SAFE_LINK + ' before sending.')
    if (c.body.includes(WHY_SLOT)) throw new ConvexError('Say why each investor fits in place of ' + WHY_SLOT + ' before sending.') // PST-305
    if (a.type === 'confirm') await confirmationTarget(ctx, a.investorId)
    const prev = a.draftId ? await ctx.db.get(a.draftId) : null
    if (prev?.status === 'sent') throw new ConvexError('This one has already gone. Start a new draft.')
    const body = await fillLinks(ctx, userId, a.investorId, c.body)
    const forward = await filledForward(ctx, userId, a)
    const draftId = await upsert(ctx, userId, a, body, forward ? { forward } : {})
    return { draftId, to: c.to, subject: c.subject, body }
  },
})

/** Sent from Nest: the row marked sent and the one email touch. */
export const sentByEmail = internalMutation({
  args: { draftId: v.id('drafts') },
  handler: async (ctx, { draftId }) => {
    const { userId } = await requireUser(ctx)
    const d = await ctx.db.get(draftId)
    if (!d || d.status === 'sent') return
    const at = Date.now()
    await ctx.db.patch(draftId, { status: 'sent', via: 'nest', sentAt: at })
    // PST-305: the intro ask ticks "Asked" on each of its intros, and touches no investor.
    if (d.type !== 'introAsk') await logTouch(ctx, userId, { ...d, via: 'nest' })
    for (const x of d.introIds ?? []) await markAsked(ctx, x)
    // PST-291: a written confirmation that went starts the 48-hour offer.
    if (d.type === 'confirm') await stampConfirmation(ctx, userId, d.investorId, at)
    // PST-294: sending a forwardable intro's ask ticks "Asked" and starts the clock.
    if (d.introId) await markAsked(ctx, d.introId)
    if (d.type === 'lead') await noteLeadAsked(ctx, d.investorId) // PST-295
  },
})

/** "Send from nest@pestokids.com", through Resend. Replies go to dev@pestokids.com. Only offered when RESEND_API_KEY is set. */
export const send = action({
  args: vInput,
  handler: async (ctx, a): Promise<{ draftId: Id<'drafts'>; to: string }> => {
    if (!emailReady()) throw new ConvexError('Email isn’t set up here. Copy the text instead.')
    const p: { draftId: Id<'drafts'>; to: string; subject: string; body: string } = await ctx.runMutation(internal.drafts.prepareSend, a)
    const r = await sendEmail({ to: p.to, subject: p.subject, text: p.body })
    if (!r.sent) {
      console.warn('drafts.send failed', p.draftId, r.reason)
      throw new ConvexError(r.reason === 'no-key' ? 'Email isn’t set up here. Copy the text instead.' : 'Couldn’t send it: ' + (r.message ?? 'the email service refused it') + '.')
    }
    await ctx.runMutation(internal.drafts.sentByEmail, { draftId: p.draftId })
    return { draftId: p.draftId, to: p.to }
  },
})

const MAX_MANY = 100

/**
 * PST-291: several drafts at once (Close › Allocation's "Draft N allocation
 * emails"), each to the investor's main contact unless `to` names someone.
 * Nothing is sent. Resolves with the new ids, in order.
 */
export const saveMany = mutation({
  args: { drafts: v.array(v.object({ investorId: v.id('investors'), type: vDraftType, to: v.string(), subject: v.string(), body: v.string() })) },
  handler: async (ctx, { drafts }) => {
    const { userId } = await requireUser(ctx)
    if (drafts.length > MAX_MANY) throw new ConvexError('That’s more than ' + MAX_MANY + ' drafts at once.')
    const ids: Id<'drafts'>[] = []
    for (const a of drafts) {
      const inv = await ctx.db.get(a.investorId)
      if (!inv) throw new ConvexError('One of those investors was deleted')
      const c = clean(a)
      const people = c.to ? [] : await ctx.db.query('people').withIndex('by_investor', (q) => q.eq('investorId', inv._id)).collect()
      const to = c.to || mainContact(people, inv.email)?.email
      ids.push(await ctx.db.insert('drafts', { investorId: inv._id, type: a.type, subject: c.subject, body: c.body, status: 'draft', costUsd: 0, createdAt: Date.now(), createdBy: userId, ...(to ? { to } : {}) }))
    }
    return ids
  },
})

/** An investor was deleted: their drafts go too. */
export async function forgetDrafts(ctx: MutationCtx, investorId: Id<'investors'>) {
  for (const d of await ctx.db.query('drafts').withIndex('by_investor', (q) => q.eq('investorId', investorId)).collect()) await ctx.db.delete(d._id)
}
