// PST-290: list keys. J and K move a visible focus ring through the rows, ↵
// opens (each row's own Enter), D drafts, X selects and ⇧X selects a range.
// Rows are the elements with data-nav-id under `root`, in page order, and only
// the visible ones (Investors renders a table and phone cards). Opening a row
// remembers the list's order for the drawer's ← and →.
import { useEffect, useRef, type RefObject } from 'react'
import { rememberListOrder } from '../../lib/listOrder'
import { KEYS, matches, singleKeyOk } from '../../lib/shortcuts'
import { openDraft } from '../drafts/data'
import { usePreviewState } from '../preview-state'

export type ListKeyOptions = {
  /** X: select or unselect one row. */
  onToggle?: (id: string) => void
  /** ⇧X: select every row from the last X to this one. */
  onRange?: (ids: string[]) => void
}

const rowsIn = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('[data-nav-id]')].filter((r) => r.offsetParent !== null)
const idsOf = (rows: HTMLElement[]) => rows.map((r) => r.dataset.navId!)

export function useListKeys(root: RefObject<HTMLElement | null>, opts: ListKeyOptions = {}) {
  const latest = useRef(opts)
  useEffect(() => {
    latest.current = opts
  })
  const anchor = useRef<string | null>(null)
  const preview = usePreviewState()?.system === 'list-focus'

  useEffect(() => {
    const el = root.current
    if (!el) return
    const remember = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Enter') return
      if ((e.target as Element | null)?.closest?.('[data-nav-id]')) rememberListOrder(idsOf(rowsIn(el)))
    }
    const onKey = (e: KeyboardEvent) => {
      if (!singleKeyOk(e) || document.querySelector('.sys-modal, [aria-modal="true"]')) return
      const rows = rowsIn(el)
      if (!rows.length) return
      const at = rows.findIndex((r) => r.contains(document.activeElement))
      const down = matches(e, KEYS.down)
      if (down || matches(e, KEYS.up)) {
        e.preventDefault()
        const n = at < 0 ? (down ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, at + (down ? 1 : -1)))
        rows[n].focus({ preventScroll: true })
        rows[n].scrollIntoView({ block: 'nearest', inline: 'nearest' })
        return
      }
      if (at < 0) return
      const id = rows[at].dataset.navId!
      const { onToggle, onRange } = latest.current
      if (matches(e, KEYS.draft)) {
        e.preventDefault()
        openDraft({ investorId: id })
      } else if (onToggle && matches(e, KEYS.select)) {
        e.preventDefault()
        anchor.current = id
        onToggle(id)
      } else if (onRange && matches(e, KEYS.selectRange)) {
        e.preventDefault()
        const ids = idsOf(rows)
        const from = anchor.current ? ids.indexOf(anchor.current) : -1
        onRange(from < 0 ? [id] : ids.slice(Math.min(from, at), Math.max(from, at) + 1))
        anchor.current = id
      }
    }
    el.addEventListener('click', remember, true)
    el.addEventListener('keydown', remember, true)
    document.addEventListener('keydown', onKey)
    return () => {
      el.removeEventListener('click', remember, true)
      el.removeEventListener('keydown', remember, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [root])

  // ?preview&system=list-focus: the focus ring on the second row, as after pressing J twice.
  useEffect(() => {
    if (!preview) return
    const t = setTimeout(() => {
      const rows = root.current ? rowsIn(root.current) : []
      rows[Math.min(1, rows.length - 1)]?.focus({ preventScroll: true })
    }, 600)
    return () => clearTimeout(t)
  }, [preview, root])
}
