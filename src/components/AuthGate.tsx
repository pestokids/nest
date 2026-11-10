import { useAuthActions } from '@convex-dev/auth/react'
import { useConvexAuth, useQuery } from 'convex/react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '../../convex/_generated/api'
import { SessionContext, type Me } from './session'
import { SignIn } from './SignIn'

// sessionStorage keys. Nothing here leaves the browser.
const DENIED = 'nest_denied' // the refused email, kept across the forced sign-out
const PENDING = 'nest_signin_pending' // set when we hand off to Google

const read = (k: string) => (typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(k))
const write = (k: string, v: string | null) => {
  if (typeof sessionStorage === 'undefined') return
  if (v === null) sessionStorage.removeItem(k)
  else sessionStorage.setItem(k, v)
}

/**
 * Signed out → sign-in screen. Signed in but not on ALLOWED_EMAILS → signed out
 * and shown "Not on the list". The access rules themselves live in Convex
 * (requireUser); this only picks which sign-in state to draw.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth()
  const { signIn, signOut } = useAuthActions()
  const status = useQuery(api.access.status, isAuthenticated ? {} : 'skip')

  const [deniedEmail, setDeniedEmail] = useState<string | null>(() => read(DENIED))
  // Came back from Google with a code, or we sent them there and are waiting.
  const [handoff] = useState(() => typeof location !== 'undefined' && (new URLSearchParams(location.search).has('code') || !!read(PENDING)))
  const [clicked, setClicked] = useState(false)
  const [error, setError] = useState(false)
  const [signedOut, setSignedOut] = useState(false)

  useEffect(() => {
    if (status?.status === 'denied') {
      write(DENIED, status.email || '')
      write(PENDING, null)
      setDeniedEmail(status.email || '')
      void signOut()
    } else if (status?.status === 'ok') {
      write(PENDING, null)
      write(DENIED, null)
      setDeniedEmail(null)
      setError(false)
    }
  }, [status, signOut])

  // Back from Google but not signed in: the callback failed or was abandoned.
  useEffect(() => {
    if (isLoading || isAuthenticated || !read(PENDING)) return
    write(PENDING, null)
    if (read(DENIED) === null) setError(true)
  }, [isLoading, isAuthenticated])

  // Returning to this page from Google with the back button restores a stale "checking".
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setClicked(false)
    }
    window.addEventListener('pageshow', onShow)
    return () => window.removeEventListener('pageshow', onShow)
  }, [])

  const startSignIn = useCallback(() => {
    write(DENIED, null)
    write(PENDING, String(Date.now()))
    setDeniedEmail(null)
    setError(false)
    setSignedOut(false)
    setClicked(true)
    signIn('google', { redirectTo: location.pathname + location.search }).catch(() => {
      write(PENDING, null)
      setClicked(false)
      setError(true)
    })
  }, [signIn])

  const doSignOut = useCallback(() => {
    setSignedOut(true)
    void signOut()
  }, [signOut])

  const me: Me | null = status?.status === 'ok' ? { firstName: status.firstName, name: status.name, email: status.email } : null
  const session = useMemo(() => (me ? { me, signOut: doSignOut } : null), [me?.firstName, me?.name, me?.email, doSignOut]) // eslint-disable-line react-hooks/exhaustive-deps

  if (session) return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>

  const waiting = isLoading || (isAuthenticated && (status === undefined || status.status === 'ok'))
  if (clicked || (waiting && handoff)) return <SignIn state="checking" />
  if (waiting) return <div className="app-loading" aria-busy="true" />
  if (status?.status === 'denied' || deniedEmail !== null)
    return (
      <SignIn
        state="noaccess"
        email={status?.status === 'denied' ? status.email : deniedEmail ?? ''}
        onSignIn={startSignIn}
        onSignOut={() => {
          write(DENIED, null)
          setDeniedEmail(null)
          setSignedOut(true)
        }}
      />
    )
  return <SignIn state={error ? 'error' : signedOut ? 'signedout' : 'default'} onSignIn={startSignIn} />
}
