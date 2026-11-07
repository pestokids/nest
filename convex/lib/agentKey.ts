// PST-276: agent keys. "nest_ak_" + 32 random bytes (base64url). Only the SHA-256
// of a key is stored (agentKeys.hash) and looked up; the key itself is shown once.
import { KEY_PREFIX } from '../../src/lib/agents'

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** A new key, and the 8 characters after nest_ak_ that Settings may show. */
export function newKey(): { key: string; prefix: string } {
  const secret = b64url(crypto.getRandomValues(new Uint8Array(32)))
  return { key: KEY_PREFIX + secret, prefix: secret.slice(0, 8) }
}

/** SHA-256, hex. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** What agentKeys.hash holds for a key. */
export const hashKey = sha256Hex

/** The key in "Authorization: Bearer nest_ak_…", or null when there isn't one that could be ours. */
export function bearerKey(header: string | null): string | null {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '')
  const key = m?.[1]
  return key && key.startsWith(KEY_PREFIX) && key.length <= 100 ? key : null
}
