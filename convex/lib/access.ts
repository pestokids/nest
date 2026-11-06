import { getAuthUserId } from '@convex-dev/auth/server'
import { ConvexError } from 'convex/values'
import type { QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'

/** ALLOWED_EMAILS: comma-separated, compared lowercased. */
export function allowedEmails(): Set<string> {
  return new Set(
    (process.env.ALLOWED_EMAILS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  )
}

export type Access =
  | { status: 'signedOut' }
  | { status: 'denied'; email: string }
  | { status: 'ok'; userId: Id<'users'>; user: Doc<'users'> }

export async function checkUser(ctx: QueryCtx): Promise<Access> {
  const userId = await getAuthUserId(ctx)
  if (!userId) return { status: 'signedOut' }
  const user = await ctx.db.get(userId)
  if (!user) return { status: 'signedOut' }
  const email = user.email?.toLowerCase()
  if (!email || user.emailVerificationTime === undefined || !allowedEmails().has(email)) return { status: 'denied', email: email ?? '' }
  return { status: 'ok', userId, user }
}

/** Every public query and mutation calls this first. */
export async function requireUser(ctx: QueryCtx) {
  const a = await checkUser(ctx)
  if (a.status === 'signedOut') throw new ConvexError('Not signed in')
  if (a.status === 'denied') throw new ConvexError("This account doesn't have access")
  return { userId: a.userId, user: a.user }
}

export const firstName = (u: Pick<Doc<'users'>, 'name' | 'email'> | null | undefined) =>
  u?.name?.trim().split(/\s+/)[0] || (u?.email ? u.email.split('@')[0] : '') || '?'
