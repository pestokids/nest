// Delete with Undo: the row disappears at once and the delete is sent when the
// Undo window ends. It is also sent straight away when the page is hidden or
// closed (pagehide, visibilitychange → hidden) or when the owner flushes it
// (the Raise views unmounting), so a delete is never silently lost.

type Timers = { set: (fn: () => void, ms: number) => unknown; clear: (t: unknown) => void }
type Target = { addEventListener: (type: string, fn: () => void) => void; removeEventListener: (type: string, fn: () => void) => void }
type Doc = Target & { visibilityState: string }

const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t as ReturnType<typeof setTimeout>) }

export class PendingDeletes {
  private timers = new Map<string, unknown>()

  constructor(
    /** Sends the delete. Read through a function so the caller can always hand over its latest mutation. */
    private send: (id: string) => void,
    private ms: number,
    private clock: Timers = realTimers,
  ) {}

  /** Start the Undo window for `id`. */
  add(id: string) {
    this.cancelTimer(id)
    this.timers.set(id, this.clock.set(() => this.commit(id), this.ms))
  }

  /** Undo: true if the delete was still pending (and now won't be sent). */
  undo(id: string): boolean {
    if (!this.timers.has(id)) return false
    this.cancelTimer(id)
    this.timers.delete(id)
    return true
  }

  has(id: string) {
    return this.timers.has(id)
  }

  /** Send one pending delete now. */
  commit(id: string) {
    if (!this.timers.has(id)) return
    this.cancelTimer(id)
    this.timers.delete(id)
    this.send(id)
  }

  /** Send every pending delete now. */
  flush() {
    for (const id of [...this.timers.keys()]) this.commit(id)
  }

  /** Flush when the page is hidden or closed. Returns the cleanup. */
  listen(win: Target, doc: Doc): () => void {
    const onHide = () => this.flush()
    const onVisibility = () => {
      if (doc.visibilityState === 'hidden') this.flush()
    }
    win.addEventListener('pagehide', onHide)
    doc.addEventListener('visibilitychange', onVisibility)
    return () => {
      win.removeEventListener('pagehide', onHide)
      doc.removeEventListener('visibilitychange', onVisibility)
    }
  }

  private cancelTimer(id: string) {
    const t = this.timers.get(id)
    if (t !== undefined) this.clock.clear(t)
  }
}
