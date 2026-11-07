import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()
// PST-263: Calendar and Gmail, one sync per connected teammate.
crons.interval('google sync', { minutes: 10 }, internal.google.tick, {})
export default crons
