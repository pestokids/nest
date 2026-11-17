#!/usr/bin/env node
// Import internal/rolodex.json into the Rolodex (rolodexPeople, rolodexFirms, rolodexMeta).
//
//   node scripts/rolodex-import.mjs            # dev deployment
//   node scripts/rolodex-import.mjs --prod     # production
//   node scripts/rolodex-import.mjs --dry-run  # batches only, nothing sent
//
// The JSON comes from the fundraising research (fundraising/scripts/export_rolodex.py) and holds
// personal data: it lives in internal/ (git-ignored) and is never committed. Rows are upserted
// (people by Crustdata ID, firms by key), so running it twice changes nothing; rows the file no
// longer has are deleted afterwards (rolodex:prune), then the header totals are written.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const prod = args.includes('--prod')
const dry = args.includes('--dry-run')
const file = args.find((a) => !a.startsWith('--')) ?? 'internal/rolodex.json'
/** `convex run` takes its arguments on the command line; stay well under the OS limit (1 MB on macOS). */
const MAX_BYTES = 350_000

const data = JSON.parse(readFileSync(file, 'utf8'))
const importedAt = Date.now()

function batches(rows) {
  const out = []
  let cur = []
  let size = 0
  for (const r of rows) {
    const n = JSON.stringify(r).length + 1
    if (cur.length && size + n > MAX_BYTES) {
      out.push(cur)
      cur = []
      size = 0
    }
    cur.push(r)
    size += n
  }
  if (cur.length) out.push(cur)
  return out
}

function run(fn, payload) {
  if (dry) return {}
  const r = spawnSync('npx', ['convex', 'run', ...(prod ? ['--prod'] : []), fn, JSON.stringify(payload)], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  if (r.status !== 0) {
    process.stderr.write(r.stderr || r.stdout)
    throw new Error(`${fn} failed (exit ${r.status})`)
  }
  const text = r.stdout.trim()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return { raw: text }
  }
}

const total = (acc, c) => ({ inserted: acc.inserted + (c.inserted ?? 0), updated: acc.updated + (c.updated ?? 0), unchanged: acc.unchanged + (c.unchanged ?? 0) })
const zero = { inserted: 0, updated: 0, unchanged: 0 }

console.log(`Rolodex import → ${prod ? 'PRODUCTION' : 'dev'}${dry ? ' (dry run)' : ''}: ${data.people.length} people, ${data.firms.length} firms from ${file}`)

let firms = zero
for (const [i, rows] of batches(data.firms).entries()) {
  firms = total(firms, run('rolodex:importFirms', { importedAt, rows }))
  console.log(`  firms batch ${i + 1}: ${rows.length}`)
}
let people = zero
const pb = batches(data.people)
for (const [i, rows] of pb.entries()) {
  people = total(people, run('rolodex:importPeople', { importedAt, rows }))
  console.log(`  people batch ${i + 1}/${pb.length}: ${rows.length}`)
}

let pruned = 0
for (const table of ['rolodexFirms', 'rolodexPeople']) {
  for (;;) {
    const r = run('rolodex:prune', { table, importedAt })
    pruned += r.deleted ?? 0
    if (!r.more) break
  }
}

const shortlist = data.people.filter((p) => p.shortlist).length
run('rolodex:setMeta', { people: data.people.length, shortlist, firms: data.firms.length, importedAt, source: data.source ?? file })
console.log(JSON.stringify({ firms, people, pruned, shortlist }, null, 2))
