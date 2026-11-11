// PST-307: the Advisor's read tools that the MCP server doesn't have: one
// investor's notes, signals, decision and intros; the email threads Nest keeps
// (subjects and who wrote last, never bodies); the round and plan; the race and
// lead; the Network; the Inbox; materials with their version notes; and what the
// Advisor remembers. One internal query, so a call can only read. Each read says
// what it looked at as "From:" chips (src/lib/advisor.ts Source).
import { v } from 'convex/values'
import { internalQuery, type QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { decisionFor } from './decisions'
import { loadRound, getRoundRow } from './lib/round'
import { movesNow } from './mcp'
import { shortName, type Source } from '../src/lib/advisor'
import { formatDay, todayIST } from '../src/lib/dates'
import { DAY_MS, dayOf, timeOf } from '../src/lib/google'
import { KIND_LABEL } from '../src/lib/materials'
import { dueList, quietList } from '../src/lib/pipeline'
import { goalLabel } from '../src/lib/plan'
import { canLeadOf, kickoffPhase, raceLanes, raceWindow, slowDown } from '../src/lib/race'
import { currentPhase } from '../src/lib/round'
import { LABEL } from '../src/lib/stages'
import { RELATION_LABEL, STEP_SHORT, STEPS } from '../src/lib/introducers'
import type { Investor } from '../src/lib/pipeline'
import type { ToolDef } from './lib/anthropic'

type Out = { ok: true; data: Record<string, unknown>; sources: Source[] } | { ok: false; error: string }
const done = (data: Record<string, unknown>, sources: Source[] = []): Out => ({ ok: true, data, sources })
const nope = (error: string): Out => ({ ok: false, error })
const NO_INVESTOR = 'There’s no investor with that id. Use search_investors to find the right one.'
const ID = { type: 'string', minLength: 1, maxLength: 64, description: 'The investor id from search_investors.' }
const NOTE_CHARS = 1500

/** The Advisor's own read tools, as Claude is given them (the MCP read tools come first; see convex/lib/advisor.ts). */
export const ADVISOR_READ_TOOLS: ToolDef[] = [
  {
    name: 'investor_detail',
    description: 'One investor’s meeting notes (newest first, the text Dev saved), the signals Nest read from their emails and notes (what they asked for, how keen), their decision (status, reason, decide-by date, calls so far) and who can introduce Dev. Use with get_investor.',
    input_schema: { type: 'object', properties: { id: ID }, required: ['id'], additionalProperties: false },
  },
  {
    name: 'recent_emails',
    description: 'Email threads with investors Nest keeps: subject, who wrote last, the day, and whether Dev owes a reply. Never the bodies (Nest doesn’t store them). Optionally one investor, and how many days back (default 14, at most 60).',
    input_schema: { type: 'object', properties: { investorId: ID, days: { type: 'integer', description: 'Days back, 1 to 60.' } }, additionalProperties: false },
  },
  {
    name: 'round_plan',
    description: 'The round: target, stretch, instrument, cap and minimum check, the deadline, the round’s lead, and the plan’s phases (dates, goals, which one is now).',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'race',
    description: 'The race this week (or kickoff week): every firm from booked to offer, furthest first, with their 1st meeting, decide-by date and whether they can lead; the lead; and the “slow down” note when one firm is a stage ahead.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'network',
    description: 'The Network: founders, friends, advisors and angels who can introduce Dev, with how Dev knows them and the investors on each one’s list (and how far each intro got). Optionally filter by words in the name or company.',
    input_schema: { type: 'object', properties: { query: { type: 'string', maxLength: 60, description: 'Words in the person’s name or company.' } }, additionalProperties: false },
  },
  {
    name: 'inbox',
    description: 'Today’s Inbox: next steps due or late, investors gone quiet, decide-by dates passed, emails Dev owes a reply to, asks Nest found in emails, and today’s meetings.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'materials',
    description: 'The pitch deck, memo, one-pager, model and data room: each with its versions and the note Dev wrote on each version (what changed). Not the files themselves.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'memory',
    description: 'Facts Dev said yes to remembering, about the company and how Dev likes to work.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
]
export const ADVISOR_READ_NAMES = new Set(ADVISOR_READ_TOOLS.map((t) => t.name))

async function investorById(ctx: QueryCtx, raw: unknown) {
  const id = typeof raw === 'string' ? ctx.db.normalizeId('investors', raw) : null
  return id ? await ctx.db.get(id) : null
}

async function investorDetail(ctx: QueryCtx, a: Record<string, unknown>): Promise<Out> {
  const i = await investorById(ctx, a.id)
  if (!i) return nope(NO_INVESTOR)
  const now = Date.now()
  const notes = (await ctx.db.query('notes').withIndex('by_investor', (q) => q.eq('investorId', i._id)).collect())
    .filter((n) => !n.removedAt)
    .sort((x, y) => y.date.localeCompare(x.date))
    .slice(0, 6)
  const signals = (await ctx.db.query('signals').withIndex('by_investor', (q) => q.eq('investorId', i._id)).order('desc').take(10)).filter((s) => !s.undoneAt)
  const decision = await decisionFor(ctx, i._id, now)
  const intros = await ctx.db.query('intros').withIndex('by_investor', (q) => q.eq('investorId', i._id)).collect()
  const via = []
  for (const x of intros) {
    const who = x.introducerId ? await ctx.db.get(x.introducerId) : x.viaInvestorId ? await ctx.db.get(x.viaInvestorId) : null
    if (who) via.push({ name: who.name, done: STEPS.filter((s) => x.steps[s]).map((s) => STEP_SHORT[s]) })
  }
  const sources: Source[] = notes.length ? [{ kind: 'notes', label: shortName(i.name) + ' · notes ' + formatDay(notes[0].date).split(' ').slice(1).join(' '), investorId: i._id }] : []
  if (signals.length) sources.push({ kind: 'signals', label: shortName(i.name) + ' · signals', investorId: i._id })
  if (decision?.status || decision?.decideBy) sources.push({ kind: 'decision', label: shortName(i.name) + ' · decision', investorId: i._id })
  return done(
    {
      investor: { id: i._id, name: i.name, stage: LABEL[i.stage] },
      notes: notes.map((n) => ({ date: n.date, title: n.title ?? null, text: n.text.length > NOTE_CHARS ? n.text.slice(0, NOTE_CHARS) + '…' : n.text })),
      signals: signals.map((s) => ({ day: s.day, from: s.source, asked: s.answers.ask ?? null, status: s.answers.status ?? null, interest: s.answers.score ?? null, outcome: s.outcome })),
      decision: decision ? { status: decision.status ?? null, reason: decision.reason ?? null, decideBy: decision.decideBy ?? null, calls: decision.calls, firstMeeting: decision.firstMeeting ?? null } : null,
      application: i.application ?? null,
      introducedBy: via,
    },
    sources,
  )
}

async function recentEmails(ctx: QueryCtx, a: Record<string, unknown>): Promise<Out> {
  const who = a.investorId === undefined ? null : await investorById(ctx, a.investorId)
  if (a.investorId !== undefined && !who) return nope(NO_INVESTOR)
  const days = typeof a.days === 'number' ? Math.min(60, Math.max(1, Math.round(a.days))) : 14
  const now = Date.now()
  const threads = (await ctx.db.query('emailTouches').withIndex('by_last', (q) => q.gte('lastAt', now - days * DAY_MS)).collect())
    .filter((t) => t.investorIds.length && (!who || t.investorIds.includes(who._id)))
    .sort((x, y) => y.lastAt - x.lastAt)
    .slice(0, 40)
  const names = new Map<string, string>()
  for (const t of threads) for (const id of t.investorIds) if (!names.has(id)) names.set(id, (await ctx.db.get(id))?.name ?? '')
  return done(
    {
      days,
      threads: threads.map((t) => ({
        subject: t.subject, day: dayOf(t.lastAt), lastFrom: t.lastFrom === 'us' ? 'Dev' : 'them', messages: t.count, replyOwed: !!t.owed,
        investors: t.investorIds.map((id) => ({ id, name: names.get(id) })).filter((x) => x.name),
      })),
    },
    who ? [{ kind: 'emails', label: shortName(who.name) + ' · emails', investorId: who._id }] : threads.length ? [{ kind: 'emails', label: 'Emails · last ' + days + ' days' }] : [],
  )
}

async function roundPlan(ctx: QueryCtx): Promise<Out> {
  const { round, exists } = await loadRound(ctx)
  const today = todayIST()
  const leadId = (await getRoundRow(ctx))?.leadId
  const lead = leadId ? await ctx.db.get(leadId) : null
  const now = currentPhase(round, today)
  return done(
    {
      set: exists,
      target: round.target, stretch: round.stretch, instrument: round.instrument, cap: round.cap ?? null, minCheck: round.minCheck ?? null, deadline: round.deadline, kickoff: round.kickoff,
      lead: lead ? { id: lead._id, name: lead.name } : null,
      phases: round.phases.map((p) => ({ name: p.name, from: p.from, to: p.to, goal: goalLabel(round, p), line: p.goal ?? null, now: p === now })),
      note: 'Amounts in US dollars. A field that is null isn’t set: say so, never guess it.',
    },
    [{ kind: 'plan', label: 'Plan · ' + (now ? now.name : 'round') }],
  )
}

async function race(ctx: QueryCtx): Promise<Out> {
  const t = Date.now()
  const today = todayIST(t)
  const { round } = await loadRound(ctx)
  const investors = (await ctx.db.query('investors').collect()) as unknown as Investor[]
  const acts = await ctx.db.query('activities').withIndex('by_date').order('desc').take(2000)
  const meetings = (await ctx.db.query('meetings').withIndex('by_start', (q) => q.gte('start', t - 60 * DAY_MS)).collect()).filter((m) => m.investorIds.length)
  const rows = await ctx.db.query('decisions').collect()
  const byId = new Map<string, Doc<'decisions'>>(rows.map((r) => [r.investorId, r]))
  const lanes = raceLanes({ investors, acts: acts as never, meetings: meetings as never, round, today, decision: (id) => byId.get(id) })
  const slow = slowDown(lanes, today)
  const w = raceWindow(round, today)
  const leadId = (await getRoundRow(ctx))?.leadId ?? null
  const k = kickoffPhase(round)
  return done(
    {
      window: w.kind === 'kickoff' ? 'kickoff week' : 'this week',
      days: w.days,
      kickoff: k ? { from: k.from, to: k.to } : null,
      leadId,
      lanes: lanes.map((l) => ({ id: l.investor._id, name: l.investor.name, stage: LABEL[l.stage], firstMeeting: l.firstMeeting ?? null, decideBy: l.decideBy ?? null, canLead: canLeadOf(l.investor).on })),
      slowDown: slow ? slow.text : null,
    },
    [{ kind: 'race', label: 'Race · ' + (w.kind === 'kickoff' ? 'kickoff week' : 'this week') }],
  )
}

async function network(ctx: QueryCtx, a: Record<string, unknown>): Promise<Out> {
  const words = String(a.query ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  const people = (await ctx.db.query('introducers').collect()).filter((p) => words.every((w) => (p.name + ' ' + (p.company ?? '')).toLowerCase().includes(w)))
  const intros = await ctx.db.query('intros').collect()
  const out = []
  for (const p of people.slice(0, 40)) {
    const list = []
    for (const x of intros.filter((y) => y.introducerId === p._id)) {
      const i = await ctx.db.get(x.investorId)
      if (i) list.push({ id: i._id, name: i.name, stage: LABEL[i.stage], done: STEPS.filter((s) => x.steps[s]).map((s) => STEP_SHORT[s]) })
    }
    const rel = p.relation === 'portfolio' ? 'founder' : p.relation
    out.push({ name: p.name, relation: RELATION_LABEL[rel], company: p.company ?? null, notes: p.notes || null, canIntroduce: list })
  }
  return done({ count: people.length, people: out }, people.length ? [{ kind: 'network', label: 'Network' + (people.length === 1 ? ' · ' + shortName(people[0].name) : '') }] : [])
}

async function inbox(ctx: QueryCtx): Promise<Out> {
  const now = Date.now()
  const { today, round, investors, moves } = await movesNow(ctx, now)
  const names = new Map<string, string>(investors.map((i) => [i._id, i.name]))
  const signals = (await ctx.db.query('signals').withIndex('by_at', (q) => q.gte('at', now - 30 * DAY_MS)).collect()).filter((s) => !s.undoneAt)
  const owed = (await ctx.db.query('emailTouches').withIndex('by_last', (q) => q.gte('lastAt', now - 30 * DAY_MS)).collect()).filter((t) => t.owed && t.investorIds.length)
  const from = Date.parse(today + 'T00:00:00+05:30')
  const meetings = (await ctx.db.query('meetings').withIndex('by_start', (q) => q.gte('start', from).lt('start', from + DAY_MS)).collect()).filter((m) => m.investorIds.length)
  const rows = await ctx.db.query('decisions').collect()
  return done(
    {
      today,
      dueOrLate: dueList(investors, today).map((i) => ({ id: i._id, name: i.name, nextStep: i.nextStep, due: i.nextDate ?? null })),
      goneQuiet: quietList(investors, today, round.quietDays).map((i) => ({ id: i._id, name: i.name, stage: LABEL[i.stage] })),
      decideByPassed: rows.filter((r) => r.decideBy && r.decideBy < today && names.has(r.investorId) && r.status !== 'no').map((r) => ({ id: r.investorId, name: names.get(r.investorId), decideBy: r.decideBy })),
      repliesOwed: owed.map((t) => ({ subject: t.subject, since: dayOf(t.owed!.at), investors: t.investorIds.map((id) => names.get(id)).filter(Boolean) })),
      asks: signals.filter((s) => s.asked && !s.askDoneAt).map((s) => ({ id: s.investorId, name: names.get(s.investorId), asked: s.asked, day: s.day })),
      toDecide: signals.filter((s) => s.outcome === 'decide' && !s.doneAt && s.change).map((s) => ({ id: s.investorId, name: names.get(s.investorId), proposes: s.change!.to, reason: s.change!.reason ?? null })),
      meetingsToday: meetings.sort((x, y) => x.start - y.start).map((m) => ({ title: m.title, time: timeOf(m.start) + ' IST', investors: m.investorIds.map((id) => names.get(id)).filter(Boolean) })),
      nextMoves: moves.map((m) => ({ title: m.title, why: m.why })),
    },
    [{ kind: 'inbox', label: 'Inbox · today' }],
  )
}

async function materials(ctx: QueryCtx): Promise<Out> {
  const all = await ctx.db.query('materials').collect()
  const out = []
  for (const m of all) {
    const versions = await ctx.db.query('materialVersions').withIndex('by_material', (q) => q.eq('materialId', m._id)).collect()
    const current = versions.find((x) => x._id === m.currentVersionId)
    out.push({ title: m.title, kind: KIND_LABEL[m.kind], current: current ? 'v' + current.n : null, pages: current?.pages ?? null, versions: versions.map((x) => ({ version: 'v' + x.n, on: dayOf(x.createdAt), note: x.note || null })) })
  }
  const deck = all.find((m) => m.kind === 'deck')
  const deckV = deck ? out.find((x) => x.title === deck.title)?.current : null
  return done({ materials: out }, out.length ? [{ kind: 'materials', label: deck && deckV ? 'Materials · Deck ' + deckV : 'Materials' }] : [])
}

async function memory(ctx: QueryCtx): Promise<Out> {
  const facts = await ctx.db.query('advisorMemory').withIndex('by_created').order('desc').take(60)
  return done({ facts: facts.map((f) => f.fact) }, facts.length ? [{ kind: 'memory', label: 'Memory' }] : [])
}

export const read = internalQuery({
  args: { tool: v.string(), args: v.any() },
  handler: async (ctx, { tool, args }): Promise<Out> => {
    const a = (args ?? {}) as Record<string, unknown>
    if (tool === 'investor_detail') return await investorDetail(ctx, a)
    if (tool === 'recent_emails') return await recentEmails(ctx, a)
    if (tool === 'round_plan') return await roundPlan(ctx)
    if (tool === 'race') return await race(ctx)
    if (tool === 'network') return await network(ctx, a)
    if (tool === 'inbox') return await inbox(ctx)
    if (tool === 'materials') return await materials(ctx)
    if (tool === 'memory') return await memory(ctx)
    return nope(tool + ' isn’t a read tool.')
  },
})

/** Names for the chips of the MCP read tools' results. */
export async function chipsForMcp(ctx: QueryCtx, tool: string, ids: readonly string[]): Promise<Source[]> {
  if (tool === 'get_investor') {
    const out: Source[] = []
    for (const raw of ids.slice(0, 1)) {
      const id = ctx.db.normalizeId('investors', raw) as Id<'investors'> | null
      const i = id ? await ctx.db.get(id) : null
      if (i) out.push({ kind: 'investor', label: shortName(i.name) + ' · enrichment', investorId: i._id })
    }
    return out
  }
  const fixed: Record<string, Source> = {
    todays_moves: { kind: 'inbox', label: 'Inbox · today' },
    list_questions: { kind: 'qanda', label: 'Q&A bank' },
    round_totals: { kind: 'round', label: 'Round · totals' },
    material_opens: { kind: 'materials', label: 'Materials · opens' },
    meetings_between: { kind: 'calendar', label: 'Calendar' },
  }
  return fixed[tool] ? [fixed[tool]] : []
}

/** The MCP read tools' chips, for the action. */
export const mcpChips = internalQuery({
  args: { tool: v.string(), ids: v.array(v.string()) },
  handler: (ctx, { tool, ids }) => chipsForMcp(ctx, tool, ids),
})
