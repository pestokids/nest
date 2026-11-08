// PST-290: the order of the list the drawer was opened from, so ← and → in the
// drawer step through the same rows. Lists record it when a row is opened
// (useListKeys); the drawer reads it.
let order: string[] = []

export function rememberListOrder(ids: string[]) {
  order = ids
}

/** The id `step` places away from `id` in `ids`, or null at either end or when it isn't there. */
export function stepIn(ids: readonly string[], id: string, step: 1 | -1): string | null {
  const at = ids.indexOf(id)
  return at < 0 ? null : ids[at + step] ?? null
}

/** The previous or next investor in the remembered list. */
export const neighbour = (id: string, step: 1 | -1) => stepIn(order, id, step)
