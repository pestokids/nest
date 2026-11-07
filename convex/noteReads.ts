// PST-277: meeting notes become updates (screens/raise-ai/drawer-notes-read-by-nest.png).
// When notes are saved (pasted, or in through MCP) or on "Read with Nest", Claude
// reads them with the investor's record, the stage rules and the Q&A bank, and
// proposes updates. Each proposal is also a row in Suggestions (source "notes"), so
// it shows on Today when nobody opens the drawer; deciding it in either place
// decides both, because the drawer's Apply accepts those same rows. Logs carry ids only.
import { ConvexError, v, type Infer } from 'convex/values'
import { action, internalAction, internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { requireUser } from './lib/access'
import { AIError, complete, extractJson, hasAIKey, NoAIKey, usageRow, type RunUsage } from './lib/anthropic'
import { featureModel } from './lib/enrichQueue'
import { conform, SchemaError } from './lib/jsonSchema'
import { DRAFT_SYSTEM, draftPrompt, notePrompt, SYSTEM, vNoteAnswer } from './lib/notesPrompt'
import { READ_STALE_MS, startRead } from './lib/noteRead'
import { acceptOne, insertSuggestion, reopen } from './suggestions'
import { vNoteSource, vProposal } from './notesSchema'
import { vModel, vUsage } from './validators'
import { expectedClash, matchNote, proposalsFrom, type ProposalState } from '../src/lib/meetingNotes'
import { NO_AI_KEY } from '../src/lib/enrich'
import { isISODate, todayIST } from '../src/lib/dates'
import { DAY_MS } from '../src/lib/google'
import { dayLabel } from '../src/lib/investorView'
import { money } from '../src/lib/money'
import { touchDay } from '../src/lib/pipeline'
import { LIMITS, similarQuestions, type Question } from '../src/lib/qanda'
import { STAGE_TILE } from '../src/lib/stages'

type ProposalDoc = Infer<typeof vProposal>
type Read = Doc<'noteReads'>
const noKey = () => new ConvexError({ code: NO_AI_KEY, message: 'AI isn’t set up here.' })
const isLiveQ = (q: Doc<'questions'> | null): q is Doc<'questions'> => !!q && !q.removedAt && !q.mergedInto
const possessive = (name: string) => name.trim() + (/s$/i.test(name.trim()) ? '’' : '’s')
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)

/* ---------- what the drawer reads ---------- */

/** A proposal's state: its Suggestions row decides it (accepted = applied); one with no row is dropped once the read is decided. */
async function stateOf(ctx: QueryCtx, r: Read, p: ProposalDoc): Promise<ProposalState> {
  if (!p.suggestionId) return r.status === 'ready' ? 'open' : 'dropped'
  const s = await ctx.db.get(p.suggestionId)
  return s?.status === 'open' ? 'open' : s?.status === 'accepted' ? 'applied' : 'dropped'
}

/** The latest read of each of an investor's notes, with each proposal's state. A read that died says so. */
export const forInvestor = query({
  args: { investorId: v.id('investors') },
  handler: async (ctx, { investorId }) => {
    await requireUser(ctx)
    const reads = await ctx.db.query('noteReads').withIndex('by_investor', (q) => q.eq('investorId', investorId)).order('desc').collect()
    const latest = new Map<string, Read>()
    for (const r of reads) if (!latest.has(r.noteId)) latest.set(r.noteId, r)
    const now = Date.now()
    const out = []
    for (const r of latest.values()) {
      const stale = r.status === 'reading' && r.startedAt < now - READ_STALE_MS
      const proposals = []
      for (const p of r.proposals) proposals.push({ ...p, state: await stateOf(ctx, r, p) })
      const { decided: _d, auto: _a, ...rest } = r
      out.push({ ...rest, proposals, ...(stale ? { status: 'failed' as const, error: 'Took too long' } : {}) })
    }
    return out
  },
})

/* ---------- starting a read ---------- */

/** "Read with Nest" (or Try again): read a note now, whatever the Settings toggle says. */
export const read = mutation({
  args: { noteId: v.id('notes') },
  handler: async (ctx, { noteId }) => {
    await requireUser(ctx)
    if (!hasAIKey()) throw noKey()
    const note = await ctx.db.get(noteId)
    if (!note || note.removedAt) throw new ConvexError('Those notes were deleted.')
    return await startRead(ctx, noteId, { auto: false })
  },
})

/** What the action sends Claude: the note, the investor's record and the bank. Null when the read isn't running. */
export const input = internalQuery({
  args: { readId: v.id('noteReads') },
  handler: async (ctx, { readId }) => {
    const r = await ctx.db.get(readId)
    if (!r || r.status !== 'reading') return null
    const note = await ctx.db.get(r.noteId)
    const inv = await ctx.db.get(r.investorId)
    if (!note || note.removedAt || !inv) return null
    const bank = (await ctx.db.query('questions').collect())
      .filter(isLiveQ)
      .sort((a, b) => b.askedCount - a.askedCount || b.updatedAt - a.updatedAt)
      .slice(0, 200)
      .map((q) => ({ _id: q._id as string, text: q.text }))
    const investor = { stage: inv.stage, expected: inv.expected, nextStep: inv.nextStep, nextDate: inv.nextDate }
    return {
      model: r.model ?? (await featureModel(ctx, 'notes')),
      prompt: notePrompt({ today: todayIST(), note: { date: note.date, title: note.title, text: note.text }, investor: { ...investor, name: inv.name, firm: inv.firm, type: inv.type, path: inv.path, notes: inv.notes }, bank }),
      check: { note: note.text, investor, bank },
    }
  },
})

/** The "why" and "→ change" lines of a proposal's Suggestions row. */
function rowFor(p: ProposalDoc, inv: Doc<'investors'>, note: Doc<'notes'>, today: string) {
  const from = possessive(inv.name) + ' ' + (note.title ? note.title : 'meeting') + ' notes'
  const said = (q: string) => from + ': “' + clip(q, 120) + '”'
  switch (p.kind) {
    case 'next_step':
      return { kind: 'next_step' as const, title: said(p.quote), fix: 'Set “' + p.step + '”' + (p.date ? ' · ' + dayLabel(p.date, today) : ''), patch: { op: 'next_step' as const, step: p.step, ...(p.date ? { date: p.date } : {}) } }
    case 'stage':
      return { kind: 'stage' as const, title: said(p.quote), fix: 'Move to ' + STAGE_TILE[p.to], patch: { op: 'stage' as const, from: p.from, to: p.to } }
    case 'expected':
      return { kind: 'expected' as const, title: said(p.quote), fix: 'Set Expected to ' + money(p.amount), patch: { op: 'expected' as const, amount: p.amount } }
    case 'questions':
      return {
        kind: 'question' as const,
        title: from + ': ' + (p.items.length === 1 ? '“' + clip(p.items[0].text, 120) + '”' : p.items.length + ' questions they asked.'),
        fix: 'Add ' + (p.items.length === 1 ? 'it' : 'them') + ' to the Q&A bank',
        patch: { op: 'questions' as const, noteId: note._id, items: p.items },
      }
    case 'warm_path':
      return { kind: 'warm_path' as const, title: said(p.quote), fix: 'Add to their notes: ' + p.text, patch: { op: 'warm_path' as const, text: p.text } }
  }
}

/** Store what Claude found, and put each proposal in Suggestions. An earlier read of the same note gives way. */
export const finish = internalMutation({
  args: { readId: v.id('noteReads'), summary: v.array(v.string()), proposals: v.array(vProposal), costUsd: v.number(), model: vModel, usage: vUsage },
  handler: async (ctx, a) => {
    const r = await ctx.db.get(a.readId)
    if (!r) return
    const spent = { costUsd: a.costUsd, model: a.model, usage: a.usage }
    if (r.status !== 'reading') return void (await ctx.db.patch(r._id, spent))
    const note = await ctx.db.get(r.noteId)
    const inv = await ctx.db.get(r.investorId)
    if (!note || note.removedAt || !inv) return void (await ctx.db.patch(r._id, { status: 'failed', error: 'The notes or the investor were deleted.', ...spent, finishedAt: Date.now() }))
    for (const old of await ctx.db.query('noteReads').withIndex('by_note', (q) => q.eq('noteId', r.noteId)).collect()) {
      if (old._id === r._id || old.status !== 'ready') continue
      for (const p of old.proposals) if (p.suggestionId && (await ctx.db.get(p.suggestionId))?.status === 'open') await ctx.db.delete(p.suggestionId)
      await ctx.db.patch(old._id, { status: 'dismissed' })
    }
    const today = todayIST()
    const proposals: ProposalDoc[] = []
    for (const p0 of a.proposals) {
      const p = p0.kind === 'expected' ? { ...p0, clash: expectedClash(inv.expected).clash } : p0
      if (p.kind === 'expected' && p.clash) {
        proposals.push(p)
        continue
      }
      const suggestionId = await insertSuggestion(ctx, { ...rowFor(p, inv, note, today), investorId: inv._id, source: 'notes', key: 'notes:' + r._id + ':' + p.id })
      proposals.push(suggestionId ? { ...p, suggestionId } : p)
    }
    await ctx.db.patch(r._id, { status: 'ready', summary: a.summary, proposals, ...spent, finishedAt: Date.now() })
  },
})

export const fail = internalMutation({
  args: { readId: v.id('noteReads'), error: v.string(), costUsd: v.number(), model: v.optional(vModel), usage: v.optional(vUsage) },
  handler: async (ctx, { readId, ...a }) => {
    const r = await ctx.db.get(readId)
    if (r?.status === 'reading') await ctx.db.patch(r._id, { status: 'failed', ...a, finishedAt: Date.now() })
  },
})

/** Read one note: one plain Claude turn (no web tools), its JSON checked against the note. */
export const execute = internalAction({
  args: { readId: v.id('noteReads') },
  handler: async (ctx, { readId }) => {
    const t0 = Date.now()
    const job = await ctx.runQuery(internal.noteReads.input, { readId })
    if (!job) return void (await ctx.runMutation(internal.noteReads.fail, { readId, error: 'Nothing to read', costUsd: 0 }))
    let cost = 0
    let usage: RunUsage | undefined
    let found = 0
    let status = 'ready'
    try {
      const out = await complete({ model: job.model, system: SYSTEM, prompt: job.prompt, maxTokens: 3000 })
      cost = out.costUsd
      usage = usageRow(out.usage)
      const { summary, proposals } = proposalsFrom(conform(vNoteAnswer, extractJson(out.text + '\n')), job.check)
      found = proposals.length
      await ctx.runMutation(internal.noteReads.finish, { readId, summary, proposals: proposals as ProposalDoc[], costUsd: cost, model: job.model, usage })
    } catch (e) {
      status = 'failed'
      const error = e instanceof NoAIKey ? NO_AI_KEY : e instanceof AIError || e instanceof SchemaError ? e.message.slice(0, 200) : 'Something went wrong while reading the notes.'
      await ctx.runMutation(internal.noteReads.fail, { readId, error, costUsd: cost, model: job.model, usage })
    }
    console.log('notes read=' + readId + ' status=' + status + ' proposals=' + found + ' cost=$' + cost.toFixed(4) + ' model=' + job.model + ' secs=' + Math.round((Date.now() - t0) / 1000))
  },
})

/* ---------- Apply, Dismiss, Undo ---------- */

async function openRow(ctx: MutationCtx, p: ProposalDoc) {
  const s = p.suggestionId ? await ctx.db.get(p.suggestionId) : null
  return s?.status === 'open' ? s : null
}

/**
 * Apply N: the ticked proposals are accepted through Suggestions (the same writes:
 * next step, stage via applyMove, Expected only when empty, questions into the
 * bank, a warm path onto their notes), unticked ones are dropped (not kept as
 * suggestions), and the meeting is logged as a note on History.
 */
export const apply = mutation({
  args: { readId: v.id('noteReads'), ids: v.array(v.string()) },
  handler: async (ctx, { readId, ids }) => {
    const { userId } = await requireUser(ctx)
    const r = await ctx.db.get(readId)
    if (!r || r.status !== 'ready') throw new ConvexError('Those notes were already handled.')
    if (!(await ctx.db.get(r.investorId))) throw new ConvexError('That investor was deleted')
    const accepted: Id<'suggestions'>[] = []
    const dropped: Id<'suggestions'>[] = []
    const now = Date.now()
    for (const p of r.proposals) {
      const s = await openRow(ctx, p)
      if (!s) continue
      if (!ids.includes(p.id)) {
        await ctx.db.patch(s._id, { status: 'dismissed', decidedAt: now, decidedBy: userId })
        dropped.push(s._id)
      } else if (await acceptOne(ctx, s, userId)) accepted.push(s._id)
    }
    const note = await ctx.db.get(r.noteId)
    const inv = (await ctx.db.get(r.investorId))!
    const day = touchDay(note?.date, todayIST())
    const text = clip(((note?.title ?? 'Meeting') + ': ' + r.summary.join(' ')).trim(), 600)
    const activityId = r.summary.length ? await ctx.db.insert('activities', { investorId: inv._id, kind: 'note', note: text, touch: 'meeting', date: day, userId }) : undefined
    if (activityId && (!inv.lastTouch || inv.lastTouch < day)) await ctx.db.patch(inv._id, { lastTouch: day, updatedAt: now, updatedBy: userId })
    await ctx.db.patch(r._id, { status: 'applied', decided: { at: now, accepted, dropped, ...(activityId ? { activityId } : {}), ...(inv.lastTouch ? { lastTouch: inv.lastTouch } : {}) } })
    return { applied: accepted.length }
  },
})

/** Dismiss the whole card: every open proposal is dropped from Suggestions too. */
export const dismiss = mutation({
  args: { readId: v.id('noteReads') },
  handler: async (ctx, { readId }) => {
    const { userId } = await requireUser(ctx)
    const r = await ctx.db.get(readId)
    if (!r || r.status !== 'ready') return null
    const now = Date.now()
    const dropped: Id<'suggestions'>[] = []
    for (const p of r.proposals) {
      const s = await openRow(ctx, p)
      if (!s) continue
      await ctx.db.patch(s._id, { status: 'dismissed', decidedAt: now, decidedBy: userId })
      dropped.push(s._id)
    }
    await ctx.db.patch(r._id, { status: 'dismissed', decided: { at: now, accepted: [], dropped } })
    return readId
  },
})

/** Undo Apply or Dismiss: the note on History goes, every change is reverted and the proposals are open again (here and in Suggestions). */
export const undo = mutation({
  args: { readId: v.id('noteReads') },
  handler: async (ctx, { readId }) => {
    const { userId } = await requireUser(ctx)
    const r = await ctx.db.get(readId)
    if (!r?.decided || (r.status !== 'applied' && r.status !== 'dismissed')) return false
    const d = r.decided
    if (d.activityId && (await ctx.db.get(d.activityId))) {
      await ctx.db.delete(d.activityId)
      if (await ctx.db.get(r.investorId)) await ctx.db.patch(r.investorId, { lastTouch: d.lastTouch, updatedAt: Date.now(), updatedBy: userId })
    }
    for (const id of [...d.accepted, ...d.dropped].reverse()) {
      const s = await ctx.db.get(id)
      if (s) await reopen(ctx, s, userId)
    }
    await ctx.db.patch(r._id, { status: 'ready', decided: undefined })
    return true
  },
})

/* ---------- notes from outside: Wispr Flow and agents ---------- */

/**
 * Notes from outside Nest. The investor is the one given, else the one the
 * email or the meeting title matches (lib/meetingNotes matchNote); with no clear
 * match the notes wait in "Unmatched notes" on Today. A matched note is read
 * like a pasted one. Wispr Flow and other agents send notes through the Nest MCP
 * server's `add_meeting_notes` tool (convex/mcp.ts).
 */
export async function addMeetingNotes(
  ctx: MutationCtx,
  a: { investorId?: Id<'investors'>; meetingId?: Id<'meetings'>; email?: string; meetingTitle: string; date: string; text: string; source: Infer<typeof vNoteSource> },
): Promise<{ unmatchedId: Id<'unmatchedNotes'> } | { noteId: Id<'notes'>; investorId: Id<'investors'>; readId: Id<'noteReads'> | null }> {
    const text = a.text.trim().slice(0, LIMITS.note)
    if (!text) throw new ConvexError('The notes are empty.')
    const date = isISODate(a.date) ? a.date : todayIST()
    const meetingTitle = a.meetingTitle.replace(/\s+/g, ' ').trim().slice(0, 200) || 'Meeting'
    const at = Date.parse(date + 'T00:00:00+05:30')
    const meetings = await ctx.db.query('meetings').withIndex('by_start', (q) => q.gte('start', at - 2 * DAY_MS).lte('start', at + 2 * DAY_MS)).collect()
    const given = a.investorId ? await ctx.db.get(a.investorId) : null
    const match = matchNote(
      { email: a.email, meetingTitle, date },
      given ? [given] : await ctx.db.query('investors').collect(),
      given ? [] : await ctx.db.query('people').collect(),
      meetings,
    ) ?? (given ? { investorId: given._id } : null)
    if (!match) {
      const unmatchedId = await ctx.db.insert('unmatchedNotes', { ...(a.email?.trim() ? { email: a.email.trim().toLowerCase() } : {}), meetingTitle, date, text, source: a.source, createdAt: Date.now() })
      return { unmatchedId }
    }
    const investorId = match.investorId as Id<'investors'>
    // PST-285: a Wispr Flow note fetched for a calendar meeting names that meeting.
    const meetingId = a.meetingId ?? (match.meetingId as Id<'meetings'> | undefined)
    const noteId = await ctx.db.insert('notes', {
      investorId, date, text, title: meetingTitle.slice(0, LIMITS.title), source: a.source, ...(meetingId ? { meetingId } : {}),
    })
    return { noteId, investorId, readId: await startRead(ctx, noteId, { auto: true }) }
}

export const ingestNote = internalMutation({
  args: {
    investorId: v.optional(v.id('investors')),
    email: v.optional(v.string()),
    meetingTitle: v.string(),
    date: v.string(),
    text: v.string(),
    source: vNoteSource,
  },
  handler: addMeetingNotes,
})

/** "Unmatched notes" on Today: notes nobody could be matched to, newest first. */
export const unmatched = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx)
    const rows = await ctx.db.query('unmatchedNotes').withIndex('by_created').order('desc').take(50)
    return rows.filter((u) => !u.noteId && !u.droppedAt)
  },
})

/** Pick whose notes they are: they become that investor's note, and Nest reads them. */
export const matchUnmatched = mutation({
  args: { id: v.id('unmatchedNotes'), investorId: v.id('investors') },
  handler: async (ctx, { id, investorId }) => {
    await requireUser(ctx)
    const u = await ctx.db.get(id)
    if (!u || u.noteId || u.droppedAt) throw new ConvexError('Those notes were already handled.')
    if (!(await ctx.db.get(investorId))) throw new ConvexError('That investor was deleted')
    const at = Date.parse(u.date + 'T00:00:00+05:30')
    const meeting = (await ctx.db.query('meetings').withIndex('by_start', (q) => q.gte('start', at - DAY_MS).lte('start', at + 2 * DAY_MS)).collect()).find((m) => m.investorIds.includes(investorId))
    const noteId = await ctx.db.insert('notes', { investorId, date: u.date, text: u.text, title: u.meetingTitle.slice(0, LIMITS.title), source: u.source, ...(meeting ? { meetingId: meeting._id } : {}) })
    await ctx.db.patch(id, { noteId })
    await startRead(ctx, noteId, { auto: true })
    return noteId
  },
})

/** "Not about the round" (Undo: `restoreUnmatched`). */
export const dropUnmatched = mutation({
  args: { id: v.id('unmatchedNotes') },
  handler: async (ctx, { id }) => {
    await requireUser(ctx)
    const u = await ctx.db.get(id)
    if (u && !u.droppedAt && !u.noteId) await ctx.db.patch(id, { droppedAt: Date.now() })
    return id
  },
})

export const restoreUnmatched = mutation({
  args: { id: v.id('unmatchedNotes') },
  handler: async (ctx, { id }) => {
    await requireUser(ctx)
    if ((await ctx.db.get(id))?.droppedAt) await ctx.db.patch(id, { droppedAt: undefined })
    return id
  },
})

/* ---------- Draft from past answers (the Answer panel) ---------- */

/** What a draft is made from: answers to this question and similar ones, and the notes where it was asked. */
export const draftInput = internalQuery({
  args: { questionId: v.id('questions') },
  handler: async (ctx, { questionId }) => {
    await requireUser(ctx)
    const q = await ctx.db.get(questionId)
    if (!isLiveQ(q)) throw new ConvexError('That question was merged or deleted.')
    const live = (await ctx.db.query('questions').collect()).filter(isLiveQ)
    const answered = live.filter((x) => x.bestAnswer.trim())
    const like = similarQuestions(q as unknown as Question, answered.map((x) => ({ ...x, asks: [] }) as unknown as Question), 4)
    const past = [
      ...[...new Set(q.answerVersions.map((x) => x.text.trim()).filter(Boolean))].slice(-2).map((answer) => ({ question: q.text, answer })),
      ...like.map((x) => ({ question: x.text, answer: x.bestAnswer })),
    ]
    const asks = await ctx.db.query('questionAsks').withIndex('by_question', (x) => x.eq('questionId', questionId)).collect()
    const notes: { date: string; text: string }[] = []
    for (const id of [...new Set(asks.map((a) => a.noteId).filter((x): x is Id<'notes'> => !!x))].slice(0, 3)) {
      const n = await ctx.db.get(id)
      if (n && !n.removedAt) notes.push({ date: n.date, text: n.text.slice(0, 2000) })
    }
    return { prompt: past.length || notes.length ? draftPrompt({ question: q.text, past, notes }) : null, from: past.length + notes.length }
  },
})

/** A draft for the Best answer box, editable before Save. Nothing is saved here. */
export const draftAnswer = action({
  args: { questionId: v.id('questions') },
  handler: async (ctx, { questionId }): Promise<{ text: string; costUsd: number; from: number }> => {
    const job = await ctx.runQuery(internal.noteReads.draftInput, { questionId })
    if (!hasAIKey()) throw noKey()
    if (!job.prompt) throw new ConvexError('Nothing to draft from yet: no past answers or notes for this one.')
    const model = await ctx.runQuery(internal.enrich.modelOf, { feature: 'drafts' })
    try {
      const out = await complete({ model, system: DRAFT_SYSTEM, prompt: job.prompt, maxTokens: 600 })
      const text = out.text.trim().replace(/^["“]+|["”]+$/g, '').slice(0, LIMITS.answer)
      if (!text) throw new AIError(200, 'answered with nothing')
      console.log('notes draft question=' + questionId + ' cost=$' + out.costUsd.toFixed(5))
      return { text, costUsd: out.costUsd, from: job.from }
    } catch (e) {
      if (e instanceof NoAIKey) throw noKey()
      if (e instanceof AIError) throw new ConvexError(e.message)
      throw e
    }
  },
})
