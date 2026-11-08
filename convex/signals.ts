// PST-293: signals from emails and notes. Each Jev call (scheduled from
// lib/signalHooks.ts) ends in `save`, which keeps the answers and probabilities
// (never the text), then acts on them: a sure answer changes the status by itself
// (logged, with Undo), an unsure one waits as a Decide row, and a sure ask from an
// email becomes an Inbox row. Logs carry ids, counts and outcomes only.
import { v } from 'convex/values'
import { internalAction, internalMutation, internalQuery } from './_generated/server'
import { internal } from './_generated/api'
import { askJev, jevReady } from './lib/jev'
import { applyStatus, decisionRow } from './decisions'
import { vSignalSource } from './decisionsSchema'
import { JEV_STATE_CHARS, readAnswers, topPick } from '../src/lib/jev'
import { askOf, emailOutcome, emailQuestions, interestOf, noteOutcome, noteSignalQuestions } from '../src/lib/signals'
import { makeMatcher } from '../src/lib/google'
import type { DecisionStatus } from '../src/lib/decisions'
import type { Doc, Id } from './_generated/dataModel'

/* ---------- notes ---------- */

/** The note to read, unless it's gone, its investor is, or it was read already. */
export const noteInput = internalQuery({
  args: { noteId: v.id('notes') },
  handler: async (ctx, { noteId }) => {
    const n = await ctx.db.get(noteId)
    if (!n || n.removedAt || !(await ctx.db.get(n.investorId))) return null
    if (await ctx.db.query('signals').withIndex('by_key', (q) => q.eq('key', 'note:' + noteId)).first()) return null
    return { investorId: n.investorId, date: n.date, title: n.title ?? '', text: n.text }
  },
})

/** One Jev call for one meeting note: status, offered to lead, "come back with a lead", interest from 1 to 5. */
export const fromNote = internalAction({
  args: { noteId: v.id('notes') },
  handler: async (ctx, { noteId }) => {
    const n = await ctx.runQuery(internal.signals.noteInput, { noteId })
    if (!n) return
    const meeting = n.title.slice(0, 200)
    const state = { meeting, date: n.date, note: n.text.slice(0, JEV_STATE_CHARS - meeting.length - 20) }
    const r = await askJev(ctx, { feature: 'note_signals', state, questions: noteSignalQuestions() })
    if (!r) return
    await ctx.runMutation(internal.signals.save, { investorId: n.investorId, source: 'note', key: 'note:' + noteId, day: n.date, noteId, answers: r.answers })
  },
})

/* ---------- emails ---------- */

/**
 * The new messages worth a Jev call: from an investor's address or domain, not
 * read before, while Jev is ready. Each with its investors and the email touch
 * (thread) it belongs to.
 */
export const emailTargets = internalQuery({
  args: {
    userId: v.id('users'),
    self: v.string(),
    items: v.array(v.object({ messageId: v.string(), threadId: v.string(), from: v.string(), subject: v.string(), at: v.number() })),
  },
  handler: async (ctx, { userId, self, items }) => {
    if (!items.length || !(await jevReady(ctx))) return []
    const match = makeMatcher((await ctx.db.query('investors').collect()).map((i) => ({ _id: i._id as string, email: i.email, emails: i.emails, domains: i.domains })))
    const out: { messageId: string; subject: string; at: number; investorIds: Id<'investors'>[]; emailTouchId?: Id<'emailTouches'> }[] = []
    for (const m of items) {
      const ids = match.people([m.from], self).ids as Id<'investors'>[]
      const fresh: Id<'investors'>[] = []
      for (const id of ids)
        if (!(await ctx.db.query('signals').withIndex('by_key', (q) => q.eq('key', 'email:' + m.messageId + ':' + id)).first())) fresh.push(id)
      if (!fresh.length) continue
      const touch = await ctx.db.query('emailTouches').withIndex('by_user_thread', (q) => q.eq('userId', userId).eq('threadId', m.threadId)).unique()
      out.push({ messageId: m.messageId, subject: m.subject, at: m.at, investorIds: fresh, ...(touch ? { emailTouchId: touch._id } : {}) })
    }
    return out
  },
})

/* ---------- keeping a signal, and acting on it ---------- */

type SignalFields = Pick<Doc<'signals'>, 'answers' | 'probabilities' | 'outcome' | 'change' | 'p' | 'asked'>

/** What the answers say against the status now: the row's answers and probabilities, and the outcome. Null for answers Nest can't read. */
function readSignal(source: 'email' | 'note', raw: unknown, current: DecisionStatus | undefined): SignalFields | null {
  if (source === 'email') {
    const a = readAnswers(emailQuestions(), raw)
    if (!a) return null
    const o = emailOutcome(a, current)
    const asked = askOf(a)
    const ask = topPick(a.ask)?.key as SignalFields['answers']['ask']
    return {
      answers: ask ? { ask } : {},
      probabilities: { ask: a.ask.probabilities, pass: a.pass.noul, real: a.real.noul },
      outcome: o.kind, p: o.p, ...(o.change ? { change: { ...o.change, ...(current ? { from: current } : {}) } } : {}), ...(asked ? { asked } : {}),
    }
  }
  const a = readAnswers(noteSignalQuestions(), raw)
  if (!a) return null
  const o = noteOutcome(a, current)
  const status = topPick(a.status)?.key as DecisionStatus | undefined
  return {
    answers: { ...(status ? { status } : {}), score: interestOf(a.score.score) },
    probabilities: { status: a.status.probabilities, score: a.score.probabilities, lead: a.lead.noul, comeback: a.comeback.noul },
    outcome: o.kind, p: o.p, ...(o.change ? { change: { ...o.change, ...(current ? { from: current } : {}) } } : {}),
  }
}

/** Keep one signal (once per key) and act on it. */
export const save = internalMutation({
  args: {
    investorId: v.id('investors'),
    source: vSignalSource,
    key: v.string(),
    day: v.string(),
    emailTouchId: v.optional(v.id('emailTouches')),
    messageId: v.optional(v.string()),
    noteId: v.optional(v.id('notes')),
    answers: v.any(),
  },
  handler: async (ctx, { answers, ...a }) => {
    if (await ctx.db.query('signals').withIndex('by_key', (q) => q.eq('key', a.key)).first()) return null
    if (!(await ctx.db.get(a.investorId))) return null
    const row = await decisionRow(ctx, a.investorId)
    const s = readSignal(a.source, answers, row?.status)
    if (!s) return null
    const now = Date.now()
    const id = await ctx.db.insert('signals', { ...a, ...s, at: now })
    if (s.outcome === 'auto' && s.change) {
      const logId = await applyStatus(ctx, a.investorId, s.change.to, { reason: s.change.reason, signalId: id, now })
      if (logId) await ctx.db.patch(id, { logId })
    }
    console.log('signals saved source=' + a.source + ' outcome=' + s.outcome + (s.asked ? ' ask=' + s.asked : ''))
    return id
  },
})
