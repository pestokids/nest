import { query } from './_generated/server'
import { checkUser, firstName } from './lib/access'

/**
 * The caller's own access status, so the client can show the sign-in screen or
 * sign a disallowed account out with a plain message. Returns nothing about the
 * tracker, only the caller's own name and email (for the avatar menu, and so
 * "Not on the list" can say which account it refused). It is the only public
 * function that doesn't throw for outsiders.
 */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const a = await checkUser(ctx)
    if (a.status === 'signedOut') return { status: a.status }
    if (a.status === 'denied') return { status: a.status, email: a.email }
    return { status: 'ok' as const, firstName: firstName(a.user), name: a.user.name ?? '', email: a.user.email ?? '' }
  },
})
