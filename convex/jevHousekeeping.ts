// PST-292: Jev's housekeeping. Each action is scheduled by its own event (lib/jevHooks.ts),
// asks one request, and writes what Jev decided. When Jev can't answer (askJev returns
// null), everything stays as it was before Jev: Who's this? looks the person up, notes
// stay in Unmatched, and no duplicate or repeat is flagged. Logs carry ids and counts only.
import { v } from 'convex/values'
import { internalAction, internalMutation, internalQuery, mutation } from './_generated/server'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { requireUser } from './lib/access'
import { askJev } from './lib/jev'
import { pairKey } from './lib/jevHooks'
import { hasAIKey } from './lib/anthropic'
import { lookedUp, queueSender } from './lib/enrichQueue'
import { attachUnmatched } from './noteReads'
import {
  duplicateQuestions, isDuplicate, JEV_STATE_CHARS, noteDecision, noteQuestions, qaDecision, qaQuestions, topPick, whoDecision, whoQuestions, type FirmRecord,
} from '../src/lib/jev'
import { IDX } from '../src/lib/stages'

const vWhoState = v.object({ email_domain: v.string(), invite_title: v.string(), other_attendee_domains: v.array(v.string()), domain_is_known_investor_firm: v.boolean() })
const firmOf = (i: Pick<Doc<'investors'>, 'firm' | 'name'>) => i.firm.trim() || i.name.trim()

/* ---------- Who's this? pre-check ---------- */

/** One Noul per new person: below 0.3 they skip the Haiku lookup; otherwise (or with no answer) they're looked up as before. */
export const whosThis = internalAction({
  args: { items: v.array(v.object({ email: v.string(), state: vWhoState })) },
  handler: async (ctx, { items }) => {
    const lookups: string[] = []
    const skipped: { email: string; p: number }[] = []
    for (const it of items) {
      const r = await askJev(ctx, { feature: 'whos_this', state: it.state, questions: whoQuestions() })
      const p = r?.answers.likely_investor.noul
      if (p !== undefined && whoDecision(p) === 'skip') skipped.push({ email: it.email, p })
      else lookups.push(it.email)
    }
    await ctx.runMutation(internal.jevHousekeeping.afterWho, { lookups, skipped })
    console.log('jev whos_this people=' + items.length + ' skipped=' + skipped.length)
  },
})

export const afterWho = internalMutation({
  args: { lookups: v.array(v.string()), skipped: v.array(v.object({ email: v.string(), p: v.number() })) },
  handler: async (ctx, { lookups, skipped }) => {
    const at = Date.now()
    for (const s of skipped) await ctx.db.insert('jevMarks', { kind: 'who', subject: s.email, p: s.p, at })
    if (!hasAIKey()) return
    for (const email of lookups) if (!(await lookedUp(ctx, email))) await queueSender(ctx, email)
  },
})

/* ---------- Unmatched notes ---------- */

export const noteInput = internalQuery({
  args: { id: v.id('unmatchedNotes'), investorIds: v.array(v.id('investors')) },
  handler: async (ctx, { id, investorIds }) => {
    const u = await ctx.db.get(id)
    if (!u || u.noteId || u.droppedAt) return null
    const investors = []
    for (const i of investorIds) {
      const inv = await ctx.db.get(i)
      if (inv) investors.push({ id: inv._id, label: inv.name + (inv.firm.trim() && inv.firm.trim() !== inv.name.trim() ? ' (' + inv.firm.trim() + ')' : '') })
    }
    return investors.length ? { meetingTitle: u.meetingTitle, date: u.date, text: u.text, investors } : null
  },
})

/** A Choice among the meeting's investors with a companion Noul: attach when sure, else a "Probably …" hint. */
export const unmatchedNote = internalAction({
  args: { id: v.id('unmatchedNotes'), investorIds: v.array(v.id('investors')) },
  handler: async (ctx, a) => {
    const n = await ctx.runQuery(internal.jevHousekeeping.noteInput, a)
    if (!n) return
    const options = n.investors.map((x, k) => ({ key: 'i' + k, label: x.label }))
    const state = { meeting_title: n.meetingTitle, date: n.date, investors: options.map((o) => o.label), note: n.text.slice(0, JEV_STATE_CHARS) }
    const r = await askJev(ctx, { feature: 'unmatched_notes', state, questions: noteQuestions(options) })
    const d = r ? noteDecision(r.answers) : null
    if (!d) return
    const pick = (key: string) => n.investors[Number(key.slice(1))]?.id
    if ('attach' in d) await ctx.runMutation(internal.jevHousekeeping.afterNote, { id: a.id, investorId: pick(d.attach), p: topPick(r!.answers.investor)!.p, attach: true })
    else await ctx.runMutation(internal.jevHousekeeping.afterNote, { id: a.id, investorId: pick(d.hint), p: d.p, attach: false })
    console.log('jev unmatched_notes note=' + a.id + ' options=' + options.length + ' attached=' + ('attach' in d))
  },
})

export const afterNote = internalMutation({
  args: { id: v.id('unmatchedNotes'), investorId: v.id('investors'), p: v.number(), attach: v.boolean() },
  handler: async (ctx, { id, investorId, p, attach }) => {
    const u = await ctx.db.get(id)
    if (!u || u.noteId || u.droppedAt || !(await ctx.db.get(investorId))) return
    await ctx.db.insert('jevMarks', { kind: 'note', subject: id, target: investorId, p, at: Date.now() })
    if (attach) await attachUnmatched(ctx, u, investorId)
  },
})

/* ---------- Duplicate firms ---------- */

const recordOf = (i: Doc<'investors'>): FirmRecord => ({ name: i.name, firm: i.firm, type: i.type, domains: i.domains ?? [] })

export const firmInput = internalQuery({
  args: { investorId: v.id('investors'), others: v.array(v.id('investors')) },
  handler: async (ctx, { investorId, others }) => {
    const me = await ctx.db.get(investorId)
    if (!me) return null
    const rows: Doc<'investors'>[] = []
    for (const id of others) {
      const o = await ctx.db.get(id)
      if (o) rows.push(o)
    }
    return rows.length ? { record: recordOf(me), others: rows.map(recordOf), ids: rows.map((o) => o._id) } : null
  },
})

/** One Noul per similar name: at 0.8 or above, a Duplicate suggestion (Dev merges; never automatic). */
export const duplicateFirm = internalAction({
  args: { investorId: v.id('investors'), others: v.array(v.id('investors')) },
  handler: async (ctx, a) => {
    const x = await ctx.runQuery(internal.jevHousekeeping.firmInput, a)
    if (!x) return
    const r = await askJev(ctx, { feature: 'duplicate_firms', state: { record: x.record, others: x.others }, questions: duplicateQuestions(x.ids.length) })
    if (!r) return
    const same = x.ids.flatMap((id, k) => (isDuplicate(r.answers['same_' + k].noul) ? [{ otherId: id, p: r.answers['same_' + k].noul }] : []))
    if (same.length) await ctx.runMutation(internal.jevHousekeeping.afterDuplicate, { investorId: a.investorId, same })
    console.log('jev duplicate_firms investor=' + a.investorId + ' candidates=' + x.ids.length + ' same=' + same.length)
  },
})

export const afterDuplicate = internalMutation({
  args: { investorId: v.id('investors'), same: v.array(v.object({ otherId: v.id('investors'), p: v.number() })) },
  handler: async (ctx, { investorId, same }) => {
    const me = await ctx.db.get(investorId)
    if (!me) return
    for (const { otherId } of same) {
      const other = await ctx.db.get(otherId)
      if (!other) continue
      const k = pairKey(me._id, other._id)
      const taken = async (key: string) => !!(await ctx.db.query('suggestions').withIndex('by_key', (q) => q.eq('key', key)).first())
      if ((await taken('check:duplicate:' + k)) || (await taken('jev:duplicate:' + k))) continue
      const [keep, drop] = [me, other].sort((p, q) => (IDX[q.maxStage] ?? 0) - (IDX[p.maxStage] ?? 0) || p._creationTime - q._creationTime)
      await ctx.db.insert('suggestions', {
        kind: 'duplicate', investorId: keep._id, otherInvestorId: drop._id, source: 'jev', safe: false, status: 'open', key: 'jev:duplicate:' + k, createdAt: Date.now(),
        title: firmOf(keep) + ' and “' + firmOf(drop) + '” look like the same firm.', fix: 'Merge into ' + keep.name + ', keeping both histories', patch: { op: 'merge' },
      })
    }
  },
})

/* ---------- Q&A repeats ---------- */

export const qaInput = internalQuery({
  args: { questionId: v.id('questions'), candidates: v.array(v.id('questions')) },
  handler: async (ctx, { questionId, candidates }) => {
    const live = (q: Doc<'questions'> | null): q is Doc<'questions'> => !!q && !q.removedAt && !q.mergedInto
    const q = await ctx.db.get(questionId)
    if (!live(q)) return null
    const existing: { id: Id<'questions'>; text: string }[] = []
    for (const id of candidates) {
      const o = await ctx.db.get(id)
      if (live(o)) existing.push({ id: o._id, text: o.text })
    }
    return existing.length ? { text: q.text, existing } : null
  },
})

/** A Choice among the five closest questions with a companion Noul: "Same as …" at 0.85 with the companion below 0.3. */
export const qaRepeat = internalAction({
  args: { questionId: v.id('questions'), candidates: v.array(v.id('questions')) },
  handler: async (ctx, a) => {
    const x = await ctx.runQuery(internal.jevHousekeeping.qaInput, a)
    if (!x) return
    const texts = x.existing.map((o) => o.text)
    const r = await askJev(ctx, { feature: 'qa_repeats', state: { new_question: x.text, existing: texts }, questions: qaQuestions(texts) })
    const k = r ? qaDecision(r.answers) : null
    if (k !== null && r) await ctx.runMutation(internal.jevHousekeeping.afterQa, { questionId: a.questionId, sameAs: x.existing[k].id, p: topPick(r.answers.same_as)!.p })
    console.log('jev qa_repeats question=' + a.questionId + ' options=' + texts.length + ' same=' + (k !== null))
  },
})

export const afterQa = internalMutation({
  args: { questionId: v.id('questions'), sameAs: v.id('questions'), p: v.number() },
  handler: async (ctx, { questionId, sameAs, p }) => {
    const [q, o] = [await ctx.db.get(questionId), await ctx.db.get(sameAs)]
    if (!q || !o || q.removedAt || q.mergedInto || o.removedAt || o.mergedInto) return
    await ctx.db.insert('jevMarks', { kind: 'same_question', subject: questionId, target: sameAs, p, at: Date.now() })
  },
})

/** "Not the same" on a question Jev marked "Same as …": the mark goes, the question stays as it is. */
export const notSame = mutation({
  args: { questionId: v.id('questions') },
  handler: async (ctx, { questionId }) => {
    await requireUser(ctx)
    const mark = await ctx.db.query('jevMarks').withIndex('by_subject', (q) => q.eq('kind', 'same_question').eq('subject', questionId)).order('desc').first()
    if (mark && !mark.undoneAt) await ctx.db.patch(mark._id, { undoneAt: Date.now() })
    return null
  },
})

/** Undo of "Not the same". */
export const restoreSame = mutation({
  args: { questionId: v.id('questions') },
  handler: async (ctx, { questionId }) => {
    await requireUser(ctx)
    const mark = await ctx.db.query('jevMarks').withIndex('by_subject', (q) => q.eq('kind', 'same_question').eq('subject', questionId)).order('desc').first()
    if (mark?.undoneAt) await ctx.db.patch(mark._id, { undoneAt: undefined })
    return null
  },
})
