import { useAuthActions } from '@convex-dev/auth/react'
import { useConvexAuth, useQuery } from 'convex/react'
import { useEffect, useState, type ReactNode } from 'react'
import { api } from '../../convex/_generated/api'
import { SignIn } from './SignIn'

const DENIED = 'nest_denied'

/** Signed out → sign-in screen. Signed in but not on ALLOWED_EMAILS → signed out with a plain message. */
export function AuthGate({ children }: { children: (me: string) => ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth()
  const { signIn, signOut } = useAuthActions()
  const status = useQuery(api.access.status, isAuthenticated ? {} : 'skip')
  const [denied, setDenied] = useState(() => typeof sessionStorage !== 'undefined' && sessionStorage.getItem(DENIED) === '1')

  useEffect(() => {
    if (status?.status === 'denied') {
      sessionStorage.setItem(DENIED, '1')
      setDenied(true)
      void signOut()
    }
  }, [status, signOut])

  if (isLoading || (isAuthenticated && status === undefined)) return <SignIn busy />
  if (!isAuthenticated || status?.status !== 'ok')
    return (
      <SignIn
        denied={denied}
        onSignIn={() => {
          sessionStorage.removeItem(DENIED)
          setDenied(false)
          void signIn('google', { redirectTo: location.pathname + location.search })
        }}
      />
    )
  return <>{children(status.firstName)}</>
}
