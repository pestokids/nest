// DEV ONLY (PST-305): made-up Network data for ?preview. Every name, company,
// address and link is invented (example domains only).
//   &investors=network       Investors › Network
//   &network=founder|friend|advisor  the panel for a founder (Ankur), a friend (Ria) or an advisor (Neha, who also invests)
//   &network=lookup          Ankur's panel with Find their investors done: results to tick, two already in Nest
//   &network=import          the CSV import of people, with its preview (two rows skipped)
//   &draft=intro-ask         Ask Ankur for intros: three investors picked, a line on each, the note to forward
import { composeAsk, type LookupResult } from '../lib/network'
import type { Introducer, Intro } from '../lib/introducers'
import type { Investor } from '../lib/pipeline'

export const PREVIEW_NETWORK = ['founder', 'friend', 'advisor', 'lookup', 'import'] as const
export type PreviewNetwork = (typeof PREVIEW_NETWORK)[number]
/** Whose panel each state opens. */
export const PREVIEW_NETWORK_PERSON: Record<Exclude<PreviewNetwork, 'import'>, string> = { founder: 'pi-ankur', friend: 'pi-ria', advisor: 'pi-neha', lookup: 'pi-ankur' }

/** The people PST-305 adds to PST-294's, and what it adds to theirs. */
export const NETWORK_PEOPLE: Introducer[] = [
  { _id: 'pi-neha', name: 'Neha Rao', email: 'neha@rao.example', relation: 'advisor', notes: 'Go-to-market and hiring', roles: { canIntro: true, givesAdvice: true, wantsToInvest: true } },
  { _id: 'pi-omar', name: 'Omar Field', relation: 'founder', notes: '', company: 'Puddlejump', companyDomain: 'puddlejump.example' },
]
export const NETWORK_EXTRAS: Record<string, Partial<Introducer>> = {
  'pi-ankur': { company: 'Tinkerly', companyDomain: 'tinkerly.example' },
  'pi-mira': { company: 'ex-founder, angel' },
}
/** Neha's own angel card (she wants to invest): linked both ways. */
export const NETWORK_LINKS: Record<string, string> = { 'pi-neha': 'Saltmarsh Angels' }

/** Intros picked and not asked yet ("to ask"). */
const TO_ASK: [string, string][] = [
  ['pi-ankur', 'Cedar Collective'],
  ['pi-ankur', 'Morrow Ventures'],
  ['pi-ankur', 'Willow Street'],
  ['pi-ria', 'Tidewater Angels'],
  ['pi-neha', 'Quill Capital'],
]

export function previewNetwork(investors: readonly Investor[], people: Introducer[], now: number): { introducers: Introducer[]; intros: Intro[] } {
  const byName = (n: string) => investors.find((i) => i.name === n)
  const introducers = [...people, ...NETWORK_PEOPLE.map((p) => ({ ...p, createdAt: now }))].map((p) => {
    const link = NETWORK_LINKS[p._id] && byName(NETWORK_LINKS[p._id])
    return { ...p, ...NETWORK_EXTRAS[p._id], ...(link ? { investorId: link._id } : {}) }
  })
  const intros = TO_ASK.flatMap(([introducerId, name], k): Intro[] => {
    const inv = byName(name)
    return inv ? [{ _id: 'pa' + k, investorId: inv._id, introducerId, steps: {}, createdAt: now - (k + 1) * 36e5 }] : []
  })
  return { introducers, intros }
}

/** How long the pretend lookup takes. */
export const PREVIEW_LOOKUP_DELAY = 1600

/** Who "backed" a made-up company: seven firms, two of them already in the fixture's list. */
export function previewLookupResults(company: string): LookupResult[] {
  const slug = company.toLowerCase().replace(/[^a-z0-9]/g, '') || 'company'
  const src = (host: string) => 'https://' + host + '/portfolio/' + slug
  return [
    { firm: 'Orchard Capital', partner: 'Priya Natarajan', round: 'seed', year: 2025, url: src('orchard.example'), domain: 'orchard.example' },
    { firm: 'Brightpath Ventures', partner: 'Tara Quinn', round: 'pre-seed', year: 2024, url: src('brightpath.example.com'), domain: 'brightpath.example.com' },
    { firm: 'Kite Angels', round: 'pre-seed', year: 2024, url: 'https://news.example.com/' + slug + '-raises-pre-seed' },
    { firm: 'Meadowlark Fund', partner: 'Sam Ortiz', round: 'seed', year: 2025, url: src('meadowlark.example.com'), domain: 'meadowlark.example.com' },
    { firm: 'Pinecone Capital', round: 'seed', year: 2025, url: 'https://deals.example.com/' + slug },
    { firm: 'Little Giants Fund', partner: 'Ana Ruiz', round: 'pre-seed', year: 2024, url: src('littlegiants.example.com'), domain: 'littlegiants.example.com' },
    { firm: 'Harbourline Partners', year: 2025, url: 'https://deals.example.com/' + slug + '-seed' },
  ]
}

/** The preview's "Haiku" for the intro ask: a line on each investor but the last (so [why they fit] shows), a note with blanks. */
export function previewAsk(o: { who: string; picked: readonly string[] }) {
  return composeAsk(
    {
      subject: 'A few intros for Pesto?',
      opening: 'Hi ' + o.who.split(/\s+/)[0] + ',\n\nWould you be up for introducing me to a few investors you know? These three look like a good fit for Pesto:',
      fits: o.picked.slice(0, -1).map((name) => ({ name, why: 'they back consumer and kids companies at pre-seed.' })),
      note: 'We’re building Pesto, a kids and family app. [__] families joined the beta in [__] weeks, and we’re raising our pre-seed now. Would you be up for a 30-minute call next week?',
    },
    { who: o.who, me: 'Dev', picked: o.picked, known: 'Pesto kids family app pre-seed' },
  )
}

/** &network=import: a file with a duplicate of someone already in the Network and a row with a bad email. */
export const PREVIEW_PEOPLE_CSV = [
  'name,email,relation,company,notes',
  'Asha Linden,asha@tinkerly.example,Founder,Brightloop,Backed by Orchard',
  'Ravi Moss,,Friend,,College friend',
  'Lena Park,lena@park.example,Advisor,,Pricing and growth',
  'Ankur Mehta,ankur@tinkerly.example,Founder,Tinkerly,',
  'Jo Bell,jo-at-bell,Angel,,Met at a demo day',
].join('\n')
