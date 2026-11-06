import { titleCase } from '../../lib/palette'
import { NestEmpty } from '../illustrations'
import { Button } from '../ui'

/** No matches (raise-investors/no-results.png): an empty nest, never Pesto. */
export function NoResults({ q, filtered, empty, onAdd, onClearSearch, onClearAll }: {
  q: string
  filtered: boolean
  empty: boolean
  onAdd: () => void
  onClearSearch: () => void
  onClearAll: () => void
}) {
  const title = empty ? 'The nest is empty.' : q ? `Nobody called “${q}” in the nest.` : 'Nobody matches these filters.'
  const sub = empty ? 'Add the first investor, or import a CSV.' : q ? 'Check the spelling, clear the filters, or add them as a new investor.' : 'Clear a filter to see more of the list.'
  return (
    <div className="inv-none" role="status">
      <NestEmpty size={120} className="inv-none__illo" />
      <h2 className="inv-none__title">{title}</h2>
      <p className="inv-none__sub">{sub}</p>
      <div className="inv-none__actions">
        {empty || q ? (
          <Button variant="primary" icon="plus" onClick={onAdd}>
            {q ? `Add “${titleCase(q)}”` : 'Add investor'}
          </Button>
        ) : null}
        {q ? (
          <Button variant="secondary" onClick={onClearSearch}>
            Clear search
          </Button>
        ) : filtered ? (
          <Button variant="secondary" onClick={onClearAll}>
            Clear filters
          </Button>
        ) : null}
      </div>
    </div>
  )
}
