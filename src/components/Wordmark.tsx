/** The `nest.` wordmark: forest with an orange dot, or cream with a lime dot on dark. */
export function Wordmark({ onDark, className }: { onDark?: boolean; className?: string }) {
  return (
    <span className={['wordmark', onDark && 'wordmark--on-dark', className].filter(Boolean).join(' ')} aria-label="nest">
      nest<span className="wordmark__dot">.</span>
    </span>
  )
}
