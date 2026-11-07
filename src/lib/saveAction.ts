// One way to run a write: on failure, the save-failed sound and an error toast
// with Retry (which runs the same write again, as many times as it takes).
// React wiring: useSaveAction() in src/components/system/useSaveAction.ts.

export type FailToast = { tone: 'error'; message: string; action: { label: string; onClick: () => void }; durationMs: number }

export type SaveDeps = {
  toast: (t: FailToast) => void
  play: (name: 'save-failed') => void
  /** Text for an unexpected failure; our own ConvexError text wins when present. */
  describe: (e: unknown) => string
}

export type SaveOptions<T> = {
  /** "Couldn't save the round." Shown before the error's own text. */
  failMessage?: string
  onDone?: (result: T) => void
  /** Return true when the failure was handled (e.g. field errors), so no toast or sound. */
  onError?: (e: unknown) => boolean | void
}

/** Toasts with Retry stay up longer than the usual 4s. */
export const FAIL_TOAST_MS = 9000

/** Runs `fn`; resolves to its result, or undefined when it failed (and the toast is up). */
export async function runSave<T>(fn: () => Promise<T>, opts: SaveOptions<T>, deps: SaveDeps): Promise<T | undefined> {
  try {
    const r = await fn()
    opts.onDone?.(r)
    return r
  } catch (e) {
    if (opts.onError?.(e) === true) return undefined
    deps.play('save-failed')
    const why = deps.describe(e)
    deps.toast({
      tone: 'error',
      message: [opts.failMessage, why].filter(Boolean).join(' '),
      action: { label: 'Retry', onClick: () => void runSave(fn, opts, deps) },
      durationMs: FAIL_TOAST_MS,
    })
    return undefined
  }
}
