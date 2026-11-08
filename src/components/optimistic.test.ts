// PST-290: the optimistic updates behind instant changes: a logged touch shows
// at once, and its Undo takes it back, before the server answers.
import type { OptimisticLocalStore } from 'convex/browser'
import { getFunctionName } from 'convex/server'
import { describe, expect, it } from 'vitest'
import { api } from '../../convex/_generated/api'
import { showKit, showTick } from './close/optimistic'
import { hideMark, hideQuestion, showMark, showMerge, showQuestionBack, showUnmerge } from './qanda/optimistic'
import { hideSuggestions, hideTouch, showAdvance, showAI, showFactBack, showFacts, showGoogle, showMaterials, showPrepTick, showSave, showSuggestionsBack, showTouch } from './optimistic'

/** An in-memory stand-in for Convex's local query results. */
function fakeStore(seed: [unknown, Record<string, unknown>, unknown][]) {
  const m = new Map<string, unknown>()
  const key = (q: unknown, args: Record<string, unknown>) => getFunctionName(q as never) + JSON.stringify(args)
  for (const [q, args, v] of seed) m.set(key(q, args), v)
  const store = {
    getQuery: (q: unknown, args: Record<string, unknown>) => m.get(key(q, args)),
    setQuery: (q: unknown, args: Record<string, unknown>, v: unknown) => void m.set(key(q, args), v),
    getAllQueries: (q: unknown) => {
      const name = getFunctionName(q as never)
      return [...m].filter(([k]) => k.startsWith(name + '{')).map(([k, value]) => ({ args: JSON.parse(k.slice(name.length)), value }))
    },
  }
  return { store: store as unknown as OptimisticLocalStore, get: <T = never>(q: unknown, args: Record<string, unknown> = {}) => m.get(key(q, args)) as T }
}

const T = '2030-03-10'
const inv = { _id: 'inv1', name: 'Made-up Capital', stage: 'm1', maxStage: 'm1', lastTouch: '2030-03-01', nextStep: 'Send the deck', nextDate: '2030-03-12' }
const old = { _id: 'act0', investorId: 'inv1', kind: 'note', note: 'Intro call', date: '2030-03-01', by: 'Dev' }

describe('optimistic touch with Undo', () => {
  it('shows the touch on the investor and in both activity lists at once', () => {
    const { store, get } = fakeStore([
      [api.investors.list, {}, [inv]],
      [api.activities.recent, {}, [old]],
      [api.activities.forInvestor, { investorId: 'inv1' }, [old]],
    ])
    showTouch(store, { id: 'inv1' as never, note: ' Called about the round ', touch: 'call', next: { step: 'Send numbers', date: '2030-03-14' } }, 'Dev', T)
    expect(get(api.investors.list)).toEqual([{ ...inv, lastTouch: T, nextStep: 'Send numbers', nextDate: '2030-03-14' }])
    const recent = get(api.activities.recent) as { note: string; touch: string; date: string; by: string }[]
    expect(recent).toHaveLength(2)
    expect(recent[0]).toMatchObject({ note: 'Called about the round', touch: 'call', date: T, by: 'Dev' })
    expect((get(api.activities.forInvestor, { investorId: 'inv1' }) as unknown[])[0]).toBe(recent[0])
  })

  it('Undo takes the row away and puts the fields back', () => {
    const touched = { ...inv, lastTouch: T, nextStep: 'Send numbers', nextDate: '2030-03-14' }
    const row = { ...old, _id: 'act1', note: 'Called', date: T }
    const { store, get } = fakeStore([
      [api.investors.list, {}, [touched]],
      [api.activities.recent, {}, [row, old]],
      [api.activities.forInvestor, { investorId: 'inv1' }, [row, old]],
    ])
    const from = { lastTouch: inv.lastTouch, nextStep: inv.nextStep, nextDate: inv.nextDate }
    const set = { lastTouch: T, nextStep: 'Send numbers', nextDate: '2030-03-14' }
    hideTouch(store, { id: 'inv1' as never, activityId: 'act1' as never, from, set })
    expect(get(api.investors.list)).toEqual([inv])
    expect(get(api.activities.recent)).toEqual([old])
    expect(get(api.activities.forInvestor, { investorId: 'inv1' })).toEqual([old])
  })

  it('does nothing before the list has loaded', () => {
    const { store, get } = fakeStore([])
    showTouch(store, { id: 'inv1' as never, note: 'x' }, 'Dev', T)
    expect(get(api.investors.list)).toBeUndefined()
  })
})

describe('optimistic stage move', () => {
  it('moves one stage on at once, with the next step', () => {
    const { store, get } = fakeStore([[api.investors.list, {}, [inv]]])
    showAdvance(store, { id: 'inv1' as never, next: { step: 'Partner call', date: '2030-03-20' } }, T)
    expect(get(api.investors.list)).toEqual([{ ...inv, stage: 'm2', maxStage: 'm2', lastTouch: T, nextStep: 'Partner call', nextDate: '2030-03-20' }])
  })
})

// PST-298: the rest of what a user changes shows first too.
describe('optimistic edits and toggles', () => {
  it('shows an edited investor at once: trimmed fields, and a new stage dates the touch', () => {
    const { store, get } = fakeStore([[api.investors.list, {}, [inv]]])
    const fields = { name: ' Made-up Capital ', firm: '', type: 'VC', geo: 'India', warmth: 'warm', path: '', tier: 'A', wave: 2, stage: 'dd', lead: false, nextStep: ' Send the model ', notes: '', source: '', expected: -5, lastTouch: '2030-03-01' }
    showSave(store, { id: 'inv1' as never, fields: fields as never }, T)
    expect(get(api.investors.list)[0]).toMatchObject({ name: 'Made-up Capital', wave: 2, stage: 'dd', maxStage: 'dd', lastTouch: T, nextStep: 'Send the model', expected: 0 })
  })

  it('leaves a new investor to the server (it needs its id)', () => {
    const { store, get } = fakeStore([[api.investors.list, {}, [inv]]])
    showSave(store, { fields: { name: 'New one' } as never }, T)
    expect(get(api.investors.list)).toEqual([inv])
  })

  it('ticks and unticks a prep to-do', () => {
    const { store, get } = fakeStore([[api.prep.list, { phaseKey: 'p1' }, [{ item: 0, doneAt: 1, by: 'Dev' }]]])
    showPrepTick(store, { phaseKey: 'p1', item: 2, done: true }, 'Dev')
    expect((get(api.prep.list, { phaseKey: 'p1' }) as { item: number }[]).map((r) => r.item)).toEqual([0, 2])
    showPrepTick(store, { phaseKey: 'p1', item: 0, done: false }, 'Dev')
    expect((get(api.prep.list, { phaseKey: 'p1' }) as { item: number }[]).map((r) => r.item)).toEqual([2])
  })

  it('answers a meeting and stops asking about a person, on your own meetings only', () => {
    const p = { email: 'someone@example.com', name: 'Someone' }
    const g = { me: { running: false }, team: [], threads: [], meetings: [{ eventId: 'e1', mine: true, people: [p] }, { eventId: 'e2', mine: false, people: [p] }] }
    const { store, get } = fakeStore([[api.google.data, {}, g]])
    showGoogle(store, { eventId: 'e1', answer: 'm2' })
    showGoogle(store, { dismiss: ' Someone@Example.com ' })
    expect(get<typeof g>(api.google.data).meetings).toEqual([{ eventId: 'e1', mine: true, people: [p], answer: 'm2', dismissed: ['someone@example.com'] }, g.meetings[1]])
  })

  it('switches a feature back to the default model', () => {
    const d = { models: { default: 'claude-haiku', features: { drafts: 'claude-sonnet', ask: 'claude-sonnet' } } }
    const { store, get } = fakeStore([[api.enrich.data, {}, d]])
    showAI(store, { feature: 'drafts', model: null })
    expect(get<typeof d>(api.enrich.data).models.features).toEqual({ ask: 'claude-sonnet' })
  })

  it('makes a version current, and a deleted material takes its versions and links with it', () => {
    const d = {
      materials: [{ _id: 'm1', currentVersionId: 'v1' }], versions: [{ _id: 'v1', materialId: 'm1' }, { _id: 'v2', materialId: 'm1' }],
      links: [{ _id: 'l1', materialId: 'm1' }], stats: [{ linkId: 'l1' }], notices: [{ linkId: 'l1' }],
    }
    const { store, get } = fakeStore([[api.materials.data, {}, d]])
    showMaterials(store, { current: 'v2' as never })
    expect(get<typeof d>(api.materials.data).materials[0].currentVersionId).toBe('v2')
    showMaterials(store, { remove: 'm1' as never })
    expect(get(api.materials.data)).toEqual({ materials: [], versions: [], links: [], stats: [], notices: [] })
  })
})

describe('optimistic decisions with an instant Undo', () => {
  it('a dismissed suggestion leaves the queue, and Undo puts it straight back', () => {
    const s1 = { _id: 's1', kind: 'stale', createdAt: 1 }
    const s2 = { _id: 's2', kind: 'stale', createdAt: 2 }
    const { store, get } = fakeStore([[api.suggestions.list, {}, [s1, s2]]])
    hideSuggestions(store, { ids: ['s1' as never] })
    expect(get(api.suggestions.list)).toEqual([s2])
    showSuggestionsBack(store, ['s1' as never])
    expect((get(api.suggestions.list) as unknown[]).length).toBe(2)
    expect(get(api.suggestions.list)).toContainEqual(s1)
  })

  it('a dismissed fact leaves the drawer and the count, and its Undo brings both back', () => {
    const f = { _id: 'f1', runId: 'r1', investorId: 'inv1', status: 'pending' }
    const kept = { _id: 'f2', runId: 'r1', investorId: 'inv1', status: 'kept' }
    const { store, get } = fakeStore([
      [api.enrich.forInvestor, { investorId: 'inv1' }, { run: null, facts: [f, kept], people: [] }],
      [api.enrich.data, {}, { senders: [], runs: [{ _id: 'r1', investorId: 'inv1', pending: 1 }] }],
    ])
    showFacts(store, { factId: 'f1' as never }, 'dismissed')
    expect(get<{ facts: unknown[] }>(api.enrich.forInvestor, { investorId: 'inv1' }).facts).toEqual([kept])
    expect(get<{ runs: { pending: number }[] }>(api.enrich.data).runs[0].pending).toBe(0)
    showFactBack(store, 'f1' as never)
    expect(get<{ facts: unknown[] }>(api.enrich.forInvestor, { investorId: 'inv1' }).facts).toEqual([kept, f])
    expect(get<{ runs: { pending: number }[] }>(api.enrich.data).runs[0].pending).toBe(1)
  })

  it('Keep all keeps every pending fact of the run', () => {
    const facts = [{ _id: 'f1', runId: 'r1', investorId: 'inv1', status: 'pending' }, { _id: 'f3', runId: 'r0', investorId: 'inv1', status: 'pending' }]
    const { store, get } = fakeStore([[api.enrich.forInvestor, { investorId: 'inv1' }, { run: null, facts, people: [] }]])
    showFacts(store, { runId: 'r1' as never }, 'kept')
    expect(get<{ facts: { status: string }[] }>(api.enrich.forInvestor, { investorId: 'inv1' }).facts.map((x) => x.status)).toEqual(['kept', 'pending'])
  })
})

describe('optimistic Close', () => {
  const verbal = { ...inv, stage: 'verbal', maxStage: 'verbal' }
  const c = { _id: 'c1', investorId: 'inv1', amount: 50000, cap: 8000000, steps: [{ key: 'sent', at: '2030-03-05' }] }

  it('ticking "signed" ticks it and moves the investor to Signed at once', () => {
    const { store, get } = fakeStore([
      [api.investors.list, {}, [verbal]],
      [api.closings.data, {}, { closings: [c], allocations: [], tranche2: null, capTable: null }],
    ])
    showTick(store, { id: 'c1' as never, key: 'signed', at: T }, T)
    expect(get<{ closings: (typeof c)[] }>(api.closings.data).closings[0].steps.map((x) => x.key)).toEqual(['sent', 'signed'])
    expect(get(api.investors.list)[0]).toMatchObject({ stage: 'signed', maxStage: 'signed', lastTouch: T })
  })

  it('a tick the server would refuse shows nothing', () => {
    const data = { closings: [{ ...c, steps: [] }], allocations: [], tranche2: null, capTable: null }
    const { store, get } = fakeStore([[api.investors.list, {}, [verbal]], [api.closings.data, {}, data]])
    showTick(store, { id: 'c1' as never, key: 'signed', at: T }, T)
    expect(get(api.closings.data)).toBe(data)
  })

  it('moving a commitment to tranche 2 takes tranche 2’s cap', () => {
    const { store, get } = fakeStore([[api.closings.data, {}, { closings: [c], allocations: [], tranche2: { cap: 12000000 }, capTable: null }]])
    showKit(store, { id: 'c1' as never, tranche: 2 })
    expect(get<{ closings: unknown[] }>(api.closings.data).closings[0]).toMatchObject({ tranche: 2, cap: 12000000 })
  })
})

describe('optimistic Q&A with an instant Undo', () => {
  const ask = (id: string, extra = {}) => ({ _id: id, investorId: 'inv1', date: '2030-03-01', source: 'manual', ...extra })
  const q = (id: string, text: string, asks: unknown[], bestAnswer = '') => ({ _id: id, text, theme: 'Market', bestAnswer, answerVersions: [], onDeck: false, askedCount: asks.length, createdAt: 1, updatedAt: 1, asks })
  type Bank = { questions: { _id: string; askedCount: number; bestAnswer: string; asks: unknown[] }[]; noteCount: number }

  it('merge moves every ask over, and its Undo splits them again', () => {
    const drop = q('q1', 'How big is the market?', [ask('a1')], 'Large')
    const keep = q('q2', 'What is the market size?', [ask('a2')])
    const { store, get } = fakeStore([[api.qanda.bank, {}, { questions: [drop, keep], noteCount: 0 }]])
    showMerge(store, { dropId: 'q1' as never, keepId: 'q2' as never })
    expect(get<Bank>(api.qanda.bank).questions).toEqual([{ ...keep, asks: [ask('a2'), ask('a1')], askedCount: 2, bestAnswer: 'Large', slideRef: undefined }])
    showUnmerge(store, 'q1' as never)
    expect(get<Bank>(api.qanda.bank).questions).toEqual([{ ...keep, slideRef: undefined }, drop])
  })

  it('a deleted question comes back at once on Undo', () => {
    const one = q('q1', 'Why now?', [ask('a1')])
    const { store, get } = fakeStore([[api.qanda.bank, {}, { questions: [one], noteCount: 0 }]])
    hideQuestion(store, 'q1' as never)
    expect(get<Bank>(api.qanda.bank).questions).toEqual([])
    showQuestionBack(store, 'q1' as never)
    expect(get<Bank>(api.qanda.bank).questions).toEqual([one])
  })

  it('picking a note line adds it to the question with the same words, or as a new one; un-picking takes it out', () => {
    const note = { _id: 'n1', investorId: 'inv1', date: '2030-03-02', text: 'Intro\n- how big is the market?\n- Why now?', by: 'Dev' }
    const { store, get } = fakeStore([
      [api.qanda.bank, {}, { questions: [q('q1', 'How big is the market', [])], noteCount: 1 }],
      [api.qanda.notesFor, { investorId: 'inv1' }, [note]],
    ])
    showMark(store, { noteId: 'n1' as never, line: 1 })
    showMark(store, { noteId: 'n1' as never, line: 2 })
    const after = get<Bank>(api.qanda.bank).questions
    expect(after.map((x) => [x._id.startsWith('optimistic-') ? 'new' : x._id, x.askedCount])).toEqual([['q1', 1], ['new', 1]])
    hideMark(store, { noteId: 'n1' as never, line: 2 })
    expect(get<Bank>(api.qanda.bank).questions.map((x) => x._id)).toEqual(['q1'])
  })
})
