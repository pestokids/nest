// DEV ONLY. `?preview` renders Home and Raise from a fake fixture without signing in.
//   &seed                    use internal/seed.json instead of the fixture
//   &home=firstrun|prepdone  Home states
//   &signin=<state>          a sign-in state: default, hover, checking, noaccess, error, signedout
import { AppShell } from '../components/AppShell'
import { PreviewData, type PreviewHome } from '../components/PreviewData'
import { LocalSounds, SessionContext } from '../components/session'
import { SignIn, SIGN_IN_STATES, type SignInState } from '../components/SignIn'

const session = { me: { firstName: 'Dev', name: 'Dev Preview', email: 'dev@example.com' }, signOut: () => {} }

export function Preview() {
  const q = new URLSearchParams(location.search)
  if (q.has('seed')) sessionStorage.setItem('nest_preview_data', 'seed')
  else if (q.has('preview')) sessionStorage.removeItem('nest_preview_data')
  const signin = q.get('signin') as SignInState | null
  if (signin && SIGN_IN_STATES.includes(signin))
    return (
      <LocalSounds>
        <SignIn state={signin === 'hover' ? 'default' : signin} forceHover={signin === 'hover'} email="someone@example.com" onSignIn={() => {}} onSignOut={() => {}} />
      </LocalSounds>
    )
  const home = (q.get('home') ?? 'default') as PreviewHome
  return (
    <LocalSounds>
      <SessionContext.Provider value={session}>
        <PreviewData source={sessionStorage.getItem('nest_preview_data') === 'seed' ? 'seed' : 'fixture'} home={home}>
          <AppShell />
        </PreviewData>
      </SessionContext.Provider>
    </LocalSounds>
  )
}
