// PST-307: the Advisor, a fundraising coach and storyteller chat (round6/advisor-*.png).
// Chats and their messages live here; an answer runs as an internal action
// (execute) that loops over tools like Ask Nest (convex/ask.ts) and streams into
// its message row through `progress`, which also tells it when Dev pressed Stop.
// The Advisor only reads Nest, drafts and suggests: an email draft lands in
// Drafts, a suggested change waits for Dev to send it to Suggestions, a fact is
// remembered only on Dev's Yes. The monthly cap (Settings › AI › Advisor) is
// checked before a run starts and between its turns. Every public function calls
// requireUser. Logs carry ids, tool names and costs, never questions or answers.
import { ConvexError, v } from 'convex/values'
import { action, internalAction, internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { requireUser } from './lib/access'
import { AIError, complete, errorTag, hasAIKey, NoAIKey, NO_THINKING, usageRow, type Message, type RunUsage } from './lib/anthropic'
import { advisorContext, advisorLoop, READ_TOOL_NAMES, type ToolResult } from './lib/advisor'
import { ADVISOR_READ_NAMES } from './advisorReads'
import { suggestAsAdvisor, suggestPlanNumber } from './mcp'
import { newQuestion, sameQuestion } from './qanda'
import { vAdvisorMode, vBlock, vPinned, vScreen } from './advisorSchema'
import { vModel } from './validators'
import { checkArgs, toolNamed } from '../src/lib/agents'
import {
  addSources, ADVISOR_CAP, ADVISOR_DEFAULTS, capCheck, estimateAnswer, FACT_MAX, HISTORY_MESSAGES, isAdvisorModel, MAX_CAP_USD, MAX_PINNED, MESSAGE_MAX, monthStartIST, TITLE_MAX, titleFrom,
  type AdvisorMode, type AdvisorSettings, type Source,
} from '../src/lib/advisor'
import { BLOCK_TOOL_NAMES, blockInvestorIds, parseBlock, type Block } from '../src/lib/advisorBlocks'
import { NO_AI_KEY } from '../src/lib/enrich'
import { cleanQuestion, LIMITS } from '../src/lib/qanda'
import { averageUsage, OPUS, type Model } from '../src/lib/models'

export { ADVISOR_CAP }
/** Streamed text is saved at most this often. */
const FLUSH_MS = 150
/** An answer still streaming after this long died without saying so. */
const STALE_MS = 5 * 6e4
/** A deleted chat is gone for good once its Undo has had this long. */
const PURGE_MS = 10 * 6e4

/* ---------- settings ---------- */

async function aiRow(ctx: QueryCtx) {
  const row = await ctx.db.query('settings').withIndex('by_key', (q) => q.eq('key', 'ai')).unique()
  return row?.key === 'ai' ? row : null
}

export async function advisorSettings(ctx: QueryCtx): Promise<AdvisorSettings> {
  const row = await aiRow(ctx)
  return {
    model: isAdvisorModel(row?.advisorModel) ? row.advisorModel : ADVISOR_DEFAULTS.model,
    capUsd: row?.advisorCapUsd ?? ADVISOR_DEFAULTS.capUsd,
    web: row?.advisorWeb ?? ADVISOR_DEFAULTS.web,
  }
}

/** This month's Advisor spend (IST month) and how many answers it paid for. */
export async function advisorMonth(ctx: QueryCtx, now = Date.now()) {
  const rows = await ctx.db.query('advisorMessages').withIndex('by_created', (q) => q.gte('createdAt', monthStartIST(now))).collect()
  const answers = rows.filter((m) => m.role === 'assistant')
  return { usd: answers.reduce((s, m) => s + m.costUsd, 0), answers: answers.length, byModel: answers }
}

/** The average usage of recent finished answers on a model, for the estimate. */
async function realUsage(ctx: QueryCtx, model: Model) {
  const recent = await ctx.db.query('advisorMessages').withIndex('by_created').order('desc').take(200)
  const used = recent.filter((m) => m.role === 'assistant' && m.status === 'done' && m.model === model && m.usage).map((m) => m.usage as RunUsage).slice(0, 20)
  return averageUsage(used)
}

export const setSettings = mutation({
  args: { model: v.optional(vModel), capUsd: v.optional(v.number()), web: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    await requireUser(ctx)
    if (a.model !== undefined && !isAdvisorModel(a.model)) throw new ConvexError('The Advisor runs on Sonnet or Opus.')
    if (a.capUsd !== undefined && !(Number.isFinite(a.capUsd) && a.capUsd >= 0 && a.capUsd <= MAX_CAP_USD)) throw new ConvexError('The cap has to be between $0 and $' + MAX_CAP_USD + '.')
    const patch = {
      ...(a.model !== undefined ? { advisorModel: a.model } : {}),
      ...(a.capUsd !== undefined ? { advisorCapUsd: Math.round(a.capUsd * 100) / 100 } : {}),
      ...(a.web !== undefined ? { advisorWeb: a.web } : {}),
    }
    const row = await aiRow(ctx)
    if (row) await ctx.db.patch(row._id, patch)
    else await ctx.db.insert('settings', { key: 'ai', ...patch })
    return await advisorSettings(ctx)
  },
})

/* ---------- what the app reads ---------- */

/** The sidebar and Settings: the settings, this month against the cap, memory's size, and what an answer has really cost on each model. */
export const overview = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx)
    const month = await advisorMonth(ctx)
    const memory = await ctx.db.query('advisorMemory').collect()
    const settings = await advisorSettings(ctx)
    const sonnet = await realUsage(ctx, ADVISOR_DEFAULTS.model)
    const opus = await realUsage(ctx, OPUS)
    return { connected: hasAIKey(), settings, monthUsd: month.usd, monthAnswers: month.answers, memoryCount: memory.length, real: { sonnet, opus } }
  },
})

const chatRow = (c: Doc<'advisorChats'>) => ({
  _id: c._id, title: c.title, pinned: c.pinned, model: c.model, mode: c.mode, createdAt: c.createdAt, updatedAt: c.updatedAt, totalCostUsd: c.totalCostUsd, messageCount: c.messageCount,
  pinnedContext: c.pinnedContext ?? [], ...(c.screen ? { screen: c.screen } : {}),
})

/** Your chats, newest first (deleted ones waiting out their Undo are left out). */
export const chats = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireUser(ctx)
    const rows = await ctx.db.query('advisorChats').withIndex('by_user', (q) => q.eq('userId', userId)).order('desc').take(300)
    return rows.filter((c) => !c.deletedAt).map(chatRow)
  },
})

async function ownChat(ctx: QueryCtx, chatId: Id<'advisorChats'>, userId: Id<'users'>) {
  const c = await ctx.db.get(chatId)
  if (!c || c.userId !== userId || c.deletedAt) throw new ConvexError('That chat was deleted.')
  return c
}
async function ownMessage(ctx: QueryCtx, messageId: Id<'advisorMessages'>, userId: Id<'users'>) {
  const m = await ctx.db.get(messageId)
  if (!m) throw new ConvexError('That message is gone.')
  return { m, chat: await ownChat(ctx, m.chatId, userId) }
}
const messagesOf = (ctx: QueryCtx, chatId: Id<'advisorChats'>) => ctx.db.query('advisorMessages').withIndex('by_chat', (q) => q.eq('chatId', chatId)).collect()

/** One of your chats with its messages, oldest first (null: not yours, or deleted). */
export const chat = query({
  args: { chatId: v.id('advisorChats') },
  handler: async (ctx, { chatId }) => {
    const { userId } = await requireUser(ctx)
    const c = await ctx.db.get(chatId)
    if (!c || c.userId !== userId || c.deletedAt) return null
    const now = Date.now()
    const messages = (await messagesOf(ctx, chatId)).map((m) => {
      const dead = m.status === 'streaming' && now - m.createdAt > STALE_MS && now - (m.finishedAt ?? m.createdAt) > STALE_MS
      const { usage: _u, ...rest } = m
      return dead ? { ...rest, status: 'failed' as const, error: 'It didn’t finish. Try again.' } : rest
    })
    return { chat: chatRow(c), messages }
  },
})

/* ---------- sending ---------- */

/** What the next answer should cost, from the chat so far (the estimate the cap is checked against). */
async function estimateFor(ctx: QueryCtx, history: readonly Doc<'advisorMessages'>[], model: Model, mode: AdvisorMode, web: boolean) {
  const historyChars = history.slice(-HISTORY_MESSAGES).reduce((s, m) => s + m.text.length, 0)
  const real = await realUsage(ctx, model)
  return estimateAnswer({ model, mode, web, historyChars, real: real?.avg, realCount: real?.runs })
}

/** Refuse a run that would pass the cap, and one with no key. */
async function mayRun(ctx: QueryCtx, history: readonly Doc<'advisorMessages'>[], model: Model, mode: AdvisorMode) {
  if (!hasAIKey()) throw new ConvexError({ code: NO_AI_KEY, message: 'AI isn’t set up here.' })
  const s = await advisorSettings(ctx)
  const est = await estimateFor(ctx, history, model, mode, s.web)
  const ok = capCheck((await advisorMonth(ctx)).usd, est, s.capUsd)
  if (!ok.ok) throw new ConvexError({ code: ADVISOR_CAP, message: ok.message })
}

/** Start an answer: a streaming row after `after`, and the action that writes it. */
async function startAnswer(ctx: MutationCtx, chat: Doc<'advisorChats'>, model: Model, mode: AdvisorMode) {
  const now = Date.now()
  const id = await ctx.db.insert('advisorMessages', { chatId: chat._id, role: 'assistant', text: '', blocks: [], sources: [], model, mode, costUsd: 0, status: 'streaming', createdAt: now })
  await ctx.scheduler.runAfter(0, internal.advisor.execute, { messageId: id })
  return id
}

const cleanText = (text: string) => {
  const t = text.trim()
  if (!t) throw new ConvexError('Type a question first.')
  if (t.length > MESSAGE_MAX) throw new ConvexError('Keep it under ' + MESSAGE_MAX + ' characters.')
  return t
}

/**
 * Send a message: to a chat, or a new one (chatId left out). `model` is for this
 * answer only (Ask Opus); the chat keeps its own. `pinned` and `screen` are the
 * new chat's "+ Context" and, from ⌘J, the screen it was opened on.
 */
export const send = mutation({
  args: {
    chatId: v.optional(v.id('advisorChats')), text: v.string(), mode: vAdvisorMode, model: v.optional(vModel),
    pinned: v.optional(v.array(vPinned)), screen: v.optional(vScreen),
  },
  handler: async (ctx, a) => {
    const { userId } = await requireUser(ctx)
    const text = cleanText(a.text)
    if (a.model && !isAdvisorModel(a.model)) throw new ConvexError('The Advisor runs on Sonnet or Opus.')
    const s = await advisorSettings(ctx)
    const existing = a.chatId ? await ownChat(ctx, a.chatId, userId) : null
    const history = existing ? await messagesOf(ctx, existing._id) : []
    if (history.some((m) => m.status === 'streaming' && Date.now() - m.createdAt < STALE_MS)) throw new ConvexError('Wait for the answer, or press Stop.')
    const model = a.model ?? existing?.model ?? s.model
    await mayRun(ctx, history, model, a.mode)
    const now = Date.now()
    const chatId =
      existing?._id ??
      (await ctx.db.insert('advisorChats', {
        userId, title: titleFrom(text), pinned: false, model, mode: a.mode, createdAt: now, updatedAt: now, totalCostUsd: 0, messageCount: 0,
        ...(a.pinned?.length ? { pinnedContext: a.pinned.slice(0, MAX_PINNED) } : {}), ...(a.screen ? { screen: a.screen } : {}),
      }))
    if (existing && a.pinned) await ctx.db.patch(chatId, { pinnedContext: a.pinned.slice(0, MAX_PINNED) })
    const chat = (await ctx.db.get(chatId))!
    await ctx.db.insert('advisorMessages', { chatId, role: 'user', text, blocks: [], sources: [], mode: a.mode, costUsd: 0, status: 'done', createdAt: now })
    await ctx.db.patch(chatId, { updatedAt: now, mode: a.mode, messageCount: chat.messageCount + 2 })
    const messageId = await startAnswer(ctx, chat, model, a.mode)
    return { chatId, messageId }
  },
})

/** Stop an answer: it keeps what it wrote so far. */
export const stop = mutation({
  args: { messageId: v.id('advisorMessages') },
  handler: async (ctx, { messageId }) => {
    const { userId } = await requireUser(ctx)
    const { m } = await ownMessage(ctx, messageId, userId)
    if (m.status === 'streaming') await ctx.db.patch(m._id, { status: 'stopped', finishedAt: Date.now() })
    return null
  },
})

/** Run an answer again in place (Regenerate), on another model for this answer only (Ask Opus instead). Its cost so far stays counted. */
export const regenerate = mutation({
  args: { messageId: v.id('advisorMessages'), model: v.optional(vModel) },
  handler: async (ctx, { messageId, model }) => {
    const { userId } = await requireUser(ctx)
    const { m, chat } = await ownMessage(ctx, messageId, userId)
    if (m.role !== 'assistant') throw new ConvexError('Only an answer can be asked again.')
    if (m.status === 'streaming') throw new ConvexError('Wait for the answer, or press Stop.')
    if (model && !isAdvisorModel(model)) throw new ConvexError('The Advisor runs on Sonnet or Opus.')
    const use = model ?? m.model ?? chat.model
    const before = (await messagesOf(ctx, chat._id)).filter((x) => x._creationTime < m._creationTime)
    await mayRun(ctx, before, use, m.mode ?? chat.mode)
    await ctx.db.patch(m._id, { text: '', blocks: [], sources: [], status: 'streaming', error: undefined, model: use, finishedAt: Date.now() })
    await ctx.scheduler.runAfter(0, internal.advisor.execute, { messageId: m._id })
    return m._id
  },
})

/** Edit your last message: its answer is written again. */
export const editLast = mutation({
  args: { chatId: v.id('advisorChats'), text: v.string() },
  handler: async (ctx, a) => {
    const { userId } = await requireUser(ctx)
    const chat = await ownChat(ctx, a.chatId, userId)
    const text = cleanText(a.text)
    const all = await messagesOf(ctx, chat._id)
    const lastUser = [...all].reverse().find((m) => m.role === 'user')
    if (!lastUser) throw new ConvexError('There’s nothing to edit yet.')
    const answer = all.find((m) => m.role === 'assistant' && m._creationTime > lastUser._creationTime)
    if (answer?.status === 'streaming') throw new ConvexError('Wait for the answer, or press Stop.')
    const before = all.filter((m) => m._creationTime < lastUser._creationTime)
    const model = answer?.model ?? chat.model
    const mode = lastUser.mode ?? chat.mode
    await mayRun(ctx, [...before, { ...lastUser, text }], model, mode)
    await ctx.db.patch(lastUser._id, { text })
    if (answer) {
      await ctx.db.patch(answer._id, { text: '', blocks: [], sources: [], status: 'streaming', error: undefined, finishedAt: Date.now() })
      await ctx.scheduler.runAfter(0, internal.advisor.execute, { messageId: answer._id })
      return answer._id
    }
    await ctx.db.patch(chat._id, { messageCount: chat.messageCount + 1, updatedAt: Date.now() })
    return await startAnswer(ctx, chat, model, mode)
  },
})

/* ---------- the chat list ---------- */

export const rename = mutation({
  args: { chatId: v.id('advisorChats'), title: v.string() },
  handler: async (ctx, { chatId, title }) => {
    const { userId } = await requireUser(ctx)
    await ownChat(ctx, chatId, userId)
    const t = title.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX)
    if (!t) throw new ConvexError('Give the chat a name.')
    await ctx.db.patch(chatId, { title: t })
    return null
  },
})

export const setPinned = mutation({
  args: { chatId: v.id('advisorChats'), pinned: v.boolean() },
  handler: async (ctx, { chatId, pinned }) => {
    const { userId } = await requireUser(ctx)
    await ownChat(ctx, chatId, userId)
    await ctx.db.patch(chatId, { pinned })
    return null
  },
})

/** The chat's model from now on (the model chip). */
export const setModel = mutation({
  args: { chatId: v.id('advisorChats'), model: vModel },
  handler: async (ctx, { chatId, model }) => {
    const { userId } = await requireUser(ctx)
    await ownChat(ctx, chatId, userId)
    if (!isAdvisorModel(model)) throw new ConvexError('The Advisor runs on Sonnet or Opus.')
    await ctx.db.patch(chatId, { model })
    return null
  },
})

/** "+ Context": the investors and materials pinned to a chat. */
export const setContext = mutation({
  args: { chatId: v.id('advisorChats'), pinned: v.array(vPinned) },
  handler: async (ctx, { chatId, pinned }) => {
    const { userId } = await requireUser(ctx)
    await ownChat(ctx, chatId, userId)
    await ctx.db.patch(chatId, { pinnedContext: pinned.slice(0, MAX_PINNED) })
    return null
  },
})

/** Delete with Undo: the chat is hidden now and purged once its Undo has passed. */
export const remove = mutation({
  args: { chatId: v.id('advisorChats') },
  handler: async (ctx, { chatId }) => {
    const { userId } = await requireUser(ctx)
    const c = await ownChat(ctx, chatId, userId)
    const now = Date.now()
    await ctx.db.patch(c._id, { deletedAt: now })
    for (const old of await ctx.db.query('advisorChats').withIndex('by_user', (q) => q.eq('userId', userId)).collect()) {
      if (!old.deletedAt || now - old.deletedAt < PURGE_MS) continue
      for (const m of await messagesOf(ctx, old._id)) await ctx.db.delete(m._id)
      await ctx.db.delete(old._id)
    }
    return null
  },
})

export const restore = mutation({
  args: { chatId: v.id('advisorChats') },
  handler: async (ctx, { chatId }) => {
    const { userId } = await requireUser(ctx)
    const c = await ctx.db.get(chatId)
    if (!c || c.userId !== userId) throw new ConvexError('Too late to undo: that chat is gone.')
    await ctx.db.patch(chatId, { deletedAt: undefined })
    return null
  },
})

/* ---------- acting on an answer's blocks ---------- */

async function blockAt(ctx: QueryCtx, messageId: Id<'advisorMessages'>, index: number, userId: Id<'users'>) {
  const { m, chat } = await ownMessage(ctx, messageId, userId)
  const b = m.blocks[index]
  if (!b) throw new ConvexError('That part of the answer is gone.')
  return { m, chat, b }
}
const withBlock = (m: Doc<'advisorMessages'>, index: number, b: Block) => m.blocks.map((x, i) => (i === index ? b : x)) as Doc<'advisorMessages'>['blocks']

/**
 * Keep Dev's change to a block: a story reordered or edited, a blank filled in,
 * a draft edited, a plan step ticked, an option picked, a Q&A save. The kind
 * can't change, and a memory or a suggestion only changes through its own buttons.
 */
export const updateBlock = mutation({
  args: { messageId: v.id('advisorMessages'), index: v.number(), block: vBlock },
  handler: async (ctx, { messageId, index, block }) => {
    const { userId } = await requireUser(ctx)
    const { m, b } = await blockAt(ctx, messageId, index, userId)
    if (b.kind !== block.kind) throw new ConvexError('That part of the answer is something else now.')
    if (b.kind === 'memory' || b.kind === 'suggestion') throw new ConvexError('Use its own buttons.')
    await ctx.db.patch(m._id, { blocks: withBlock(m, index, block as Block) })
    return null
  },
})

/** "Remember this?": Yes keeps the fact (it can be edited first), No drops it. Nothing is kept before Yes. */
export const answerMemory = mutation({
  args: { messageId: v.id('advisorMessages'), index: v.number(), yes: v.boolean(), fact: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const { userId } = await requireUser(ctx)
    const { m, chat, b } = await blockAt(ctx, a.messageId, a.index, userId)
    if (b.kind !== 'memory') throw new ConvexError('That isn’t something to remember.')
    if (b.state !== 'asked') return b.memoryId ?? null
    if (!a.yes) {
      await ctx.db.patch(m._id, { blocks: withBlock(m, a.index, { ...b, state: 'dismissed' }) })
      return null
    }
    const fact = (a.fact ?? b.fact).replace(/\s+/g, ' ').trim().slice(0, FACT_MAX)
    if (!fact) throw new ConvexError('Write the fact first.')
    const memoryId = await ctx.db.insert('advisorMemory', { fact, chatId: chat._id, createdAt: Date.now(), createdBy: userId })
    await ctx.db.patch(m._id, { blocks: withBlock(m, a.index, { ...b, fact, state: 'saved', memoryId }) })
    return memoryId
  },
})

/** "Send to Suggestions": the card becomes a Suggestion, with the same checks and dedupe as an agent's. */
export const sendSuggestion = mutation({
  args: { messageId: v.id('advisorMessages'), index: v.number() },
  handler: async (ctx, a) => {
    const { userId } = await requireUser(ctx)
    const { m, b } = await blockAt(ctx, a.messageId, a.index, userId)
    if (b.kind !== 'suggestion') throw new ConvexError('That isn’t a suggestion.')
    if (b.state !== 'proposed') return { added: b.state === 'sent', message: b.note ?? '' }
    const out = await suggestAsAdvisor(ctx, { investorId: b.investorId, kind: b.change, why: b.why, ...(b.value !== undefined ? { value: b.value } : {}), ...(b.date ? { date: b.date } : {}) })
    const added = out.ok && out.data.suggested === true
    const message = out.ok ? String(out.data.message ?? '') : out.error
    await ctx.db.patch(m._id, {
      blocks: withBlock(m, a.index, { ...b, state: added ? 'sent' : 'not_added', note: message, ...(added ? { suggestionId: String(out.ok && out.data.suggestionId) } : {}) }),
    })
    return { added, message }
  },
})

/** "Move to …" on an investor card: a stage Suggestion for Dev's OK. Nothing moves here. */
export const suggestMove = mutation({
  args: { messageId: v.id('advisorMessages'), index: v.number(), stage: v.string() },
  handler: async (ctx, a) => {
    const { userId } = await requireUser(ctx)
    const { b } = await blockAt(ctx, a.messageId, a.index, userId)
    if (b.kind !== 'investor_card') throw new ConvexError('That isn’t an investor card.')
    const out = await suggestAsAdvisor(ctx, { investorId: b.investorId, kind: 'stage', value: a.stage, why: 'From an Advisor answer.' })
    return { added: out.ok && out.data.suggested === true, message: out.ok ? String(out.data.message ?? '') : out.error }
  },
})

/** "Save to Plan" on a blank: a Suggestion that keeps the number for the Advisor once accepted. */
export const blankToPlan = mutation({
  args: { messageId: v.id('advisorMessages'), index: v.number(), value: v.string() },
  handler: async (ctx, a) => {
    const { userId } = await requireUser(ctx)
    const { m, b } = await blockAt(ctx, a.messageId, a.index, userId)
    if (b.kind !== 'blank') throw new ConvexError('That isn’t a blank.')
    const value = (a.value.trim() + (b.unit && !a.value.includes(b.unit) ? ' ' + b.unit : '')).trim().slice(0, 60)
    if (!a.value.trim()) throw new ConvexError('Fill in the number first.')
    const out = await suggestPlanNumber(ctx, b.label, value)
    await ctx.db.patch(m._id, { blocks: withBlock(m, a.index, { ...b, value: a.value.trim(), saved: 'plan' }) })
    return { added: out.ok && out.data.suggested === true, message: out.ok ? String(out.data.message ?? '') : out.error }
  },
})

/** "Save" on a Q&A answer or a story: it becomes the best answer to that question in Q&A (a question already there gets it as a new version). */
export const saveToQanda = mutation({
  args: { messageId: v.id('advisorMessages'), index: v.number() },
  handler: async (ctx, a) => {
    const { userId } = await requireUser(ctx)
    const { m, b } = await blockAt(ctx, a.messageId, a.index, userId)
    if (b.kind !== 'draft' || b.draftKind === 'email') throw new ConvexError('Only an answer or a story goes to Q&A.')
    if (b.questionId) return b.questionId
    const text = cleanQuestion((b.question ?? b.title).slice(0, LIMITS.question))
    const id = (await sameQuestion(ctx, text))?._id ?? (await newQuestion(ctx, text))
    const q = (await ctx.db.get(id))!
    const best = b.body.trim().slice(0, LIMITS.answer)
    const now = Date.now()
    await ctx.db.patch(id, { bestAnswer: best, answerVersions: [...q.answerVersions, { text: best, at: now, by: userId }], updatedAt: now })
    await ctx.db.patch(m._id, { blocks: withBlock(m, a.index, { ...b, questionId: id }) })
    return id
  },
})

/* ---------- memory (Settings › AI › Advisor) ---------- */

export const memory = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx)
    const rows = await ctx.db.query('advisorMemory').withIndex('by_created').order('desc').collect()
    const titles = new Map<string, string>()
    for (const r of rows) if (r.chatId && !titles.has(r.chatId)) titles.set(r.chatId, (await ctx.db.get(r.chatId))?.title ?? '')
    return rows.map((r) => ({ _id: r._id, fact: r.fact, createdAt: r.createdAt, ...(r.chatId && titles.get(r.chatId) ? { chat: titles.get(r.chatId) } : {}) }))
  },
})

export const editMemory = mutation({
  args: { id: v.id('advisorMemory'), fact: v.string() },
  handler: async (ctx, { id, fact }) => {
    await requireUser(ctx)
    const f = fact.replace(/\s+/g, ' ').trim().slice(0, FACT_MAX)
    if (!f) throw new ConvexError('Write the fact, or delete it.')
    if (!(await ctx.db.get(id))) throw new ConvexError('That memory was deleted.')
    await ctx.db.patch(id, { fact: f, updatedAt: Date.now() })
    return null
  },
})

/** Delete a memory; resolves with what Undo needs to put it back. */
export const deleteMemory = mutation({
  args: { id: v.id('advisorMemory') },
  handler: async (ctx, { id }) => {
    await requireUser(ctx)
    const r = await ctx.db.get(id)
    if (!r) return null
    await ctx.db.delete(id)
    return { fact: r.fact, createdAt: r.createdAt, ...(r.chatId ? { chatId: r.chatId } : {}) }
  },
})

export const restoreMemory = mutation({
  args: { fact: v.string(), createdAt: v.number(), chatId: v.optional(v.id('advisorChats')) },
  handler: async (ctx, a) => {
    const { userId } = await requireUser(ctx)
    return await ctx.db.insert('advisorMemory', { fact: a.fact.slice(0, FACT_MAX), createdAt: a.createdAt, createdBy: userId, ...(a.chatId ? { chatId: a.chatId } : {}) })
  },
})

/* ---------- the run ---------- */

/** Everything an answer needs: the conversation before it, the chat's context, memory, the settings and this month's spend. */
export const input = internalQuery({
  args: { messageId: v.id('advisorMessages') },
  handler: async (ctx, { messageId }) => {
    const m = await ctx.db.get(messageId)
    if (!m || m.status !== 'streaming' || m.role !== 'assistant') return null
    const chat = await ctx.db.get(m.chatId)
    if (!chat || chat.deletedAt) return null
    const before = (await messagesOf(ctx, chat._id)).filter((x) => x._creationTime < m._creationTime)
    const history: Message[] = []
    for (const x of before.slice(-HISTORY_MESSAGES)) {
      const text = x.text.trim()
      if (!text) continue
      const prev = history[history.length - 1]
      if (prev?.role === x.role) prev.content = String(prev.content) + '\n\n' + text
      else history.push({ role: x.role, content: text })
    }
    while (history[0]?.role === 'assistant') history.shift()
    if (history[history.length - 1]?.role !== 'user') return null
    const memory = (await ctx.db.query('advisorMemory').withIndex('by_created').order('desc').take(30)).map((r) => r.fact)
    const s = await advisorSettings(ctx)
    return {
      chatId: chat._id, userId: chat.userId, model: m.model ?? chat.model, mode: m.mode ?? chat.mode, history, memory, pinned: chat.pinnedContext ?? [], screen: chat.screen ?? null,
      web: s.web, capUsd: s.capUsd, monthUsd: (await advisorMonth(ctx)).usd - m.costUsd, baseCost: m.costUsd,
    }
  },
})

/** Streamed text so far; false when the answer is no longer streaming (Stop), so the run stops. */
export const progress = internalMutation({
  args: { messageId: v.id('advisorMessages'), text: v.string(), costUsd: v.number() },
  handler: async (ctx, { messageId, text, costUsd }) => {
    const m = await ctx.db.get(messageId)
    if (!m || m.status !== 'streaming') return false
    await ctx.db.patch(messageId, { text, costUsd })
    return true
  },
})

/**
 * One block tool call: check its input, check the investors it names, write the
 * draft (an email lands in Drafts as a draft; nothing is sent), and add the block
 * to the answer. Resolves with what Claude is told.
 */
export const act = internalMutation({
  args: { messageId: v.id('advisorMessages'), tool: v.string(), input: v.any() },
  handler: async (ctx, { messageId, tool, input }): Promise<ToolResult> => {
    const m = await ctx.db.get(messageId)
    if (!m || m.status !== 'streaming') return { isError: true, content: 'The answer was stopped.' }
    const parsed = parseBlock(tool, input)
    if (!parsed.ok) return { isError: true, content: parsed.error }
    let b = parsed.value
    for (const raw of blockInvestorIds(b)) {
      const id = ctx.db.normalizeId('investors', raw)
      if (!id || !(await ctx.db.get(id))) return { isError: true, content: 'There’s no investor with id ' + raw.slice(0, 40) + '. Use search_investors to find the right one.' }
    }
    if (b.kind === 'follow_ups' && m.blocks.some((x) => x.kind === 'follow_ups')) return { isError: true, content: 'This answer already has its follow-ups.' }
    let said = 'Shown in the answer.'
    if (b.kind === 'draft' && b.draftKind === 'email') {
      const chat = (await ctx.db.get(m.chatId))!
      const investorId = ctx.db.normalizeId('investors', b.investorId!)!
      const draftId = await ctx.db.insert('drafts', {
        investorId, type: b.draftType ?? 'followup', subject: b.subject ?? b.title, body: b.body, status: 'draft', costUsd: 0, createdAt: Date.now(), createdBy: chat.userId,
        ...(m.model ? { model: m.model } : {}),
      })
      b = { ...b, draftId }
      said = 'Saved in Drafts as a draft. Nothing was sent.'
    } else if (b.kind === 'draft') said = 'Shown with Save; it goes into Q&A only if Dev saves it.'
    else if (b.kind === 'suggestion') said = 'Shown as a card. Nothing changes unless Dev sends it to Suggestions and accepts it there.'
    else if (b.kind === 'memory') said = 'Dev is asked “Remember this?”. It is kept only if Dev says yes.'
    await ctx.db.patch(m._id, { blocks: [...m.blocks, b] as Doc<'advisorMessages'>['blocks'] })
    return { content: said }
  },
})

export const finish = internalMutation({
  args: {
    messageId: v.id('advisorMessages'), status: v.union(v.literal('done'), v.literal('failed'), v.literal('stopped')), text: v.string(),
    sources: v.array(v.object({ kind: v.string(), label: v.string(), investorId: v.optional(v.string()), url: v.optional(v.string()) })),
    costUsd: v.number(), runCostUsd: v.number(), error: v.optional(v.string()), usage: v.optional(v.object({ input: v.number(), output: v.number(), thinking: v.optional(v.number()), cacheRead: v.number(), cacheWrite: v.number(), webSearches: v.number() })),
  },
  handler: async (ctx, a) => {
    const m = await ctx.db.get(a.messageId)
    if (!m) return
    const stopped = m.status === 'stopped'
    await ctx.db.patch(m._id, {
      status: stopped ? 'stopped' : a.status, text: a.text, sources: a.sources as Doc<'advisorMessages'>['sources'], costUsd: a.costUsd, finishedAt: Date.now(),
      ...(a.usage ? { usage: a.usage } : {}), ...(a.error && !stopped ? { error: a.error } : {}),
    })
    const chat = await ctx.db.get(m.chatId)
    if (chat) await ctx.db.patch(chat._id, { totalCostUsd: chat.totalCostUsd + a.runCostUsd, updatedAt: Date.now() })
  },
})

/** Run one answer: the tool loop, streaming into the row, then its sources and cost. */
export const execute = internalAction({
  args: { messageId: v.id('advisorMessages') },
  handler: async (ctx, { messageId }) => {
    const t0 = Date.now()
    const job = await ctx.runQuery(internal.advisor.input, { messageId })
    if (!job) return
    const abort = new AbortController()
    const sources: Source[] = []
    const calls: string[] = []
    let kept = ''
    let turn = ''
    let cost = 0
    let usage: RunUsage | undefined
    let saved = 0
    let stopped = false
    const save = async (force = false) => {
      if (stopped || (!force && Date.now() - saved < FLUSH_MS)) return
      saved = Date.now()
      const live = await ctx.runMutation(internal.advisor.progress, { messageId, text: (kept + turn).trim(), costUsd: job.baseCost + cost })
      if (!live) {
        stopped = true
        abort.abort()
      }
    }
    const callTool = async (name: string, raw: unknown): Promise<ToolResult> => {
      calls.push(name)
      if (BLOCK_TOOL_NAMES.has(name)) return await ctx.runMutation(internal.advisor.act, { messageId, tool: name, input: raw ?? {} })
      if (ADVISOR_READ_NAMES.has(name)) {
        const out = await ctx.runQuery(internal.advisorReads.read, { tool: name, args: raw ?? {} })
        if (!out.ok) return { isError: true, content: out.error }
        addSources(sources, out.sources)
        return { content: JSON.stringify(out.data) }
      }
      const def = toolNamed(name)
      if (!def || def.scope !== 'read') return { isError: true, content: name + ' isn’t something the Advisor can do: it reads, drafts and suggests.' }
      const args = checkArgs(def, raw)
      if (!args.ok) return { isError: true, content: args.error }
      const out = await ctx.runQuery(internal.mcp.read, { tool: def.name, args: args.value })
      if (!out.ok) return { isError: true, content: out.error }
      addSources(sources, await ctx.runQuery(internal.advisorReads.mcpChips, { tool: def.name, ids: out.seen?.investors ?? [] }))
      return { content: JSON.stringify(out.data) }
    }
    let status: 'done' | 'failed' | 'stopped' = 'done'
    let error: string | undefined
    let failure = ''
    try {
      const out = await advisorLoop({
        model: job.model,
        context: advisorContext({ now: Date.now(), mode: job.mode, memory: job.memory, pinned: job.pinned, screen: job.screen }),
        messages: job.history,
        web: job.web,
        callTool,
        signal: abort.signal,
        onText: (d) => {
          turn += d
          return save()
        },
        onTurn: async (used) => {
          // Stopped while this turn streamed: what it wrote after Stop isn't kept.
          await save(true)
          if (stopped) {
            turn = ''
            return
          }
          // A turn that read something was only a preamble; one that drafted or showed blocks keeps its words.
          if (!used.some((n) => READ_TOOL_NAMES.has(n) || n === '(retry)') && turn.trim()) kept = (kept ? kept.trimEnd() + '\n\n' : '') + turn.trim()
          turn = ''
          await save(true)
        },
        onCost: (usd, u) => {
          cost = usd
          usage = usageRow(u)
        },
        // Another tool turn and the answer after it must both fit under the cap.
        budget: (spent, lastTurn) => job.monthUsd + spent + 2 * lastTurn <= job.capUsd,
      })
      cost = out.costUsd
      usage = usageRow(out.usage)
      addSources(sources, out.web.slice(0, 8).map((w) => ({ kind: 'web' as const, label: w.title.slice(0, 120), url: w.url })))
    } catch (e) {
      if (stopped || abort.signal.aborted) status = 'stopped'
      else {
        status = 'failed'
        failure = ' error=' + errorTag(e)
        error = e instanceof NoAIKey ? 'AI isn’t set up here.' : e instanceof AIError ? e.message.slice(0, 200) : 'Something went wrong while answering. Try again.'
      }
    }
    const text = (kept + (status === 'done' ? '' : turn)).trim()
    await ctx.runMutation(internal.advisor.finish, { messageId, status, text, sources, costUsd: job.baseCost + cost, runCostUsd: cost, error, usage })
    console.log('advisor msg=' + messageId + ' status=' + status + ' tools=' + (calls.join(',') || '-') + ' cost=$' + cost.toFixed(4) + ' model=' + job.model + ' secs=' + Math.round((Date.now() - t0) / 1000) + failure)
  },
})

/* ---------- "Try another" on a story beat ---------- */

export const beatInput = internalQuery({
  args: { messageId: v.id('advisorMessages'), index: v.number(), beat: v.number(), userId: v.id('users') },
  handler: async (ctx, a) => {
    const { m, chat, b } = await blockAt(ctx, a.messageId, a.index, a.userId)
    if (b.kind !== 'story' || !b.beats[a.beat]) throw new ConvexError('That line is gone.')
    const s = await advisorSettings(ctx)
    const ok = capCheck((await advisorMonth(ctx)).usd, 0.01, s.capUsd)
    if (!ok.ok) throw new ConvexError({ code: ADVISOR_CAP, message: ok.message })
    return { model: m.model ?? chat.model, beats: b.beats, title: b.title ?? '' }
  },
})

export const saveBeat = internalMutation({
  args: { messageId: v.id('advisorMessages'), index: v.number(), beat: v.number(), text: v.string(), costUsd: v.number() },
  handler: async (ctx, a) => {
    const m = await ctx.db.get(a.messageId)
    const b = m?.blocks[a.index]
    if (!m || b?.kind !== 'story' || !b.beats[a.beat]) return
    const beats = b.beats.map((x, i) => (i === a.beat ? { ...x, text: a.text } : x))
    await ctx.db.patch(m._id, { blocks: withBlock(m, a.index, { ...b, beats }), costUsd: m.costUsd + a.costUsd })
    const chat = await ctx.db.get(m.chatId)
    if (chat) await ctx.db.patch(chat._id, { totalCostUsd: chat.totalCostUsd + a.costUsd })
  },
})

/** "Try another": one beat written again, the rest of the story as it stands. Counted on the answer and the cap. */
export const tryAnother = action({
  args: { messageId: v.id('advisorMessages'), index: v.number(), beat: v.number() },
  handler: async (ctx, a): Promise<string> => {
    const { userId } = await requireUserInAction(ctx)
    if (!hasAIKey()) throw new ConvexError({ code: NO_AI_KEY, message: 'AI isn’t set up here.' })
    const job = await ctx.runQuery(internal.advisor.beatInput, { ...a, userId })
    const story = job.beats.map((x, i) => (i === a.beat ? '>> ' : '   ') + x.label + ': ' + x.text).join('\n')
    const out = await complete({
      model: job.model,
      thinking: NO_THINKING[job.model],
      system: 'You rewrite one line of a founder’s pitch story. Keep the founder’s voice and plain words. Never invent a number: keep every [__] as it is and add no new figures. Reply with the new line only.',
      prompt: (job.title ? 'Story: ' + job.title + '\n' : '') + story + '\n\nWrite the line marked >> another way.',
      maxTokens: 1500,
    })
    const text = out.text.replace(/^["“]|["”]$/g, '').trim().slice(0, 300) || job.beats[a.beat].text
    await ctx.runMutation(internal.advisor.saveBeat, { ...a, text, costUsd: out.costUsd })
    console.log('advisor beat msg=' + a.messageId + ' cost=$' + out.costUsd.toFixed(4) + ' model=' + job.model)
    return text
  },
})

/** requireUser for an action: through a query, since actions have no db. */
async function requireUserInAction(ctx: { runQuery: (q: typeof internal.advisor.whoami, a: Record<string, never>) => Promise<Id<'users'> | null> }) {
  const userId = await ctx.runQuery(internal.advisor.whoami, {})
  if (!userId) throw new ConvexError('Not signed in')
  return { userId }
}

export const whoami = internalQuery({
  args: {},
  handler: async (ctx) => {
    try {
      return (await requireUser(ctx)).userId
    } catch {
      return null
    }
  },
})
