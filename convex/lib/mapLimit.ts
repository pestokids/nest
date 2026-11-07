/**
 * `fn` over `xs`, at most `n` at a time, results in order. When one call fails,
 * no new calls start, and it waits for the ones already running to settle before
 * throwing the first error, so a failed run never leaves fetches unawaited.
 */
export async function mapLimit<T, R>(xs: readonly T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length)
  let at = 0
  let failed: { error: unknown } | undefined
  await Promise.all(
    Array.from({ length: Math.min(n, xs.length) }, async () => {
      while (!failed && at < xs.length) {
        const k = at++
        try {
          out[k] = await fn(xs[k])
        } catch (error) {
          failed ??= { error }
        }
      }
    }),
  )
  if (failed) throw failed.error
  return out
}
