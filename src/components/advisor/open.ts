// PST-307: the ⌘J panel opens from anywhere (the key, ⌘K, a button), and its
// "Looking at" names the investor whose drawer is open, which the Raise layout
// reports here (it owns the drawer).

type Listener = () => void
const listeners = new Set<Listener>()

/** Opens the Advisor panel. Does nothing until its host is mounted (the app shell). */
export function openAdvisorPanel(): void {
  listeners.forEach((l) => l())
}

export function onOpenAdvisorPanel(l: Listener): () => void {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

let investor: { id: string; name: string } | null = null
/** The investor whose drawer is open (null: none). */
export const setScreenInvestor = (i: { id: string; name: string } | null) => {
  investor = i
}
export const screenInvestor = () => investor
