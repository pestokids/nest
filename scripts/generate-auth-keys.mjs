// Prints JWT_PRIVATE_KEY and JWKS for Convex Auth (from the Convex Auth manual setup).
// Usage: node scripts/generate-auth-keys.mjs
// Or set them directly: node scripts/generate-auth-keys.mjs --set [--prod]
import { exportJWK, exportPKCS8, generateKeyPair } from 'jose'
import { execFileSync } from 'node:child_process'

const keys = await generateKeyPair('RS256', { extractable: true })
const privateKey = (await exportPKCS8(keys.privateKey)).trimEnd().replace(/\n/g, ' ')
const jwks = JSON.stringify({ keys: [{ use: 'sig', ...(await exportJWK(keys.publicKey)) }] })

if (process.argv.includes('--set')) {
  const prod = process.argv.includes('--prod') ? ['--prod'] : []
  for (const [k, v] of [['JWT_PRIVATE_KEY', privateKey], ['JWKS', jwks]])
    execFileSync('npx', ['convex', 'env', 'set', ...prod, k, '--', v], { stdio: 'inherit' })
} else {
  process.stdout.write(`JWT_PRIVATE_KEY="${privateKey}"\nJWKS=${jwks}\n`)
}
