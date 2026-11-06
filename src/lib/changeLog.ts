// The Settings change log in sentences: "Close date moved from Tue 1 Dec to Fri 4 Dec".
import { isISODate } from './dates'
import { longDay } from './investorView'
import { money } from './money'
import { fieldLabel, type RoundChange } from './round'

export type LogEntry = RoundChange & { _id: string; at: number; by: string }
export type LogEvent = { id: string; at: number; by: string; lines: string[] }

const MONEY = new Set(['target', 'stretch', 'cap', 'minCheck'])
const NAMES: Record<string, string> = { target: 'Target', stretch: 'Room to', cap: 'Valuation cap', minCheck: 'Minimum check' }

const show = (field: string, v: string) => {
  if (!v) return 'nothing'
  if (MONEY.has(field) && Number.isFinite(Number(v))) return money(Number(v))
  if (isISODate(v)) return longDay(v)
  return v
}

/** One change as a sentence. */
export function describeChange(c: RoundChange): string {
  if (c.field === 'import') return `Imported ${c.to}`
  if (MONEY.has(c.field)) {
    const a = Number(c.from)
    const b = Number(c.to)
    if (!c.from) return `${NAMES[c.field]} set to ${show(c.field, c.to)}`
    if (!c.to) return `${NAMES[c.field]} cleared (was ${show(c.field, c.from)})`
    return `${NAMES[c.field]} ${b > a ? 'raised' : 'lowered'} from ${show(c.field, c.from)} to ${show(c.field, c.to)}`
  }
  if (c.field === 'deadline') return `Close date moved from ${show(c.field, c.from)} to ${show(c.field, c.to)}`
  if (c.field === 'kickoff') return `Kickoff moved from ${show(c.field, c.from)} to ${show(c.field, c.to)}`
  if (c.field === 'quietDays') return `Gone quiet now after ${c.to} days (was ${c.from})`
  if (/^phases\.\d+\.name$/.test(c.field)) return c.from ? `${c.from} renamed to ${c.to}` : `Phase added: ${c.to}`
  return `${fieldLabel(c.field)}: ${show(c.field, c.from)} → ${show(c.field, c.to)}`
}

/** Rows saved together (same time, same person) become one event, newest first. */
export function groupLog(rows: LogEntry[]): LogEvent[] {
  const out: LogEvent[] = []
  for (const r of [...rows].sort((a, b) => b.at - a.at)) {
    const last = out[out.length - 1]
    if (last && last.at === r.at && last.by === r.by && r.field !== 'import') last.lines.push(describeChange(r))
    else out.push({ id: r._id, at: r.at, by: r.by, lines: [describeChange(r)] })
  }
  return out
}

/** "NOV 6 · 18:20" in India time, like every other date in Nest. */
export function logTime(at: number): string {
  const d = new Date(at + 330 * 60 * 1000)
  const mon = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][d.getUTCMonth()]
  return `${mon} ${d.getUTCDate()} · ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}
