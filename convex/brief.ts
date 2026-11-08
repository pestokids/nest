// PST-279: the morning brief. At 08:00 IST (crons.ts) Nest writes down what
// happened since yesterday (replies waiting on Dev, materials opened, meetings
// done, open suggestions) and today's three moves, each with a one-line reason
// Claude writes from the facts (on Haiku, under a cent; Settings › AI can pick another model). Without a key, or if Claude
// fails, the moves keep Today's own why. One brief per IST day; Today shows it
// until Dev dismisses it, then it's one line. Background work: never a sound.
import { v, type Infer } from 'convex/values'
import { internalAction, internalMutation, internalQuery, mutation, query } from './_generated/server'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { requireUser } from './lib/access'
import { complete, errorTag, hasAIKey, usageRow, type Model, type RunUsage } from './lib/anthropic'
import { parseReasons, reasonsPrompt, REASONS_SYSTEM, sinceLines, type MoveFacts } from './lib/brief'
import { aiSettings } from './lib/enrichQueue'
import { movesNow } from './mcp'
import { vBriefMove, vBriefSince } from './askSchema'
import { vModel, vUsage } from './validators'
import { sinceYesterday } from '../src/lib/brief'
import { todayIST } from '../src/lib/dates'
import { DAY_MS } from '../src/lib/google'
import { lastContact } from '../src/lib/pipeline'
import { LABEL } from '../src/lib/stages'

type Move = Infer<typeof vBriefMove>

/** Everything the brief needs, or null when today's is already written or the toggle is off. */
export const facts = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    const day = todayIST(now)
    if (await ctx.db.query('briefs').withIndex('by_day', (q) => q.eq('day', day)).first()) return null
    if (!(await aiSettings(ctx)).morningBrief) return null
    const from = now - DAY_MS
    const { investors, moves } = await movesNow(ctx, now)
    const meetings = await ctx.db
      .query('meetings')
      .withIndex('by_start', (q) => q.gte('start', from - DAY_MS).lte('start', now))
      .collect()
    const notes = []
    for (const id of new Set(meetings.flatMap((m) => m.investorIds)))
      for (const n of await ctx.db.query('notes').withIndex('by_investor', (q) => q.eq('investorId', id)).collect()) {
        if (n.removedAt) continue
        const reads = await ctx.db.query('noteReads').withIndex('by_note', (q) => q.eq('noteId', n._id)).collect()
        notes.push({ investorId: n.investorId, meetingId: n.meetingId, date: n.date, read: reads.some((r) => r.status !== 'reading' && r.status !== 'failed') })
      }
    const since = sinceYesterday({
      now,
      investors,
      threads: await ctx.db.query('emailTouches').withIndex('by_last', (q) => q.gte('lastAt', from)).collect(),
      materials: await ctx.db.query('materials').collect(),
      versions: await ctx.db.query('materialVersions').collect(),
      links: await ctx.db.query('shareLinks').collect(),
      views: (await ctx.db.query('views').collect()).filter((w) => w.startedAt >= from),
      meetings,
      notes,
      suggestions: await ctx.db.query('suggestions').withIndex('by_status', (q) => q.eq('status', 'open')).collect(),
    }) as Infer<typeof vBriefSince>
    const byId = new Map(investors.map((i) => [i._id as string, i]))
    const picked: Move[] = moves.slice(0, 3).map((m) => ({ key: m.key, title: m.title, why: m.why, ...('investorId' in m.action ? { investorId: m.action.investorId as Id<'investors'> } : {}) }))
    const facts: MoveFacts[] = picked.map((m) => {
      const i = m.investorId ? byId.get(m.investorId) : undefined
      if (!i) return { move: m.title, why: m.why, sinceYesterday: [] }
      const investor = {
        name: i.name, stage: LABEL[i.stage], ...(i.nextStep ? { nextStep: i.nextStep } : {}), ...(i.nextDate ? { nextDate: i.nextDate } : {}),
        ...(lastContact(i) ? { lastTouch: lastContact(i) } : {}), ...(i.expected ? { expected: i.expected } : {}), ...(i.committed ? { committed: i.committed } : {}),
      }
      return { move: m.title, why: m.why, investor, sinceYesterday: sinceLines(since, i._id) }
    })
    return { day, since, moves: picked, facts }
  },
})

/** Keep the first brief of the day; a second one for the same day is dropped. */
export const save = internalMutation({
  args: { day: v.string(), builtAt: v.number(), since: vBriefSince, moves: v.array(vBriefMove), costUsd: v.number(), model: v.optional(vModel), usage: v.optional(vUsage) },
  handler: async (ctx, b) => {
    const had = await ctx.db.query('briefs').withIndex('by_day', (q) => q.eq('day', b.day)).first()
    return had ? had._id : await ctx.db.insert('briefs', b)
  },
})

/** The 08:00 IST cron: build today's brief once. */
export const run = internalAction({
  args: {},
  handler: async (ctx): Promise<Id<'briefs'> | null> => {
    const now = Date.now()
    const job = await ctx.runQuery(internal.brief.facts, { now })
    if (!job) return null
    let moves = job.moves
    let cost = 0
    let used: { model: Model; usage: RunUsage } | undefined
    let ai = 'none'
    let failure = ''
    if (hasAIKey() && job.facts.length) {
      const model = await ctx.runQuery(internal.enrich.modelOf, { feature: 'brief' })
      try {
        const out = await complete({ model, system: REASONS_SYSTEM, prompt: reasonsPrompt(job.facts), maxTokens: 1000 })
        cost = out.costUsd
        used = { model, usage: usageRow(out.usage) }
        const reasons = parseReasons(out.text, job.facts)
        moves = moves.map((m, i) => (reasons[i] ? { ...m, reason: reasons[i] } : m))
        ai = reasons.filter(Boolean).length + '/' + moves.length
      } catch (e) {
        ai = 'failed'
        failure = ' error=' + errorTag(e)
      }
    }
    const id = await ctx.runMutation(internal.brief.save, { day: job.day, builtAt: now, since: job.since, moves, costUsd: cost, ...used })
    console.log('brief day=' + job.day + ' id=' + id + ' moves=' + moves.length + ' reasons=' + ai + ' cost=$' + cost.toFixed(5) + failure)
    return id
  },
})

/** Today's brief (IST), or null before 08:00, with the toggle off, or on a day it didn't run. */
export const today = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx)
    return await ctx.db.query('briefs').withIndex('by_day', (q) => q.eq('day', todayIST())).first()
  },
})

/** Dismiss (collapse to one line) or show it again. */
export const setDismissed = mutation({
  args: { id: v.id('briefs'), dismissed: v.boolean() },
  handler: async (ctx, { id, dismissed }) => {
    await requireUser(ctx)
    if (!(await ctx.db.get(id))) return null
    await ctx.db.patch(id, { dismissedAt: dismissed ? Date.now() : undefined })
    return null
  },
})
