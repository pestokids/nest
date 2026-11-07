// PST-276: the Nest MCP server's keys and call log (convex/agents.ts, convex/mcpHttp.ts).
import { defineTable } from 'convex/server'
import { v } from 'convex/values'

export const vAgentScope = v.union(v.literal('read'), v.literal('suggest'))

export const agentTables = {
  // One key per agent ("Grok Bot"). Only the SHA-256 of the key is stored, never the key itself.
  agentKeys: defineTable({
    name: v.string(),
    scope: vAgentScope,
    /** SHA-256 of the full key, hex. */
    hash: v.string(),
    /** The first 8 characters after nest_ak_, for display. */
    prefix: v.string(),
    createdBy: v.id('users'),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  }).index('by_hash', ['hash']),

  // Every call an agent makes: which key, which tool, when, whether it worked and how long it took. Never arguments or results.
  agentCalls: defineTable({
    keyId: v.id('agentKeys'),
    /** The tool, or the method for anything else (initialize, tools/list…). Empty until the call finishes. */
    tool: v.string(),
    at: v.number(),
    ok: v.boolean(),
    ms: v.number(),
  }).index('by_key_at', ['keyId', 'at']),
}
