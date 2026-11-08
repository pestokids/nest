// @vitest-environment edge-runtime
// PST-289: Send feedback against a mocked Linear GraphQL API: success, the
// Feedback label missing (made on the team), a failure that leaves the row
// "Not sent yet", the hourly retry, and no key at all. fetch is faked; nothing
// here calls Linear. Every name, text and URL below is made up.
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const KEY = 'test-linear-key'
const UPLOAD = 'https://uploads.example.com/signed-put'
const ASSET = 'https://uploads.example.com/asset/shot.png'

beforeEach(() => {
  vi.stubEnv('ALLOWED_EMAILS', 'founder@pestokids.com')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

type Call = { url: string; method: string; auth: string | null; query?: string; variables?: Record<string, unknown> }

/** A fake Linear. `label`: whether Pesto already has a Feedback label. `down`: answer 500 to everything. */
function fakeLinear(o: { label?: boolean; down?: boolean } = {}) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers)
    if (url === UPLOAD) {
      calls.push({ url, method: init.method ?? 'GET', auth: headers.get('Authorization') })
      return new Response(null, { status: 200 })
    }
    const body = JSON.parse(String(init.body)) as { query: string; variables: Record<string, unknown> }
    calls.push({ url, method: init.method ?? 'GET', auth: headers.get('Authorization'), query: body.query, variables: body.variables })
    if (o.down) return new Response(JSON.stringify({ errors: [{ message: 'Service unavailable' }] }), { status: 500 })
    const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (body.query.includes('query Target'))
      return ok({
        teams: { nodes: [{ id: 'team-pesto' }] },
        projects: { nodes: [{ id: 'project-nest' }] },
        issueLabels: { nodes: o.label === false ? [{ id: 'label-elsewhere', team: { id: 'team-other' } }] : [{ id: 'label-feedback', team: { id: 'team-pesto' } }] },
      })
    if (body.query.includes('issueLabelCreate')) return ok({ issueLabelCreate: { success: true, issueLabel: { id: 'label-new' } } })
    if (body.query.includes('fileUpload')) return ok({ fileUpload: { success: true, uploadFile: { uploadUrl: UPLOAD, assetUrl: ASSET, headers: [{ key: 'x-goog-meta', value: '1' }] } } })
    if (body.query.includes('issueCreate')) return ok({ issueCreate: { success: true, issue: { identifier: 'PST-301', url: 'https://linear.app/example/issue/PST-301' } } })
    return new Response('{}', { status: 404 })
  })
  return calls
}

async function setup() {
  const t = convexTest(schema, modules)
  const userId = await t.run((ctx) => ctx.db.insert('users', { email: 'founder@pestokids.com', name: 'Dev', emailVerificationTime: 1 }))
  const as = t.withIdentity({ subject: `${userId}|session` })
  const screenshotId = await t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })))
  const id = await as.mutation(api.feedback.submit, {
    type: 'idea',
    text: 'Show who hasn’t booked yet\nIt would help in kickoff week.',
    path: '/raise/pipeline?q=secret',
    viewport: { w: 1440, h: 900 },
    version: 'abc1234',
    screenshotId,
  })
  return { t, as, id }
}

const issueCall = (calls: Call[]) => calls.find((c) => c.query?.includes('issueCreate'))!

describe('Send feedback → Linear (PST-289)', () => {
  it('makes the issue in Pesto › Nest with the Feedback label, the page and the screenshot', async () => {
    vi.stubEnv('LINEAR_API_KEY', KEY)
    const calls = fakeLinear()
    const { t, as, id } = await setup()
    const r = await as.action(api.feedback.send, { id })
    expect(r).toEqual({ status: 'sent', identifier: 'PST-301', url: 'https://linear.app/example/issue/PST-301' })

    expect(calls.filter((c) => c.url !== UPLOAD).every((c) => c.url === 'https://api.linear.app/graphql' && c.auth === KEY)).toBe(true)
    expect(calls.some((c) => c.query?.includes('issueLabelCreate'))).toBe(false)
    const put = calls.find((c) => c.url === UPLOAD)!
    expect(put.method).toBe('PUT')
    expect(put.auth).toBeNull()
    const input = issueCall(calls).variables!.input as Record<string, unknown>
    expect(input).toMatchObject({ teamId: 'team-pesto', projectId: 'project-nest', labelIds: ['label-feedback'], title: 'Show who hasn’t booked yet' })
    expect(input.description).toContain('Page: `/raise/pipeline` (Raise › Pipeline)')
    expect(input.description).toContain('Viewport: 1440 × 900')
    expect(input.description).toContain(`![Screenshot of the page](${ASSET})`)
    expect(input.description).not.toContain('secret')

    const row = await t.run((ctx) => ctx.db.get(id))
    expect(row).toMatchObject({ status: 'sent', attempts: 1, path: '/raise/pipeline', issue: { identifier: 'PST-301' } })
    // Sending again changes nothing.
    expect(await as.action(api.feedback.send, { id })).toMatchObject({ status: 'sent', identifier: 'PST-301' })
    expect(calls.filter((c) => c.query?.includes('issueCreate'))).toHaveLength(1)
  })

  it('makes the Feedback label on the team when it’s missing', async () => {
    vi.stubEnv('LINEAR_API_KEY', KEY)
    const calls = fakeLinear({ label: false })
    const { as, id } = await setup()
    expect(await as.action(api.feedback.send, { id })).toMatchObject({ status: 'sent' })
    const made = calls.find((c) => c.query?.includes('issueLabelCreate'))!
    expect(made.variables).toEqual({ teamId: 'team-pesto', name: 'Feedback' })
    expect((issueCall(calls).variables!.input as { labelIds: string[] }).labelIds).toEqual(['label-new'])
  })

  it('keeps it as Not sent yet when Linear fails, and the hourly retry sends it', async () => {
    vi.stubEnv('LINEAR_API_KEY', KEY)
    fakeLinear({ down: true })
    const { t, as, id } = await setup()
    expect(await as.action(api.feedback.send, { id })).toEqual({ status: 'unsent', reason: 'error' })
    const failed = await t.run((ctx) => ctx.db.get(id))
    expect(failed).toMatchObject({ status: 'unsent', attempts: 1 })
    expect(failed!.lastError).toContain('Linear answered 500')
    expect(failed!.lastError).not.toContain(KEY)
    const listed = await as.query(api.feedback.list, {})
    expect(listed.linear).toBe(true)
    expect(listed.rows[0]).toMatchObject({ status: 'unsent', title: 'Show who hasn’t booked yet', by: 'Dev' })

    vi.useFakeTimers()
    try {
      const calls = fakeLinear()
      expect(await t.mutation(internal.feedback.retry, {})).toBe(1)
      await t.finishAllScheduledFunctions(vi.runAllTimers)
      expect(calls.some((c) => c.query?.includes('issueCreate'))).toBe(true)
    } finally {
      vi.useRealTimers()
    }
    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({ status: 'sent', attempts: 2, issue: { identifier: 'PST-301' } })
  })

  it('without a key it saves, sends nothing, and the retry waits', async () => {
    const calls = fakeLinear()
    const { t, as, id } = await setup()
    expect(await as.action(api.feedback.send, { id })).toEqual({ status: 'unsent', reason: 'nokey' })
    expect(await t.mutation(internal.feedback.retry, {})).toBe(0)
    expect(calls).toEqual([])
    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({ status: 'unsent', attempts: 0 })
    expect((await as.query(api.feedback.list, {})).linear).toBe(false)
  })

  it('refuses outsiders and empty text', async () => {
    const t = convexTest(schema, modules)
    await expect(t.mutation(api.feedback.uploadUrl, {})).rejects.toThrow(/Not signed in/)
    const { as } = await setup()
    await expect(as.mutation(api.feedback.submit, { type: 'bug', text: '   ', path: '/', viewport: { w: 1, h: 1 }, version: 'dev' })).rejects.toThrow(/first/)
  })
})
