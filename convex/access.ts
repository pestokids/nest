import { query } from './_generated/server'
import { allowedEmails, checkUser, firstName, requireUser } from './lib/access'

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

/**
 * Who can get in: the ALLOWED_EMAILS list, with names for accounts that have
 * signed in. Only for people already on the list.
 */
export const members = query({
  args: {},
  handler: async (ctx) => {
    const { user: me } = await requireUser(ctx)
    const users = await ctx.db.query('users').collect()
    const byEmail = new Map(users.filter((u) => u.email).map((u) => [u.email!.toLowerCase(), u]))
    return [...allowedEmails()]
      .sort()
      .map((email) => {
        const u = byEmail.get(email)
        return { email, name: u ? firstName(u) : email.split('@')[0], me: email === me.email?.toLowerCase() }
      })
      .sort((a, b) => Number(b.me) - Number(a.me))
  },
})
