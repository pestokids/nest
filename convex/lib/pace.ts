const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * A rate limiter for one run: `await pace()` before each request, from any
 * number of workers, and they're let through one at a time, at least
 * 1000/perSecond ms apart, so no second ever sees more than `perSecond` start.
 * Infinity never waits.
 */
export function pacer(perSecond: number) {
  const gap = 1000 / perSecond
  let last = -Infinity
  let queue = Promise.resolve()
  return () =>
    (queue = queue.then(async () => {
      for (let wait = last + gap - Date.now(); wait > 0; wait = last + gap - Date.now()) await sleep(wait)
      last = Date.now()
    }))
}
