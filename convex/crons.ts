import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()
// PST-263: Calendar and Gmail, one sync per connected teammate.
crons.interval('google sync', { minutes: 10 }, internal.google.tick, {})
// PST-275: the suggestion checks, every morning at 09:00 IST (03:30 UTC).
crons.daily('suggestion checks', { hourUTC: 3, minuteUTC: 30 }, internal.suggestions.check, {})
export default crons
