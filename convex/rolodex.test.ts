// @vitest-environment edge-runtime
// Rolodex: signed-out and not-on-the-list callers are refused; the import upserts
// (twice changes nothing), prunes what a newer import dropped, and the list comes
// back shortlist first. Every name and firm here is made up.
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')

beforeEach(() => vi.stubEnv('ALLOWED_EMAILS', 'founder@pestokids.com'))
afterEach(() => vi.unstubAllEnvs())

const person = (crustdataId: number, name: string, shortlist: boolean) => ({
  crustdataId, name, university: 'BITS', role: 'founder' as const, roleStatus: 'current' as const, founder: 'current' as const, currentRole: 'founder' as const,
  shortlist, fundingCheck: shortlist ? ('funded_company' as const) : ('unfunded' as const), countryCode: 'IN', gradYear: 2015,
})
const firm = (key: string, name: string) => ({ key, name, type: 'VC fund', geo: 'India', indiaPresence: 'yes' as const, people: 1, vcPeople: 1, angelPeople: 0, peopleThereNow: 1, personIds: [1] })

async function setup() {
  const t = convexTest(schema, modules)
  const dev = await t.run((ctx) => ctx.db.insert('users', { email: 'founder@pestokids.com', name: 'Dev', emailVerificationTime: 1 }))
  const stranger = await t.run((ctx) => ctx.db.insert('users', { email: 'someone@example.com', name: 'S', emailVerificationTime: 1 }))
  return { t, as: t.withIdentity({ subject: dev + '|s1' }), out: t.withIdentity({ subject: stranger + '|s2' }) }
}

describe('rolodex', () => {
  it('refuses anyone signed out or not on the list', async () => {
    const { t, out } = await setup()
    await expect(t.query(api.rolodex.meta, {})).rejects.toThrow('Not signed in')
    await expect(out.query(api.rolodex.firms, {})).rejects.toThrow("doesn't have access")
    await expect(out.query(api.rolodex.people, { paginationOpts: { numItems: 10, cursor: null } })).rejects.toThrow("doesn't have access")
  })

  it('imports idempotently, lists the shortlist first, and prunes what the next import dropped', async () => {
    const { t, as } = await setup()
    const rows = [person(1, 'Anvi Kale', false), person(2, 'Bhanu Iyer', true), person(3, 'Chaya Das', true)]
    expect(await t.mutation(internal.rolodex.importPeople, { importedAt: 100, rows })).toEqual({ inserted: 3, updated: 0, unchanged: 0 })
    expect(await t.mutation(internal.rolodex.importPeople, { importedAt: 200, rows })).toEqual({ inserted: 0, updated: 0, unchanged: 3 })
    await t.mutation(internal.rolodex.importFirms, { importedAt: 200, rows: [firm('id:1', 'Arbor Ventures')] })
    await t.mutation(internal.rolodex.setMeta, { people: 3, shortlist: 2, firms: 1, importedAt: 200, source: 'test' })

    const page = await as.query(api.rolodex.people, { paginationOpts: { numItems: 10, cursor: null } })
    expect(page.page.map((p) => [p.name, p.shortlist])).toEqual([
      ['Chaya Das', true],
      ['Bhanu Iyer', true],
      ['Anvi Kale', false],
    ])
    expect(Object.keys(page.page[0])).not.toContain('whyIncluded')
    const full = await as.query(api.rolodex.person, { id: page.page[0]._id as never })
    expect(full?.name).toBe('Chaya Das')
    expect(await as.query(api.rolodex.meta, {})).toMatchObject({ people: 3, shortlist: 2, firms: 1 })

    // A newer import without Anvi: changed rows replaced, Anvi pruned.
    await t.mutation(internal.rolodex.importPeople, { importedAt: 300, rows: [{ ...rows[1], gradYear: 2016 }, rows[2]] })
    await t.mutation(internal.rolodex.importFirms, { importedAt: 300, rows: [firm('id:1', 'Arbor Ventures')] })
    expect(await t.mutation(internal.rolodex.prune, { table: 'rolodexPeople', importedAt: 300 })).toEqual({ deleted: 1, more: false })
    const after = await as.query(api.rolodex.people, { paginationOpts: { numItems: 10, cursor: null } })
    expect(after.page.map((p) => p.name).sort()).toEqual(['Bhanu Iyer', 'Chaya Das'])
    expect(after.page.find((p) => p.name === 'Bhanu Iyer')?.gradYear).toBe(2016)
    expect(await as.query(api.rolodex.firms, {})).toHaveLength(1)
  })

  it('investors list most founders first and trimmed; one investor and companies by key come whole; both prune', async () => {
    const { t, as, out } = await setup()
    const backed = (key: string, name: string, founders: number[]) => ({
      key, name, status: 'funded', rounds: ['Seed 2021'], firstYear: 2021, source: 'web' as const,
      founders: founders.map((personId) => ({ personId, name: 'F' + personId, timing: 'during' as const })),
    })
    const investor = (key: string, name: string, companies: ReturnType<typeof backed>[]) => ({
      key, name, kind: 'vc' as const, companies, companyCount: companies.length, founderCount: new Set(companies.flatMap((c) => c.founders.map((f) => f.personId))).size, webCount: companies.length,
    })
    const rows = [investor('arbor', 'Arbor Ventures', [backed('id:7', 'Inkwell', [2])]), investor('kai rao', 'Kai Rao', [backed('id:7', 'Inkwell', [2]), backed('id:8', 'Fold', [3, 4])])]
    expect(await t.mutation(internal.rolodex.importInvestors, { importedAt: 100, rows })).toEqual({ inserted: 2, updated: 0, unchanged: 0 })
    const company = { key: 'id:7', name: 'Inkwell', status: 'funded', research: 'web' as const, founders: [{ personId: 2, name: 'F2' }], investors: [{ key: 'arbor', name: 'Arbor Ventures', kind: 'vc' as const, source: 'web' as const }] }
    await t.mutation(internal.rolodex.importCompanies, { importedAt: 100, rows: [company] })

    await expect(out.query(api.rolodex.investors, { paginationOpts: { numItems: 10, cursor: null } })).rejects.toThrow("doesn't have access")
    await expect(out.query(api.rolodex.investor, { key: 'arbor' })).rejects.toThrow("doesn't have access")
    await expect(out.query(api.rolodex.companies, { keys: ['id:7'] })).rejects.toThrow("doesn't have access")

    const page = await as.query(api.rolodex.investors, { paginationOpts: { numItems: 10, cursor: null } })
    expect(page.page.map((r) => [r.name, r.founderCount, r.companyNames])).toEqual([
      ['Kai Rao', 3, ['Inkwell', 'Fold']],
      ['Arbor Ventures', 1, ['Inkwell']],
    ])
    expect(Object.keys(page.page[0])).not.toContain('companies')
    expect((await as.query(api.rolodex.investor, { key: 'kai rao' }))?.companies[1].founders).toHaveLength(2)
    expect(await as.query(api.rolodex.investor, { key: 'nobody' })).toBeNull()
    expect((await as.query(api.rolodex.companies, { keys: ['id:7', 'id:missing'] })).map((c) => c.investors[0].name)).toEqual(['Arbor Ventures'])

    await t.mutation(internal.rolodex.importInvestors, { importedAt: 200, rows: [rows[1]] })
    expect(await t.mutation(internal.rolodex.prune, { table: 'rolodexInvestors', importedAt: 200 })).toEqual({ deleted: 1, more: false })
    expect(await t.mutation(internal.rolodex.prune, { table: 'rolodexCompanies', importedAt: 200 })).toEqual({ deleted: 1, more: false })
  })
})
