import { useRef, useState } from 'react'
import { play } from '../../lib/sound'
import { ALL, STAGE_TILE } from '../../lib/stages'
import { useRaise } from '../data'
import { useUI } from '../raise-ui'
import { Confirm } from '../system/Confirm'
import { Menu } from '../system/Menu'
import { useSaveAction } from '../system/useSaveAction'
import { Icon } from '../ui'
import { bulkChange, type BulkChange } from './bulk'
import { exportInvestors } from './exportCsv'

const plural = (n: number) => `${n} investor${n === 1 ? '' : 's'}`

/** The dark bar that slides up when rows are picked (raise-investors/bulk-selected.png). */
export function BulkBar({ ids, onClear, onEnriching }: { ids: Set<string>; onClear: () => void; onEnriching: (ids: string[]) => void }) {
  const d = useRaise()
  const { toast, fail } = useUI()
  const [starting, setStarting] = useState(false)
  const save = useSaveAction()
  const [menu, setMenu] = useState<'stage' | 'wave' | null>(null)
  const [confirm, setConfirm] = useState(false)
  const stageBtn = useRef<HTMLButtonElement>(null)
  const waveBtn = useRef<HTMLButtonElement>(null)
  const picked = d.investors.filter((i) => ids.has(i._id))
  const n = picked.length

  /** PST-298: shows on every row at once, with Undo (./bulk.ts). */
  const update = (change: BulkChange, done: string, sound?: 'stage-up') => {
    const { saved, undo } = bulkChange(d, picked, change)
    if (sound) play(sound)
    toast({
      message: done,
      action: {
        label: 'Undo',
        onClick: () => {
          play('undo')
          undo().catch(fail)
        },
      },
    })
    void saved.then((e) => e && fail(e))
  }

  async function enrich() {
    setStarting(true)
    play('pesto-hop', { volume: 0.5 })
    try {
      const list = picked.map((i) => i._id)
      await d.aiDo.enrichMany(list)
      onEnriching(list)
    } catch (e) {
      fail(e)
    } finally {
      setStarting(false)
    }
  }

  return (
    <>
      <div className="inv-bulk" role="toolbar" aria-label={`${n} selected`}>
        <span className="inv-bulk__n">{n} selected</span>
        <button type="button" className="inv-bulk__btn inv-bulk__btn--enrich" disabled={starting} aria-busy={starting || undefined} onClick={() => void enrich()}>
          <Icon name="spark" size={16} />
          Enrich
        </button>
        <button type="button" ref={stageBtn} className="inv-bulk__btn" aria-haspopup="menu" aria-expanded={menu === 'stage'} onClick={() => setMenu(menu === 'stage' ? null : 'stage')}>
          <span className="only-desk">Move to stage</span>
          <span className="only-phone">Stage</span> <Icon name="chevron-down" size={14} strokeWidth={2.4} />
        </button>
        <button type="button" ref={waveBtn} className="inv-bulk__btn" aria-haspopup="menu" aria-expanded={menu === 'wave'} onClick={() => setMenu(menu === 'wave' ? null : 'wave')}>
          <span className="only-desk">Set wave</span>
          <span className="only-phone">Wave</span> <Icon name="chevron-down" size={14} strokeWidth={2.4} />
        </button>
        <button type="button" className="inv-bulk__btn" onClick={() => exportInvestors(picked, toast)}>
          Export
        </button>
        <button type="button" className="inv-bulk__btn inv-bulk__btn--danger" onClick={() => setConfirm(true)}>
          Delete
        </button>
        <button type="button" className="inv-bulk__x" onClick={onClear} aria-label="Clear selection">
          <Icon name="close" size={16} strokeWidth={2.4} />
        </button>
      </div>
      {menu === 'stage' ? (
        <Menu
          anchor={stageBtn.current}
          title={`Move ${plural(n)} to`}
          placement="above"
          align="start"
          onClose={() => setMenu(null)}
          items={ALL.map((s) => ({ label: STAGE_TILE[s.k], onSelect: () => update({ stage: s.k }, `Moved ${plural(n)} to ${STAGE_TILE[s.k]}.`, 'stage-up') }))}
        />
      ) : null}
      {menu === 'wave' ? (
        <Menu
          anchor={waveBtn.current}
          title={`Set the wave for ${plural(n)}`}
          placement="above"
          align="start"
          onClose={() => setMenu(null)}
          items={([1, 2, 3] as const).map((w) => ({ label: `Wave ${w}${d.round.waves[w - 1] && d.round.waves[w - 1] !== `Wave ${w}` ? ` · ${d.round.waves[w - 1]}` : ''}`, onSelect: () => update({ wave: w }, `${plural(n)} now in Wave ${w}.`) }))}
        />
      ) : null}
      {confirm ? (
        <Confirm
          title={`Delete ${plural(n)}?`}
          body="Their history goes too. This can’t be undone."
          confirm={`Delete ${n}`}
          onClose={() => setConfirm(false)}
          onConfirm={() =>
            save(
              async () => {
                for (const i of picked) await d.remove(i._id)
              },
              {
                failMessage: `Couldn’t delete ${plural(n)}.`,
                onDone: () => {
                  toast(`Deleted ${plural(n)}.`)
                  onClear()
                },
              },
            )
          }
        />
      ) : null}
    </>
  )
}
