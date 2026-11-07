// @vitest-environment edge-runtime
// PST-282: Materials. The token-only viewer (lookup, revoked and expired links, the
// email ask, page time), the first open's touch, rate limits, and email sending.
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './_generated/api'
import type { Id } from './_generated/dataModel'
import schema from './schema'
import { sendEmail } from './lib/email'
import { LIMITS } from './viewer'
import { todayIST } from '../src/lib/dates'
import { DEFAULT_OPTIONS, type LinkOptions } from '../src/lib/materials'
import { addDays } from '../src/lib/today'

const modules = import.meta.glob('./**/*.ts')

beforeEach(() => {
  vi.stubEnv('ALLOWED_EMAILS', 'founder@pestokids.com')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const base = { type: 'Angel' as const, geo: 'India' as const, warmth: 'warm' as const, path: '', tier: 'A' as const, wave: 1 as const, lead: false, nextStep: '', notes: '', source: '', updatedAt: 0 }
const OPEN: LinkOptions = { ...DEFAULT_OPTIONS, askEmail: false, watermark: false }

/** Made-up investors and two materials: Kite Angels and Orchard Capital, a pitch deck (2 versions) and a memo. */
async function setup() {
  const t = convexTest(schema, modules)
  const today = todayIST()
  const ids = await t.run(async (ctx) => {
    const dev = await ctx.db.insert('users', { email: 'founder@pestokids.com', name: 'Dev', emailVerificationTime: 1 })
    const kite = await ctx.db.insert('investors', { ...base, name: 'Kite Angels', firm: 'Kite Angels', email: 'sam@kite.example.com', stage: 'm1', maxStage: 'm1', lastTouch: addDays(today, -10) })
    const orchard = await ctx.db.insert('investors', { ...base, name: 'Orchard Capital', firm: 'Orchard Capital', email: 'maya@orchard.example.com', stage: 'booked', maxStage: 'booked' })
    const pdf = await ctx.storage.store(new Blob(['%PDF-1.4 made-up deck'], { type: 'application/pdf' }))
    return { dev, kite, orchard, pdf }
  })
  const as = t.withIdentity({ subject: `${ids.dev}|s1` })
  const deck = await as.mutation(api.materials.create, { kind: 'deck', title: 'Pitch deck', source: { fileId: ids.pdf, pages: 3, note: 'First version.' } })
  const v2 = await as.mutation(api.materials.addVersion, { materialId: deck, source: { fileId: ids.pdf, pages: 4, note: 'New traction slide.' } })
  const memo = await as.mutation(api.materials.create, { kind: 'memo', title: 'Investment memo', source: { url: 'https://docs.google.com/document/d/abc123/edit', note: 'Draft.' } })
  const share = async (materialId: Id<'materials'>, investorId: Id<'investors'>, options: LinkOptions = OPEN, versionId: Id<'materialVersions'> | 'current' = 'current') =>
    (await as.mutation(api.materials.share, { materialId, versionId, investorIds: [investorId], options, expiresInDays: 30 }))[0]
  const post = async (path: string, body: unknown, ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile') => {
    const res = await t.fetch(path, { method: 'POST', headers: { 'Content-Type': 'text/plain', 'User-Agent': ua }, body: JSON.stringify(body) })
    return { status: res.status, body: (await res.json()) as Record<string, unknown> & { state: string; sessionId?: string; doc?: Record<string, unknown> } }
  }
  const open = (token: string, email?: string) => post('/d/open', { token, ...(email !== undefined ? { email } : {}) })
  const beat = (token: string, sessionId: string, page: number, ms: number) => post('/d/beat', { token, sessionId, page, ms })
  const notes = (investorId: Id<'investors'>) => t.run((ctx) => ctx.db.query('activities').withIndex('by_investor', (q) => q.eq('investorId', investorId)).collect())
  return { t, as, today, ...ids, deck, v2, memo, share, open, beat, post, notes }
}

describe('the public viewer', () => {
  it('a token returns only its own document, and nothing about the investor', async () => {
    const s = await setup()
    const a = await s.share(s.deck, s.kite)
    await s.share(s.memo, s.orchard)
    const r = await s.open(a.token)
    expect(r.status).toBe(200)
    expect(r.body.state).toBe('ok')
    expect(r.body.doc).toEqual({ title: 'Pitch deck', n: 2, pages: 4, kind: 'pdf', url: null, download: false, watermark: null, reply: 'dev@pestokids.com', from: 'Pesto' })
    const text = JSON.stringify(r.body)
    for (const leak of ['Kite', 'Orchard', 'kite.example', 'Investment memo', s.kite, s.deck, s.v2]) expect(text).not.toContain(leak)
    expect(Object.keys(r.body).sort()).toEqual(['doc', 'sessionId', 'state'])
  })

  it('a pinned link keeps showing its version; a link version shows its link', async () => {
    const s = await setup()
    const v1 = await s.t.run(async (ctx) => (await ctx.db.query('materialVersions').collect()).find((x) => x.n === 1 && x.materialId === s.deck)!._id)
    const pinned = await s.share(s.deck, s.kite, OPEN, v1)
    expect((await s.open(pinned.token)).body.doc).toMatchObject({ n: 1, pages: 3 })
    const memo = await s.share(s.memo, s.orchard)
    expect((await s.open(memo.token)).body.doc).toMatchObject({ kind: 'link', url: 'https://docs.google.com/document/d/abc123/edit', download: false })
  })

  it('unknown, malformed, revoked and expired tokens get nothing', async () => {
    const s = await setup()
    expect((await s.open('A'.repeat(22))).status).toBe(404)
    expect((await s.open('not a token')).status).toBe(404)
    expect((await s.post('/d/open', { nope: 1 })).status).toBe(400)

    const revoked = await s.share(s.deck, s.kite)
    const opened = await s.open(revoked.token)
    await s.as.mutation(api.materials.revoke, { linkId: revoked.linkId })
    const r = await s.open(revoked.token)
    expect(r.status).toBe(410)
    expect(r.body).toEqual({ state: 'expired' })
    expect((await s.beat(revoked.token, opened.body.sessionId!, 1, 5000)).status).toBe(410)
    expect((await s.t.fetch(`/d/file?token=${revoked.token}&session=${opened.body.sessionId}`)).status).toBe(410)

    const late = await s.share(s.deck, s.orchard)
    await s.t.run((ctx) => ctx.db.patch(late.linkId, { expiresAt: Date.now() - 1000 }))
    expect(await s.open(late.token)).toEqual({ status: 410, body: { state: 'expired' } })
  })

  it('a deleted material stops its links', async () => {
    const s = await setup()
    const l = await s.share(s.memo, s.kite)
    await s.as.mutation(api.materials.remove, { materialId: s.memo })
    expect((await s.open(l.token)).status).toBe(404)
  })

  it('asks for an email first when the link wants one, and watermarks with it', async () => {
    const s = await setup()
    const l = await s.share(s.deck, s.kite, { ...DEFAULT_OPTIONS, askEmail: true, watermark: true })
    expect((await s.open(l.token)).body).toEqual({ state: 'email', invalid: false })
    expect((await s.open(l.token, 'not-an-email')).body).toEqual({ state: 'email', invalid: true })
    // Nothing was recorded before the email.
    expect(await s.t.run((ctx) => ctx.db.query('views').collect())).toHaveLength(0)
    const r = await s.open(l.token, '  Sam@Kite.Example.com ')
    expect(r.body.state).toBe('ok')
    expect(r.body.doc).toMatchObject({ watermark: 'sam@kite.example.com' })
    const views = await s.t.run((ctx) => ctx.db.query('views').collect())
    expect(views).toHaveLength(1)
    expect(views[0]).toMatchObject({ email: 'sam@kite.example.com', device: 'phone' })

    // The PDF only comes with a session from a passed email ask.
    expect((await s.t.fetch(`/d/file?token=${l.token}&session=${'B'.repeat(22)}`)).status).toBe(404)
    const file = await s.t.fetch(`/d/file?token=${l.token}&session=${r.body.sessionId}`)
    expect(file.status).toBe(200)
    expect(file.headers.get('content-type')).toBe('application/pdf')
    expect(file.headers.get('content-disposition')).toMatch(/^inline/)
    expect(await file.text()).toContain('%PDF')
    // No download unless the link allows it.
    expect((await s.t.fetch(`/d/file?token=${l.token}&session=${r.body.sessionId}&download=1`)).status).toBe(403)
  })

  it('the watermark turns the email ask on even when it was left off', async () => {
    const s = await setup()
    const l = await s.share(s.deck, s.kite, { ...DEFAULT_OPTIONS, askEmail: false, watermark: true })
    expect((await s.open(l.token)).body.state).toBe('email')
  })

  it('page time adds up across beacons, and bad beacons add nothing', async () => {
    const s = await setup()
    const l = await s.share(s.deck, s.kite)
    const { sessionId } = (await s.open(l.token)).body
    for (const [page, ms] of [[1, 5000], [1, 5000], [2, 3000], [4, 2500], [2, 99_000], [9, 5000], [0, 5000], [3, -400]] as const) await s.beat(l.token, sessionId!, page, ms)
    const other = await s.share(s.deck, s.orchard)
    expect((await s.beat(other.token, sessionId!, 1, 5000)).status).toBe(404)
    const d = await s.as.query(api.materials.data, {})
    const stat = d.stats.find((x) => x.linkId === l.linkId)!
    // 30 s is the most one beacon carries; page 9 is past the end; page 0 and negative time are ignored.
    expect(stat.pageMs).toEqual([10000, 33000, 0, 2500])
    expect(stat.totalMs).toBe(45500)
    expect(stat.opens).toBe(1)
    // A second open adds to the same link's numbers.
    const again = (await s.open(l.token)).body.sessionId!
    await s.beat(l.token, again, 1, 4000)
    const d2 = await s.as.query(api.materials.data, {})
    expect(d2.stats.find((x) => x.linkId === l.linkId)).toMatchObject({ opens: 2, totalMs: 49500, pageMs: [14000, 33000, 0, 2500] })
  })

  it('rate-limits lookups per token', async () => {
    const s = await setup()
    const l = await s.share(s.deck, s.kite)
    for (let k = 0; k < LIMITS.open; k++) expect((await s.open(l.token)).status).toBe(200)
    expect(await s.open(l.token)).toEqual({ status: 429, body: { state: 'limited' } })
    // Another link has its own budget.
    const other = await s.share(s.deck, s.orchard)
    expect((await s.open(other.token)).status).toBe(200)
  })
})

describe('the first open', () => {
  it('logs one touch, moves Last touch to today and raises one notice', async () => {
    const s = await setup()
    const l = await s.share(s.deck, s.kite)
    const before = await s.notes(s.kite)
    expect(before.map((a) => a.note)).toEqual(['Sent a link to Pitch deck (always the current version)'])
    await s.open(l.token)
    await s.open(l.token)
    await s.open(l.token)
    const opened = (await s.notes(s.kite)).filter((a) => a.note?.startsWith('Opened'))
    expect(opened).toHaveLength(1)
    expect(opened[0]).toMatchObject({ kind: 'note', note: 'Opened Pitch deck v2', date: s.today, userId: s.dev })
    const kite = await s.t.run((ctx) => ctx.db.get(s.kite))
    expect(kite!.lastTouch).toBe(s.today)
    const d = await s.as.query(api.materials.data, {})
    expect(d.notices).toEqual([{ linkId: l.linkId, investorId: s.kite, at: expect.any(Number) }])
    await s.as.mutation(api.materials.seen, { linkIds: [l.linkId] })
    expect((await s.as.query(api.materials.data, {})).notices).toEqual([])
  })

  it('never moves Last touch backwards, and stays quiet when notify is off', async () => {
    const s = await setup()
    const future = addDays(s.today, 1)
    await s.t.run((ctx) => ctx.db.patch(s.orchard, { lastTouch: future }))
    const l = await s.share(s.deck, s.orchard, { ...OPEN, notify: false })
    await s.open(l.token)
    expect((await s.t.run((ctx) => ctx.db.get(s.orchard)))!.lastTouch).toBe(future)
    expect((await s.as.query(api.materials.data, {})).notices).toEqual([])
  })
})

describe('the library', () => {
  it('refuses signed-out callers', async () => {
    const s = await setup()
    await expect(s.t.query(api.materials.data, {})).rejects.toThrow(/Not signed in/)
    await expect(s.t.mutation(api.materials.share, { materialId: s.deck, versionId: 'current', investorIds: [s.kite], options: OPEN, expiresInDays: 0 })).rejects.toThrow(/Not signed in/)
  })

  it('numbers versions, makes the newest current, and checks what goes in', async () => {
    const s = await setup()
    const d = await s.as.query(api.materials.data, {})
    const deck = d.materials.find((m) => m._id === s.deck)!
    expect(deck.currentVersionId).toBe(s.v2)
    expect(d.versions.filter((x) => x.materialId === s.deck).map((x) => [x.n, x.by])).toEqual([[1, 'Dev'], [2, 'Dev']])
    await expect(s.as.mutation(api.materials.addVersion, { materialId: s.deck, source: { url: 'http://insecure.example.com', note: '' } })).rejects.toThrow(/link/)
    await expect(s.as.mutation(api.materials.addVersion, { materialId: s.deck, source: { note: '' } })).rejects.toThrow(/PDF or a link/)
    const big = await s.t.run((ctx) => ctx.storage.store(new Blob(['x'], { type: 'image/png' })))
    await expect(s.as.mutation(api.materials.addVersion, { materialId: s.deck, source: { fileId: big, note: '' } })).rejects.toThrow(/Only PDFs/)
  })

  it('share makes one link per investor, each with its own 128-bit token', async () => {
    const s = await setup()
    const links = await s.as.mutation(api.materials.share, { materialId: s.deck, versionId: s.v2, investorIds: [s.kite, s.orchard, s.kite], options: DEFAULT_OPTIONS, expiresInDays: 30 })
    expect(links).toHaveLength(2)
    expect(new Set(links.map((l) => l.token)).size).toBe(2)
    for (const l of links) expect(l.token).toMatch(/^[A-Za-z0-9_-]{22}$/)
    const rows = await s.t.run((ctx) => ctx.db.query('shareLinks').collect())
    expect(rows.every((r) => r.expiresAt! > Date.now() + 29 * 864e5)).toBe(true)
  })
})

describe('email', () => {
  it('sendEmail is skipped when RESEND_API_KEY is missing', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    expect(await sendEmail({ to: 'sam@kite.example.com', subject: 'Hi', text: 'Hello' })).toEqual({ sent: false, reason: 'no-key' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('sends through Resend from Dev at Pesto, replying to Dev', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test_made_up')
    const fetch = vi.fn(async () => new Response(JSON.stringify({ id: 'em_1' }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    expect(await sendEmail({ to: 'sam@kite.example.com', subject: 'Pitch deck from Pesto', text: 'Hello' })).toEqual({ sent: true, id: 'em_1' })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.resend.com/emails')
    expect(JSON.parse(String(init.body))).toMatchObject({ from: 'Dev at Pesto <nest@pestokids.com>', reply_to: 'dev@pestokids.com', to: ['sam@kite.example.com'] })
  })

  it('a refused send comes back as not sent, never thrown', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test_made_up')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'Domain not verified' }), { status: 403 })))
    expect(await sendEmail({ to: 'sam@kite.example.com', subject: 'Hi', text: 'Hello' })).toEqual({ sent: false, reason: 'error', message: 'Domain not verified' })
  })

  it('emailLinks skips everything without a key, and logs an email touch when it sends', async () => {
    const s = await setup()
    const l = await s.share(s.deck, s.kite)
    vi.stubEnv('RESEND_API_KEY', '')
    expect(await s.as.action(api.materials.emailLinks, { linkIds: [l.linkId], message: 'Hi Sam' })).toEqual({ sent: 0, failed: 0, skipped: 1 })
    expect((await s.notes(s.kite)).some((a) => a.touch === 'email')).toBe(false)

    vi.stubEnv('RESEND_API_KEY', 're_test_made_up')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'em_2' }), { status: 200 })))
    expect(await s.as.action(api.materials.emailLinks, { linkIds: [l.linkId], message: 'Hi Sam' })).toEqual({ sent: 1, failed: 0, skipped: 0 })
    expect((await s.notes(s.kite)).filter((a) => a.touch === 'email')).toHaveLength(1)
  })
})
