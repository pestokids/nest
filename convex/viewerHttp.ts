// PST-282: the public viewer's HTTP routes, on <CONVEX_SITE_URL>/d/…. Every call
// carries only the link's token (and the viewer's own session id); anything
// malformed gets a 400. CORS is open: the token is the only credential, and no
// cookies are involved.
import type { HttpRouter } from 'convex/server'
import { httpAction } from './_generated/server'
import { internal } from './_generated/api'
import { deviceOf } from '../src/lib/materials'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
}
const NO_STORE = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, ...NO_STORE, 'Content-Type': 'application/json' } })
const STATUS = { ok: 200, missing: 404, expired: 410, limited: 429 } as const

/** A small JSON body (sent as text/plain so the browser skips the preflight), or null. */
async function body(req: Request): Promise<Record<string, unknown> | null> {
  const text = await req.text()
  if (text.length > 4096) return null
  try {
    const o = JSON.parse(text)
    return o && typeof o === 'object' && !Array.isArray(o) ? o : null
  } catch {
    return null
  }
}
const str = (x: unknown, max = 300) => (typeof x === 'string' && x.length <= max ? x : null)
const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null)

/** POST /d/open { token, email? } */
const open = httpAction(async (ctx, req) => {
  const b = await body(req)
  const token = str(b?.token, 64)
  const email = b?.email === undefined ? undefined : str(b.email, 254)
  if (!token || email === null) return json({ state: 'bad' }, 400)
  const r = await ctx.runMutation(internal.viewer.open, { token, email, device: deviceOf(req.headers.get('user-agent')) })
  return json(r, r.state === 'ok' || r.state === 'email' ? 200 : STATUS[r.state])
})

/** POST /d/beat { token, sessionId, page, ms } (navigator.sendBeacon) */
const beat = httpAction(async (ctx, req) => {
  const b = await body(req)
  const token = str(b?.token, 64)
  const sessionId = str(b?.sessionId, 64)
  const page = num(b?.page)
  const ms = num(b?.ms)
  if (!token || !sessionId || page === null || ms === null) return json({ state: 'bad' }, 400)
  const r = await ctx.runMutation(internal.viewer.beat, { token, sessionId, page, ms })
  return json({ state: r }, STATUS[r])
})

/** GET /d/file?token=…&session=…[&download=1] */
const file = httpAction(async (ctx, req) => {
  const q = new URL(req.url).searchParams
  const token = str(q.get('token'), 64)
  const sessionId = str(q.get('session'), 64)
  if (!token || !sessionId) return json({ state: 'bad' }, 400)
  const r = await ctx.runMutation(internal.viewer.file, { token, sessionId })
  if (r.state !== 'ok') return json({ state: r.state }, STATUS[r.state])
  const download = q.get('download') === '1'
  if (download && !r.download) return json({ state: 'refused' }, 403)
  const blob = await ctx.storage.get(r.fileId)
  if (!blob) return json({ state: 'missing' }, 404)
  return new Response(blob, {
    headers: {
      ...CORS,
      ...NO_STORE,
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${r.name}"`,
    },
  })
})

const preflight = httpAction(async () => new Response(null, { status: 204, headers: CORS }))

export function viewerRoutes(http: HttpRouter) {
  http.route({ path: '/d/open', method: 'POST', handler: open })
  http.route({ path: '/d/beat', method: 'POST', handler: beat })
  http.route({ path: '/d/file', method: 'GET', handler: file })
  for (const path of ['/d/open', '/d/beat', '/d/file']) http.route({ path, method: 'OPTIONS', handler: preflight })
}
