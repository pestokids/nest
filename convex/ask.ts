// PST-279: Ask Nest. ⌘K's Ask mode sends a question; Claude answers from Nest's
// data with the MCP read tools (the same definitions and the same handlers as the
// MCP server: src/lib/agents.ts and mcp.ts `read`), and the answer streams into
// the askRuns row the palette watches. Ask only reads: a tool call can reach
// nothing but internal.mcp.read, an internal query, so it can't write. Logs carry
// ids, tool names and costs, never questions or answers.
import { ConvexError, v } from 'convex/values'
import { internalAction, internalMutation, internalQuery, mutation, query } from './_generated/server'
import { internal } from './_generated/api'
import { requireUser } from './lib/access'
import { AIError, hasAIKey, NoAIKey, usageRow, type RunUsage } from './lib/anthropic'
import { featureModel } from './lib/enrichQueue'
import { askLoop, askSystem, type ToolResult } from './lib/ask'
import { vAskStatus, vSources } from './askSchema'
import { vModel, vUsage } from './validators'
import { checkArgs, toolNamed } from '../src/lib/agents'
import { QUESTION_MAX } from '../src/lib/ask'
import { NO_AI_KEY } from '../src/lib/enrich'

/** Streamed text is saved at most this often. */
const FLUSH_MS = 150
/** A run still going after this long died without saying so. */
const STALE_MS = 3 * 6e4

/** Ask a question; resolves with the run the palette watches. PST-273: `model` is the Ask chip's pick, for this question only. */
export const start = mutation({
  args: { question: v.string(), model: v.optional(vModel) },
  handler: async (ctx, { question, model }) => {
    const { userId } = await requireUser(ctx)
    const q = question.trim().replace(/\s+/g, ' ')
    if (!q) throw new ConvexError('Type a question first.')
    if (q.length > QUESTION_MAX) throw new ConvexError(`Keep the question under ${QUESTION_MAX} characters.`)
    if (!hasAIKey()) throw new ConvexError({ code: NO_AI_KEY, message: 'AI isn’t set up here.' })
    const id = await ctx.db.insert('askRuns', {
      userId, question: q, status: 'thinking', text: '', tools: [], sources: { investors: 0, threads: 0, meetings: 0 }, costUsd: 0, startedAt: Date.now(),
      model: model ?? (await featureModel(ctx, 'ask')),
    })
    await ctx.scheduler.runAfter(0, internal.ask.execute, { runId: id })
    return id
  },
})

/** One of your runs, as it streams. */
export const get = query({
  args: { id: v.id('askRuns') },
  handler: async (ctx, { id }) => {
    const { userId } = await requireUser(ctx)
    const r = await ctx.db.get(id)
    if (!r || r.userId !== userId) return null
    const dead = (r.status === 'thinking' || r.status === 'answering') && Date.now() - r.startedAt > STALE_MS
    return {
      _id: r._id, question: r.question, status: dead ? ('failed' as const) : r.status, text: r.text, tools: r.tools, sources: r.sources, costUsd: r.costUsd, ...(r.model ? { model: r.model } : {}),
      ...(dead ? { error: 'It didn’t finish. Try again.' } : r.error ? { error: r.error } : {}),
    }
  },
})

export const input = internalQuery({
  args: { runId: v.id('askRuns') },
  handler: async (ctx, { runId }) => {
    const r = await ctx.db.get(runId)
    return r && r.status === 'thinking' ? { question: r.question, model: r.model ?? (await featureModel(ctx, 'ask')) } : null
  },
})

export const progress = internalMutation({
  args: { runId: v.id('askRuns'), status: vAskStatus, text: v.string(), tools: v.array(v.string()), costUsd: v.number() },
  handler: async (ctx, { runId, ...patch }) => {
    const r = await ctx.db.get(runId)
    if (r && (r.status === 'thinking' || r.status === 'answering')) await ctx.db.patch(runId, patch)
  },
})

export const finish = internalMutation({
  args: {
    runId: v.id('askRuns'), status: v.union(v.literal('done'), v.literal('failed')), text: v.string(), tools: v.array(v.string()), sources: vSources, costUsd: v.number(), error: v.optional(v.string()),
    model: vModel, usage: v.optional(vUsage),
  },
  handler: async (ctx, { runId, ...patch }) => {
    if (await ctx.db.get(runId)) await ctx.db.patch(runId, { ...patch, finishedAt: Date.now() })
  },
})

/** Run one question: the tool loop, streaming into the row, then the answer with its sources and cost. */
export const execute = internalAction({
  args: { runId: v.id('askRuns') },
  handler: async (ctx, { runId }) => {
    const t0 = Date.now()
    const job = await ctx.runQuery(internal.ask.input, { runId })
    if (!job) return
    const seen = { investors: new Set<string>(), threads: new Set<string>(), meetings: new Set<string>() }
    /** The read tools that ran (a refused call still counts toward the six in askLoop, not here). */
    const calls: string[] = []
    let text = ''
    let cost = 0
    let usage: RunUsage | undefined
    let saved = 0
    const save = async (force = false) => {
      if (!force && Date.now() - saved < FLUSH_MS) return
      saved = Date.now()
      await ctx.runMutation(internal.ask.progress, { runId, status: text ? 'answering' : 'thinking', text, tools: calls, costUsd: cost })
    }
    const callTool = async (name: string, raw: unknown): Promise<ToolResult> => {
      const def = toolNamed(name)
      if (!def || def.scope !== 'read') return { isError: true, content: `${name} isn’t something Ask can do: Ask only reads.` }
      const args = checkArgs(def, raw)
      if (!args.ok) return { isError: true, content: args.error }
      const out = await ctx.runQuery(internal.mcp.read, { tool: def.name, args: args.value })
      calls.push(def.name)
      if (!out.ok) return { isError: true, content: out.error }
      for (const k of ['investors', 'threads', 'meetings'] as const) for (const id of out.seen?.[k] ?? []) seen[k].add(id)
      return { content: JSON.stringify(out.data) }
    }
    let status: 'done' | 'failed' = 'done'
    try {
      const out = await askLoop({
        model: job.model,
        question: job.question,
        system: askSystem(Date.now()),
        callTool,
        onText: (d) => {
          text += d
          return save()
        },
        onTool: () => {
          text = ''
          return save(true)
        },
        onCost: (usd, u) => {
          cost = usd
          usage = usageRow(u)
        },
      })
      const sources = { investors: seen.investors.size, threads: seen.threads.size, meetings: seen.meetings.size }
      await ctx.runMutation(internal.ask.finish, { runId, status, text: out.text, tools: calls, sources, costUsd: out.costUsd, model: job.model, usage: usageRow(out.usage) })
      cost = out.costUsd
    } catch (e) {
      status = 'failed'
      const error = e instanceof NoAIKey ? 'AI isn’t set up here.' : e instanceof AIError ? e.message.slice(0, 200) : 'Something went wrong while answering. Try again.'
      await ctx.runMutation(internal.ask.finish, { runId, status, text: '', tools: calls, sources: { investors: 0, threads: 0, meetings: 0 }, costUsd: cost, error, model: job.model, usage })
    }
    console.log('ask run=' + runId + ' status=' + status + ' tools=' + (calls.join(',') || '-') + ' cost=$' + cost.toFixed(4) + ' model=' + job.model + ' secs=' + Math.round((Date.now() - t0) / 1000))
  },
})
