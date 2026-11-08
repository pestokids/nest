// PST-298: the last stage move made on this device, by a click or a key (the
// board, the drawer, ⌘K). A cheer that answers a move (interactions-batch-1.png:
// the second offer's target-hit and confetti) plays only for your own move, never
// for one that arrives from a sync or is already there on load.

/** How long after your move its cheer may still play. */
export const OWN_MOVE_MS = 5000

let last: { investorId: string; to: string; at: number } | null = null

export function noteOwnMove(investorId: string, to: string, at = Date.now()) {
  last = { investorId, to, at }
}

/** Whether a move to `to` was made here in the last few seconds. */
export const isOwnMove = (to: string, now = Date.now()) => !!last && last.to === to && now - last.at >= 0 && now - last.at <= OWN_MOVE_MS
