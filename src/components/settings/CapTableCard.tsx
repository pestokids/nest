// PST-283: Settings › Round › Cap table. Founders' share counts, the option
// pool and any earlier SAFEs, for Close's cap table after the close. Saved on
// its own (not with the round form above).
import { useEffect, useRef, useState } from 'react'
import { hasCapTable, validateCapTable, type CapTable } from '../../lib/close'
import { shake } from '../../lib/motion'
import { play } from '../../lib/sound'
import { CloseProvider, useClose } from '../close/CloseData'
import { useRaise } from '../data'
import { useUI } from '../raise-ui'
import { useSaveAction } from '../system/useSaveAction'
import { Button, Icon } from '../ui'
import { AmountInput, NumberInput } from './inputs'
import { F } from './PhaseList'

export function CapTableCard() {
  return (
    <CloseProvider>
      <Card />
    </CloseProvider>
  )
}

type Draft = { founders: { name: string; shares?: number }[]; optionPool?: number; safes: { name: string; amount?: number; cap?: number }[] }
const toDraft = (c: CapTable | null): Draft => ({ founders: c?.founders ?? [], optionPool: c?.optionPool, safes: c?.safes ?? [] })
const fromDraft = (d: Draft): CapTable => ({
  founders: d.founders.map((f) => ({ name: f.name, shares: f.shares ?? NaN })),
  optionPool: d.optionPool ?? 0,
  safes: d.safes.map((s) => ({ name: s.name, amount: s.amount ?? NaN, cap: s.cap ?? NaN })),
})

function Card() {
  const d = useRaise()
  const c = useClose()
  const { toast } = useUI()
  const save = useSaveAction()
  const [draft, setDraft] = useState<Draft>(() => toDraft(c.capTable))
  const [dirty, setDirty] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [busy, setBusy] = useState(false)
  const form = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!dirty) setDraft(toDraft(c.capTable))
  }, [c.capTable, dirty])

  const errors = validateCapTable(fromDraft(draft))
  const err = (k: string) => (attempted ? errors[k] : undefined)
  const edit = (fn: (x: Draft) => Draft) => {
    setDirty(true)
    setDraft(fn)
  }
  const empty = !hasCapTable(c.capTable) && !dirty

  async function submit() {
    if (Object.keys(errors).length) {
      setAttempted(true)
      play('nope')
      requestAnimationFrame(() => form.current?.querySelectorAll('.field--error .input').forEach((el) => shake(el)))
      return
    }
    setBusy(true)
    await save(() => c.setCapTable(fromDraft(draft)), {
      failMessage: 'Couldn’t save the cap table.',
      onDone: (n) => {
        setDirty(false)
        setAttempted(false)
        toast(n ? 'Saved the cap table. It’s in the change log.' : 'Nothing had changed.')
      },
    })
    setBusy(false)
  }
  const discard = () => {
    setDraft(toDraft(c.capTable))
    setDirty(false)
    setAttempted(false)
  }
  const clear = async () => {
    await save(() => c.setCapTable(null), {
      failMessage: 'Couldn’t clear the cap table.',
      onDone: () => {
        setDirty(false)
        toast('Cleared the cap table.')
      },
    })
  }

  return (
    <div className="set-card set-cap" id="cap-table" ref={form}>
      <div className="set-card__head">
        <h2>Cap table</h2>
        {hasCapTable(c.capTable) && !dirty ? (
          <button type="button" className="drawer__textbtn drawer__textbtn--danger" onClick={clear}>
            Clear
          </button>
        ) : null}
      </div>
      <p className="set-card__lede">Founders’ shares and the option pool, for the cap table after the close on Close. Share counts, not percentages.</p>
      {!d.roundExists ? (
        <p className="set-cap__empty">Save the round above first, then add the cap table.</p>
      ) : !c.loaded ? null : empty ? (
        <div className="set-cap__empty">
          <p>No cap table yet. Add each founder’s shares and the option pool to see who owns what once the SAFEs convert.</p>
          <Button variant="secondary" icon="plus" onClick={() => edit(() => ({ founders: [{ name: '', shares: undefined }], optionPool: undefined, safes: [] }))}>
            Add founders
          </Button>
        </div>
      ) : (
        <>
          <p className="set-sub">Founders</p>
          {err('founders') ? <p className="field__error" role="alert">{err('founders')}</p> : null}
          {draft.founders.map((f, i) => (
            <div key={i} className="set-cap__row">
              <F id={`cap-f-${i}`} label="Name" err={err(`founders.${i}.name`)}>
                <input id={`cap-f-${i}`} value={f.name} placeholder="Founder" onChange={(e) => edit((x) => ({ ...x, founders: x.founders.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)) }))} />
              </F>
              <F id={`cap-fs-${i}`} label="Shares" err={err(`founders.${i}.shares`)}>
                <NumberInput id={`cap-fs-${i}`} value={f.shares} placeholder="4,500,000" onChange={(v) => edit((x) => ({ ...x, founders: x.founders.map((y, j) => (j === i ? { ...y, shares: v } : y)) }))} />
              </F>
              <button type="button" className="set-phase__btn set-cap__x" aria-label={`Remove ${f.name || 'this founder'}`} onClick={() => edit((x) => ({ ...x, founders: x.founders.filter((_, j) => j !== i) }))}>
                <Icon name="trash" size={16} />
              </button>
            </div>
          ))}
          <button type="button" className="set-add" onClick={() => edit((x) => ({ ...x, founders: [...x.founders, { name: '', shares: undefined }] }))}>
            <Icon name="plus" size={16} strokeWidth={2.2} /> Add a founder
          </button>

          <div className="set-cap__pool">
            <F id="cap-pool" label="Option pool" err={err('optionPool')} help="Shares set aside for the team, granted or not. 0 if there’s no pool.">
              <NumberInput id="cap-pool" value={draft.optionPool} placeholder="1,000,000" onChange={(v) => edit((x) => ({ ...x, optionPool: v }))} />
            </F>
          </div>

          <p className="set-sub">Earlier SAFEs, if any</p>
          {draft.safes.map((s, i) => (
            <div key={i} className="set-cap__row set-cap__row--safe">
              <F id={`cap-s-${i}`} label="Holder" err={err(`safes.${i}.name`)}>
                <input id={`cap-s-${i}`} value={s.name} placeholder="Who holds it" onChange={(e) => edit((x) => ({ ...x, safes: x.safes.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)) }))} />
              </F>
              <F id={`cap-sa-${i}`} label="Amount" err={err(`safes.${i}.amount`)}>
                <AmountInput id={`cap-sa-${i}`} value={s.amount} placeholder="$50,000" onChange={(v) => edit((x) => ({ ...x, safes: x.safes.map((y, j) => (j === i ? { ...y, amount: v } : y)) }))} />
              </F>
              <F id={`cap-sc-${i}`} label="Post-money cap" err={err(`safes.${i}.cap`)}>
                <AmountInput id={`cap-sc-${i}`} value={s.cap} placeholder="$6,000,000" onChange={(v) => edit((x) => ({ ...x, safes: x.safes.map((y, j) => (j === i ? { ...y, cap: v } : y)) }))} />
              </F>
              <button type="button" className="set-phase__btn set-cap__x" aria-label={`Remove ${s.name || 'this SAFE'}`} onClick={() => edit((x) => ({ ...x, safes: x.safes.filter((_, j) => j !== i) }))}>
                <Icon name="trash" size={16} />
              </button>
            </div>
          ))}
          <button type="button" className="set-add" onClick={() => edit((x) => ({ ...x, safes: [...x.safes, { name: '', amount: undefined, cap: undefined }] }))}>
            <Icon name="plus" size={16} strokeWidth={2.2} /> Add an earlier SAFE
          </button>

          <div className="set-foot">
            <span className="set-foot__status" role="status">
              {attempted && Object.keys(errors).length ? 'Fix the highlighted fields' : dirty ? 'Unsaved changes' : 'Saved'}
            </span>
            {dirty ? (
              <Button variant="ghost" onClick={discard}>
                Discard
              </Button>
            ) : null}
            <Button variant="primary" disabled={!dirty} loading={busy} loadingLabel="Saving…" onClick={submit}>
              Save cap table
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
