// PST-290: list density. ⇧D switches between compact (44 px rows) and
// comfortable (64 px); saved per user in Convex, and on this device until it loads.
export type Density = 'compact' | 'comfortable'

const KEY = 'nest_density'

export function localDensity(): Density {
  try {
    return localStorage.getItem(KEY) === 'compact' ? 'compact' : 'comfortable'
  } catch {
    return 'comfortable'
  }
}
export function saveLocalDensity(d: Density) {
  try {
    localStorage.setItem(KEY, d)
  } catch {
    /* private mode */
  }
}

export const otherDensity = (d: Density): Density => (d === 'compact' ? 'comfortable' : 'compact')
