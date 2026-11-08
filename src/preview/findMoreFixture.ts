// DEV ONLY (PST-296): made-up Find more data for ?preview&investors=find-more, with
// &find=running (a run searching), &find=results (eight new investors) or
// &find=empty (a run that found nobody new). Without &find the panel waits to be
// run; Search plays a pretend run. Invented investors, companies and example.com
// links only.
import type { Found } from '../lib/findMore'

export const PREVIEW_FIND = ['running', 'results', 'empty'] as const
export type PreviewFind = (typeof PREVIEW_FIND)[number]

export const FIXTURE_COMPANIES = ['Puddlejump', 'Storyloft', 'Tiny Atlas']

export type FixtureCandidate = Found & { score: number; warmPath?: string }

const src = (host: string, path = '') => [{ url: 'https://' + host + path, title: host }, { url: 'https://deals.example.com/' + host.split('.')[0], title: 'deals.example.com' }]

/** Eight new investors, best first, as a run with Jev on would leave them. */
export const FIXTURE_CANDIDATES: FixtureCandidate[] = [
  {
    name: 'Brightpath Ventures', firm: 'Brightpath Ventures', type: 'Seed fund', leads: true, domain: 'brightpath.example.com', stage: 'Pre-seed and seed', check: '$100K–$300K', checkUsd: 200_000,
    thesis: 'Kids and consumer apps', backed: [{ company: 'Puddlejump', round: 'Pre-seed', date: '2026-03' }], dealsLast12: 6, lastDeal: '2026-10', sources: src('brightpath.example.com', '/portfolio'),
    score: 88, warmPath: 'Ria met Tara in Oct',
  },
  {
    name: 'Pinecone Capital', firm: 'Pinecone Capital', type: 'Micro-VC', leads: false, domain: 'pinecone.example.com', stage: 'Seed', check: 'About $100K', checkUsd: 100_000,
    thesis: 'Edtech and learning', backed: [{ company: 'Storyloft', round: 'Seed', date: '2026-06' }], dealsLast12: 2, lastDeal: '2026-06', coInvests: ['Orchard Capital'], sources: src('pinecone.example.com'),
    score: 81, warmPath: 'Ankur knows them',
  },
  {
    name: 'Little Giants Fund', firm: 'Little Giants Fund', type: 'Seed fund', leads: true, domain: 'littlegiants.example.com', stage: 'Pre-seed', check: '$50K–$250K',
    thesis: 'Family apps for parents', geography: 'India and the US', backed: [{ company: 'Tiny Atlas', round: 'Pre-seed', date: '2026-01' }], dealsLast12: 2, lastDeal: '2026-08', sources: src('littlegiants.example.com', '/team'),
    score: 79, warmPath: 'Mira emailed them in Sept',
  },
  {
    name: 'Cedar Angels', firm: '', type: 'Angel', domain: 'cedarangels.example.com', stage: 'Pre-seed', check: '$25K–$75K', checkUsd: 50_000,
    thesis: 'Parents as LPs, kids products', backed: [{ company: 'Puddlejump', round: 'Pre-seed', date: '2026-03' }, { company: 'Storyloft', round: 'Pre-seed', date: '2025-12' }], dealsLast12: 2, lastDeal: '2026-03', sources: src('cedarangels.example.com'),
    score: 74,
  },
  {
    name: 'Northbeam Seed', firm: 'Northbeam Seed', type: 'Seed fund', leads: false, domain: 'northbeam.example.com', stage: 'Seed', check: '$150K',
    thesis: 'Consumer', backed: [{ company: 'Tiny Atlas', round: 'Seed', date: '2026-08' }], dealsLast12: 4, lastDeal: '2026-09', coInvests: ['Orchard Capital'], sources: src('northbeam.example.com'),
    score: 70,
  },
  {
    name: 'Meadowlark Fund', firm: 'Meadowlark Fund', type: 'Pre-seed fund', leads: true, domain: 'meadowlark.example.com', stage: 'Pre-seed', checkUsd: 75_000,
    thesis: 'Learning at home', backed: [{ company: 'Storyloft', round: 'Pre-seed', date: '2025-12' }], dealsLast12: 3, lastDeal: '2026-05', sources: src('meadowlark.example.com'),
    score: 66,
  },
  {
    name: 'Harbourline Partners', firm: 'Harbourline Partners', type: 'Micro-VC', leads: false, domain: 'harbourline.example.com', stage: 'Seed', checkUsd: 150_000,
    thesis: 'Consumer subscriptions', backed: [{ company: 'Puddlejump', round: 'Seed', date: '2026-07' }], dealsLast12: 5, lastDeal: '2026-07', sources: src('harbourline.example.com'),
    score: 61,
  },
  {
    name: 'Otter Street Angels', firm: '', type: 'Angel', domain: 'otterstreet.example.com', stage: 'Pre-seed', checkUsd: 25_000,
    thesis: 'Kids', geography: 'India', backed: [{ company: 'Tiny Atlas', round: 'Pre-seed', date: '2026-01' }], dealsLast12: 1, lastDeal: '2026-01', sources: src('otterstreet.example.com'),
    score: 54,
  },
]
