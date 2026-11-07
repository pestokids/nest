// PST-283: Close. SAFE conversion maths, dilution, the cap table, step order and stage moves, the ladder and reminders.
import { describe, expect, it } from 'vitest'
import { classifyMove } from './board'
import {
  capTableAfter, capTableCsv, checkTick, checkUntick, cleanTerms, compareCaps, convertSafes, dilution, effectiveTerms, ladder, nextAction,
  reminderKind, reminderText, rungOf, scenarioSafes, setStep, stageMove, STEP_KEYS, suggestCut, termsLine, validateCapTable, validateTerms,
  whatsappUrl, type Closing, type Safe, type Step, type StepKey,
} from './close'
import type { Investor } from './pipeline'
import type { Stage } from './stages'

const safe = (id: string, amount: number, cap: number, more: Partial<Safe> = {}): Safe => ({ id, name: id, amount, cap, ...more })
const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0)

describe('SAFE conversion (post-money)', () => {
  it('owns amount ÷ cap, each SAFE on its own', () => {
    const c = convertSafes([safe('a', 100_000, 10_000_000), safe('b', 250_000, 16_000_000), safe('c', 50_000, 8_000_000)])
    expect(c.map((s) => s.ownership)).toEqual([0.01, 0.015625, 0.00625])
    expect(c.map((s) => s.valuation)).toEqual([10_000_000, 16_000_000, 8_000_000])
  })

  it('ignores a discount when there is no next round to price it against', () => {
    const [s] = convertSafes([safe('a', 100_000, 10_000_000, { discount: 0.2 })])
    expect(s.ownership).toBe(0.01)
  })

  it('uses the discount when (1 − discount) × next pre-money is below the cap', () => {
    const [s] = convertSafes([safe('a', 120_000, 20_000_000, { discount: 0.2 })], { nextPreMoney: 15_000_000 })
    expect(s.valuation).toBe(12_000_000)
    expect(s.ownership).toBeCloseTo(0.01, 12)
  })

  it('uses the cap when the cap is the better price', () => {
    const [s] = convertSafes([safe('a', 100_000, 10_000_000, { discount: 0.2 })], { nextPreMoney: 20_000_000 })
    expect(s.valuation).toBe(10_000_000)
  })

  it('MFN takes the lowest cap and the highest discount of the other SAFEs', () => {
    const all = [safe('mfn', 50_000, 20_000_000, { mfn: true }), safe('b', 100_000, 16_000_000), safe('c', 100_000, 12_000_000, { discount: 0.1 })]
    expect(effectiveTerms(all[0], all)).toEqual({ cap: 12_000_000, discount: 0.1 })
    expect(convertSafes(all)[0].ownership).toBeCloseTo(50_000 / 12_000_000, 12)
  })

  it('MFN keeps its own terms when they are already the best', () => {
    const all = [safe('mfn', 50_000, 8_000_000, { mfn: true, discount: 0.25 }), safe('b', 100_000, 16_000_000, { discount: 0.1 })]
    expect(effectiveTerms(all[0], all)).toEqual({ cap: 8_000_000, discount: 0.25 })
  })

  it('without MFN a SAFE never borrows better terms', () => {
    const all = [safe('a', 50_000, 20_000_000), safe('b', 100_000, 12_000_000)]
    expect(effectiveTerms(all[0], all)).toEqual({ cap: 20_000_000, discount: 0 })
  })
})

describe('dilution', () => {
  const sets: [Safe[], number, number?][] = [
    [[safe('a', 1_500_000, 16_000_000)], 0.1],
    [[safe('a', 100_000, 10_000_000), safe('b', 250_000, 16_000_000, { discount: 0.2 }), safe('c', 50_000, 8_000_000, { mfn: true })], 0.12, 14_000_000],
    [[], 0.1],
    [[safe('a', 400_000, 12_000_000), safe('b', 25_000, 12_000_000), safe('c', 75_000, 12_000_000)], 0],
  ]
  it.each(sets)('founders, pool and SAFE holders add up to 100%% (%#)', (safes, poolPct, nextPreMoney) => {
    const d = dilution(safes, { poolPct, nextPreMoney })
    expect(d.founders + d.pool + d.safeTotal).toBeCloseTo(1, 12)
    expect(d.safeTotal).toBeCloseTo(sum(d.safes.map((s) => s.ownership)), 12)
    expect(d.over).toBe(false)
  })

  it('matches the design: $1.5M at a $16M cap with a 10% pool', () => {
    const d = dilution([safe('round', 1_500_000, 16_000_000)], { poolPct: 0.1 })
    expect(d.safeTotal).toBeCloseTo(0.09375, 12)
    expect(d.founders).toBeCloseTo(0.80625, 12)
  })

  it('flags a model where SAFEs and the pool want more than everything', () => {
    expect(dilution([safe('a', 9_000_000, 10_000_000)], { poolPct: 0.2 }).over).toBe(true)
  })

  it('compares caps 25% either side, to the nearest $1M', () => {
    expect(compareCaps(16_000_000)).toEqual([12_000_000, 20_000_000])
    expect(compareCaps(1_000_000)).toEqual([1_000_000, 1_000_000])
  })
})

describe('cap table after the close', () => {
  const table = { founders: [{ name: 'Founder A', shares: 4_500_000 }, { name: 'Founder B', shares: 4_500_000 }], optionPool: 1_000_000, safes: [{ name: 'Earlier SAFE', amount: 50_000, cap: 5_000_000 }] }
  const round = [{ name: 'Marigold Capital', amount: 400_000, cap: 16_000_000 }, { name: 'Asha Linden', amount: 25_000, cap: 16_000_000, mfn: true }]

  it('converts every SAFE at its cap and adds up to 100% before and after', () => {
    const t = capTableAfter(table, round)!
    expect(sum(t.rows.map((r) => r.before.pct))).toBeCloseTo(1, 12)
    expect(sum(t.rows.map((r) => r.after.pct))).toBeCloseTo(1, 12)
    expect(sum(t.rows.map((r) => r.after.shares))).toBeCloseTo(t.after, 6)
    const by = Object.fromEntries(t.rows.map((r) => [r.holder, r]))
    expect(by['Marigold Capital'].after.pct).toBeCloseTo(400_000 / 16_000_000, 12)
    expect(by['Earlier SAFE'].after.pct).toBeCloseTo(0.01, 12)
    // MFN: the earlier SAFE's $5M cap is the best in the table.
    expect(by['Asha Linden'].after.pct).toBeCloseTo(25_000 / 5_000_000, 12)
    expect(by['Founder A'].before.pct).toBeCloseTo(0.45, 12)
    expect(by['Founder A'].after.shares).toBe(4_500_000)
    expect(by['Option pool'].kind).toBe('Reserved')
    expect(by['Marigold Capital'].before.shares).toBe(0)
  })

  it('gives up when the SAFEs would own everything, or nothing is entered', () => {
    expect(capTableAfter(table, [{ name: 'Too much', amount: 16_000_000, cap: 16_000_000 }])).toBeNull()
    expect(capTableAfter({ founders: [], optionPool: 0 }, round)).toBeNull()
  })

  it('exports as CSV', () => {
    const csv = capTableCsv(capTableAfter({ founders: [{ name: 'Founder, A', shares: 900 }], optionPool: 100 }, [{ name: 'S', amount: 10, cap: 100 }])!.rows)
    expect(csv.split('\n')[0]).toBe('holder,type,invested,shares before,% before,shares after,% after')
    expect(csv).toContain('"Founder, A",Common,,900,90.00,900,81.00')
    expect(csv).toContain('S,SAFE,10,0,0.00,111,10.00')
  })

  it('validates the Settings card', () => {
    expect(validateCapTable({ founders: [], optionPool: 0 })).toHaveProperty('founders')
    expect(validateCapTable({ founders: [{ name: '', shares: 1.5 }], optionPool: -1 })).toEqual({
      'founders.0.name': 'Required.', 'founders.0.shares': 'A whole number of shares.', optionPool: 'A whole number of shares, or 0.',
    })
    expect(validateCapTable(table)).toEqual({})
  })
})

describe('steps', () => {
  const today = '2026-11-07'
  const steps = (xs: [StepKey, string][]): Step[] => xs.map(([key, at]) => ({ key, at }))

  it('go in order', () => {
    expect(checkTick([], 'sent', '2026-11-02', today)).toBeNull()
    expect(checkTick([], 'signed', '2026-11-02', today)).toBe('Tick “SAFE sent” first.')
    expect(checkTick(steps([['sent', '2026-11-02']]), 'countersigned', '2026-11-03', today)).toBe('Tick “Signed by them” first.')
    expect(checkTick(steps([['sent', '2026-11-02'], ['signed', '2026-11-03']]), 'wired', '2026-11-04', today)).toBe('Tick “Countersigned” first.')
    expect(checkTick(steps([['sent', '2026-11-02'], ['signed', '2026-11-03'], ['countersigned', '2026-11-04']]), 'wired', '2026-11-05', today)).toBeNull()
  })

  it('viewed and wire instructions are optional', () => {
    const s = steps([['sent', '2026-11-02'], ['signed', '2026-11-03'], ['countersigned', '2026-11-04']])
    expect(checkTick(s, 'wired', '2026-11-04', today)).toBeNull()
    expect(checkTick(steps([['sent', '2026-11-02']]), 'signed', '2026-11-02', today)).toBeNull()
  })

  it('dates stay in order and out of the future', () => {
    const s = steps([['sent', '2026-11-03'], ['signed', '2026-11-05']])
    expect(checkTick(s, 'countersigned', '2026-11-04', today)).toBe('Can’t be before “Signed by them”.')
    expect(checkTick(s, 'countersigned', '2026-11-08', today)).toBe('Can’t be in the future.')
    expect(checkTick(s, 'sent', '2026-11-06', today)).toBe('Can’t be after “Signed by them”.')
    expect(checkTick(s, 'sent', 'soon', today)).toBe('Pick a date.')
  })

  it('untick from the end', () => {
    const s = steps([['sent', '2026-11-03'], ['viewed', '2026-11-04'], ['signed', '2026-11-05']])
    expect(checkUntick(s, 'sent')).toBe('Untick “Viewed” first.')
    expect(checkUntick(s, 'signed')).toBeNull()
    expect(checkUntick(s, 'wired')).toBe('Not ticked.')
    expect(setStep(s, 'signed', null).map((x) => x.key)).toEqual(['sent', 'viewed'])
    expect(setStep(steps([['signed', '2026-11-05']]), 'sent', '2026-11-03').map((x) => x.key)).toEqual(['sent', 'signed'])
  })
})

describe('steps move pipeline stages', () => {
  it('SAFE signed → Signed, wired → Money in', () => {
    expect(stageMove('verbal', 'signed', true)).toEqual({ to: 'signed' })
    expect(stageMove('signed', 'wired', true)).toEqual({ to: 'wired' })
  })

  it('other steps never move the card', () => {
    for (const k of ['sent', 'viewed', 'countersigned', 'wireSent'] as const) {
      expect(stageMove('verbal', k, true)).toEqual({ to: null })
      expect(stageMove('signed', k, false)).toEqual({ to: null })
    }
  })

  it('refuses a tick that would skip a stage', () => {
    expect(stageMove('dd', 'signed', true).error).toBe('That would skip a stage on the pipeline. Move them to Verbal first.')
    expect(stageMove('verbal', 'wired', true).error).toBe('That would skip a stage on the pipeline. Move them to Signed first.')
    expect(stageMove('m1', 'signed', true).error).toContain('skip 3 stages')
  })

  it('never moves a card back on a tick, and leaves passed and parked alone', () => {
    expect(stageMove('wired', 'signed', true)).toEqual({ to: null })
    expect(stageMove('signed', 'signed', true)).toEqual({ to: null })
    expect(stageMove('passed', 'signed', true)).toEqual({ to: null })
    expect(stageMove('parked', 'wired', true)).toEqual({ to: null })
  })

  it('unticking undoes only the move the tick made', () => {
    expect(stageMove('signed', 'signed', false)).toEqual({ to: 'verbal' })
    expect(stageMove('wired', 'wired', false)).toEqual({ to: 'signed' })
    expect(stageMove('wired', 'signed', false)).toEqual({ to: null })
    expect(stageMove('verbal', 'wired', false)).toEqual({ to: null })
  })

  it('a whole close from Verbal only ever moves one stage forward', () => {
    let stage: Stage = 'verbal'
    let s: Step[] = []
    const seen: Stage[] = [stage]
    for (const key of STEP_KEYS) {
      expect(checkTick(s, key, '2026-11-07', '2026-11-07')).toBeNull()
      s = setStep(s, key, '2026-11-07')
      const m = stageMove(stage, key, true)
      expect(m.error).toBeUndefined()
      if (m.to) {
        expect(classifyMove(stage, m.to).kind).toBe('next')
        stage = m.to
        seen.push(stage)
      }
    }
    expect(seen).toEqual(['verbal', 'signed', 'wired'])
  })
})

describe('the ladder', () => {
  const inv = (id: string, stage: Stage, more: Partial<Investor> = {}): Investor =>
    ({ _id: id, name: id, firm: '', type: 'Angel', geo: 'India', warmth: 'warm', path: '', tier: 'B', wave: 1, lead: false, nextStep: '', notes: '', source: '', maxStage: 'todo', stage, ...more }) as Investor
  const rec = (investorId: string, amount: number, keys: StepKey[]): Closing => ({
    _id: 'c' + investorId, investorId, amount, instrument: 'post-money SAFE', cap: 16_000_000, proRata: false, mfn: false, steps: keys.map((key) => ({ key, at: '2026-11-03' })),
  })

  it('puts each investor on one rung and adds up the amounts', () => {
    const investors = [
      inv('soft', 'dd', { expected: 25_000 }),
      inv('soft-no-amount', 'm2'),
      inv('early', 'm1', { expected: 50_000 }),
      inv('verbal', 'verbal', { expected: 40_000, committed: 50_000 }),
      inv('sent', 'verbal', { committed: 100_000 }),
      inv('signed', 'signed', { committed: 25_000 }),
      inv('wired', 'wired', { committed: 75_000 }),
      inv('passed', 'passed', { committed: 75_000 }),
    ]
    const l = ladder(investors, [rec('sent', 90_000, ['sent', 'viewed']), rec('signed', 25_000, ['sent', 'signed'])])
    expect(l.rows.map((r) => [r.investor._id, r.rung, r.amount, r.action])).toEqual([
      ['wired', 'wired', 75_000, null],
      ['signed', 'signed', 25_000, 'countersign'],
      ['sent', 'sent', 90_000, 'remind'],
      ['verbal', 'verbal', 50_000, 'record'],
      ['soft', 'soft', 25_000, 'confirm'],
    ])
    expect(l.rungs.sent).toEqual({ amount: 90_000, count: 1 })
    expect(l.committed).toBe(240_000)
    expect(l.total).toBe(265_000)
  })

  it('the next action follows the steps', () => {
    expect(nextAction('verbal', null)).toBe('record')
    expect(nextAction('sent', rec('x', 1, ['sent']))).toBe('remind')
    expect(nextAction('signed', rec('x', 1, ['sent', 'signed']))).toBe('countersign')
    expect(nextAction('signed', rec('x', 1, ['sent', 'signed', 'countersigned', 'wireSent']))).toBe('wired')
    expect(nextAction('wired', rec('x', 1, ['sent', 'signed', 'countersigned', 'wired']))).toBeNull()
    expect(rungOf(inv('x', 'verbal'), rec('x', 1, ['sent', 'signed', 'countersigned', 'wired']))).toBe('wired')
  })

  it('reads terms the way the table does', () => {
    expect(termsLine({ cap: 16_000_000, instrument: 'post-money SAFE', proRata: true, mfn: true, sideLetter: 'Information rights' })).toBe('$16M post cap · pro-rata · MFN · side letter')
    expect(termsLine({ cap: 8_000_000, instrument: 'pre-money SAFE', discount: 0.2 })).toBe('$8M pre cap · 20% discount')
    expect(termsLine(null)).toBe('–')
  })
})

describe('reminders', () => {
  const today = '2026-11-07'
  const closing = { amount: 100_000, signerName: 'Ria Marigold', requestUrl: 'https://sign.example.com/r/abc', steps: [{ key: 'sent' as const, at: '2026-11-03' }] }

  it('asks politely for a signature, with the date and the link', () => {
    const r = reminderText({ kind: 'sign', investorName: 'Marigold Capital', closing, me: 'Dev', today })
    expect(r.subject).toBe('Your SAFE for $100,000: a gentle reminder')
    expect(r.text).toBe(
      'Hi Ria,\n\nA gentle nudge on the SAFE for your $100,000 investment, whenever you have a moment. I sent it on Tue.\n\nHere’s the link again: https://sign.example.com/r/abc\n\nHappy to jump on a call if anything in it needs a second look.\n\nThanks so much,\nDev',
    )
  })

  it('greets the team without a signer and leaves out a missing link', () => {
    const r = reminderText({ kind: 'sign', investorName: 'Marigold Capital', closing: { amount: 50_000, steps: [{ key: 'sent', at: '2026-10-20' }] }, me: '', today })
    expect(r.text.startsWith('Hi Marigold Capital team,\n\n')).toBe(true)
    expect(r.text).toContain('I sent it on 20 Oct.')
    expect(r.text).not.toContain('link')
    expect(r.text.endsWith('Thanks so much')).toBe(true)
  })

  it('reminds about the wire once both sides have signed', () => {
    const steps: Step[] = [{ key: 'sent', at: '2026-10-28' }, { key: 'signed', at: '2026-11-01' }, { key: 'countersigned', at: '2026-11-02' }, { key: 'wireSent', at: '2026-11-06' }]
    const r = reminderText({ kind: 'wire', investorName: 'Neel Ember', closing: { amount: 75_000, signerName: 'Neel Ember', steps }, me: 'Dev', today })
    expect(r.subject).toBe('Your $75,000 wire: a gentle reminder')
    expect(r.text).toContain('Thank you again for signing. A gentle reminder that the $75,000 wire is the last step. The wire instructions went out yesterday;')
  })

  it('knows which reminder fits', () => {
    const at = '2026-11-01'
    const of = (keys: StepKey[]) => ({ steps: keys.map((key) => ({ key, at })) })
    expect(reminderKind(of([]))).toBeNull()
    expect(reminderKind(of(['sent', 'viewed']))).toBe('sign')
    expect(reminderKind(of(['sent', 'signed']))).toBeNull()
    expect(reminderKind(of(['sent', 'signed', 'countersigned']))).toBe('wire')
    expect(reminderKind(of(['sent', 'signed', 'countersigned', 'wired']))).toBeNull()
  })

  it('shares on WhatsApp with the text filled in', () => {
    expect(whatsappUrl('Hi Ria,\nthanks & bye')).toBe('https://wa.me/?text=Hi%20Ria%2C%0Athanks%20%26%20bye')
  })
})

describe('oversubscribed', () => {
  const rows = [
    { id: 'a', name: 'Angels', amount: 350_000, angel: true },
    { id: 'b', name: 'Fund B', amount: 600_000, angel: false },
    { id: 'c', name: 'Fund C', amount: 500_000, angel: false },
  ]
  it('keeps angels whole and cuts funds by the same share', () => {
    const cut = suggestCut(rows, 1_200_000)
    expect(cut.map((c) => c.to)).toEqual([350_000, 463_000, 386_000])
    expect(sum(cut.map((c) => c.to))).toBeLessThanOrEqual(1_200_000)
  })
  it('cuts everyone when angels alone are over the room', () => {
    expect(suggestCut(rows, 300_000).map((c) => c.to)).toEqual([72_000, 124_000, 103_000])
  })
  it('models the money still to raise as one more SAFE', () => {
    const s = scenarioSafes(rows.slice(0, 1), { cap: 16_000_000, raise: 1_000_000 })
    expect(s.gap).toBe(650_000)
    expect(s.safes.map((x) => x.amount)).toEqual([350_000, 650_000])
    expect(s.cut).toBeNull()
  })
})

describe('terms', () => {
  const t = { amount: 50_000, instrument: ' post-money SAFE ', cap: 16_000_000, proRata: true, mfn: false, discount: 0, signerEmail: ' ', requestUrl: ' https://sign.example.com/x ' }
  it('cleans and validates', () => {
    expect(cleanTerms(t)).toEqual({ amount: 50_000, instrument: 'post-money SAFE', cap: 16_000_000, proRata: true, mfn: false, requestUrl: 'https://sign.example.com/x' })
    expect(validateTerms(cleanTerms(t))).toEqual({})
    expect(validateTerms({ ...t, amount: 0, cap: NaN, discount: 1, signerEmail: 'nope', signedUrl: 'drive' })).toEqual({
      amount: 'Must be more than $0.', cap: 'Must be more than $0.', discount: 'Between 0% and 99%, or leave empty.', signerEmail: 'Not an email address.', signedUrl: 'A link starting with https://',
    })
  })
})
