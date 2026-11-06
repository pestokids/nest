// Calls every public Nest function without signing in and checks each is refused.
// Usage: node --env-file=.env.local scripts/check-unauth.mjs <an investor id>
import { ConvexHttpClient } from 'convex/browser'
import { anyApi as api } from 'convex/server'

const url = process.env.VITE_CONVEX_URL
const id = process.argv[2]
if (!url || !id) throw new Error('Set VITE_CONVEX_URL and pass an investor id')
const c = new ConvexHttpClient(url)

const fields = {
  name: 'x', firm: '', type: 'Angel', geo: 'India', warmth: 'intro', path: '', tier: 'B', wave: 2, stage: 'todo',
  lead: false, nextStep: '', notes: '', source: '',
}
const { round } = { round: { target: 1, stretch: 1, deadline: '2030-02-01', kickoff: '2030-01-01', instrument: 'x', phases: [], odds: { todo: 0, ask: 0, intro: 0, booked: 0, m1: 0, m2: 0, dd: 0, verbal: 0, signed: 0, wired: 0 }, quietDays: 4, waves: [] } }

const calls = [
  ['query', 'investors:list', api.investors.list, {}],
  ['query', 'activities:recent', api.activities.recent, {}],
  ['query', 'activities:forInvestor', api.activities.forInvestor, { investorId: id }],
  ['query', 'settings:get', api.settings.get, {}],
  ['query', 'settings:log', api.settings.log, {}],
  ['mutation', 'investors:upsert', api.investors.upsert, { fields }],
  ['mutation', 'investors:upsert (edit)', api.investors.upsert, { id, fields }],
  ['mutation', 'investors:importMany', api.investors.importMany, { rows: [fields] }],
  ['mutation', 'investors:advance', api.investors.advance, { id }],
  ['mutation', 'investors:logNote', api.investors.logNote, { id, note: 'x' }],
  ['mutation', 'investors:logNote (touch)', api.investors.logNote, { id, note: 'x', touch: 'ask', next: { step: 'x' } }],
  ['mutation', 'investors:advance (next)', api.investors.advance, { id, next: { step: 'x' } }],
  ['mutation', 'investors:remove', api.investors.remove, { id }],
  ['mutation', 'investors:move', api.investors.move, { id, stage: 'ask' }],
  ['mutation', 'investors:undoMove', api.investors.undoMove, { id, to: 'ask', from: { stage: 'todo', maxStage: 'todo' }, activityId: null }],
  ['mutation', 'settings:update', api.settings.update, { round }],
  ['query', 'prep:list', api.prep.list, { phaseKey: 'p1' }],
  ['mutation', 'prep:set', api.prep.set, { phaseKey: 'p1', item: 0, done: true }],
  ['query', 'prefs:get', api.prefs.get, {}],
  ['mutation', 'prefs:setSounds', api.prefs.setSounds, { on: false }],
  ['query', 'access:members', api.access.members, {}],
]

let failed = 0
for (const [kind, name, fn, args] of calls) {
  try {
    const r = await c[kind](fn, args)
    failed++
    console.log(`FAIL  ${name} returned`, JSON.stringify(r).slice(0, 80))
  } catch (e) {
    const msg = String(e.data ?? e.message)
    const ok = /Not signed in/.test(msg)
    if (!ok) failed++
    console.log(`${ok ? 'ok   ' : 'FAIL '} ${name} refused: ${msg.split('\n')[0].slice(0, 80)}`)
  }
}
const s = await c.query(api.access.status, {})
console.log(`${s.status === 'signedOut' ? 'ok   ' : 'FAIL '} access:status → ${JSON.stringify(s)} (no tracker data)`)
if (s.status !== 'signedOut') failed++
process.exit(failed ? 1 : 0)
