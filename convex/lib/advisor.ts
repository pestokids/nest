// PST-307: the Advisor's prompt and tool loop. Claude (Sonnet by default, Opus
// when Dev picks it) gets Nest's read tools (the MCP server's, plus the Advisor's
// own in convex/advisorReads.ts), the draft, suggestion and memory tools, and the
// show_* tools that draw answer blocks (src/lib/advisorBlocks.ts); Anthropic's
// web search too when Settings › AI › Advisor has it on. It loops on tool_use,
// streaming text through onText, until it answers. The prompt is in code and
// holds no facts about the company: those only ever come from the tools.
// The tools and the system prompt carry cache marks, so later turns read them from the cache.
import { toolsFor } from '../../src/lib/agents'
import { MAX_TOOL_CALLS, type AdvisorMode, type Pinned, type ScreenContext } from '../../src/lib/advisor'
import { ACTION_TOOLS, SHOW_TOOLS } from '../../src/lib/advisorBlocks'
import { lookingAt } from '../../src/lib/advisor'
import { timeOf } from '../../src/lib/google'
import { todayIST, weekdayOf } from '../../src/lib/dates'
import { ADVISOR_READ_TOOLS } from '../advisorReads'
import { addUsage, AIError, converse, costOf, NO_THINKING, type Block, type Message, type Model, type ToolDef, type Usage } from './anthropic'

/** The MCP read tools the Advisor gets (the same handlers as the MCP server, convex/mcp.ts `read`). */
export const MCP_READS = toolsFor('read').map((t) => t.name)
/** Every tool, in a fixed order so the cached prefix stays the same between questions. */
export const ADVISOR_TOOLS: ToolDef[] = [
  ...toolsFor('read').map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })),
  ...ADVISOR_READ_TOOLS,
  ...ACTION_TOOLS,
  ...SHOW_TOOLS,
]
export const READ_TOOL_NAMES = new Set([...MCP_READS, ...ADVISOR_READ_TOOLS.map((t) => t.name)])
/** Anthropic's web search (a server tool): a few searches per answer at most. */
export const WEB_SEARCH = { type: 'web_search_20260318', name: 'web_search', max_uses: 3 }

/** The rule about numbers, word for word in the prompt (and checked by the tests). */
export const NUMBERS_GUARD = `Numbers
- Never invent a number. Every amount, percentage, date, count and name comes from a tool result or from the founder's own words in this chat.
- When a number is missing, write [__] where it goes and say in one line what's missing (for example: "[__] is your week-8 retention; Nest doesn't have it"). Use show_blank for the one that matters most.
- Never estimate, round up or borrow a "typical" number into the founder's story, an email or a plan.`

export const ADVISOR_SYSTEM = `You are the Advisor inside Nest, a tracker for a startup's fundraise. You are an expert guide to pre-seed and seed rounds, the kind who has run hundreds of raises, and a storyteller who helps founders say why their company matters. You talk with the founder.

How you work
- Read before you answer. Get the facts from Nest with the read tools: investors and their enrichment, notes, signals and decisions, emails Nest keeps, the round and plan, the race and lead, Q&A, materials, the Network, the Inbox and what you remember. Call them first, without writing anything, then write the answer once.
- Use web search only for public facts about firms, partners and the market, never for the company's own numbers.
- Be direct and honest. Say what you'd do and why, including when the news is bad. Don't flatter.
- Write in plain words and short sentences, the way the founder would talk to a friend. No headings or tables. Use "1. " lines for steps in order and **bold** sparingly.
- Ask at most one clarifying question, and only when a useful answer is impossible without it. Otherwise make the most sensible assumption, say it in a few words, and answer.
- Lead with the answer. Keep it short: about 150 words, unless you're writing a draft or a story.

${NUMBERS_GUARD}

Citing
- When you name an investor, write [[investor:<id>|<name>]] with the id from the tools, e.g. [[investor:k57abc|Kite Angels]]. Never make up an id; without one, write the name plainly.
- Nest shows what you read as "From:" chips under the answer, so don't list your sources. When a fact comes from the web, say so in the sentence.

Doing things
- You advise, draft and suggest. You never send, change, move or log anything yourself, and you never say you did.
- create_draft writes an email (it lands in Drafts), or a Q&A answer or story (the founder saves it to Q&A). Say so in one line.
- suggest_change proposes a decide-by date, a stage, a next step or an application status. It shows as a card; nothing changes until the founder accepts it in Suggestions.
- remember proposes keeping a lasting fact about the company or the founder's preferences that Nest doesn't already have. The founder is asked first.
- The show_* tools draw live pieces of Nest into the answer: an investor card, a plan the founder can tick, two or three options, the race, a story to reshape, a blank for a missing number. Use one or two when they help more than words, and don't repeat in text what a block shows.
- End every answer with show_follow_ups: three or four next questions written for this answer.`

export const MODE_PROMPT: Record<AdvisorMode, string> = {
  coach:
    'Mode: Coach. Focus on what to do next: who to put first and in what order, how to run the week, how to turn a maybe into a decision, and terms and allocation trade-offs. Make a call, give the reason, and name the next step with its day.',
  storyteller:
    "Mode: Storyteller. Focus on the story: the arc (hook, problem, insight, proof, why now, ask), pitch lines and emails in the founder's own voice, tailored to one investor and what they care about. Read that investor's notes and enrichment first, keep the founder's words where you can, and use show_story for an arc.",
}

/** The second system block: what changes per question. Never cached. */
export function advisorContext(o: { now: number; mode: AdvisorMode; memory: readonly string[]; pinned: readonly Pinned[]; screen?: ScreenContext | null }): string {
  const day = todayIST(o.now)
  const parts = [MODE_PROMPT[o.mode], 'It is ' + weekdayOf(day) + ' ' + day + ', ' + timeOf(o.now) + ' in India. All dates and times are India time (IST).']
  if (o.memory.length) parts.push('What you remember (the founder said yes to each):\n' + o.memory.map((m) => '- ' + m).join('\n'))
  if (o.pinned.length)
    parts.push('Pinned to this chat with + Context (read these first):\n' + o.pinned.map((p) => '- ' + (p.kind === 'investor' ? 'Investor ' + p.label + ' (id ' + p.id + ')' : 'Material ' + p.label)).join('\n'))
  if (o.screen) parts.push('The founder asked from the ⌘J panel while looking at: ' + lookingAt(o.screen) + (o.screen.investorId ? ' (investor id ' + o.screen.investorId + ')' : '') + '. Answer about that screen unless they ask about something else.')
  return parts.join('\n\n')
}

export type ToolResult = { content: string; isError?: boolean }
export type WebSource = { url: string; title: string }

/** The latest tool results carry the cache mark (one at a time), so each turn reads the conversation so far from the cache. */
function markLatest(messages: Message[]) {
  for (const m of messages) if (Array.isArray(m.content)) for (const b of m.content as Record<string, unknown>[]) delete b.cache_control
  const last = messages[messages.length - 1]?.content
  if (Array.isArray(last) && last.length) (last[last.length - 1] as Record<string, unknown>).cache_control = { type: 'ephemeral' }
}

/** Web pages an answer used: the ones its text cites, else every result its searches returned. */
function webSourcesOf(blocks: readonly Block[]): WebSource[] {
  const cited: WebSource[] = []
  const found: WebSource[] = []
  for (const b of blocks) {
    if (b.type === 'text') for (const c of (b.citations as { url?: string; title?: string }[] | undefined) ?? []) if (c?.url) cited.push({ url: c.url, title: c.title ?? c.url })
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) for (const r of b.content as { url?: string; title?: string }[]) if (r?.url) found.push({ url: r.url, title: r.title ?? r.url })
  }
  return cited.length ? cited : found
}

/**
 * One answer. Text streams through onText. When a turn calls read tools, its
 * text was only a preamble: onTurn says so and it's dropped; a turn that only
 * shows blocks or drafts keeps its text. A turn cut off at max_tokens (thinking
 * can use up the room) is asked once more, to answer with what it has. After
 * MAX_TOOL_CALLS calls, or when `budget` says the cap is near, Claude must answer
 * with what it has. Returns the usage, the cost (each request priced on its own)
 * and the web pages it used.
 */
export async function advisorLoop(o: {
  model: Model
  context: string
  messages: Message[]
  web: boolean
  callTool: (name: string, input: unknown) => Promise<ToolResult>
  onText?: (delta: string) => unknown
  /** A turn ended; `tools` are the tools it called (none: it was the answer). */
  onTurn?: (tools: string[]) => unknown
  onCost?: (usd: number, usage: Usage) => unknown
  /** False once another turn might pass the cap: Claude answers with what it has. `lastTurnUsd` is what the latest turn cost. */
  budget?: (spentUsd: number, lastTurnUsd: number) => boolean
  signal?: AbortSignal
}): Promise<{ usage: Usage; costUsd: number; web: WebSource[] }> {
  const messages = [...o.messages]
  let calls = 0
  let usage: Usage = {}
  let costUsd = 0
  let cutOff = false
  let paused = 0
  let lastTurn = 0
  const web: WebSource[] = []
  for (;;) {
    const last = cutOff || calls >= MAX_TOOL_CALLS || (o.budget && lastTurn ? !o.budget(costUsd, lastTurn) : false)
    const r = await converse({
      model: o.model, system: ADVISOR_SYSTEM, context: o.context, messages, tools: ADVISOR_TOOLS, serverTools: o.web ? [WEB_SEARCH] : [], cacheTools: true,
      thinking: NO_THINKING[o.model], toolChoice: last ? 'none' : 'auto', maxTokens: 8000, hooks: { onText: o.onText, signal: o.signal },
    })
    usage = addUsage(usage, r.usage)
    lastTurn = costOf(r.usage, o.model)
    costUsd += lastTurn
    await o.onCost?.(costUsd, usage)
    web.push(...webSourcesOf(r.blocks))
    if (r.stop === 'max_tokens') {
      if (last) throw new AIError(200, 'ran out of room before answering', 'max_tokens')
      cutOff = true
      await o.onTurn?.(['(retry)'])
      continue
    }
    if (r.stop === 'pause_turn') {
      if (++paused > 3) throw new AIError(200, 'kept pausing without an answer', 'pause_turn')
      messages.push({ role: 'assistant', content: r.blocks })
      continue
    }
    const uses = last ? [] : r.blocks.filter((b) => b.type === 'tool_use')
    await o.onTurn?.(uses.map((u) => String(u.name)))
    if (!uses.length) return { usage, costUsd, web }
    messages.push({ role: 'assistant', content: r.blocks })
    const results: Block[] = []
    for (const u of uses) {
      if (calls >= MAX_TOOL_CALLS) {
        results.push({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: 'No more tool calls for this answer: answer with what you have.' })
        continue
      }
      calls++
      const out = await o.callTool(String(u.name), u.input)
      results.push({ type: 'tool_result', tool_use_id: u.id, content: out.content, ...(out.isError ? { is_error: true } : {}) })
    }
    messages.push({ role: 'user', content: results })
    markLatest(messages)
  }
}
