// PST-279: Ask Nest's tool loop. Claude (Sonnet, no web tools) gets Nest's read
// tools: the same definitions the MCP server lists (src/lib/agents.ts), run by the
// same handlers (mcp.ts `read`, through the caller's callTool). It loops on
// tool_use until it answers, with at most MAX_TOOL_CALLS calls; after the last one
// it must answer with what it has. The prompt asks for [[investor:<id>|Name]]
// citations and [[action:…]] lines (src/lib/ask.ts reads them).
import { toolsFor } from '../../src/lib/agents'
import { DONT_KNOW, MAX_TOOL_CALLS } from '../../src/lib/ask'
import { timeOf } from '../../src/lib/google'
import { todayIST } from '../../src/lib/dates'
import { addUsage, AIError, converse, costOf, MODEL, type Block, type Message, type ToolDef, type Usage } from './anthropic'

/** The read tools, as Claude is given them. The last one carries the cache mark, so the tools and the system prompt are cached between turns. */
export const ASK_TOOLS: ToolDef[] = toolsFor('read').map((t, i, all) => ({
  name: t.name,
  description: t.description,
  input_schema: t.inputSchema,
  ...(i === all.length - 1 ? { cache_control: { type: 'ephemeral' } } : {}),
}))

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function askSystem(now: number): string {
  const day = todayIST(now)
  return `You are Nest, the tracker for Pesto's pre-seed raise. Dev, the founder, asks you questions in Nest's search box. Answer from Nest's data, which you read with the tools. You can only read: you can't change, send, log or move anything, and you never say you did.

It is ${WEEKDAYS[new Date(day + 'T00:00:00Z').getUTCDay()]} ${day}, ${timeOf(now)} in India. All dates and times are India time (IST).

How to answer
- Call the tools you need first, without writing anything. Then write the answer once.
- Lead with the answer and keep it short: about 100 words at most.
- Plain sentences. For people in an order, use "1. " lines. No headings, tables or links.
- Every number, amount, date and name must come from a tool result. Never estimate, round up or invent one. If the tools don't say, answer "${DONT_KNOW}" and say in a few words what's missing.
- Amounts in US dollars, short: $50K, $1.2M.

Investors
- Every time you name an investor, write [[investor:<id>|<name>]] with the id from the tools, e.g. [[investor:k57abc|Kite Angels]]. Never make up an id; without one, write the name plainly.

Actions
- When the answer points to something Dev should do in Nest, end with up to three action lines, each alone on its line:
  [[action:open|<investorId>]] opens that investor
  [[action:prep|<meetingId>]] opens the prep brief for a meeting (the meeting id from meetings_between or todays_moves)
  [[action:draft|<investorId>]] opens Nest's email draft for that investor (Dev reviews it; nothing is sent)
  [[action:ask|<investorId>]] logs that Dev asked them for a specific amount
- Only these four. Dev clicks them; you don't do them.

Where to start
- "Who should I chase today?": todays_moves.
- "How much is verbal but not signed?": round_totals (verbalNotSigned and who is in it).
- "Prep me for my 4pm", or any meeting: meetings_between for today, pick the meeting at that time, then get_investor for who it's with. Answer in two or three lines (who they are, what's open) and add [[action:prep|<meetingId>]]. If there's no meeting then, say so.
- "Who hasn't seen deck v4?": material_opens with material "deck" and version 4.`
}

export type ToolResult = { content: string; isError?: boolean }

/** The latest tool results carry the cache mark (one at a time), so each turn reads the conversation so far from the cache. */
function markLatest(messages: Message[]) {
  for (const m of messages)
    if (Array.isArray(m.content)) for (const b of m.content as Record<string, unknown>[]) delete b.cache_control
  const last = messages[messages.length - 1]?.content
  if (Array.isArray(last) && last.length) (last[last.length - 1] as Record<string, unknown>).cache_control = { type: 'ephemeral' }
}

/**
 * Ask one question. Text streams through onText; when a turn turns out to call
 * tools, onTool says so (that turn's text was only a preamble). Returns the
 * answer, the read tools it called and what it cost.
 */
export async function askLoop(o: {
  question: string
  system: string
  callTool: (name: string, input: unknown) => Promise<ToolResult>
  onText?: (delta: string) => unknown
  /** A turn is calling tools (its text so far was only a preamble). */
  onTool?: (name: string) => unknown
  /** The cost so far, after every turn (so a run that fails later still logs it). */
  onCost?: (usd: number) => unknown
}): Promise<{ text: string; calls: string[]; usage: Usage; costUsd: number }> {
  const messages: Message[] = [{ role: 'user', content: o.question }]
  const calls: string[] = []
  let usage: Usage = {}
  for (;;) {
    const last = calls.length >= MAX_TOOL_CALLS
    const r = await converse({ model: MODEL, system: o.system, messages, tools: ASK_TOOLS, toolChoice: last ? 'none' : 'auto', hooks: { onText: o.onText } })
    usage = addUsage(usage, r.usage)
    await o.onCost?.(costOf(usage, MODEL))
    if (r.stop === 'max_tokens') throw new AIError(200, 'ran out of room before answering')
    const uses = r.blocks.filter((b) => b.type === 'tool_use')
    if (!uses.length || last) {
      const text = r.blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim()
      return { text: text || DONT_KNOW, calls, usage, costUsd: costOf(usage, MODEL) }
    }
    messages.push({ role: 'assistant', content: r.blocks })
    const results: Block[] = []
    for (const u of uses) {
      if (calls.length >= MAX_TOOL_CALLS) {
        results.push({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: 'No more lookups for this question: answer with what you have.' })
        continue
      }
      const name = String(u.name)
      calls.push(name)
      await o.onTool?.(name)
      const out = await o.callTool(name, u.input)
      results.push({ type: 'tool_result', tool_use_id: u.id, content: out.content, ...(out.isError ? { is_error: true } : {}) })
    }
    messages.push({ role: 'user', content: results })
    markLatest(messages)
  }
}
