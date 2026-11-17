// Rolodex: people and investor firms from the fundraising research. The app only
// reads; the import (scripts/rolodex-import.mjs → the internal mutations below)
// is the only writer. Every public function calls requireUser first.
import { paginationOptsValidator } from 'convex/server'
import { v } from 'convex/values'
import { internalMutation, query } from './_generated/server'
import { requireUser } from './lib/access'
import { rolodexFirmFields, rolodexPersonFields } from './rolodexSchema'
import { listRow } from '../src/lib/rolodex'

/** Everyone, shortlist first, a page at a time, trimmed to what the list and its filters need. */
export const people = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    await requireUser(ctx)
    const r = await ctx.db.query('rolodexPeople').withIndex('by_shortlist').order('desc').paginate(paginationOpts)
    return { ...r, page: r.page.map(listRow) }
  },
})

/** One person, everything kept (the side panel). */
export const person = query({
  args: { id: v.id('rolodexPeople') },
  handler: async (ctx, { id }) => {
    await requireUser(ctx)
    const p = await ctx.db.get(id)
    if (!p) return null
    const { importedAt: _i, ...rest } = p
    return rest
  },
})

/** Every investor organisation (about 800 rows). */
export const firms = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx)
    const rows = await ctx.db.query('rolodexFirms').take(5000)
    return rows.map(({ importedAt: _i, ...rest }) => rest)
  },
})

/** Totals and when the data was imported (null before the first import). */
export const meta = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx)
    const m = await ctx.db.query('rolodexMeta').withIndex('by_key', (q) => q.eq('key', 'import')).unique()
    return m ? { people: m.people, shortlist: m.shortlist, firms: m.firms, importedAt: m.importedAt, source: m.source } : null
  },
})

/* ---------- import (internal: `npx convex run rolodex:importPeople …`) ---------- */

type Counts = { inserted: number; updated: number; unchanged: number }

/** Upsert a batch of people by Crustdata ID. Unchanged rows aren't written. */
export const importPeople = internalMutation({
  args: { importedAt: v.number(), rows: v.array(v.object(rolodexPersonFields)) },
  handler: async (ctx, { importedAt, rows }) => {
    const c: Counts = { inserted: 0, updated: 0, unchanged: 0 }
    for (const row of rows) {
      const prev = await ctx.db.query('rolodexPeople').withIndex('by_crustdataId', (q) => q.eq('crustdataId', row.crustdataId)).unique()
      if (!prev) {
        await ctx.db.insert('rolodexPeople', { ...row, importedAt })
        c.inserted++
      } else if (same(prev, row)) {
        if (prev.importedAt !== importedAt) await ctx.db.patch(prev._id, { importedAt })
        c.unchanged++
      } else {
        await ctx.db.replace(prev._id, { ...row, importedAt })
        c.updated++
      }
    }
    return c
  },
})

/** Upsert a batch of firms by key. */
export const importFirms = internalMutation({
  args: { importedAt: v.number(), rows: v.array(v.object(rolodexFirmFields)) },
  handler: async (ctx, { importedAt, rows }) => {
    const c: Counts = { inserted: 0, updated: 0, unchanged: 0 }
    for (const row of rows) {
      const prev = await ctx.db.query('rolodexFirms').withIndex('by_key', (q) => q.eq('key', row.key)).unique()
      if (!prev) {
        await ctx.db.insert('rolodexFirms', { ...row, importedAt })
        c.inserted++
      } else if (same(prev, row)) {
        if (prev.importedAt !== importedAt) await ctx.db.patch(prev._id, { importedAt })
        c.unchanged++
      } else {
        await ctx.db.replace(prev._id, { ...row, importedAt })
        c.updated++
      }
    }
    return c
  },
})

/** After an import: delete rows the import didn't touch (up to 500 a call; run until `more` is false). */
export const prune = internalMutation({
  args: { table: v.union(v.literal('rolodexPeople'), v.literal('rolodexFirms')), importedAt: v.number() },
  handler: async (ctx, { table, importedAt }) => {
    const stale = await ctx.db.query(table).withIndex('by_importedAt', (q) => q.lt('importedAt', importedAt)).take(500)
    for (const d of stale) await ctx.db.delete(d._id)
    return { deleted: stale.length, more: stale.length === 500 }
  },
})

/** The totals shown in the header, written last. */
export const setMeta = internalMutation({
  args: { people: v.number(), shortlist: v.number(), firms: v.number(), importedAt: v.number(), source: v.string() },
  handler: async (ctx, args) => {
    const prev = await ctx.db.query('rolodexMeta').withIndex('by_key', (q) => q.eq('key', 'import')).unique()
    if (prev) await ctx.db.replace(prev._id, { key: 'import', ...args })
    else await ctx.db.insert('rolodexMeta', { key: 'import', ...args })
  },
})

function same(prev: Record<string, unknown>, row: Record<string, unknown>) {
  const { _id: _a, _creationTime: _b, importedAt: _c, ...cur } = prev
  return JSON.stringify(sortKeys(cur)) === JSON.stringify(sortKeys(row))
}
function sortKeys(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(sortKeys)
  if (x && typeof x === 'object')
    return Object.fromEntries(
      Object.entries(x)
        .filter(([, y]) => y !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, y]) => [k, sortKeys(y)]),
    )
  return x
}
