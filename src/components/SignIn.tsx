// The sign-in desk scene (screens/sign-in/*). Presentation only: AuthGate
// decides the state; this component draws Pesto, the bubble and the card.
import { useEffect, useRef, useState } from 'react'
import { replay, shake } from '../lib/motion'
import { play, type SoundName } from '../lib/sound'
import { EggCracking, Mug } from './illustrations'
import { Button, Icon } from './ui'
import { Wordmark } from './Wordmark'

export type SignInState = 'default' | 'hover' | 'checking' | 'noaccess' | 'error' | 'signedout'
export const SIGN_IN_STATES: SignInState[] = ['default', 'hover', 'checking', 'noaccess', 'error', 'signedout']

type Pose = 'office-typing' | 'office-glasses-up' | 'checking' | 'bouncer' | 'spill' | 'leaving'
const SCENE: Record<SignInState, { pose: Pose; say?: string; mug: boolean; sound?: SoundName }> = {
  default: { pose: 'office-typing', mug: true },
  hover: { pose: 'office-glasses-up', mug: true },
  checking: { pose: 'checking', say: 'Hmm. Let me see some ID.', mug: true },
  noaccess: { pose: 'bouncer', say: 'Sorry pal. Not on the list.', mug: false, sound: 'not-on-list' },
  error: { pose: 'spill', say: 'That was not me.', mug: false, sound: 'spill' },
  signedout: { pose: 'leaving', say: 'See you tomorrow!', mug: false, sound: 'signed-out' },
}
const POSES = [...new Set(Object.values(SCENE).map((s) => s.pose))]

type Props = {
  state: Exclude<SignInState, 'hover'>
  /** The refused account, for "Not on the list". Never sent anywhere. */
  email?: string
  onSignIn?: () => void
  onSignOut?: () => void
  /** Preview only: pin the hover pose. */
  forceHover?: boolean
}

export function SignIn({ state, email, onSignIn, onSignOut, forceHover }: Props) {
  const [hover, setHover] = useState(false)
  const shown: SignInState = (hover || forceHover) && state === 'default' ? 'hover' : state
  const sc = SCENE[shown]
  const [bubble, setBubble] = useState(false)
  const card = useRef<HTMLDivElement>(null)
  const lock = useRef<HTMLSpanElement>(null)
  const root = useRef<HTMLElement>(null)
  const scene = useRef<HTMLDivElement>(null)

  // Scale the desk to the room it has: 1 on a 900px-tall desktop, smaller on short screens and phones.
  useEffect(() => {
    const el = scene.current
    const host = root.current
    if (!el || !host || typeof ResizeObserver === 'undefined') return
    const fit = () => {
      const phone = window.innerWidth <= 760
      const h = el.clientHeight
      const k = phone ? Math.min(0.72, Math.max(0.42, (h - 250) / 540)) : Math.min(1, Math.max(0.55, (h - 330) / 570))
      host.style.setProperty('--k', k.toFixed(3))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Bubble pops in 400ms after the state appears; each state plays its sound once.
  useEffect(() => {
    setBubble(false)
    const t = setTimeout(() => setBubble(true), 400)
    const snd = SCENE[state].sound
    if (snd) play(snd)
    if (state === 'error') replay(card.current, 'm-shake-x')
    if (state === 'noaccess') shake(lock.current)
    return () => clearTimeout(t)
  }, [state])

  const look = {
    onPointerEnter: () => setHover(true),
    onPointerLeave: () => setHover(false),
    onFocus: () => setHover(true),
    onBlur: () => setHover(false),
  }

  return (
    <main ref={root} className={`signin signin--${shown}`}>
      <div className="signin__scene" ref={scene}>
        <Wordmark onDark className="signin__wordmark" />
        <h1 className="signin__headline">Pesto’s back office.</h1>
        <span className="signin__dot signin__dot--lime" aria-hidden="true" />
        <span className="signin__dot signin__dot--orange" aria-hidden="true" />
        <span className="signin__dot signin__dot--grey" aria-hidden="true" />
        <div className="signin__stage" aria-hidden="true">
          <div className="signin__halo" />
          {sc.mug ? (
            <div className="signin__mug">
              <svg className="signin__steam" viewBox="0 0 30 24">
                <path d="M10 22 C5 16 15 12 10 4" />
                <path d="M20 22 C15 16 25 12 20 4" />
              </svg>
              <Mug />
            </div>
          ) : null}
          <div className={`signin__bird signin__bird--${sc.pose}`}>
            {POSES.map((p) => (
              <img key={p} src={`/mascot/${p}.webp`} alt="" className={p === sc.pose ? 'is-on' : ''} decoding="async" />
            ))}
            {shown === 'default' ? (
              <svg className="signin__glint" viewBox="0 0 16 16">
                <path d="M8 0 L9.5 6.5 L16 8 L9.5 9.5 L8 16 L6.5 9.5 L0 8 L6.5 6.5 Z" fill="#fff" />
              </svg>
            ) : null}
          </div>
          {sc.say ? (
            <div className={`signin__bubble signin__bubble--${shown} ${bubble ? 'is-on' : ''}`} key={shown}>
              {sc.say}
            </div>
          ) : null}
        </div>
        <div className="signin__desk" aria-hidden="true" />
      </div>

      <div className="signin__card" ref={card} role="region" aria-label="Sign in">
        {state === 'noaccess' ? (
          <>
            <h2 className="signin__title">Not on the list</h2>
            <p className="signin__body">
              Pesto checked the list twice. {email ? <span className="signin__email">{email}</span> : 'That account'} isn’t on it. Use your pestokids.com account, or ask Dev to add you.
            </p>
            <div className="signin__actions">
              <Button variant="primary" onClick={onSignIn}>
                Try another account
              </Button>
              <Button variant="secondary" onClick={onSignOut}>
                Sign out
              </Button>
            </div>
          </>
        ) : (
          <>
            {state === 'error' ? (
              <div className="signin__callout signin__callout--error" role="alert">
                <Icon name="alert" size={20} />
                <span>Google didn’t finish signing you in. Give it another go.</span>
              </div>
            ) : state === 'signedout' ? (
              <div className="signin__callout signin__callout--ok" role="status">
                <Icon name="check" size={20} strokeWidth={2.2} />
                <span>You’re signed out. The nest will keep warm.</span>
              </div>
            ) : null}
            <h2 className="signin__title">Sign in</h2>
            <button type="button" className={`gbtn ${forceHover ? 'is-hover' : ''}`} onClick={onSignIn} disabled={state === 'checking' || !onSignIn} aria-busy={state === 'checking' || undefined} {...look}>
              {state === 'checking' ? <EggCracking size={22} className="gbtn__egg" /> : <Icon name="google" size={22} />}
              <span>{state === 'checking' ? 'Hatching your session…' : 'Continue with Google'}</span>
            </button>
          </>
        )}
        <p className="signin__note">
          {state === 'checking' ? (
            <>
              <svg className="signin__note-egg m-wobble-loop" viewBox="0 0 52 64" width="14" height="18" aria-hidden="true">
                <path d="M26 3 C39.6 3 48 22 48 38 C48 53 38 61 26 61 C14 61 4 53 4 38 C4 22 12 3 26 3Z" fill="#F0DDAE" />
              </svg>
              Checking you’re on the Pesto team…
            </>
          ) : (
            <>
              <span ref={lock} className="signin__lock">
                <Icon name="lock" size={18} style={{ ['--icon-hole' as string]: 'var(--signin-note)' }} />
              </span>
              Pesto team only · @pestokids.com accounts
            </>
          )}
        </p>
      </div>
    </main>
  )
}
