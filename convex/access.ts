import { query } from './_generated/server'
import { checkUser, firstName } from './lib/access'

/**
 * The caller's own access status, so the client can show the sign-in screen or
 * sign a disallowed account out with a plain message. Returns nothing about the
 * tracker; it is the only public function that doesn't throw for outsiders.
 */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const a = await checkUser(ctx)
    if (a.status !== 'ok') return { status: a.status }
    return { status: 'ok' as const, firstName: firstName(a.user) }
  },
})
