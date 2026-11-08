/**
 * PST-298: one scroll per page. A view's filter row sticks under the Raise tabs. As its
 * ref, this publishes the row's height as --stick-filters on the page, so the table
 * header row under it can stick right below (top: var(--stick-list), src/styles/shell.css).
 */
export function stickyHeight(el: HTMLElement | null) {
  const page = el?.closest<HTMLElement>('.raise')
  if (!el || !page) return
  const set = () => page.style.setProperty('--stick-filters', `${el.offsetHeight}px`)
  set()
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(set) : null
  ro?.observe(el)
  return () => {
    ro?.disconnect()
    page.style.removeProperty('--stick-filters')
  }
}
