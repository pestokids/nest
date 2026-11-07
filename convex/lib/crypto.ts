// PST-263: the Google refresh token is encrypted at rest (AES-256-GCM), and the
// OAuth `state` is signed (HMAC-SHA256). Both keys are derived (HKDF) from one
// secret, GOOGLE_TOKEN_KEY: 32 random bytes, base64. It never leaves Convex.

const enc = new TextEncoder()
const dec = new TextDecoder()

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
const b64url = (bytes: Uint8Array) => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64url = (s: string) => unb64(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4))

export class MissingKey extends Error {
  constructor() {
    super('GOOGLE_TOKEN_KEY is not set')
  }
}

/** The raw secret, or MissingKey when GOOGLE_TOKEN_KEY isn't set (or isn't 32 bytes of base64). */
function secret(): Uint8Array {
  const raw = process.env.GOOGLE_TOKEN_KEY?.trim()
  if (!raw) throw new MissingKey()
  let bytes: Uint8Array
  try {
    bytes = unb64(raw)
  } catch {
    throw new MissingKey()
  }
  if (bytes.length !== 32) throw new MissingKey()
  return bytes
}

export const hasTokenKey = () => {
  try {
    secret()
    return true
  } catch {
    return false
  }
}

async function derive(info: string, alg: AesKeyGenParams | HmacKeyGenParams, usages: KeyUsage[]) {
  const base = await crypto.subtle.importKey('raw', secret() as BufferSource, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode(info) }, base, alg, false, usages)
}

/** "v1.<iv>.<ciphertext>" (base64). */
export async function encryptToken(plain: string): Promise<string> {
  const key = await derive('nest/google/refresh-token', { name: 'AES-GCM', length: 256 }, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain)))
  return `v1.${b64(iv)}.${b64(ct)}`
}

export async function decryptToken(stored: string): Promise<string> {
  const [v, iv, ct] = stored.split('.')
  if (v !== 'v1' || !iv || !ct) throw new Error('Unreadable token')
  const key = await derive('nest/google/refresh-token', { name: 'AES-GCM', length: 256 }, ['decrypt'])
  return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) as BufferSource }, key, unb64(ct) as BufferSource))
}

const hmacKey = () => derive('nest/google/oauth-state', { name: 'HMAC', hash: 'SHA-256' }, ['sign', 'verify'])

/** A signed, expiring OAuth `state`: which user started the connect, so the callback can't be replayed for someone else. */
export async function signState(payload: { u: string; exp: number; n?: string }): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify({ ...payload, n: payload.n ?? b64url(crypto.getRandomValues(new Uint8Array(9))) })))
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(), enc.encode(body)))
  return `${body}.${b64url(sig)}`
}

/** The payload if the signature checks out and it hasn't expired, else null. */
export async function verifyState(state: string, now = Date.now()): Promise<{ u: string; exp: number } | null> {
  const [body, sig] = state.split('.')
  if (!body || !sig) return null
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(), unb64url(sig) as BufferSource, enc.encode(body))
    if (!ok) return null
    const p = JSON.parse(dec.decode(unb64url(body))) as { u?: unknown; exp?: unknown }
    if (typeof p.u !== 'string' || typeof p.exp !== 'number' || p.exp < now) return null
    return { u: p.u, exp: p.exp }
  } catch (e) {
    if (e instanceof MissingKey) throw e
    return null
  }
}
