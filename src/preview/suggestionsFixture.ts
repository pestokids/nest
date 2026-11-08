// DEV ONLY: made-up suggested fixes for ?preview (PST-275). Two extra invented
// investors and two past meetings give the real rule checks something to find;
// the rows only other features make (call notes, enrichment, an agent) are added
// by hand. Names and addresses are invented (example.com).
import type { Investor } from '../lib/pipeline'
import type { CheckInput, SuggestionDraft } from '../lib/suggestions'
import { addDays } from '../lib/today'

/** &suggestions=all (the list open), tidy (cleared: "All tidy."), none (no card), agent (an agent's row arrives), jev (PST-292: a Duplicate Jev found). */
export const PREVIEW_SUGGESTIONS = ['default', 'all', 'tidy', 'none', 'agent', 'jev', /* PST-302 */ 'notes', 'outreach', 'application'] as const
export type PreviewSuggestions = (typeof PREVIEW_SUGGESTIONS)[number]

const H = 36e5
const D = 24 * H

/** A second card for Lantern Ventures (a duplicate), and an intro with no next step. PST-292 (`jev`): a misspelt second card for Juniper Seed. */
export function fixtureSuggestionInvestors(today: string, jev = false): Investor[] {
  const base = { geo: 'India', lead: false, notes: '', source: 'Preview fixture' } as const
  return [
    ...(jev ? [{ ...base, _id: 'fxs2', name: 'Junipr Seed', firm: 'Junipr Seed', type: 'Seed fund', warmth: 'cold', path: '', tier: 'C', wave: 3, stage: 'todo', maxStage: 'todo', nextStep: '' } as Investor] : []),

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

/** An amount from call notes and enrichment facts to review: rows the checks don't make. PST-292: Jev's Duplicate for a misspelt Juniper Seed. */
export function fixtureExtraSuggestions(investors: readonly Investor[]): SuggestionDraft[] {
  const orchard = byName(investors, 'Orchard Capital')
  const juniper = byName(investors, 'Juniper Seed')
  const junipr = byName(investors, 'Junipr Seed')
  return [
    ...(juniper && junipr
      ? [{
          kind: 'duplicate' as const, investorId: juniper, otherInvestorId: junipr, title: 'Juniper Seed and “Junipr Seed” look like the same firm.', fix: 'Merge into Juniper Seed, keeping both histories',
          patch: { op: 'merge' as const }, source: 'jev' as const, safe: false, key: 'jev:duplicate:' + [juniper, junipr].sort().join(':'),
        }]
      : []),

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

/* ---------- PST-302: an agent's notes, outreach and application fixes (&suggestions=notes|outreach|application) ---------- */
export function fixtureFixSuggestions(investors: readonly Investor[], state: PreviewSuggestions): SuggestionDraft[] {
  const find = (name: string) => investors.find((i) => i.name === name)
  const agent = { source: 'agent' as const, agentName: 'Claude', safe: false }
  if (state === 'notes') {
    const kite = find('Kite Angels')
    if (!kite) return []
    return [{
      ...agent, kind: 'notes', investorId: kite._id, key: 'preview:pst302:notes',
      title: 'Kite Angels asked about week-6 retention on the call, not week-4.',
      fix: 'Replace the notes',
      patch: { op: 'notes', mode: 'replace', before: kite.notes, text: kite.notes.replace('week-4', 'week-6') },
    }]
  }
  if (state === 'outreach') {
    const fern = find('Fernhill Fund')
    if (!fern) return []
    return [{
      ...agent, kind: 'outreach', investorId: fern._id, key: 'preview:pst302:outreach',
      title: 'Fernhill Fund: Mira worked with their partner for two years, so this one is warm.',
      fix: 'Set warm path “Mira (worked with the partner)”, warm, direct, source “Mira’s list”',
      patch: { op: 'outreach', path: 'Mira (worked with the partner)', warmth: 'warm', source: 'Mira’s list' },
    }]
  }
  if (state === 'application') {
    const north = find('Northwind Accelerator')
    if (!north) return []
    return [{
      ...agent, kind: 'application', investorId: north._id, key: 'preview:pst302:application',
      title: 'Northwind Accelerator emailed an interview invite for their C12 programme.',
      fix: 'Set the application to “Interview invited · C12”',
      patch: { op: 'application', status: 'interview_invited', program: 'C12', submittedOn: north.application?.submittedOn, decisionBy: north.application?.decisionBy },
    }]
  }
  return []
}
