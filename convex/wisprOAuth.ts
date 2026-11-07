// PST-285: the Wispr Flow sign-in callback, an HTTP action at /wispr/callback
// (https://nest.pestokids.com/wispr/callback through vercel.json's rewrite on the
// production host; http://localhost:3000/wispr/callback through Vite's proxy in
// dev). Checks the signed state (who started it, not expired) and that they're
// still on the access list, swaps the code for tokens with the PKCE verifier,
// seals them and starts the first fetch. Always redirects back to Settings with
// `?wisprConnect=<result>`; never echoes a token or code.
import { httpAction } from './_generated/server'
import { internal } from './_generated/api'
import { decryptToken, hasTokenKey, MissingKey, verifyState } from './lib/crypto'
import { AuthRefused, exchangeCode } from './lib/mcpClient'
import { clientOf, sealTokens } from './wispr'
import { TRY_DAYS } from '../src/lib/wispr'

export type WisprConnectResult = 'ok' | 'denied' | 'expired' | 'nokey' | 'error'

const back = (r: WisprConnectResult) => {
  const site = (process.env.SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
  return new Response(null, { status: 302, headers: { Location: `${site}/raise/settings?wisprConnect=${r}`, 'Cache-Control': 'no-store' } })
}
const sameIssuer = (a: string, b: string) => a.replace(/\/+$/, '') === b.replace(/\/+$/, '')

export const callback = httpAction(async (ctx, req) => {
  const url = new URL(req.url)
  if (!hasTokenKey()) return back('nokey')
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
  const c = await ctx.runQuery(internal.wispr.forUser, { userId: user.userId })
  if (!c?.verifier) return back('expired')
  // RFC 9207: when the server says who it is, it must be the one we registered with.
  const iss = url.searchParams.get('iss')
  if (iss && !sameIssuer(iss, c.issuer)) return back('error')
  let sealed
  try {
    const tokens = await exchangeCode(c, await clientOf(c), { code, verifier: await decryptToken(c.verifier), redirectUri: c.redirectUri })
    sealed = await sealTokens(tokens)
  } catch (e) {
    console.log(`wispr connect conn=${c._id} status=failed${e instanceof AuthRefused ? ' reason=' + e.code : ''}`)
    return back('error')
  }
  await ctx.runMutation(internal.wispr.signedIn, { connectionId: c._id, ...sealed })
  await ctx.scheduler.runAfter(0, internal.wispr.run, { connectionId: c._id, days: TRY_DAYS })
  console.log(`wispr connect conn=${c._id} status=connected`)
  return back('ok')
})
