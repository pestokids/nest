import { createFileRoute } from '@tanstack/react-router'
import { useRaise } from '../../../components/data'
import { openOnKey, useUI, WarmChip } from '../../../components/raise-ui'
import { shortDate, todayIST } from '../../../lib/dates'
import { money } from '../../../lib/money'
import { committedOf } from '../../../lib/pipeline'
import { COMMIT, IDX, LABEL, STAGES } from '../../../lib/stages'
import { Button, Chip } from '../../../components/ui'

export const Route = createFileRoute('/_app/raise/pipeline')({ component: Pipeline })

function Pipeline() {
  const { investors: inv } = useRaise()
  const { open, advance } = useUI()
  const t = todayIST()
  const cols = STAGES.filter((s) => s.k !== 'todo')
  const todo = inv.filter((i) => i.stage === 'todo').length
  return (
    <section>
      <p className="muted" style={{ margin: '0 0 10px' }}>
        {todo} not contacted yet (in Investors). Click a card to edit, or → to move it one stage.
      </p>
      <div className="board">
        {cols.map((c) => {
          const items = inv.filter((i) => i.stage === c.k).sort((a, b) => (a.nextDate || '9').localeCompare(b.nextDate || '9'))
          const sum = items.reduce((a, i) => a + (COMMIT.has(c.k) ? committedOf(i) : +(i.expected || 0)), 0)
          const nextStage = c.k !== 'wired' ? STAGES[IDX[c.k]! + 1].k : null
          return (
            <div className="col" key={c.k}>
              <h3>
                <span>{c.l}</span>
                <span className="num">
                  {items.length}
                  {sum ? ` · ${money(sum)}` : ''}
                </span>
              </h3>
              {items.length ? (
                items.map((i) => {
                  const late = !!i.nextDate && i.nextDate < t
                  return (
                    <div className="deal" tabIndex={0} key={i._id} onClick={() => open(i._id)} onKeyDown={openOnKey(() => open(i._id))}>
                      <div className="n">{i.name}</div>
                      {i.firm ? <div className="muted" style={{ fontSize: 12 }}>{i.firm}</div> : null}
                      <div className="m">
                        <WarmChip w={i.warmth} />
                        <span className="num">{money(COMMIT.has(c.k) ? committedOf(i) : i.expected)}</span>
                      </div>
                      <div className="m">
                        <span>{i.nextStep || 'No next step'}</span>
                        {i.nextDate ? <Chip tone={late ? 'error' : 'outline'} className="chip--sm">{shortDate(i.nextDate)}</Chip> : null}
                      </div>
                      {nextStage ? (
                        <div className="m">
                          <span />
                          <Button
                            variant="secondary"
                            size="sm"
                            iconRight="arrow-right"
                            aria-label={`Advance ${i.name}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              advance(i)
                            }}
                          >
                            {LABEL[nextStage]}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  )
                })
              ) : (
                <div className="muted" style={{ fontSize: 12 }}>Empty</div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
