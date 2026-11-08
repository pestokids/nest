// PST-291: the same-day close kit, allocation and tranche 2: business days, the deadlines, allocation totals, tranche ownership and the draft text.
import { describe, expect, it } from 'vitest'
import { ladder, type Closing, type Step } from './close'
import {
  addBusinessDays, allocationRows, allocationText, allocationTotals, checkTranche2, closeDue, commitmentTerms, confirmText, currentStep, dueText, endOfDayIST,
  isWeekend, kitSteps, leftText, offerUntil, oversubscribed, ownPct, perHundredK, possessive, SAFE_LINK, trancheCap, trancheLine, verbalOf,
} from './closeKit'
import type { Activity, Investor } from './pipeline'

/** Sunday 8 Nov 2026, 15:40 IST. */
const SUN_1540 = Date.parse('2026-11-08T15:40:00+05:30')
const H = 3600_000
const ist = (s: string) => Date.parse(s + '+05:30')

const inv = (id: string, name: string, o: Partial<Investor> = {}): Investor =>
  ({ _id: id, name, firm: '', type: 'Angel', geo: 'India', warmth: 'warm', path: '', tier: 'A', wave: 1, stage: 'verbal', maxStage: 'verbal', lead: false, nextStep: '', notes: '', source: '', ...o }) as Investor
const closing = (investorId: string, o: Partial<Closing> = {}): Closing => ({ _id: 'c' + investorId, investorId, amount: 150_000, instrument: 'post-money SAFE', cap: 16_000_000, proRata: false, mfn: false, steps: [], ...o })
const verbalAct = (investorId: string, date: string, at?: number): Activity => ({ _id: 'a' + investorId + date, investorId, kind: 'stage', stage: 'verbal', date, ...(at ? { _creationTime: at } : {}) })
const steps = (...xs: [Step['key'], string][]): Step[] => xs.map(([key, at]) => ({ key, at }))

describe('business days', () => {
  it('skips Saturdays and Sundays', () => {
    expect(isWeekend('2026-11-07')).toBe(true)
    expect(isWeekend('2026-11-08')).toBe(true)
    expect(isWeekend('2026-11-09')).toBe(false)
    expect(addBusinessDays('2026-11-13', 1)).toBe('2026-11-16')
    expect(addBusinessDays('2026-11-09', 4)).toBe('2026-11-13')
    expect(addBusinessDays('2026-11-09', 5)).toBe('2026-11-16')
  })

  it('10 business days from Tue 10 Nov is Tue 24 Nov (the design)', () => {
    expect(addBusinessDays('2026-11-10', 10)).toBe('2026-11-24')
  })

  it('counts from a weekend day to the next weekdays', () => {
    expect(addBusinessDays('2026-11-07', 1)).toBe('2026-11-09')
    expect(addBusinessDays('2026-11-08', 10)).toBe('2026-11-20')
  })

  it('crosses months and years', () => {
    expect(addBusinessDays('2026-12-28', 5)).toBe('2027-01-04')
    expect(addBusinessDays('2026-11-30', 0)).toBe('2026-11-30')
  })
})

describe('deadlines', () => {
  it('ends the day at 23:59 IST', () => {
    expect(endOfDayIST('2026-11-08')).toBe(Date.parse('2026-11-08T18:29:00Z'))
  })

  it('states the offer end as weekday, day, month and IST time', () => {
    expect(offerUntil(SUN_1540 + 48 * H)).toBe('Tue 10 Nov at 15:40 IST')
  })

  it('before the confirmation: due by the end of the verbal day, the rest projected from now', () => {
    const rows = kitSteps(null, { verbalDay: '2026-11-08', now: SUN_1540 })
    expect(rows.map((r) => r.done)).toEqual([false, false, false, false, false])
    expect(rows[0]).toMatchObject({ key: 'confirm', dueAt: endOfDayIST('2026-11-08'), projected: false })
    expect(rows[1]).toMatchObject({ key: 'accept', dueAt: SUN_1540 + 48 * H, projected: true })
    expect(rows[4]).toMatchObject({ key: 'wire', dueAt: endOfDayIST('2026-11-24'), projected: true })
    expect(rows.map((r) => dueText(r, SUN_1540))).toEqual(['Due 23:59', 'by Tue 15:40', '', '', 'by Tue 24 Nov'])
    expect(currentStep(rows)).toBe('confirm')
  })

  it('acceptance at confirmation + 48 h; SAFE the same day as the yes; wire 10 business days after it', () => {
    const sent = SUN_1540 + 10 * 60_000
    const accepted = ist('2026-11-10T11:00:00')
    const rows = kitSteps(closing('x', { confirmationSentAt: sent, acceptedAt: accepted }), { verbalDay: '2026-11-08', now: accepted + H })
    expect(rows[0].done && rows[1].done).toBe(true)
    expect(rows[1].dueAt).toBe(sent + 48 * H)
    expect(rows[2]).toMatchObject({ key: 'safe', done: false, dueAt: endOfDayIST('2026-11-10'), projected: false })
    expect(rows[4]).toMatchObject({ key: 'wire', dueAt: endOfDayIST('2026-11-24'), projected: false })
    expect(currentStep(rows)).toBe('safe')
  })

  it('the SAFE step needs the questionnaire too', () => {
    const c = closing('x', { confirmationSentAt: SUN_1540, acceptedAt: SUN_1540 + H, steps: steps(['sent', '2026-11-08']) })
    expect(kitSteps(c, { now: SUN_1540 + 2 * H })[2].done).toBe(false)
    expect(kitSteps({ ...c, questionnaire: 'sent' }, { now: SUN_1540 + 2 * H })[2].done).toBe(true)
  })

  it('countersign the same day as their signature', () => {
    const c = closing('x', { confirmationSentAt: SUN_1540, acceptedAt: SUN_1540 + H, questionnaire: 'received', steps: steps(['sent', '2026-11-08'], ['signed', '2026-11-11']) })
    const rows = kitSteps(c, { now: ist('2026-11-11T20:00:00') })
    expect(rows[3]).toMatchObject({ key: 'signed', done: false, dueAt: endOfDayIST('2026-11-11') })
    expect(currentStep(rows)).toBe('signed')
  })

  it('a SAFE already out counts the confirmation and the yes done, without the questionnaire', () => {
    const rows = kitSteps(closing('x', { steps: steps(['sent', '2026-11-03']) }), { verbalDay: '2026-11-01', now: SUN_1540 })
    expect(rows.map((r) => r.done)).toEqual([true, true, false, false, false])
    expect(currentStep(rows)).toBe('safe')
    expect(rows[2].dueAt).toBeUndefined()
  })

  it('a later step done counts the earlier ones done (records from before the kit)', () => {
    const rows = kitSteps(closing('x', { steps: steps(['sent', '2026-11-01'], ['signed', '2026-11-02'], ['countersigned', '2026-11-02']) }), { verbalDay: '2026-10-30', now: SUN_1540 })
    expect(rows.map((r) => r.done)).toEqual([true, true, true, true, false])
    expect(currentStep(rows)).toBe('wire')
  })

  it('says Overdue once a real deadline has passed, never for a projected one', () => {
    const rows = kitSteps(null, { verbalDay: '2026-11-06', now: SUN_1540 })
    expect(dueText(rows[0], SUN_1540)).toBe('Overdue')
    expect(dueText(rows[1], SUN_1540)).toBe('by Tue 15:40')
  })

  it('finds the verbal day (and time, when the record has it) from the stage activity', () => {
    const acts = [verbalAct('a', '2026-11-01'), verbalAct('a', '2026-11-08', SUN_1540), verbalAct('b', '2026-11-02')]
    expect(verbalOf('a', acts)).toEqual({ day: '2026-11-08', at: SUN_1540 })
    expect(verbalOf('b', acts)).toEqual({ day: '2026-11-02' })
    expect(verbalOf('c', acts)).toBeNull()
  })
})

describe('closeDue', () => {
  const now = SUN_1540
  const investors = [
    inv('a', 'Heron Angels'),
    inv('b', 'Alder Partners'),
    inv('c', 'Cobalt Angels'),
    inv('d', 'Wired Fund', { stage: 'wired', maxStage: 'wired' }),
    inv('e', 'Soft Circle', { stage: 'dd', maxStage: 'dd' }),
    inv('f', 'Signer', { stage: 'signed', maxStage: 'signed' }),
  ]
  const acts = [verbalAct('a', '2026-11-08'), verbalAct('b', '2026-11-05'), verbalAct('c', '2026-11-08'), verbalAct('d', '2026-11-01'), verbalAct('f', '2026-11-01')]
  const closings = [
    closing('c', { confirmationSentAt: now - 2 * H }),
    closing('d'),
    closing('f', { confirmationSentAt: now - 99 * H, acceptedAt: now - 98 * H, questionnaire: 'sent', steps: steps(['sent', '2026-11-04'], ['signed', '2026-11-08']) }),
  ]

  it('lists steps due today or overdue, soonest first, never projected ones or wired investors', () => {
    const due = closeDue(now, { investors, closings, acts })
    expect(due.map((x) => [x.name, x.step, x.overdue])).toEqual([
      ['Alder Partners', 'confirm', true],
      ['Heron Angels', 'confirm', false],
      ['Signer', 'signed', false],
    ])
    expect(due[1].dueAt).toBe(endOfDayIST('2026-11-08'))
  })

  it('an offer running out today is due; one running out later is not', () => {
    const c = [closing('c', { confirmationSentAt: now - 40 * H })]
    expect(closeDue(now, { investors: [investors[2]], closings: c, acts }).map((x) => x.step)).toEqual(['accept'])
    expect(closeDue(now, { investors: [investors[2]], closings: [closing('c', { confirmationSentAt: now - H })], acts })).toEqual([])
  })
})

describe('tranches', () => {
  it('ownership per $100K at a post-money cap', () => {
    expect(perHundredK(16_000_000)).toBeCloseTo(0.00625, 12)
    expect(perHundredK(20_000_000)).toBeCloseTo(0.005, 12)
    expect(ownPct(perHundredK(16_000_000))).toBe('0.63%')
    expect(ownPct(perHundredK(20_000_000))).toBe('0.5%')
    expect(ownPct(perHundredK(10_000_000))).toBe('1%')
    expect(ownPct(perHundredK(12_000_000))).toBe('0.83%')
  })

  it('says what tranche 2 buyers own instead (the design)', () => {
    expect(trancheLine(16_000_000, 20_000_000)).toBe('Tranche 2 buyers own 0.5% per $100K instead of 0.63%.')
  })

  it('uses the tranche cap for each commitment', () => {
    const t2 = { cap: 20_000_000 }
    expect(trancheCap({ cap: 16_000_000 }, { cap: 16_000_000 }, t2)).toBe(16_000_000)
    expect(trancheCap({ tranche: 2, cap: 16_000_000 }, { cap: 16_000_000 }, t2)).toBe(20_000_000)
    expect(trancheCap({ tranche: 2, cap: 16_000_000 }, {}, null)).toBe(16_000_000)
    expect(trancheCap(null, { cap: 16_000_000 }, t2)).toBe(16_000_000)
  })

  it('new commitments start in tranche 2 once it is set up', () => {
    const i = inv('a', 'Heron Angels', { committed: 150_000 })
    expect(commitmentTerms(i, null, { cap: 16_000_000, instrument: 'post-money SAFE' }, null)).toEqual({ amount: 150_000, instrument: 'post-money SAFE', cap: 16_000_000, tranche: 1 })
    expect(commitmentTerms(i, null, { cap: 16_000_000, instrument: 'post-money SAFE' }, { cap: 20_000_000 })).toMatchObject({ cap: 20_000_000, tranche: 2 })
    expect(commitmentTerms(i, closing('a', { amount: 100_000 }), { cap: 18_000_000, instrument: 'x' }, { cap: 20_000_000 })).toEqual({ amount: 100_000, instrument: 'post-money SAFE', cap: 16_000_000, tranche: 1 })
    expect(commitmentTerms(inv('b', 'No number'), null, { instrument: 'post-money SAFE' }, null)).toMatchObject({ amount: undefined, cap: undefined })
  })

  it('tranche 2 needs a higher cap', () => {
    expect(checkTranche2(20_000_000, 16_000_000)).toBeNull()
    expect(checkTranche2(16_000_000, 16_000_000)).toMatch(/higher than tranche 1’s \$16M/)
    expect(checkTranche2(undefined, 16_000_000)).toMatch(/Enter/)
  })
})

describe('allocation', () => {
  const investors = [
    inv('lead', 'Orchard Capital', { type: 'Pre-seed fund', lead: true, committed: 600_000 }),
    inv('fund', 'Lantern Ventures', { type: 'Micro-VC', stage: 'dd', maxStage: 'dd', expected: 500_000 }),
    inv('angel', 'Kite Angels', { committed: 150_000 }),
    inv('late', 'Tamarind Capital', { type: 'Seed fund', stage: 'm2', maxStage: 'm2', expected: 400_000 }),
    inv('no', 'Not yet', { stage: 'm1', maxStage: 'm1', expected: 100_000 }),
  ]
  const l = ladder(investors, [])

  it('a row per investor on the ladder, with kind, wants and a suggested cut that keeps angels whole', () => {
    const rows = allocationRows(l.rows, [], 1_000_000)
    expect(rows.map((r) => [r.name, r.kind, r.wants])).toEqual([
      ['Orchard Capital', 'Lead', 600_000],
      ['Lantern Ventures', 'Fund', 500_000],
      ['Tamarind Capital', 'Fund', 400_000],
      ['Kite Angels', 'Angel', 150_000],
    ])
    expect(rows.find((r) => r.name === 'Kite Angels')!.gets).toBe(150_000)
    const t = allocationTotals(rows, 1_000_000)
    expect(t.wanted).toBe(1_650_000)
    expect(t.allocated).toBeLessThanOrEqual(1_000_000)
    expect(t.allocated).toBeGreaterThan(995_000)
    expect(t.over).toBe(true)
    expect(rows.every((r) => r.suggested)).toBe(true)
  })

  it('saved amounts and reasons win; totals and what is left to place add up', () => {
    const rows = allocationRows(l.rows, [
      { investorId: 'lead', gets: 600_000, why: 'Leading the round' },
      { investorId: 'fund', gets: 350_000, why: 'Second offer' },
      { investorId: 'late', gets: 200_000, why: 'Late to the race' },
      { investorId: 'angel', why: 'In early' },
    ], 1_500_000)
    expect(rows.map((r) => r.gets)).toEqual([600_000, 350_000, 200_000, 150_000])
    expect(rows.find((r) => r.investorId === 'angel')).toMatchObject({ why: 'In early', suggested: true })
    const t = allocationTotals(rows, 1_500_000)
    expect(t).toEqual({ wanted: 1_650_000, allocated: 1_300_000, room: 1_500_000, left: 200_000, over: true })
    expect(leftText(t.left)).toBe('$200K left to place')
    expect(leftText(-50_000)).toBe('$50K over the room')
    expect(leftText(0)).toBe('All placed')
  })

  it('is oversubscribed only when demand is above the room', () => {
    expect(oversubscribed(1_850_000, 1_500_000)).toBe(true)
    expect(oversubscribed(1_500_000, 1_500_000)).toBe(false)
    expect(oversubscribed(100, 0)).toBe(false)
    expect(allocationTotals(allocationRows(l.rows, [], 5_000_000), 5_000_000)).toMatchObject({ allocated: 1_650_000, left: 3_350_000, over: false })
  })
})

describe('draft text', () => {
  const terms = { amount: 150_000, instrument: 'post-money SAFE', cap: 16_000_000, tranche: 1 as const }

  it('the confirm draft states the amount, the instrument and cap, the 48 hours and the funding window (the design)', () => {
    const t = confirmText({ investorName: 'Kite Angels', contactName: 'Sam Okoye', terms, now: SUN_1540, verbalToday: true, me: 'Dev' })
    expect(t.subject).toBe('Confirming Kite Angels’ $150K in Pesto')
    expect(t.body).toBe(
      [
        'Hi Sam,',
        'Thanks for today. Confirming what we discussed:',
        '• $150,000 on a post-money SAFE at a $16M cap\n• This offer stands for 48 hours, until Tue 10 Nov at 15:40 IST\n• Once you accept, funding within 10 business days',
        'I’ll send the SAFE and a short investor questionnaire as soon as you reply.',
        'Dev',
      ].join('\n\n'),
    )
  })

  it('leaves a blank, never a guess, when the amount or cap is missing', () => {
    const t = confirmText({ investorName: 'Marigold Capital', terms: { ...terms, amount: undefined, cap: undefined }, now: SUN_1540, verbalToday: false, me: '' })
    expect(t.subject).toBe('Confirming Marigold Capital’s [__] in Pesto')
    expect(t.body).toContain('Hi there,')
    expect(t.body).toContain('Thanks again for the yes.')
    expect(t.body).toContain('• [__] on a post-money SAFE at a [__] cap')
    expect(t.body.endsWith('Dev')).toBe(true)
  })

  it('names the instrument with the right article', () => {
    const t = confirmText({ investorName: 'Wren', terms: { ...terms, instrument: 'convertible note' }, now: SUN_1540, verbalToday: true, me: 'Dev' })
    expect(t.body).toContain('on a convertible note at a $16M cap')
    expect(possessive('Wren Partners')).toBe('Wren Partners’')
    expect(possessive('Orchard Capital')).toBe('Orchard Capital’s')
  })

  it('the allocation email: what they get, the SAFE link placeholder and the wire deadline', () => {
    const cut = allocationText({ contactName: 'Priya', row: { wants: 500_000, gets: 350_000 }, terms: { instrument: 'post-money SAFE', cap: 16_000_000 }, wireBy: '2026-11-24', me: 'Dev' })
    expect(cut.subject).toBe('Your allocation in Pesto: $350K')
    expect(cut.body).toContain('you get $350,000 of the $500,000 you asked for, on a post-money SAFE at a $16M cap.')
    expect(cut.body).toContain('Your SAFE: ' + SAFE_LINK + '\nPlease wire by Tue 24 Nov, within 10 business days.')
    const full = allocationText({ row: { wants: 150_000, gets: 150_000 }, terms: { instrument: 'post-money SAFE', cap: 20_000_000 }, wireBy: '2026-11-24', me: 'Dev' })
    expect(full.body).toContain('You get the full $150,000 you asked for, on a post-money SAFE at a $20M cap.')
  })
})
