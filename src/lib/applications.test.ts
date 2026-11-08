// PST-302: applications apart from the stage, no quiet warnings while a decision
// is pending, free stage moves with one from → to entry, corrections, and the new
// connector kinds' no-op rules. Made-up investors only.
import { describe, expect, it } from 'vitest'
import { applicationChip, applicationTone, awaitingLine, changeApplication, cleanApplication, isApplicationPath, isWaitingStep, matchesApplication, type Application } from './applications'
import { applyMove, cardText } from './board'
import { buildInbox, decisionPassedRows, type InboxSources } from './inbox'
import { DEFAULT_ROUND } from './round'
import { stalledAt } from './insights'
import { money } from './money'
import { applySave, dueList, isBackward, NEW_INVESTOR, quietFor, quietList, withoutCorrections, type Activity, type Investor } from './pipeline'
import { fixLine, noOpReason, outreachChanges } from './suggestions'

let n = 0
const inv = (o: Partial<Investor>): Investor => ({ ...NEW_INVESTOR, _id: 'i' + n++, maxStage: 'todo', ...o }) as Investor
const T = '2030-03-10'
const app = (o: Partial<Application> = {}): Application => ({ status: 'submitted', ...o })

describe('application chip wording', () => {
  it('says applied and awaiting, never a meeting or money', () => {
    expect(applicationChip(app({ program: 'W27' }))).toBe('Applied W27 · awaiting decision')
    expect(applicationChip(app())).toBe('Applied · awaiting decision')
    expect(applicationChip(app({ status: 'drafting', program: 'W27' }))).toBe('Application in progress · W27')
    expect(applicationChip(app({ status: 'interview_invited', program: 'W27' }))).toBe('Interview invited · W27')
    expect(applicationChip(app({ status: 'interview_done' }))).toBe('Interview done · awaiting decision')
    expect(applicationChip(app({ status: 'accepted' }))).toBe('Accepted')
    expect(applicationChip(app({ status: 'rejected', program: 'W27' }))).toBe('Not accepted · W27')
    expect(applicationChip(app({ status: 'withdrawn' }))).toBe('Application withdrawn')
    expect(applicationChip(undefined)).toBeNull()
    for (const s of ['drafting', 'submitted', 'accepted', 'rejected', 'withdrawn'] as const) expect(applicationChip(app({ status: s }))).not.toMatch(/meeting|interview|commit|\$/i)
  })
  it('tones: waiting while they decide, outline while drafting', () => {
    expect(applicationTone(app())).toBe('waiting')
    expect(applicationTone(app({ status: 'drafting' }))).toBe('outline')
    expect(applicationTone(app({ status: 'accepted' }))).toBe('success')
    expect(applicationTone(app({ status: 'rejected' }))).toBe('muted')
  })
  it('the calm foot names the decision day, and says when it has passed', () => {
    expect(awaitingLine(app(), T)).toBe('Awaiting decision')
    expect(awaitingLine(app({ decisionBy: '2030-03-15' }), T)).toBe('Awaiting decision · decision by Fri 15 Mar')
    expect(awaitingLine(app({ decisionBy: '2030-03-09' }), T)).toBe('Decision date passed · update status')
    expect(awaitingLine(app({ status: 'drafting' }), T)).toBeNull()
  })
  it('changes only the touched fields, keeping the rest as stored now (PST-303)', () => {
    const now = app({ program: 'W27', submittedOn: '2030-03-01', decisionBy: '2030-03-20' })
    expect(changeApplication(now, { status: 'interview_invited' })).toEqual({ ...now, status: 'interview_invited' })
    expect(changeApplication(now, { decisionBy: null, program: ' S27 ' })).toEqual({ status: 'submitted', program: 'S27', submittedOn: '2030-03-01' })
    expect(changeApplication(undefined, { status: 'drafting', program: 'W27' })).toEqual({ status: 'drafting', program: 'W27' })
    expect(changeApplication(undefined, { program: 'W27' })).toBeNull()
  })
  it('cleans what comes in', () => {
    expect(cleanApplication({ status: 'submitted', program: '  ' + 'x'.repeat(50), submittedOn: 'soon', decisionBy: '2030-03-15' })).toEqual({ status: 'submitted', program: 'x'.repeat(40), decisionBy: '2030-03-15' })
    expect(cleanApplication({ status: 'maybe' })).toBeNull()
  })
  it('an "applied" warm path is no introducer', () => {
    expect(isApplicationPath('Applied')).toBe(true)
    expect(isApplicationPath('via application')).toBe(true)
    expect(isApplicationPath('Ria')).toBe(false)
  })
  it('filters any, submitted (awaiting) and none', () => {
    const a = inv({ application: app() })
    const d = inv({ application: app({ status: 'drafting' }) })
    const none = inv({})
    expect([a, d, none].filter((i) => matchesApplication(i, 'any'))).toEqual([a, d])
    expect([a, d, none].filter((i) => matchesApplication(i, 'submitted'))).toEqual([a])
    expect([a, d, none].filter((i) => matchesApplication(i, 'none'))).toEqual([none])
  })
})

describe('no quiet warnings while a decision is pending', () => {
  const old = '2030-02-01'
  const waiting = inv({ name: 'Northwind', stage: 'ask', lastTouch: old, application: app({ program: 'C12', decisionBy: '2030-03-20' }) })
  const drafting = inv({ name: 'Harbor', stage: 'ask', lastTouch: old, application: app({ status: 'drafting' }) })
  const rejected = inv({ name: 'Fernhill', stage: 'ask', lastTouch: old, application: app({ status: 'rejected' }) })

  it('selectors leave awaiting investors out, and nobody else', () => {
    expect(quietFor(waiting, T, 7)).toBeNull()
    for (const s of ['interview_invited', 'interview_done'] as const) expect(quietFor({ ...waiting, application: app({ status: s }) }, T, 7)).toBeNull()
    expect(quietFor(drafting, T, 7)).toBeGreaterThan(7)
    expect(quietFor(rejected, T, 7)).toBeGreaterThan(7)
    expect(quietList([waiting, drafting, rejected], T, 7).map((i) => i.name)).toEqual(expect.arrayContaining(['Harbor', 'Fernhill']))
    expect(quietList([waiting, drafting, rejected], T, 7).map((i) => i.name)).not.toContain('Northwind')
  })
  it('the card shows the application chip and a calm foot, not "days quiet"', () => {
    const c = cardText(waiting, T, 7, money)
    expect(c).toMatchObject({ app: 'Applied C12 · awaiting decision', foot: 'Awaiting decision · decision by Wed 20 Mar', tone: 'waiting' })
    expect(cardText({ ...waiting, application: app({ decisionBy: '2030-03-01' }) }, T, 7, money)).toMatchObject({ foot: 'Decision date passed · update status', tone: 'late' })
    expect(cardText(drafting, T, 7, money).tone).toBe('quiet')
  })
  it('the card never reads "via application" from an applied warm path', () => {
    expect(cardText({ ...waiting, path: 'Applied', warmth: 'cold' }, T, 7, money).chip).not.toMatch(/via/i)
  })
  it('Insights does not count them as stalled', () => {
    const acts = [{ investorId: waiting._id, kind: 'stage', stage: 'ask', date: old }, { investorId: drafting._id, kind: 'stage', stage: 'ask', date: old }] as Activity[]
    expect(stalledAt({ from: 'ask', to: 'intro' }, [waiting, drafting], acts)).toEqual([drafting._id])
  })
})

describe('decision date passed and the next step', () => {
  const passed = inv({ name: 'Northwind', stage: 'ask', lastTouch: '2030-03-01', application: app({ program: 'C12', decisionBy: '2030-03-08' }) })
  const withStep = inv({ name: 'Harbor', stage: 'todo', nextStep: 'Email the partners a progress update', nextDate: T, application: app({ decisionBy: '2030-03-09' }) })
  const parked = inv({ name: 'Lantern', stage: 'parked', application: app({ decisionBy: '2030-03-01' }) })
  const future = inv({ name: 'Kite', stage: 'ask', application: app({ decisionBy: '2030-03-20' }) })

  it('one "Decision date passed" row each, oldest first, with "Update status"', () => {
    const rows = decisionPassedRows([withStep, passed, parked, future], T)
    expect(rows.map((r) => [r.name, r.title, r.detail])).toEqual([
      ['Northwind', 'Decision date passed', 'Was due Fri 8 Mar · C12'],
      ['Harbor', 'Decision date passed', 'Was due yesterday'],
    ])
    const src: InboxSources = {
      now: Date.parse(T + 'T12:00:00+05:30'), today: T, investors: [passed, withStep], acts: [], round: DEFAULT_ROUND, meetings: [], threads: [], decisions: [], signals: [],
      introducers: [], intros: [], introInvestors: [passed, withStep], closings: [], opens: [], suggestions: [], priority: () => 0,
    }
    const inbox = buildInbox(src).filter((r) => r.type !== 'move')
    expect(inbox.filter((r) => r.type === 'awaiting').map((r) => [r.name, r.detail, r.label, r.group])).toEqual([
      ['Harbor', 'Decision date passed · Was due yesterday', 'Update status', 'today'],
      ['Northwind', 'Decision date passed · Was due Fri 8 Mar · C12', 'Update status', 'today'],
    ])
    // Dev's own next step stays its own row, apart from the decision.
    expect(inbox.filter((r) => r.investorId === withStep._id).map((r) => [r.type, r.detail])).toEqual([
      ['due', 'Email the partners a progress update'],
      ['awaiting', 'Decision date passed · Was due yesterday'],
    ])
    expect(inbox.some((r) => r.type === 'quiet' && r.investorId === passed._id)).toBe(false)
  })
  it('an explicit next step stays its own due row with its own date', () => {
    expect(dueList([withStep], T).map((i) => i.name)).toEqual(['Harbor'])
    expect(cardText(withStep, T, 7, money).foot).toBe('Next: email the partners a progress update · Sun 10')
    expect(isWaitingStep('Awaiting decision')).toBe(true)
    expect(isWaitingStep('Wait for their decision.')).toBe(true)
    expect(isWaitingStep('Email the partners a progress update')).toBe(false)
  })
})

describe('free stage moves', () => {
  it('any stage to any stage logs one move, back to Not contacted too', () => {
    const asked = inv({ stage: 'ask', maxStage: 'ask', lastTouch: '2030-03-01' })
    const back = applyMove(asked, 'todo', T)
    expect(back).toMatchObject({ from: 'ask', logStage: 'todo', patch: { stage: 'todo', maxStage: 'ask', lastTouch: '2030-03-01' } })
    const jump = applyMove(inv({ stage: 'todo' }), 'm1', T)
    expect(jump).toMatchObject({ from: 'todo', logStage: 'm1', patch: { stage: 'm1', maxStage: 'm1', lastTouch: T } })
    expect(applySave(null, { ...NEW_INVESTOR, stage: 'todo' }, T).logStage).toBeNull()
    expect(isBackward('ask', 'todo')).toBe(true)
    expect(isBackward('todo', 'm1')).toBe(false)
    expect(isBackward(undefined, 'todo')).toBe(false)
  })
  it('a correction drops itself and the stages it undid from the stats', () => {
    const acts = [
      { _id: 'a1', investorId: 'x', kind: 'stage', stage: 'ask', fromStage: 'todo', date: '2030-03-01', by: 'Dev' },
      { _id: 'a2', investorId: 'x', kind: 'stage', stage: 'intro', fromStage: 'ask', date: '2030-03-02', by: 'Dev' },
      { _id: 'a3', investorId: 'x', kind: 'stage', stage: 'ask', fromStage: 'intro', date: '2030-03-03', by: 'Dev', correction: { maxBefore: 'intro' } },
      { _id: 'b1', investorId: 'y', kind: 'stage', stage: 'intro', date: '2030-03-02', by: 'Dev' },
    ] as Activity[]
    expect(withoutCorrections(acts).map((a) => a._id)).toEqual(['a1', 'b1'])
    expect(withoutCorrections(acts.slice(0, 2)).map((a) => a._id)).toEqual(['a1', 'a2'])
  })
})

describe('connector no-op rules', () => {
  const i = inv({ name: 'Kite', stage: 'm1', nextStep: 'Send deck', nextDate: '2030-03-12', expected: 50000, notes: 'Wants week-4 retention.', path: 'Ria', warmth: 'intro', source: 'List', application: app({ program: 'W27' }) })
  it('says when the record already has the value', () => {
    expect(noOpReason(i, { op: 'stage', from: 'm1', to: 'm1' })).toBe('Kite is already at 1st meeting.')
    expect(noOpReason(i, { op: 'next_step', step: 'send deck', date: '2030-03-12' })).toContain('already')
    expect(noOpReason(i, { op: 'expected', amount: 50000 })).toContain('already')
    expect(noOpReason(i, { op: 'notes', mode: 'append', text: 'week-4 retention', before: i.notes })).toContain('already include')
    expect(noOpReason(i, { op: 'notes', mode: 'replace', text: 'Wants week-4 retention. ', before: i.notes })).toContain('exactly')
    expect(noOpReason(i, { op: 'outreach', path: ' ria ', warmth: 'intro' })).toContain('already has')
    expect(noOpReason(i, { op: 'application', status: 'submitted' })).toBe('Kite’s application is already “Applied W27 · awaiting decision”.')
  })
  it('a real change is not a no-op, and the fix line says what changes', () => {
    expect(noOpReason(i, { op: 'notes', mode: 'append', text: 'Asked about week-6.', before: i.notes })).toBeNull()
    expect(noOpReason(i, { op: 'application', status: 'interview_invited' })).toBeNull()
    expect(outreachChanges(i, { op: 'outreach', path: 'Mira', warmth: 'intro', source: 'List' })).toEqual({ path: 'Mira' })
    expect(fixLine({ op: 'application', status: 'interview_invited' }, i.application)).toBe('Set the application to “Interview invited · W27”')
    expect(fixLine({ op: 'notes', mode: 'append', text: 'x', before: '' })).toBe('Add a correction to the notes')
  })
})
