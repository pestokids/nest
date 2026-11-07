import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { autoMatch, FIELD_LABEL, IMPORT_HEADERS, importSummary, parseCsv, previewMapped, TEMPLATE_CSV, type ColumnMap, type ImportField, type ParsedCsv } from '../../lib/csv'
import { todayIST } from '../../lib/dates'
import { confetti, shake, useCountUp } from '../../lib/motion'
import { play } from '../../lib/sound'
import { targetValue } from '../../lib/round'
import { useRaise } from '../data'
import { NestWithEggs } from '../illustrations'
import { Button, Icon, IconButton, useToast } from '../ui'
import { Modal, useTitleId } from '../system/Modal'
import { useSaveAction } from '../system/useSaveAction'

const MAX_BYTES = 5 * 1024 * 1024

export type ImportResult = { added: number; ids: string[]; before: number }
type State =
  | { step: 1 }
  | { step: 2; file: string; parsed: ParsedCsv; map: ColumnMap }
  | { step: 3; file: string; result: ImportResult }

/** Start somewhere other than step 1 (only ?preview does). */
export type ImportStart = State

/**
 * Import investors from a CSV in three steps (raise-investors/import-*.png):
 * upload, match columns (auto-matched, fix with the selects), done (a nest,
 * confetti, the count going up, `import-done`).
 */
export function ImportDialog({ onClose, onSeeNew, start }: { onClose: () => void; onSeeNew: (ids: string[]) => void; start?: ImportStart }) {
  const [state, setState] = useState<State>(start ?? { step: 1 })
  const titleId = useTitleId()
  return (
    <Modal onClose={onClose} labelledBy={titleId} className={`imp imp--${state.step}`} initialFocus={state.step === 3 ? '.imp-done__actions .btn' : 'panel'}>
      <IconButton icon="close" label="Close" className="imp__close" onClick={onClose} />
      {state.step === 1 ? (
        <Upload titleId={titleId} onCancel={onClose} onParsed={(file, parsed) => setState({ step: 2, file, parsed, map: autoMatch(parsed.headers) })} />
      ) : state.step === 2 ? (
        <Match titleId={titleId} s={state} setMap={(map) => setState({ ...state, map })} onBack={() => setState({ step: 1 })} onDone={(result) => setState({ step: 3, file: state.file, result })} />
      ) : (
        <Done titleId={titleId} result={state.result} onClose={onClose} onSeeNew={() => (onClose(), onSeeNew(state.result.ids))} />
      )}
    </Modal>
  )
}

function Upload({ titleId, onParsed, onCancel }: { titleId: string; onParsed: (file: string, p: ParsedCsv) => void; onCancel: () => void }) {
  const [over, setOver] = useState(false)
  const [picked, setPicked] = useState<{ file: string; parsed: ParsedCsv } | null>(null)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const zone = useRef<HTMLDivElement>(null)

  const fail = (msg: string) => {
    setPicked(null)
    setError(msg)
    play('nope')
    shake(zone.current)
  }
  async function take(f: File | undefined) {
    if (!f) return
    if (!/\.csv$/i.test(f.name) && !/csv|comma-separated|text\/plain/.test(f.type)) return fail('That isn’t a CSV. Export the sheet as .csv and try again.')
    if (f.size > MAX_BYTES) return fail('That file is over 5 MB. Split it, or drop the columns you don’t need.')
    const parsed = parseCsv(await f.text())
    if (!parsed.headers.length) return fail('That file is empty.')
    if (!parsed.rows.length) return fail('Only a header row in there. Add a row per person.')
    setError('')
    setPicked({ file: f.name, parsed })
  }
  const template = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([TEMPLATE_CSV], { type: 'text/csv;charset=utf-8' }))
    a.download = 'nest-import-template.csv'
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  return (
    <>
      <p className="imp__step">Step 1 of 3</p>
      <h2 className="imp__title" id={titleId}>
        Import investors from a CSV
      </h2>
      <p className="imp__lede">One row per person. Name is the only must-have; we’ll match the other columns next.</p>
      <div
        ref={zone}
        className={`imp-drop${over ? ' is-over' : ''}${picked ? ' is-picked' : ''}${error ? ' is-bad' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          void take(e.dataTransfer.files?.[0])
        }}
      >
        <Icon name={picked ? 'check' : 'upload'} size={22} className="imp-drop__icon" />
        <p className="imp-drop__title">{picked ? picked.file : 'Drop a CSV here, or browse'}</p>
        <p className="imp-drop__sub">
          {picked
            ? `${picked.parsed.rows.length} row${picked.parsed.rows.length === 1 ? '' : 's'} · ${picked.parsed.headers.length} columns`
            : '.csv up to 5 MB · exports from Sheets, Notion and Airtable all work'}
        </p>
        <Button variant="secondary" onClick={() => input.current?.click()}>
          {picked ? 'Choose another' : 'Browse files'}
        </Button>
        <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(e) => void take(e.target.files?.[0])} aria-label="CSV file" />
      </div>
      {error ? (
        <p className="imp__error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="button" className="imp__template" onClick={template}>
        <Icon name="download" size={18} />
        Download the template (name, firm, email, type, warm path, expected, wave, notes)
      </button>
      <div className="imp__actions">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!picked} onClick={() => picked && onParsed(picked.file, picked.parsed)}>
          Continue
        </Button>
      </div>
    </>
  )
}

function Match({ titleId, s, setMap, onBack, onDone }: {
  titleId: string
  s: Extract<State, { step: 2 }>
  setMap: (m: ColumnMap) => void
  onBack: () => void
  onDone: (r: ImportResult) => void
}) {
  const d = useRaise()
  const save = useSaveAction()
  const [busy, setBusy] = useState(false)
  const preview = useMemo(() => previewMapped(s.parsed, s.map, d.investors), [s.parsed, s.map, d.investors])
  const hasName = s.map.includes('name')

  const pick = (col: number, f: ImportField | null) => {
    // One column per field, except notes (several columns can feed it).
    setMap(s.map.map((x, i) => (i === col ? f : f && f !== 'notes' && x === f ? null : x)))
  }
  async function run() {
    if (!preview.add.length) return
    setBusy(true)
    const before = d.investors.length
    await save(() => d.importMany(preview.add.map((x) => x.fields), s.file), {
      failMessage: `Couldn’t import ${s.file}.`,
      onDone: (r) => onDone({ added: r.added, ids: r.ids ?? [], before }),
    })
    setBusy(false)
  }

  return (
    <>
      <p className="imp__step">Step 2 of 3 · {s.file}</p>
      <h2 className="imp__title" id={titleId}>
        Match your columns
      </h2>
      <p className="imp__lede">We guessed from the headers. Fix anything that looks off.</p>
      <div className="imp-map">
        {s.parsed.headers.map((h, i) => {
          const f = s.map[i]
          return (
            <div className={`imp-map__row${f ? '' : ' is-skip'}`} key={i} style={{ '--i': i } as CSSProperties}>
              <span className="imp-map__col" title={h}>
                {h || `Column ${i + 1}`}
              </span>
              <span className="imp-map__arrow" aria-hidden="true">
                {f ? <Icon name="check" size={16} className="imp-map__tick" /> : <Icon name="arrow-right" size={16} />}
              </span>
              <span className="select imp-map__select">
                <select aria-label={`Column “${h}” goes to`} value={f ?? ''} onChange={(e) => pick(i, (e.target.value || null) as ImportField | null)}>
                  <option value="">Skip this column</option>
                  {IMPORT_HEADERS.map((k) => (
                    <option key={k} value={k}>
                      {FIELD_LABEL[k]}
                    </option>
                  ))}
                </select>
                <Icon name="chevron-down" size={18} className="select__chevron" />
              </span>
            </div>
          )
        })}
      </div>
      <div className={`imp-sum${hasName && preview.add.length ? '' : ' is-bad'}`} role="status">
        {!hasName ? 'Pick the column with each investor’s name.' : importSummary(preview)}
      </div>
      {hasName && preview.skipped.some((x) => !x.reason.startsWith('Already')) ? (
        <details className="imp-why">
          <summary>Why rows were skipped</summary>
          <ul>
            {preview.skipped
              .filter((x) => !x.reason.startsWith('Already'))
              .slice(0, 20)
              .map((x) => (
                <li key={x.line}>
                  Line {x.line}: {x.name === '(blank)' ? 'no name' : `${x.name}, ${x.reason}`}
                </li>
              ))}
          </ul>
        </details>
      ) : null}
      <div className="imp__actions">
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button variant="primary" disabled={!hasName || !preview.add.length} loading={busy} loadingLabel="Importing…" onClick={run}>
          Import {preview.add.length} investor{preview.add.length === 1 ? '' : 's'}
        </Button>
      </div>
    </>
  )
}

function Done({ titleId, result, onClose, onSeeNew }: { titleId: string; result: ImportResult; onClose: () => void; onSeeNew: () => void }) {
  const d = useRaise()
  const toast = useToast()
  const save = useSaveAction()
  const nest = useRef<HTMLDivElement>(null)
  const n = useCountUp(result.added, { ms: 600, delay: 200 })
  const after = result.before + result.added
  const today = todayIST()

  // The list goal: the current (or next) phase's "names on the list" target, and the phase after it.
  const ix = d.round.phases.findIndex((p) => today <= p.to && p.targets.some((t) => t.m === 'count'))
  const phase = ix >= 0 ? d.round.phases[ix] : undefined
  const goalT = phase?.targets.find((t) => t.m === 'count')
  const goal = goalT ? targetValue(d.round, goalT) : 0
  const nextName = ix >= 0 ? d.round.phases[ix + 1]?.name : undefined

  useEffect(() => {
    play('import-done')
    const t = setTimeout(() => confetti(nest.current, { count: 40 }), 120)
    return () => clearTimeout(t)
  }, [])

  const undo = () =>
    void save(
      async () => {
        for (const id of result.ids) await d.remove(id)
      },
      {
        failMessage: 'Couldn’t undo the import.',
        onDone: () => {
          play('undo')
          toast(`Import undone. ${result.ids.length} removed.`)
          onClose()
        },
      },
    )

  return (
    <div className="imp-done">
      <div className="imp-done__nest" ref={nest}>
        <NestWithEggs size={120} />
      </div>
      <h2 className="imp-done__title" id={titleId}>
        <span className="num">{n}</span> hatched.
      </h2>
      <p className="imp-done__line">
        The list went from {result.before} to {after}.
        {goal > after ? ` ${goal - after} more to reach ${goal}${nextName ? ` before ${nextName}` : ''}.` : goal ? ` That’s the ${goal}${phase ? ` ${phase.name}` : ''} goal reached.` : ''}
      </p>
      {goal ? (
        <div className="imp-done__bar" role="progressbar" aria-label="Names on the list" aria-valuemin={0} aria-valuemax={goal} aria-valuenow={Math.min(after, goal)}>
          <span style={{ width: `${Math.min(100, (after / goal) * 100)}%` }} />
        </div>
      ) : null}
      <div className="imp-done__actions">
        <Button variant="primary" onClick={onSeeNew} disabled={!result.ids.length} autoFocus>
          See the new names
        </Button>
        {result.ids.length ? (
          <Button variant="ghost" onClick={undo}>
            Undo import
          </Button>
        ) : null}
      </div>
    </div>
  )
}
