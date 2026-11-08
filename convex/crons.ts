import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()
// PST-263: Calendar and Gmail, one sync per connected teammate.
crons.interval('google sync', { minutes: 10 }, internal.google.tick, {})
// PST-275: the suggestion checks, every morning at 09:00 IST (03:30 UTC).
crons.daily('suggestion checks', { hourUTC: 3, minuteUTC: 30 }, internal.suggestions.check, {})
// PST-279: the morning brief on Today, at 08:00 IST (02:30 UTC).
crons.daily('morning brief', { hourUTC: 2, minuteUTC: 30 }, internal.brief.run, {})
// PST-285: Wispr Flow notes after investor meetings, one run per connected teammate.
crons.interval('wispr notes', { minutes: 15 }, internal.wispr.tick, {})
// PST-289: feedback that couldn't reach Linear (no key yet, or Linear said no), retried hourly.
crons.interval('feedback retry', { hours: 1 }, internal.feedback.retry, {})
export default crons
