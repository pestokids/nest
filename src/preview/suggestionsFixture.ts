// DEV ONLY: made-up suggested fixes for ?preview (PST-275). Two extra invented
// investors and two past meetings give the real rule checks something to find;
// the rows only other features make (call notes, enrichment, an agent) are added
// by hand. Names and addresses are invented (example.com).
import type { Investor } from '../lib/pipeline'
import type { CheckInput, SuggestionDraft } from '../lib/suggestions'
import { addDays } from '../lib/today'

/** &suggestions=all (the list open), tidy (cleared: "All tidy."), none (no card), agent (an agent's row arrives). */
export const PREVIEW_SUGGESTIONS = ['default', 'all', 'tidy', 'none', 'agent'] as const
export type PreviewSuggestions = (typeof PREVIEW_SUGGESTIONS)[number]

const H = 36e5
const D = 24 * H

/** A second card for Lantern Ventures (a duplicate), and an intro with no next step. */
export function fixtureSuggestionInvestors(today: string): Investor[] {
  const base = { geo: 'India', lead: false, notes: '', source: 'Preview fixture' } as const
  return [
    { ...base, _id: 'fxs0', name: 'Lantern VC', firm: 'Lantern VC', type: 'Micro-VC', warmth: 'cold', path: '', tier: 'C', wave: 3, stage: 'todo', maxStage: 'todo', nextStep: '', notes: 'From an old angel list.' },
    {
      ...base, _id: 'fxs1', name: 'Tamarind Capital', firm: 'Tamarind Capital', type: 'Seed fund', warmth: 'warm', path: 'Mira', tier: 'B', wave: 1, stage: 'intro', maxStage: 'intro',
      expected: 100000, nextStep: '', lastTouch: addDays(today, -1), email: 'ivy@tamarind.example.com',
    },
  ]
}

const byName = (investors: readonly Investor[], name: string) => investors.find((i) => i.name === name)?._id

/** Meetings the checks read: Kite met yesterday (still Booked), and an invite naming Northwind from an address at the firm. */
export function fixtureSuggestionMeetings(investors: readonly Investor[], now: number): CheckInput['meetings'] {
  const kite = byName(investors, 'Kite Angels')
  return [
    ...(kite ? [{ title: 'Pesto × Kite Angels', start: now - D - 2 * H, end: now - D - H, people: [{ email: 'sam@kite.example.com' }], investorIds: [kite] }] : []),
    { title: 'Northwind × Pesto', start: now - 2 * D, end: now - 2 * D + H, people: [{ email: 'ops@northwind.example.com' }], investorIds: [] },
  ]
}

/** An amount from call notes and enrichment facts to review: rows the checks don't make. */
export function fixtureExtraSuggestions(investors: readonly Investor[]): SuggestionDraft[] {
  const orchard = byName(investors, 'Orchard Capital')
  const juniper = byName(investors, 'Juniper Seed')
  return [
    ...(orchard
      ? [{
          kind: 'expected' as const, investorId: orchard, title: 'Orchard Capital said “around eighty” in yesterday’s call notes.', fix: 'Set Expected to $80K',
          patch: { op: 'expected' as const, amount: 80000 }, source: 'notes' as const, safe: true, key: 'preview:notes:orchard',
        }]
      : []),
    ...(juniper
      ? [{
          kind: 'enrichment' as const, investorId: juniper, title: '9 facts found for Juniper Seed.', fix: 'Review what Nest found',
          patch: { op: 'review' as const }, source: 'enrich' as const, safe: false, key: 'preview:enrich:juniper',
        }]
      : []),
  ]
}

/** The one row from an agent (preview only): Grok Bot heard about a call. */
export function fixtureAgentSuggestion(investors: readonly Investor[], today: string): SuggestionDraft | null {
  const id = byName(investors, 'Saltmarsh Angels')
  if (!id) return null
  return {
    kind: 'touch', investorId: id, title: 'Grok Bot: you called Saltmarsh Angels this morning (from your WhatsApp).', fix: 'Log a call · today',
    patch: { op: 'touch', touch: 'call', note: 'Call (logged by Grok Bot from WhatsApp).', date: today }, source: 'agent', agentName: 'Grok Bot', safe: false, key: 'preview:agent:saltmarsh',
  }
}
