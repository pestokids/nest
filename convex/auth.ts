import Google from '@auth/core/providers/google'
import { convexAuth } from '@convex-dev/auth/server'

// Google only. The OAuth consent screen is Internal (pestokids.com Workspace);
// ALLOWED_EMAILS then decides who gets in (see lib/access.ts).
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Google({
      profile(p) {
        if (p.email_verified !== true) throw new Error('Google account email is not verified')
        return {
          id: p.sub,
          name: p.name,
          email: String(p.email).toLowerCase(),
          image: p.picture,
          emailVerified: true,
        }
      },
    }),
  ],
})
