// DEV ONLY: made-up enrichment for ?preview, so every new state shows without a key:
// &ai=enriching (a run in progress), &ai=review (facts to keep, one clashing with
// Expected), &ai=nokey (AI isn't set up here), &ai=bulk (four investors enriching).
// PST-273: &ai=models (Settings › AI's Model section with two features on their own
// model, estimates from real runs for two of them), &ai=spend (a month split across
// all three models).
// The default shows Kite Angels enriched and reviewed. Clicking Enrich, Refresh or a
// bulk Enrich plays a pretend run. Invented people at example.com addresses only.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AIActions } from '../components/data'
import { investorWrite, NO_AI, type AIData, type AISettings, type Fact, type FactPerson, type InvestorAI, type Person, type Rank, type RecentRun, type Run } from '../lib/enrich'
import { todayIST } from '../lib/dates'
import { fieldsOf, NEW_INVESTOR, type Investor, type InvestorFields } from '../lib/pipeline'
import { DEFAULT_CHOICE, estimate, HAIKU, OPUS, SONNET, type Feature, type Model, type ModelChoice, type RealUsage } from '../lib/models'

export const PREVIEW_AI = ['default', 'enriching', 'review', 'nokey', 'bulk', 'models', 'spend'] as const
export type PreviewAI = (typeof PREVIEW_AI)[number]

type DB = { runs: Run[]; facts: Fact[]; people: Person[]; settings: AISettings; connected: boolean; models: ModelChoice; state: PreviewAI }

const real = (runs: number, input: number, output: number, webSearches = 0): RealUsage => ({ runs, avg: { input, output, cacheRead: 0, cacheWrite: 0, webSearches } })
/** This month's runs per feature, their real usage, and the spend (enrichment's grows with the pretend runs' cost). */
function monthOf(state: PreviewAI): { features: AIData['features']; byModel: Record<Model, number>; byFeature: Record<Feature, number> } {
  const features: AIData['features'] = {
    enrich: { month: 51, real: state === 'models' || state === 'spend' ? real(23, 71_400, 2_650, 2.6) : real(3, 64_000, 2_400, 2.3) },
    notes: { month: 6, real: state === 'models' ? real(6, 5_200, 880) : null },
    drafts: { month: 4, real: null },
    ask: { month: 11, real: null },
    brief: { month: 7, real: null },
  }
  if (state === 'spend')
    return { features, byModel: { [HAIKU]: 0.92, [SONNET]: 2.1, [OPUS]: 1.35 }, byFeature: { enrich: 3.05, notes: 0.21, drafts: 0.18, ask: 0.86, brief: 0.07 } }
  return { features, byModel: { [HAIKU]: 0.31, [SONNET]: 1.53, [OPUS]: 0 }, byFeature: { enrich: 1.62, notes: 0.05, drafts: 0.03, ask: 0.12, brief: 0.02 } }
}

const STEPS = ['Who they are and their rank', 'What the fund is and its size', 'Checking recent deals', 'Typical check size, and whether they lead', 'Other partners and what they cover']
const SENDER_STEPS = ['Who they are', 'Their firm, if they have one', 'Whether they invest, and in what']
const STEP_MS = 1100
const H = 36e5

type Seed = {
  verdict: Run['verdict']
  summary: string
  person: Partial<Record<'name' | 'title' | 'rank' | 'covers' | 'linkedin' | 'x' | 'email', [string, string]>>
  fund: Partial<Record<'name' | 'website' | 'domain' | 'type' | 'size' | 'stage' | 'check' | 'leads' | 'geography' | 'thesis' | 'recentDeals', [string, string, number?]>>
  partners: (FactPerson & { source: string; email?: string })[]
  found: [string, string?][]
}

const KITE: Seed = {
  verdict: 'investor',
  summary: 'Partner at Kite Angels, an angel syndicate.',
  person: {
    name: ['Sam Okoye', 'https://www.linkedin.com/in/sam-okoye-example'],
    title: ['Partner, leads consumer deals', 'https://kite.example.com/team'],
    rank: ['partner', 'https://kite.example.com/team'],
    covers: ['Kids, consumer, creator tools', 'https://kite.example.com/team'],
    linkedin: ['linkedin.com/in/sam-okoye-example', 'https://www.linkedin.com/in/sam-okoye-example'],
    x: ['@samokoye', 'https://x.com/samokoye'],
  },
  fund: {
    name: ['Kite Angels', 'https://kite.example.com'],
    domain: ['kite.example.com', 'https://kite.example.com'],
    type: ['Angel', 'https://kite.example.com'],
    size: ['$12M across two syndicate funds (Fund II, 2025)', 'https://news.example.com/kite-fund-ii', 12e6],
    stage: ['Pre-seed and seed', 'https://kite.example.com'],
    check: ['$25K–$50K, about $35K', 'https://kite.example.com/faq', 35e3],
    leads: ['Sometimes, in rounds under $500K', 'https://kite.example.com/faq'],
    geography: ['India and the US', 'https://kite.example.com'],
    thesis: ['Consumer and kids at pre-seed. “Parents are the buyer.”', 'https://kite.example.com'],
    recentDeals: ['Tinkerly (Aug), Little Lit (Jun), Snackstory (Mar)', 'https://deals.example.com/kite-angels'],
  },
  partners: [
    { name: 'Rhea Lal', title: 'Principal', rank: 'principal', covers: 'edtech, does first calls', source: 'https://kite.example.com/team', email: 'rhea@kite.example.com' },
    { name: 'Tomas Vee', title: 'Scout', rank: 'scout', covers: 'Bengaluru', source: 'https://kite.example.com/team', email: 'tomas@kite.example.com' },
  ],
  found: [
    ['Sam Okoye is a partner at Kite Angels', 'linkedin.com'],
    ['Angel syndicate, about $12M deployed', 'kite.example.com'],
    ['Tinkerly, Little Lit and Snackstory this year', 'deals.example.com'],
    ['$25K–$50K checks, leads small rounds', 'kite.example.com'],
    ['Two more partners: edtech and a scout', 'kite.example.com'],
  ],
}

const SENDERS: Record<string, Seed> = {
  'rowan@larkspur.example.com': {
    verdict: 'investor',
    summary: 'Principal at Larkspur Ventures, a $40M pre-seed fund.',
    person: {
      name: ['Rowan Hale', 'https://www.linkedin.com/in/rowan-hale-example'],
      title: ['Principal', 'https://larkspur.example.com/team'],
      rank: ['principal', 'https://larkspur.example.com/team'],
      covers: ['Consumer and kids', 'https://larkspur.example.com/team'],
    },
    fund: {
      name: ['Larkspur Ventures', 'https://larkspur.example.com'],
      domain: ['larkspur.example.com', 'https://larkspur.example.com'],
      type: ['Pre-seed fund', 'https://larkspur.example.com'],
      size: ['$40M', 'https://news.example.com/larkspur-fund-i', 40e6],
      stage: ['Pre-seed', 'https://larkspur.example.com'],
    },
    partners: [],
    found: [['Principal at Larkspur Ventures', 'linkedin.com'], ['A $40M pre-seed fund', 'larkspur.example.com'], ['Invests in consumer and kids', 'larkspur.example.com']],
  },
  'dara@harborlight.example.com': {
    verdict: 'investor',
    summary: 'Associate at Harbor Light, an accelerator.',
    person: {
      name: ['Dara Cole', 'https://harborlight.example.com/team'],
      title: ['Associate', 'https://harborlight.example.com/team'],
      rank: ['associate', 'https://harborlight.example.com/team'],
    },
    fund: { name: ['Harbor Light', 'https://harborlight.example.com'], domain: ['harborlight.example.com', 'https://harborlight.example.com'] },
    partners: [],
    found: [['Associate at Harbor Light', 'harborlight.example.com'], ['Harbor Light, an accelerator', 'harborlight.example.com'], ['Invests through its programme', 'harborlight.example.com']],
  },
  'mina@fieldnote.example.com': { verdict: 'unknown', summary: 'Couldn’t find her. Nothing on the web ties this address to a firm.', person: {}, fund: {}, partners: [], found: [['Nothing found'], ['No firm found'], ['Couldn’t tell']] },
}

/** Settings › AI's recent runs: a question asked two hours ago and today's 08:00 brief. */
function asksAndBriefs(state: PreviewAI): RecentRun[] {
  const at8 = Date.parse(todayIST() + 'T08:00:00+05:30')
  const base = { wasInvestor: false, facts: 0, cached: false, status: 'done' as const }
  const opus = state === 'spend'
  return [
    { ...base, _id: 'pask-recent', at: Math.max(at8 + 6e4, Date.now() - 2 * H), kind: 'ask', question: 'Who should I chase today?', tools: 2, costUsd: opus ? 0.11 : 0.004, model: opus ? OPUS : HAIKU },
    { ...base, _id: 'pbrief-recent', at: at8, kind: 'brief', moves: 3, costUsd: 0.0002, model: HAIKU },
  ]
}

const PEOPLE_NAMES = ['Ines Halloway', 'Theo Marchetti', 'Nadia Brook', 'Omar Castell', 'Lena Varga', 'Felix Amari']

/** A made-up lookup for any other fixture investor, from its name. */
function genericSeed(inv: Investor): Seed {
  const slug = (inv.firm || inv.name).toLowerCase().replace(/[^a-z]+/g, '')
  const who = PEOPLE_NAMES[[...inv.name].reduce((s, c) => s + c.charCodeAt(0), 0) % PEOPLE_NAMES.length]
  const site = 'https://' + slug + '.example.com'
  const fund = inv.firm || inv.name
  return {
    verdict: 'investor',
    summary: 'Partner at ' + fund + '.',
    person: { name: [who, site + '/team'], title: ['Partner', site + '/team'], rank: ['partner', site + '/team'], covers: ['Consumer and edtech', site + '/team'] },
    fund: {
      name: [fund, site],
      domain: [slug + '.example.com', site],
      size: ['$60M', 'https://news.example.com/' + slug, 60e6],
      stage: ['Pre-seed and seed', site],
      check: ['$100K–$250K, about $150K', site + '/faq', 150e3],
      geography: ['India', site],
      thesis: ['Consumer and learning products', site],
    },
    partners: [],
    found: [[who + ' is a partner at ' + fund, slug + '.example.com'], ['A $60M pre-seed and seed fund', 'news.example.com'], ['Three consumer deals this year', slug + '.example.com'], ['$100K–$250K checks', slug + '.example.com'], ['Nobody else listed'] ],
  }
}

let n = 0
const uid = (p: string) => p + Date.now().toString(36) + (n++).toString(36)

/** A seed's facts for one run, as pending (or kept). Clashes are worked out against the investor. */
function factsOf(seed: Seed, runId: string, o: { inv?: Investor; email?: string; status?: Fact['status']; only?: string[] }): Fact[] {
  const out: Fact[] = []
  const keptAt = Date.now()
  const push = (f: Omit<Fact, '_id' | 'runId' | 'status' | 'confidence'>) => {
    if (o.only && !o.only.includes(f.group + '.' + f.field)) return
    const clash = o.inv ? investorWrite(o.inv, f).clash : undefined
    out.push({ ...f, _id: uid('f'), runId, confidence: 0.9, status: o.status ?? 'pending', ...(o.inv ? { investorId: o.inv._id } : {}), ...(o.email ? { email: o.email } : {}), ...(clash ? { clash } : {}), ...(o.status === 'kept' ? { keptAt } : {}) })
  }
  for (const [field, [value, source]] of Object.entries(seed.person)) push({ group: 'person', field, value, source })
  for (const [field, [value, source, amount]] of Object.entries(seed.fund)) push({ group: 'fund', field, value, source, ...(amount ? { amount } : {}) })
  for (const p of seed.partners) {
    const { source, email: _e, ...person } = p
    push({ group: 'fund', field: 'partner', value: [p.name, p.title, p.covers].filter(Boolean).join(' · '), source, person })
  }
  return out
}

const REVIEW_ONLY = ['person.name', 'person.title', 'person.rank', 'person.covers', 'person.linkedin', 'person.x', 'fund.size', 'fund.stage', 'fund.check', 'fund.leads', 'fund.geography', 'fund.recentDeals']

function initial(state: PreviewAI, investors: Investor[], now: number): DB {
  const db: DB = {
    runs: [], facts: [], people: [], settings: { lookups: true, enrichNew: true, meetingNotes: true, morningBrief: true }, connected: state !== 'nokey', state,
    models: state === 'models' ? { default: HAIKU, features: { enrich: SONNET, ask: OPUS } } : DEFAULT_CHOICE,
  }
  if (state === 'nokey') return db
  const kite = investors.find((i) => i.name === 'Kite Angels')
  const done = (inv: Investor | undefined, seed: Seed, at: number, extra: Partial<Run> = {}): Run | undefined =>
    inv && { _id: uid('r'), investorId: inv._id, email: inv.email, status: 'done', steps: STEPS.map((l, k) => ({ label: seed.found[k]?.[0] ?? l, state: 'done' as const, ...(seed.found[k]?.[1] ? { source: seed.found[k][1] } : {}) })), costUsd: 0.04, startedAt: at - 40e3, finishedAt: at, auto: false, factCount: 12, verdict: seed.verdict, summary: seed.summary, model: HAIKU, ...extra }
  if (kite && state === 'enriching') {
    db.runs.push({
      _id: uid('r'), investorId: kite._id, email: kite.email, status: 'running', auto: false, costUsd: 0.03, startedAt: now - 22e3,
      steps: [
        { label: KITE.found[0][0], state: 'done', source: KITE.found[0][1] },
        { label: KITE.found[1][0], state: 'done', source: KITE.found[1][1] },
        { label: STEPS[2], state: 'running', source: 'reading 3 news pages' },
        { label: STEPS[3], state: 'waiting' },
        { label: STEPS[4], state: 'waiting' },
      ],
    })
  } else if (kite && state === 'review') {
    const run = done(kite, KITE, now - 5e3)!
    db.runs.push(run)
    db.facts.push(...factsOf(KITE, run._id, { inv: kite, only: REVIEW_ONLY }))
  } else if (kite) {
    const run = done(kite, KITE, now - 3 * H, state === 'spend' ? { model: SONNET, costUsd: 0.27 } : {})!
    db.runs.push(run)
    db.facts.push(...factsOf(KITE, run._id, { inv: kite, status: 'kept' }))
    db.people.push(
      { _id: uid('p'), investorId: kite._id, name: 'Sam Okoye', title: 'Partner', rank: 'partner', covers: 'kids and consumer', email: kite.email ?? 'sam@kite.example.com', linkedin: 'linkedin.com/in/sam-okoye-example', primary: true },
      ...KITE.partners.map((p) => ({ _id: uid('p'), investorId: kite._id, name: p.name, title: p.title, rank: p.rank as Rank, covers: p.covers, email: p.email, primary: false })),
    )
  }
  const orchard = investors.find((i) => i.name === 'Orchard Capital')
  if (state === 'bulk') {
    const [lantern, juniper] = ['Lantern Ventures', 'Juniper Seed'].map((x) => investors.find((i) => i.name === x))
    if (orchard) db.runs.push({ _id: uid('r'), investorId: orchard._id, status: 'running', auto: false, costUsd: 0.01, startedAt: now - 8e3, steps: STEPS.map((l, k) => ({ label: l, state: k === 0 ? 'running' : 'waiting' })) })
    for (const i of [lantern, juniper]) if (i) db.runs.push({ _id: uid('r'), investorId: i._id, status: 'queued', auto: false, costUsd: 0, startedAt: now - 9e3, steps: STEPS.map((l) => ({ label: l, state: 'waiting' })) })
  } else if (orchard) {
    const seed = genericSeed(orchard)
    const run = done(orchard, seed, now - 30 * H, { auto: true })!
    db.runs.push(run)
    db.facts.push(...factsOf(seed, run._id, { inv: orchard, status: 'kept' }))
  }
  // Who's this? (with &google=connected): three looked up, one still looking.
  for (const [email, seed] of Object.entries(SENDERS)) {
    const run: Run = { _id: uid('r'), email, status: 'done', auto: true, costUsd: 0.03, model: HAIKU, startedAt: now - 2 * H, finishedAt: now - 2 * H + 30e3, steps: SENDER_STEPS.map((l, k) => ({ label: seed.found[k]?.[0] ?? l, state: 'done' as const })), verdict: seed.verdict, summary: seed.summary }
    const facts = factsOf(seed, run._id, { email })
    db.runs.push({ ...run, factCount: facts.length })
    db.facts.push(...facts)
  }
  db.runs.push({ _id: uid('r'), email: 'm.tan@northbridge.example.com', status: 'running', auto: true, costUsd: 0.01, model: HAIKU, startedAt: now - 6e3, steps: SENDER_STEPS.map((l, k) => ({ label: l, state: k === 0 ? 'running' : 'waiting' })) })
  return db
}

const latestRun = (runs: Run[], match: (r: Run) => boolean) => runs.filter(match).sort((a, b) => b.startedAt - a.startedAt)[0]
const noKey = () => Promise.reject({ data: { code: 'NoAIKey', message: 'AI isn’t set up here.' } })

/**
 * The preview's enrichment: same shape as Convex's, in memory. \`save\` is the
 * preview's investor write (Keep writes through it, like the real one).
 */
export function useAIPreview(state: PreviewAI, investors: Investor[] | null, save: (id: string | null, f: InvestorFields) => Promise<string>, fail: boolean) {
  const [db, setDb] = useState<DB | null>(null)
  const ref = useRef<DB | null>(null)
  const inv = useRef<Investor[]>([])
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const saveRef = useRef(save)
  useEffect(() => {
    saveRef.current = save
    inv.current = investors ?? []
  })
  useEffect(() => {
    if (!investors || ref.current) return
    ref.current = initial(state, investors, Date.now())
    setDb(ref.current)
  }, [investors, state])
  useEffect(() => {
    const t = timers.current
    return () => t.forEach(clearTimeout)
  }, [])

  const actions = useMemo<AIActions>(() => {
    const update = (fn: (d: DB) => DB) => {
      if (!ref.current) return
      ref.current = fn(ref.current)
      setDb(ref.current)
    }
    const patchRun = (id: string, p: Partial<Run>) => update((d) => ({ ...d, runs: d.runs.map((r) => (r._id === id ? { ...r, ...p } : r)) }))
    const seedOf = (r: Run) => (r.investorId ? (() => { const i = inv.current.find((x) => x._id === r.investorId); return i?.name === 'Kite Angels' ? KITE : i ? genericSeed(i) : KITE })() : SENDERS[r.email ?? ''] ?? SENDERS['mina@fieldnote.example.com'])

    /** Start queued runs while fewer than two run, like the real queue. */
    const pump = () => {
      const d = ref.current
      if (!d) return
      const free = 2 - d.runs.filter((r) => r.status === 'running').length
      const next = d.runs.filter((r) => r.status === 'queued').sort((a, b) => a.startedAt - b.startedAt).slice(0, Math.max(0, free))
      for (const r of next) {
        patchRun(r._id, { status: 'running', startedAt: Date.now(), steps: r.steps.map((s, k) => ({ ...s, state: k === 0 ? 'running' : 'waiting' })) })
        tick(r._id, 0)
      }
    }
    /** One pretend step every STEP_MS, then the facts. */
    const tick = (id: string, k: number) => {
      timers.current.set(id, setTimeout(() => {
        const r = ref.current?.runs.find((x) => x._id === id)
        if (!r || r.status !== 'running') return
        const seed = seedOf(r)
        const steps = r.steps.map((s, j) => (j < k + 1 ? { label: seed.found[j]?.[0] ?? s.label, state: 'done' as const, ...(seed.found[j]?.[1] ? { source: seed.found[j][1] } : {}) } : j === k + 1 ? { ...s, state: 'running' as const, source: j === 2 ? 'reading 3 news pages' : undefined } : s))
        const total = estimate('enrich', r.model ?? HAIKU).usd
        const costUsd = Math.round(((k + 1) / r.steps.length) * total * 1000) / 1000
        if (k + 1 < r.steps.length) {
          patchRun(id, { steps, costUsd })
          tick(id, k + 1)
          return
        }
        const i = inv.current.find((x) => x._id === r.investorId)
        const facts = factsOf(seed, id, { inv: i, email: r.email, only: i?.name === 'Kite Angels' ? REVIEW_ONLY : undefined })
        update((d) => {
          const old = (f: Fact) => (r.investorId ? f.investorId === r.investorId : f.email === r.email && !f.investorId)
          const settled = new Set(d.facts.filter((f) => old(f) && f.status !== 'pending').map((f) => f.group + f.field + f.value))
          return {
            ...d,
            facts: [...d.facts.filter((f) => !(old(f) && f.status === 'pending')), ...facts.filter((f) => !settled.has(f.group + f.field + f.value))],
            runs: d.runs.map((x) => (x._id === id ? { ...x, status: 'done', steps, costUsd: total, finishedAt: Date.now(), factCount: facts.length, verdict: seed.verdict, summary: seed.summary } : x)),
          }
        })
        pump()
      }, STEP_MS))
    }
    const queueRun = (t: { investorId?: string; email?: string; model?: Model }) => {
      const open = ref.current?.runs.find((r) => (t.investorId ? r.investorId === t.investorId : r.email === t.email && !r.investorId) && (r.status === 'queued' || r.status === 'running'))
      if (open) return open._id
      const id = uid('r')
      update((d) => ({ ...d, runs: [...d.runs, { _id: id, ...t, model: t.model ?? d.models.features.enrich ?? d.models.default, status: 'queued', auto: false, costUsd: 0, startedAt: Date.now(), steps: (t.investorId ? STEPS : SENDER_STEPS).map((label) => ({ label, state: 'waiting' as const })) }] }))
      pump()
      return id
    }
    const keepOne = async (factId: string) => {
      const f = ref.current?.facts.find((x) => x._id === factId)
      if (!f || f.status === 'kept') return f?.clash ?? null
      const i = inv.current.find((x) => x._id === f.investorId)
      const w = i ? investorWrite(i, f) : {}
      if (i && w.patch) await saveRef.current(i._id, { ...fieldsOf(i), ...w.patch })
      update((d) => {
        let people = d.people
        if (i && f.group === 'person') {
          const name = d.facts.find((x) => x.runId === f.runId && x.group === 'person' && x.field === 'name')?.value ?? i.name
          const p = people.find((x) => x.name === name)
          const patch = { [f.field]: f.value } as Partial<Person>
          people = p ? people.map((x) => (x === p ? { ...x, ...patch } : x)) : [...people, { _id: uid('p'), investorId: i._id, name, primary: !people.some((x) => x.investorId === i._id && x.primary), ...(i.email ? { email: i.email } : {}), ...patch }]
        } else if (i && f.field === 'partner' && f.person && !people.some((x) => x.name === f.person!.name)) people = [...people, { _id: uid('p'), investorId: i._id, ...f.person, primary: false }]
        return { ...d, people, facts: d.facts.map((x) => (x._id === factId ? { ...x, status: 'kept', keptAt: Date.now(), clash: w.clash } : x)) }
      })
      return w.clash ?? null
    }
    const setStatus = (ids: string[], status: Fact['status']) => update((d) => ({ ...d, facts: d.facts.map((x) => (ids.includes(x._id) ? { ...x, status } : x)) }))
    const pendingOf = (runId: string) => (ref.current?.facts ?? []).filter((f) => f.runId === runId && f.status === 'pending')
    const wait = () => new Promise((r) => setTimeout(r, 120))
    const a: AIActions = {
      enrich: async (id, model) => (ref.current?.connected ? queueRun({ investorId: id, email: inv.current.find((x) => x._id === id)?.email, model }) : noKey()),
      enrichMany: async (ids) => (ref.current?.connected ? ids.map((id) => queueRun({ investorId: id })) : noKey()),
      lookup: async (email) => (ref.current?.connected ? queueRun({ email }) : noKey()),
      stop: async (runId) => {
        clearTimeout(timers.current.get(runId))
        patchRun(runId, { status: 'stopped', finishedAt: Date.now() })
        pump()
      },
      keep: async (factId) => {
        await wait()
        return keepOne(factId)
      },
      dismiss: async (factId) => setStatus([factId], 'dismissed'),
      undoDismiss: async (factId) => setStatus([factId], 'pending'),
      keepAll: async (runId) => {
        const fs = pendingOf(runId)
        for (const f of fs) await keepOne(f._id)
        return fs.length
      },
      dismissAll: async (runId) => {
        const fs = pendingOf(runId)
        setStatus(fs.map((f) => f._id), 'dismissed')
        return fs.length
      },
      setAuto: async (p) => update((d) => ({ ...d, settings: { ...d.settings, ...p } })),
      setModel: async (feature, model) => {
        update((d) => {
          if (!feature) return { ...d, models: { ...d.models, default: model ?? HAIKU } }
          const features = { ...d.models.features }
          if (model) features[feature] = model
          else delete features[feature]
          return { ...d, models: { ...d.models, features } }
        })
        return ref.current!.models
      },
      addSender: async (email, investorId) => {
        const d = ref.current!
        const run = latestRun(d.runs, (r) => r.email === email && !r.investorId)
        const facts = d.facts.filter((f) => run && f.runId === run._id && f.status !== 'dismissed')
        const val = (g: string, k: string) => facts.find((f) => f.group === g && f.field === k)?.value
        const name = val('person', 'name') ?? email.split('@')[0]
        let id = investorId
        const target = id ? inv.current.find((x) => x._id === id) : undefined
        if (target) await saveRef.current(target._id, { ...fieldsOf(target), emails: [...(target.emails ?? []), email] })
        else id = await saveRef.current(null, { ...NEW_INVESTOR, name: val('fund', 'name') || name, firm: val('fund', 'name') ?? '', email, source: 'Who’s this?' })
        update((x) => ({
          ...x,
          runs: x.runs.map((r) => (r._id === run?._id ? { ...r, investorId: id } : r)),
          facts: x.facts.map((f) => (facts.includes(f) ? { ...f, investorId: id } : f)),
          people: [...x.people, { _id: uid('p'), investorId: id!, name, email, primary: !x.people.some((p) => p.investorId === id && p.primary) }],
        }))
        return id!
      },
      addPerson: async (investorId, p) => update((d) => ({ ...d, people: [...d.people, { _id: uid('p'), investorId, ...p, primary: !d.people.some((x) => x.investorId === investorId && x.primary) }] })),
      setPrimary: async (personId) =>
        update((d) => {
          const p = d.people.find((x) => x._id === personId)
          return { ...d, people: d.people.map((x) => (x.investorId === p?.investorId ? { ...x, primary: x._id === personId } : x)) }
        }),
    }
    if (!fail) return a
    const failing = async () => {
      await new Promise((r) => setTimeout(r, 400))
      throw new Error('Preview: writes fail (&fail)')
    }
    return Object.fromEntries(Object.keys(a).map((k) => [k, failing])) as unknown as AIActions
  }, [fail])

  const ai = useMemo<AIData>(() => {
    if (!db) return NO_AI
    const runs = new Map<string, Run>()
    for (const r of [...db.runs].sort((a, b) => b.startedAt - a.startedAt)) if (r.investorId && !runs.has(r.investorId)) runs.set(r.investorId, r)
    const senders = new Map<string, Run>()
    for (const r of [...db.runs].sort((a, b) => b.startedAt - a.startedAt)) if (!r.investorId && r.email && !senders.has(r.email)) senders.set(r.email, r)
    const names = new Map((investors ?? []).map((i) => [i._id, i.name]))
    const spent = db.runs.reduce((s, r) => s + r.costUsd, 0)
    const m = monthOf(db.state)
    const byFeature = { ...m.byFeature, enrich: m.byFeature.enrich + spent }
    const byModel = { ...m.byModel }
    for (const r of db.runs) byModel[r.model ?? HAIKU] += r.costUsd
    return {
      loaded: true,
      connected: db.connected,
      settings: db.settings,
      models: db.models,
      features: m.features,
      spend: { byModel, byFeature },
      month: { usd: db.connected ? Object.values(byFeature).reduce((s, x) => s + x, 0) : 0, lookups: db.connected ? 42 : 0, enrichments: db.connected ? 9 : 0, noteReads: 6, asks: 11 },
      capLeft: 24,
      runs: [...runs.values()].map((r) => ({ ...r, pending: db.facts.filter((f) => f.investorId === r.investorId && f.status === 'pending').length })),
      senders: [...senders.entries()].map(([email, run]) => ({ email, run, facts: db.facts.filter((f) => f.runId === run._id && f.status !== 'dismissed' && !f.investorId) })),
      recent: [
        ...[...db.runs].map((r): RecentRun => ({ _id: r._id, at: r.finishedAt ?? r.startedAt, investor: r.investorId ? names.get(r.investorId) : undefined, email: r.email, wasInvestor: !!r.investorId, facts: r.factCount ?? 0, costUsd: r.costUsd, status: r.status, cached: !!r.cached, model: r.model })),
        // PST-279: an Ask Nest question and this morning's brief.
        ...(db.connected ? asksAndBriefs(db.state) : []),
      ]
        .sort((a, b) => b.at - a.at)
        .slice(0, 8),
    }
  }, [db, investors])

  const useInvestorAI = (id: string | null): InvestorAI | undefined => {
    if (!db || !id) return undefined
    return {
      run: latestRun(db.runs, (r) => r.investorId === id) ?? null,
      facts: db.facts.filter((f) => f.investorId === id && f.status !== 'dismissed'),
      people: db.people.filter((p) => p.investorId === id).sort((a, b) => Number(b.primary) - Number(a.primary)),
    }
  }
  return { ai, aiDo: actions, useInvestorAI }
}
