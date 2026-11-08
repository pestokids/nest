// PST-291: which investor's Close kit is open. Its own module (no imports), so
// the drawer, the board and the toasts can open the kit without pulling Close in.
import { useSyncExternalStore } from 'react'

let request: string | null = null
const listeners = new Set<() => void>()
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/** Open the Close kit on an investor (null closes it). */
export function openCloseKit(investorId: string | null) {
  request = investorId
  listeners.forEach((l) => l())
}

export const useKitRequest = () => useSyncExternalStore(subscribe, () => request, () => null)

/** The toast action a move to Verbal offers. */
export const confirmAction = (investorId: string) => ({ label: 'Confirm in writing', onClick: () => openCloseKit(investorId) })
