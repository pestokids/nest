// PST-276: Settings › Agents (keys, Activity, Revoke) and what the Nest MCP server
// (mcpHttp.ts) checks on every call: the key (by its SHA-256), revoked or not, and
// about 60 calls a minute. Each call is logged in agentCalls with the tool, time,
// whether it worked and how long it took; never arguments or results.
import { ConvexError, v } from 'convex/values'
import { internalMutation, mutation, query } from './_generated/server'
import { requireUser } from './lib/access'
import { hashKey, newKey } from './lib/agentKey'
import { vAgentScope } from './agentsSchema'
import { ACTIVITY_LIMIT, isToolCall, MCP_PATH, NAME_MAX, RATE_LIMIT, RATE_WINDOW_MS } from '../src/lib/agents'
import { DAY_MS } from '../src/lib/google'

/**
 * Where agents connect. Production's SITE_URL is https://nest.pestokids.com, which
 * rewrites /mcp to this deployment (vercel.json); anywhere else (local dev, the
 * dev deployment) it's this deployment's own .convex.site URL.
 */
export function serverUrl(): string {
  const site = process.env.SITE_URL?.trim().replace(/\/+$/, '')
  if (site?.startsWith('https://')) return site + MCP_PATH
  return (process.env.CONVEX_SITE_URL ?? '').replace(/\/+$/, '') + MCP_PATH
}

/** Live keys, oldest first, with the last time each was used and its tool calls in the last 7 days. Never a key or its hash. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx)
    const since = Date.now() - 7 * DAY_MS
    const keys = []
    for (const k of await ctx.db.query('agentKeys').collect()) {
      if (k.revokedAt) continue
      const calls = await ctx.db
        .query('agentCalls')
        .withIndex('by_key_at', (q) => q.eq('keyId', k._id).gte('at', since))
        .collect()
      keys.push({ _id: k._id, name: k.name, scope: k.scope, prefix: k.prefix, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt, calls7d: calls.filter((c) => isToolCall(c.tool)).length })
    }
    return { serverUrl: serverUrl(), keys }
  },
})

/** Activity: a key's last 50 calls, newest first. */
export const activity = query({
  args: { keyId: v.id('agentKeys') },
  handler: async (ctx, { keyId }) => {
    await requireUser(ctx)
    const rows = await ctx.db
      .query('agentCalls')
      .withIndex('by_key_at', (q) => q.eq('keyId', keyId))
      .order('desc')
      .take(ACTIVITY_LIMIT)
    return rows.map(({ _id, tool, at, ok, ms }) => ({ _id, tool, at, ok, ms }))
  },
})

/** Create a key. The key comes back this once and is never stored: only its SHA-256 and the 8 characters after nest_ak_. */
export const create = mutation({
  args: { name: v.string(), scope: vAgentScope },
  handler: async (ctx, { name, scope }) => {
    const { userId } = await requireUser(ctx)
    const clean = name.trim().replace(/\s+/g, ' ').slice(0, NAME_MAX)
    if (!clean) throw new ConvexError('Give the agent a name.')
    const { key, prefix } = newKey()
    const id = await ctx.db.insert('agentKeys', { name: clean, scope, hash: await hashKey(key), prefix, createdBy: userId, createdAt: Date.now() })
    return { id, key, name: clean, scope }
  },
})

/** Revoke a key: the next call with it is refused. The row and its calls stay. */
export const revoke = mutation({
  args: { id: v.id('agentKeys') },
  handler: async (ctx, { id }) => {
    await requireUser(ctx)
    const k = await ctx.db.get(id)
    if (!k || k.revokedAt) return null
    await ctx.db.patch(id, { revokedAt: Date.now() })
    return id
  },
})

/* ---------- for the MCP server ---------- */

/**
 * Every MCP request starts here: the key by its hash (unknown and revoked keys
 * are refused), then at most RATE_LIMIT calls in the last minute. An allowed
 * call is logged straight away, so calls in flight count too; finishCall fills
 * in the tool, the outcome and the time.
 */
export const authorize = internalMutation({
  args: { hash: v.string() },
  handler: async (ctx, { hash }) => {
    const k = await ctx.db
      .query('agentKeys')
      .withIndex('by_hash', (q) => q.eq('hash', hash))
      .unique()
    if (!k || k.revokedAt) return { ok: false as const, reason: 'unauthorized' as const }
    const now = Date.now()
    const recent = await ctx.db
      .query('agentCalls')
      .withIndex('by_key_at', (q) => q.eq('keyId', k._id).gt('at', now - RATE_WINDOW_MS))
      .take(RATE_LIMIT)
    if (recent.length >= RATE_LIMIT) return { ok: false as const, reason: 'limited' as const, retryAfter: Math.max(1, Math.ceil((recent[0].at + RATE_WINDOW_MS - now) / 1000)) }
    const callId = await ctx.db.insert('agentCalls', { keyId: k._id, tool: '', at: now, ok: false, ms: 0 })
    await ctx.db.patch(k._id, { lastUsedAt: now })
    return { ok: true as const, callId, key: { id: k._id, name: k.name, scope: k.scope } }
  },
})

export const finishCall = internalMutation({
  args: { callId: v.id('agentCalls'), tool: v.string(), ok: v.boolean(), ms: v.number() },
  handler: async (ctx, { callId, tool, ok, ms }) => {
    await ctx.db.patch(callId, { tool: tool.slice(0, 40), ok, ms: Math.max(0, Math.round(ms)) })
  },
})
