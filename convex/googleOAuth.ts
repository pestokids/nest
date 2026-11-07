// PST-263: the "Connect Google" callback, an HTTP action at <CONVEX_SITE_URL>/google/callback.
// Checks the signed state (who started it, not expired), that they're still on
// the access list, that both scopes were granted and that it's their own account,
// then seals the refresh token and starts the first sync. Always redirects back
// to Settings with `?connect=<result>`; never echoes a token or code.
import { httpAction } from './_generated/server'
import { internal } from './_generated/api'
import { encryptToken, hasTokenKey, MissingKey, verifyState } from './lib/crypto'
import { exchangeCode, gmailProfile, oauthClient, revoke, SCOPES } from './lib/googleApi'

export type ConnectResult = 'ok' | 'denied' | 'expired' | 'nokey' | 'scopes' | 'account' | 'error'

const back = (r: ConnectResult) => {
  const site = (process.env.SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
  return new Response(null, { status: 302, headers: { Location: `${site}/raise/settings?connect=${r}`, 'Cache-Control': 'no-store' } })
}

export const callback = httpAction(async (ctx, req) => {
  const url = new URL(req.url)
  if (!hasTokenKey() || !oauthClient()) return back('nokey')
  let who: { u: string } | null
  try {
    who = await verifyState(url.searchParams.get('state') ?? '')
  } catch (e) {
    return back(e instanceof MissingKey ? 'nokey' : 'error')
  }
  if (!who) return back('expired')
  if (url.searchParams.get('error')) return back('denied')
  const code = url.searchParams.get('code')
  if (!code) return back('error')
  const user = await ctx.runQuery(internal.google.allowedUser, { userId: who.u })
  if (!user) return back('denied')
  let tokens
  try {
    tokens = await exchangeCode(code)
  } catch {
    return back('error')
  }
  if (!tokens.refreshToken) return back('error')
  if (!SCOPES.every((s) => tokens.scopes.includes(s))) {
    await revoke(tokens.refreshToken)
    return back('scopes')
  }
  let googleEmail: string
  try {
    googleEmail = (await gmailProfile(tokens.accessToken)).emailAddress.toLowerCase()
  } catch {
    return back('error')
  }
  // Each teammate connects their own account: the one they sign in to Nest with.
  if (googleEmail !== user.email) {
    await revoke(tokens.refreshToken)
    return back('account')
  }
  const sealed = await encryptToken(tokens.refreshToken)
  const connectionId = await ctx.runMutation(internal.google.store, { userId: user.userId, googleEmail, sealed })
  await ctx.scheduler.runAfter(0, internal.googleSync.run, { connectionId })
  return back('ok')
})
