import { useMutation, useQuery } from 'convex/react'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '../../convex/_generated/api'
import { localSoundsPref, saveLocalSoundsPref, sound } from '../lib/sound'

export type Me = { firstName: string; name: string; email: string }
export type Session = { me: Me; signOut: () => void }

export const SessionContext = createContext<Session | null>(null)
export function useSession(): Session {
  const v = useContext(SessionContext)
  if (!v) throw new Error('useSession outside SessionContext')
  return v
}

type Sounds = { on: boolean; set: (on: boolean) => void }
const SoundsContext = createContext<Sounds | null>(null)
export function useSounds(): Sounds {
  const v = useContext(SoundsContext)
  if (!v) throw new Error('useSounds outside a sounds provider')
  return v
}

function useApply(on: boolean) {
  useEffect(() => {
    sound.setEnabled(on)
  }, [on])
}

/** Sounds preference stored per user in Convex; local storage until it loads (and for new users). */
export function ConvexSounds({ children }: { children: ReactNode }) {
  const prefs = useQuery(api.prefs.get)
  const save = useMutation(api.prefs.setSounds)
  const [local, setLocal] = useState(localSoundsPref)
  const on = prefs?.sounds ?? local
  useEffect(() => {
    if (typeof prefs?.sounds === 'boolean') saveLocalSoundsPref(prefs.sounds)
  }, [prefs?.sounds])
  useApply(on)
  const set = useCallback(
    (next: boolean) => {
      setLocal(next)
      saveLocalSoundsPref(next)
      void save({ on: next }).catch(() => {})
    },
    [save],
  )
  const value = useMemo(() => ({ on, set }), [on, set])
  return <SoundsContext.Provider value={value}>{children}</SoundsContext.Provider>
}

/** Preview: local storage only. */
export function LocalSounds({ children }: { children: ReactNode }) {
  const [on, setOn] = useState(localSoundsPref)
  useApply(on)
  const value = useMemo(
    () => ({
      on,
      set: (next: boolean) => {
        setOn(next)
        saveLocalSoundsPref(next)
      },
    }),
    [on],
  )
  return <SoundsContext.Provider value={value}>{children}</SoundsContext.Provider>
}
