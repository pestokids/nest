// PST-291: the Close kit opens from anywhere (Close, the drawer, a move to
// Verbal), like Drafts: openCloseKit() (./openKit) asks, CloseKitHost in the Raise layout shows it.
import type { ReactNode } from 'react'
import { useRaise } from '../data'
import { CloseProvider, useClose } from './CloseData'
import { CloseKit } from './CloseKit'
import { openCloseKit, useKitRequest } from './openKit'

export function CloseKitHost() {
  const id = useKitRequest()
  const { investors } = useRaise()
  const inv = id ? investors.find((i) => i._id === id) : undefined
  if (!inv) return null
  return (
    <CloseProvider>
      <Loaded>
        <CloseKit key={inv._id} investor={inv} onClose={() => openCloseKit(null)} />
      </Loaded>
    </CloseProvider>
  )
}

function Loaded({ children }: { children: ReactNode }) {
  return useClose().loaded ? children : null
}
