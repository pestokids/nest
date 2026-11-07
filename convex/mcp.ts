// PST-276: the Nest MCP server's tools (the protocol is in mcpHttp.ts). The read
// tools are one internal query. Everything else is one internal mutation, and
// every write becomes a Suggestions row (source "agent", named after the key) that
// Dev accepts or dismisses: nothing an agent does changes the raise directly.
// enrich only starts the existing lookup, within its daily cap, and what it finds
// waits for review too. Arguments arrive checked against each tool's JSON Schema
// (src/lib/agents.ts checkArgs). Email bodies are never stored, so never returned.
import { v } from 'convex/values'
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { vAgentScope } from './agentsSchema'
import { insertSuggestion } from './suggestions'
import { sha256Hex } from './lib/agentKey'
import { hasAIKey } from './lib/anthropic'
import { CACHE_DAYS, capLeft, queue } from './lib/enrichQueue'
import { loadRound } from './lib/round'
import { parseAmount } from '../src/lib/agents'
import { dupKey } from '../src/lib/csv'
import { todayIST } from '../src/lib/dates'
import { fieldLabel, firmDomain } from '../src/lib/enrich'
import { addressesOf, contactSignals, DAY_MS, dayOf, domainOf, GENERIC_DOMAINS, isOurs, normEmail, timeOf } from '../src/lib/google'
import { dayLabel } from '../src/lib/investorView'
import { money } from '../src/lib/money'
import { dueDate, dueList, lastContact, quietFor, quietList } from '../src/lib/pipeline'
import { LABEL, STAGE_KEYS, STAGE_TILE, TOUCH_LABEL, WARM, type TouchKind } from '../src/lib/stages'
import type { SuggestionKind, SuggestionPatch } from '../src/lib/suggestions'
import { nextMoves } from '../src/lib/today'

type Out = { ok: true; data: Record<string, unknown> } | { ok: false; error: string }
type Args = Record<string, unknown>
const done = (data: Record<string, unknown>): Out => ({ ok: true, data })
const nope = (error: string): Out => ({ ok: false, error })
const NO_INVESTOR = 'There’s no investor with that id. Use search_investors to find the right one.'
const SIGNAL_DAYS = 120

async function investorById(ctx: QueryCtx, raw: unknown) {
  const id = typeof raw === 'string' ? ctx.db.normalizeId('investors', raw) : null
  return id ? await ctx.db.get(id) : null
}

/** Meetings that matched an investor (never anyone's unmatched ones, which only their owner sees) and email threads. */
async function signals(ctx: QueryCtx, now: number) {
  const meetings = (
    await ctx.db
      .query('meetings')
      .withIndex('by_start', (q) => q.gte('start', now - SIGNAL_DAYS * DAY_MS))
      .collect()
  ).filter((m) => m.investorIds.length)
  const threads = await ctx.db
    .query('emailTouches')
    .withIndex('by_last', (q) => q.gte('lastAt', now - SIGNAL_DAYS * DAY_MS))
    .collect()
  return { meetings, threads }
}

/** Every investor, with the email and meeting days that count as a touch (gone quiet, last touch). */
async function investorsWithContact(ctx: QueryCtx, now: number) {
  const investors = await ctx.db.query('investors').collect()
  const s = contactSignals(await signals(ctx, now), now)
  return investors.map((i) => ({ ...i, contact: s.get(i._id) }))
}
type Inv = Awaited<ReturnType<typeof investorsWithContact>>[number]

/** An investor in a list. */
const brief = (i: Inv) => ({
  id: i._id, name: i.name, firm: i.firm, stage: LABEL[i.stage], wave: i.wave, nextStep: i.nextStep || null, nextDate: i.nextDate ?? null, lastTouch: lastContact(i) ?? null,
})

/* ---------- read ---------- */

async function searchInvestors(ctx: QueryCtx, a: Args): Promise<Out> {
  const words = String(a.query ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  const found = (await investorsWithContact(ctx, Date.now()))
    .filter((i) => (!a.stage || i.stage === a.stage) && (!a.wave || i.wave === a.wave))
    .filter((i) => {
      const text = [i.name, i.firm, i.email ?? '', ...(i.emails ?? [])].join(' ').toLowerCase()
      return words.every((w) => text.includes(w))
    })
    .sort((x, y) => x.name.localeCompare(y.name))
  return done({
    count: found.length,
    investors: found.slice(0, 50).map(brief),
    ...(found.length > 50 ? { note: `Showing 50 of ${found.length}. Narrow it down with query, stage or wave.` } : {}),
  })
}

async function getInvestor(ctx: QueryCtx, a: Args): Promise<Out> {
  const i = await investorById(ctx, a.id)
  if (!i) return nope(NO_INVESTOR)
  const now = Date.now()
  const all = await signals(ctx, now)
  const meetings = all.meetings.filter((m) => m.investorIds.includes(i._id)).sort((x, y) => y.start - x.start)
  const threads = all.threads.filter((t) => t.investorIds.includes(i._id)).sort((x, y) => y.lastAt - x.lastAt)
  const contact = contactSignals({ meetings, threads }, now).get(i._id)
  const people = await ctx.db
    .query('people')
    .withIndex('by_investor', (q) => q.eq('investorId', i._id))
    .collect()
  const acts = await ctx.db
    .query('activities')
    .withIndex('by_investor', (q) => q.eq('investorId', i._id))
    .order('desc')
    .take(20)
  const facts = (
    await ctx.db
      .query('facts')
      .withIndex('by_investor', (q) => q.eq('investorId', i._id))
      .collect()
  ).filter((f) => f.status === 'kept')
  const asks = await ctx.db
    .query('questionAsks')
    .withIndex('by_investor', (q) => q.eq('investorId', i._id))
    .collect()
  const questions = []
  for (const ask of asks.sort((x, y) => y.date.localeCompare(x.date))) {
    const q = await ctx.db.get(ask.questionId)
    if (q && !q.removedAt && !q.mergedInto) questions.push({ question: q.text, theme: q.theme, asked: ask.date })
  }
  return done({
    investor: {
      id: i._id, name: i.name, firm: i.firm, type: i.type, geo: i.geo, warmth: WARM[i.warmth], warmPath: i.path || null, tier: i.tier, wave: i.wave,
      stage: LABEL[i.stage], lead: i.lead, expected: i.expected ?? null, committed: i.committed ?? null, nextStep: i.nextStep || null, nextDate: i.nextDate ?? null,
      lastTouch: lastContact({ lastTouch: i.lastTouch, contact }) ?? null, parkedUntil: i.parkedUntil ?? null,
      email: i.email ?? null, otherEmails: i.emails ?? [], domains: i.domains ?? [], notes: i.notes || null, source: i.source || null,
    },
    people: people
      .sort((x, y) => Number(y.primary) - Number(x.primary))
      .map((p) => ({ name: p.name, title: p.title, rank: p.rank, email: p.email, location: p.location, linkedin: p.linkedin, primary: p.primary })),
    history: acts.map((x) => ({
      date: x.date,
      what: x.kind === 'stage' ? `Moved to ${x.stage ? LABEL[x.stage] : 'a new stage'}` : (x.note ?? ''),
      ...(x.touch ? { kind: TOUCH_LABEL[x.touch] } : {}),
      ...(x.source ? { from: x.source === 'calendar' ? 'Calendar' : 'Gmail' } : {}),
    })),
    emails: threads.slice(0, 20).map((t) => ({ subject: t.subject, date: dayOf(t.lastAt), lastFrom: t.lastFrom === 'us' ? 'Pesto' : 'them', messages: t.count })),
    meetings: meetings.slice(0, 20).map((m) => ({ title: m.title, date: dayOf(m.start), time: timeOf(m.start) + ' IST', past: m.end <= now })),
    factsKept: facts.map((f) => ({ about: f.group, field: fieldLabel(f.group, f.field), value: f.value, source: f.source })),
    questionsAsked: questions,
  })
}

async function todaysMoves(ctx: QueryCtx): Promise<Out> {
  const now = Date.now()
  const today = todayIST(now)
  const { round } = await loadRound(ctx)
  const investors = await investorsWithContact(ctx, now)
  const acts = await ctx.db.query('activities').withIndex('by_date').order('desc').take(1000)
  const names = new Map<string, string>(investors.map((i) => [i._id, i.name]))
  const from = Date.parse(today + 'T00:00:00+05:30')
  const seen = new Set<string>()
  const meetings = (
    await ctx.db
      .query('meetings')
      .withIndex('by_start', (q) => q.gte('start', from).lt('start', from + DAY_MS))
      .collect()
  ).filter((m) => m.investorIds.length && !seen.has(m.eventId) && seen.add(m.eventId))
  return done({
    today,
    dueToday: dueList(investors, today).map((i) => ({ ...brief(i), due: dueDate(i) })),
    goneQuiet: quietList(investors, today, round.quietDays).map((i) => {
      const days = quietFor(i, today, round.quietDays)
      return { ...brief(i), quietFor: days === Infinity ? 'never touched' : `${days} days` }
    }),
    quietAfterDays: round.quietDays,
    meetingsToday: meetings.sort((x, y) => x.start - y.start).map((m) => ({ title: m.title, time: timeOf(m.start) + ' IST', investors: m.investorIds.map((id) => names.get(id)).filter(Boolean) })),
    nextMoves: nextMoves({ investors, acts, round, today }).map((m) => ({ title: m.title, why: m.why, ...('investorId' in m.action ? { investorId: m.action.investorId } : {}) })),
  })
}

async function listQuestions(ctx: QueryCtx, a: Args): Promise<Out> {
  const theme = typeof a.theme === 'string' ? a.theme.toLowerCase() : ''
  const questions = (await ctx.db.query('questions').collect())
    .filter((q) => !q.removedAt && !q.mergedInto && (!theme || q.theme.toLowerCase() === theme))
    .sort((x, y) => y.askedCount - x.askedCount || x.text.localeCompare(y.text))
  return done({
    count: questions.length,
    questions: questions.map((q) => ({ question: q.text, theme: q.theme, bestAnswer: q.bestAnswer.trim() || 'Needs an answer', timesAsked: q.askedCount, ...(q.slideRef ? { slide: q.slideRef } : {}) })),
  })
}

export const read = internalQuery({
  args: { tool: v.string(), args: v.any() },
  handler: async (ctx, { tool, args }): Promise<Out> => {
    if (tool === 'search_investors') return await searchInvestors(ctx, args)
    if (tool === 'get_investor') return await getInvestor(ctx, args)
    if (tool === 'todays_moves') return await todaysMoves(ctx)
    if (tool === 'list_questions') return await listQuestions(ctx, args)
    return nope(`${tool} isn’t a read tool.`)
  },
})

/* ---------- write: always a suggestion ---------- */

type Agent = { keyId: Id<'agentKeys'>; name: string }

/** The agent's sentence, with the investor's name in front when it doesn't say who. */
function about(i: { name: string; firm: string }, text: string) {
  const t = text.toLowerCase()
  return t.includes(i.name.toLowerCase()) || (i.firm && t.includes(i.firm.toLowerCase())) ? text : `${i.name}: ${text}`
}

/**
 * Queue one suggestion from an agent. Its key is a hash of what it suggests, so
 * the same suggestion is never queued twice and one Dev dismissed never comes back.
 */
async function suggest(ctx: MutationCtx, agent: Agent, s: { kind: SuggestionKind; investorId?: Id<'investors'>; title: string; fix: string; patch: SuggestionPatch }): Promise<Out> {
  const key = 'agent:' + (await sha256Hex(JSON.stringify([s.kind, s.investorId ?? '', s.patch]))).slice(0, 32)
  const id = await insertSuggestion(ctx, { ...s, source: 'agent', agentName: agent.name, safe: false, key })
  if (!id) return done({ suggested: false, message: 'That suggestion is already in Dev’s queue, or Dev dismissed it before. Nothing new was added.' })
  return done({ suggested: true, suggestionId: id, message: 'Added to Dev’s Suggestions queue. Nothing has changed yet: Dev will accept or dismiss it.' })
}

async function logTouch(ctx: MutationCtx, agent: Agent, a: Args): Promise<Out> {
  const i = await investorById(ctx, a.investorId)
  if (!i) return nope(NO_INVESTOR)
  const today = todayIST()
  const date = a.date as string
  if (date > today) return nope(`date can’t be in the future (today is ${today} in India).`)
  const touch = a.kind as TouchKind
  const note = a.note as string
  const what = TOUCH_LABEL[touch].toLowerCase()
  return await suggest(ctx, agent, {
    kind: 'touch', investorId: i._id, title: about(i, note),
    fix: `Log ${what === 'email' ? 'an' : 'a'} ${what} · ${date === today ? 'today' : dayLabel(date, today)}`,
    patch: { op: 'touch', touch, note, date },
  })
}

async function addInvestor(ctx: MutationCtx, agent: Agent, a: Args): Promise<Out> {
  const name = a.name as string
  const firm = (a.firm as string | undefined) ?? ''
  const email = typeof a.email === 'string' ? normEmail(a.email) || undefined : undefined
  const note = a.note as string | undefined
  const same = (await ctx.db.query('investors').collect()).find((i) => dupKey(i.name, i.firm) === dupKey(name, firm) || (!!email && addressesOf(i).emails.includes(email)))
  if (same) return nope(`${same.name} is already on the list (id ${same._id}). Use get_investor, or suggest_change for a fix.`)
  const who = firm && firm.toLowerCase() !== name.toLowerCase() ? `${name} (${firm})` : name
  return await suggest(ctx, agent, {
    kind: 'new_investor', title: note ? `${who}: ${note}` : `${who} isn’t on the list yet.`, fix: `Add ${who} to the list`,
    patch: { op: 'new_investor', name, firm, ...(email ? { email } : {}), ...(note ? { note } : {}) },
  })
}

async function suggestChange(ctx: MutationCtx, agent: Agent, a: Args): Promise<Out> {
  const i = await investorById(ctx, a.investorId)
  if (!i) return nope(NO_INVESTOR)
  const title = about(i, a.why as string)
  const value = a.value as string | number
  if (a.kind === 'stage') {
    const want = String(value).trim().toLowerCase()
    const to = STAGE_KEYS.find((k) => k === want || LABEL[k].toLowerCase() === want || STAGE_TILE[k].toLowerCase() === want)
    if (!to) return nope(`value must be a stage: ${STAGE_KEYS.join(', ')}.`)
    if (to === i.stage) return nope(`${i.name} is already at ${LABEL[to]}.`)
    return await suggest(ctx, agent, { kind: 'stage', investorId: i._id, title, fix: `Move to ${STAGE_TILE[to]}`, patch: { op: 'stage', from: i.stage, to } })
  }
  if (a.kind === 'next_step') {
    const step = String(value).trim()
    const date = a.date as string | undefined
    if (!step) return nope('value must be the next step, e.g. “Send the data room”.')
    const when = date ? ` · ${dayLabel(date, todayIST())}` : ''
    return await suggest(ctx, agent, { kind: 'next_step', investorId: i._id, title, fix: `Set “${step}”${when}`, patch: { op: 'next_step', step, ...(date ? { date } : {}) } })
  }
  const amount = parseAmount(value)
  if (!amount) return nope('value must be the amount in US dollars the investor said, e.g. 50000.')
  return await suggest(ctx, agent, { kind: 'expected', investorId: i._id, title, fix: `Set Expected to ${money(amount)}`, patch: { op: 'expected', amount } })
}

/** The existing enrichment, as an automatic run: it counts towards (and stops at) the daily cap. */
async function enrich(ctx: MutationCtx, a: Args): Promise<Out> {
  if ((a.investorId === undefined) === (a.email === undefined)) return nope('Pass exactly one of investorId and email.')
  if (!hasAIKey()) return nope('AI isn’t set up on this Nest, so it can’t look anyone up.')
  if ((await capLeft(ctx)) <= 0) return nope('Nest has done all its automatic lookups for today. Try again tomorrow, or ask Dev to click Enrich.')
  if (a.investorId !== undefined) {
    const i = await investorById(ctx, a.investorId)
    if (!i) return nope(NO_INVESTOR)
    const runs = await ctx.db
      .query('enrichRuns')
      .withIndex('by_investor', (q) => q.eq('investorId', i._id))
      .order('desc')
      .take(5)
    if (runs.some((r) => r.status === 'queued' || r.status === 'running')) return done({ started: false, message: `A lookup of ${i.name} is already running.` })
    const email = normEmail(i.email)
    const domain = firmDomain(i)
    await queue(ctx, { investorId: i._id, auto: true, ...(email ? { email } : {}), ...(domain ? { domain } : {}) })
    return done({ started: true, message: `Started looking up ${i.name}. What Nest finds waits for Dev to review; nothing changes until then.` })
  }
  const e = normEmail(a.email as string)
  if (!e || isOurs(e)) return nope('email must be someone outside Pesto.')
  const since = Date.now() - CACHE_DAYS * DAY_MS
  const runs = await ctx.db
    .query('enrichRuns')
    .withIndex('by_email', (q) => q.eq('email', e).gte('startedAt', since))
    .collect()
  if (runs.some((r) => !r.investorId && r.status !== 'failed' && r.status !== 'stopped')) return done({ started: false, message: 'Nest looked them up in the last 30 days; Dev can see it in Who’s this?.' })
  await queue(ctx, { email: e, auto: true, ...(GENERIC_DOMAINS.has(domainOf(e)) ? {} : { domain: domainOf(e) }) })
  return done({ started: true, message: 'Started looking them up. What Nest finds shows in Who’s this? for Dev to review.' })
}

export const write = internalMutation({
  args: { tool: v.string(), args: v.any(), agent: v.object({ keyId: v.id('agentKeys'), name: v.string(), scope: vAgentScope }) },
  handler: async (ctx, { tool, args, agent }): Promise<Out> => {
    if (agent.scope !== 'suggest') return nope('This key can only read.')
    if (tool === 'log_touch') return await logTouch(ctx, agent, args)
    if (tool === 'add_investor') return await addInvestor(ctx, agent, args)
    if (tool === 'suggest_change') return await suggestChange(ctx, agent, args)
    if (tool === 'enrich') return await enrich(ctx, args)
    return nope(`${tool} isn’t a write tool.`)
  },
})
