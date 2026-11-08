// @vitest-environment edge-runtime
// PST-297: the Inbox's done and snooze marks (per person, Undo puts back what was
// there) and the clear-inbox confetti, once a day per person. Made-up people only.
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')

beforeEach(() => {
  vi.stubEnv('ALLOWED_EMAILS', 'founder@example.com,cofounder@example.com')
})
afterEach(() => {
  vi.unstubAllEnvs()
})

async function setup() {
  const t = convexTest(schema, modules)
  const [dev, sam] = await t.run(async (ctx) => [
    await ctx.db.insert('users', { email: 'founder@example.com', name: 'Dev', emailVerificationTime: 1 }),
    await ctx.db.insert('users', { email: 'cofounder@example.com', name: 'Sam', emailVerificationTime: 1 }),
  ])
  return { t, dev: t.withIdentity({ subject: dev + '|s1' }), sam: t.withIdentity({ subject: sam + '|s2' }) }
}

describe('inbox marks', () => {
  it('marks a row done for the caller only, and Undo takes it back', async () => {
    const { dev, sam } = await setup()
    expect(await dev.mutation(api.inbox.mark, { key: 'reply:a', kind: 'done', version: 'v1' })).toBeNull()
    expect(await dev.query(api.inbox.marks, {})).toEqual([{ key: 'reply:a', kind: 'done', version: 'v1' }])
    expect(await sam.query(api.inbox.marks, {})).toEqual([])
    await dev.mutation(api.inbox.restore, { key: 'reply:a', prev: null })
    expect(await dev.query(api.inbox.marks, {})).toEqual([])
  })

  it('snoozes with a time, and Undo puts back the mark it replaced', async () => {
    const { dev } = await setup()
    await dev.mutation(api.inbox.mark, { key: 'quiet:b', kind: 'snooze', version: 'v1', until: 1000 })
    const prev = await dev.mutation(api.inbox.mark, { key: 'quiet:b', kind: 'done', version: 'v2' })
    expect(prev).toEqual({ kind: 'snooze', version: 'v1', until: 1000 })
    await dev.mutation(api.inbox.restore, { key: 'quiet:b', prev })
    expect(await dev.query(api.inbox.marks, {})).toEqual([{ key: 'quiet:b', kind: 'snooze', version: 'v1', until: 1000 }])
  })

  it('needs a time to snooze until, a sane key and a signed-in person', async () => {
    const { t, dev } = await setup()
    await expect(dev.mutation(api.inbox.mark, { key: 'quiet:b', kind: 'snooze', version: 'v1' })).rejects.toThrow(/comes back/)
    await expect(dev.mutation(api.inbox.mark, { key: '', kind: 'done', version: 'v1' })).rejects.toThrow()
    await expect(t.query(api.inbox.marks, {})).rejects.toThrow(/Not signed in/)
  })
})

describe('the clear-inbox confetti', () => {
  it('plays once a day per person', async () => {
    const { dev, sam } = await setup()
    expect(await dev.mutation(api.inbox.cleared, { day: '2030-01-10' })).toBe(true)
    expect(await dev.mutation(api.inbox.cleared, { day: '2030-01-10' })).toBe(false)
    expect(await sam.mutation(api.inbox.cleared, { day: '2030-01-10' })).toBe(true)
    expect(await dev.mutation(api.inbox.cleared, { day: '2030-01-11' })).toBe(true)
    await expect(dev.mutation(api.inbox.cleared, { day: 'today' })).rejects.toThrow()
  })
})
