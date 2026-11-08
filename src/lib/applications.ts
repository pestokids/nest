// PST-302: an application to an accelerator or fund programme, kept apart from
// the pipeline stage. Dev sets the stage; an application never moves it, never
// counts as a meeting, money or "in the race", and while a decision is pending
// the investor is never "gone quiet". Pure, shared by the UI and Convex.
import { dayDiff, isISODate } from './dates'

export const APPLICATION_STATUSES = ['drafting', 'submitted', 'interview_invited', 'interview_done', 'accepted', 'rejected', 'withdrawn'] as const
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number]
/** No application on an investor means they weren't applied to. */
export type Application = { status: ApplicationStatus; program?: string; submittedOn?: string; decisionBy?: string }
export type ApplicationFields = { application?: Application }

/** The drawer's status picker. */
export const APPLICATION_LABEL: Record<ApplicationStatus, string> = {
  drafting: 'Application in progress',
  submitted: 'Submitted',
  interview_invited: 'Interview invited',
  interview_done: 'Interview done',
  accepted: 'Accepted',
  rejected: 'Not accepted',
  withdrawn: 'Withdrawn',
}

/** Statuses where the decision is theirs to make: no quiet warnings, no nudges. Drafting is Dev's own task, so it isn't here. */
export const AWAITING = new Set<ApplicationStatus>(['submitted', 'interview_invited', 'interview_done'])
export const isAwaiting = (a: Application | undefined | null): boolean => !!a && AWAITING.has(a.status)

export const isApplicationStatus = (s: unknown): s is ApplicationStatus => typeof s === 'string' && (APPLICATION_STATUSES as readonly string[]).includes(s)

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "Fri 27 Nov" */
export function decisionDay(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z')
  return DAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()]
}

/**
 * The chip on the board card, the Investors table, ⌘K and the drawer:
 * "Applied W27 · awaiting decision", "Interview invited · W27", "Accepted · W27".
 * Only an interview status says interview; nothing here says meeting or money.
 */
export function applicationChip(a: Application | undefined | null): string | null {
  if (!a) return null
  const p = a.program?.trim() ?? ''
  const tail = p ? ' · ' + p : ''
  switch (a.status) {
    case 'drafting':
      return 'Application in progress' + tail
    case 'submitted':
      return 'Applied' + (p ? ' ' + p : '') + ' · awaiting decision'
    case 'interview_invited':
      return 'Interview invited' + tail
    case 'interview_done':
      return 'Interview done · awaiting decision' + tail
    case 'accepted':
      return 'Accepted' + tail
    case 'rejected':
      return 'Not accepted' + tail
    case 'withdrawn':
      return 'Application withdrawn' + tail
  }
}

export type ApplicationTone = 'waiting' | 'success' | 'outline' | 'muted'
export const applicationTone = (a: Application): ApplicationTone => (isAwaiting(a) ? 'waiting' : a.status === 'accepted' ? 'success' : a.status === 'drafting' ? 'outline' : 'muted')

/** The decision-by day has passed and the decision is still pending. */
export const isDecisionPassed = (a: Application | undefined | null, today: string): boolean => !!a && isAwaiting(a) && !!a.decisionBy && a.decisionBy < today

/** The calm card foot while waiting: "Awaiting decision · decision by Fri 27 Nov", or "Decision date passed" once it has. Null when not waiting. */
export function awaitingLine(a: Application | undefined | null, today: string): string | null {
  if (!a || !isAwaiting(a)) return null
  if (isDecisionPassed(a, today)) return 'Decision date passed · update status'
  return a.decisionBy ? 'Awaiting decision · decision by ' + decisionDay(a.decisionBy) : 'Awaiting decision'
}

/** The Inbox row's detail: "Was due Fri 27 Nov · W27". */
export function passedDetail(a: Application, today: string): string {
  const n = a.decisionBy ? dayDiff(today, a.decisionBy) : 0
  const when = n <= 1 ? 'Was due yesterday' : 'Was due ' + decisionDay(a.decisionBy!)
  return when + (a.program?.trim() ? ' · ' + a.program.trim() : '')
}

/** Trim the programme, drop bad or empty dates. Null when there's no status. */
export function cleanApplication(a: { status?: unknown; program?: unknown; submittedOn?: unknown; decisionBy?: unknown } | null | undefined): Application | null {
  if (!a || !isApplicationStatus(a.status)) return null
  const program = typeof a.program === 'string' ? a.program.trim().slice(0, 40) : ''
  const date = (x: unknown) => (typeof x === 'string' && isISODate(x) ? x : undefined)
  const out: Application = { status: a.status }
  if (program) out.program = program
  const submittedOn = date(a.submittedOn)
  const decisionBy = date(a.decisionBy)
  if (submittedOn) out.submittedOn = submittedOn
  if (decisionBy) out.decisionBy = decisionBy
  return out
}

/** PST-302 with PST-303's rule: the fields Dev touched in the Application row, and nothing else. Null or empty clears a field. */
export type ApplicationChanges = { status?: ApplicationStatus; program?: string | null; submittedOn?: string | null; decisionBy?: string | null }

/**
 * The application as it is now with only the touched fields changed, so a status
 * or date set elsewhere (an agent's suggestion) while the row is open is kept.
 * Null when there's no status to keep (nothing applied yet and no status picked).
 */
export function changeApplication(cur: Application | undefined | null, changes: ApplicationChanges): Application | null {
  const next: Record<string, unknown> = { ...cur }
  for (const [k, x] of Object.entries(changes)) if (x !== undefined) next[k] = x === null || x === '' ? undefined : x
  return cleanApplication(next)
}

export const sameApplication = (a: Application | undefined | null, b: Application | undefined | null) =>
  (a?.status ?? null) === (b?.status ?? null) && (a?.program ?? '') === (b?.program ?? '') && (a?.submittedOn ?? '') === (b?.submittedOn ?? '') && (a?.decisionBy ?? '') === (b?.decisionBy ?? '')

/** The Investors filter: any application, one submitted (awaiting a decision), or none. */
export const APPLICATION_FILTERS = ['any', 'submitted', 'none'] as const
export type ApplicationFilter = (typeof APPLICATION_FILTERS)[number]
export const APPLICATION_FILTER_LABEL: Record<ApplicationFilter, string> = { any: 'Any', submitted: 'Submitted', none: 'None' }
export function matchesApplication(i: ApplicationFields, f: ApplicationFilter | undefined): boolean {
  if (!f) return true
  if (f === 'none') return !i.application
  if (f === 'submitted') return isAwaiting(i.application)
  return !!i.application
}

/**
 * Warm path text that only says "applied" (older records): it isn't a person who
 * can introduce Dev, so cards never read "via application" from it.
 */
export const isApplicationPath = (path: string) => /^(via )?(applied|application|apply|applied online|online application)$/i.test(path.trim())

/** Next-step text that only says to wait for the decision: not a next step (agents and drafts). */
export const isWaitingStep = (step: string) => {
  const s = step.trim().replace(/[.!]+$/, '')
  return /^(await(ing)?|wait(ing)?( on| for)?|pending|hear back)\b/i.test(s) && /\b(decision|outcome|result|results|response|answer|back|them|it)\b/i.test(s)
}
