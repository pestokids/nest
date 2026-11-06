import { createFileRoute } from '@tanstack/react-router'
import { useRaise } from '../../components/data'
import { Panel, Row } from '../../components/ui'
import { shortDate, todayIST } from '../../lib/dates'
import { money } from '../../lib/money'
import { dueList, funnel, meetingsKpi, nextList, quietList, totals } from '../../lib/pipeline'
import { ACTIVE } from '../../lib/stages'

export const Route = createFileRoute('/raise/today')({ component: Today })

function Today() {
  const { investors: inv, acts, round: r } = useRaise()
  const t = todayIST()
  const tot = totals(inv, r, t)
  const mk = meetingsKpi(r, acts, t)
  const kpis: [string, string | number, string][] = [
    ['Committed', money(tot.committed), `${tot.pctOfTarget}% of ${money(r.target)}`],
    ['Still to raise', money(tot.need), `${money(tot.perDay)} a day to ${shortDate(r.deadline)}`],
    ['In conversation', inv.filter((i) => ACTIVE.has(i.stage)).length, `${inv.filter((i) => i.stage === 'ask').length} waiting on an intro`],
    [
      `1st meetings${mk ? ` · ${mk.phase.name}` : ''}`,
      mk ? (mk.target ? `${mk.m1}/${mk.target}` : mk.m1) : 0,
      mk ? `${shortDate(mk.phase.from)}–${shortDate(mk.phase.to)}` : '',
    ],
    ['Passed', inv.filter((i) => i.stage === 'passed').length, `${inv.filter((i) => i.stage === 'parked').length} parked`],
  ]
  const due = dueList(inv, t)
  const quiet = quietList(inv, t, r.quietDays)
  const next = nextList(inv)
  const fn = funnel(inv)

  return (
    <section>
      <div className="kpis">
        {kpis.map(([l, v, s]) => (
          <div className="kpi" key={l}>
            <span className="eyebrow">{l}</span>
            <span className="v num">{v}</span>
            <span className="s">{s}</span>
          </div>
        ))}
      </div>
      <div className="grid2" style={{ marginTop: 18 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Panel title="Due today or overdue" aside={due.length ? `${due.length}` : ''}>
            <div className="body">
              {due.length ? (
                due.map((i) => <Row key={i._id} i={i} today={t} sev={i.nextDate! < t ? 'sev-bad' : 'sev-warn'} />)
              ) : (
                <div className="empty">Nothing due. Set a next step and date on every live conversation so it shows up here.</div>
              )}
            </div>
          </Panel>
          <Panel title="Gone quiet" aside={`active, no touch in ${r.quietDays}+ days`}>
            <div className="body">
              {quiet.length ? (
                quiet.map((i) => <Row key={i._id} i={i} today={t} sev="sev-warn" />)
              ) : (
                <div className="empty">Every live conversation has been touched in the last {r.quietDays} days.</div>
              )}
            </div>
          </Panel>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Panel title="Funnel" aside="reached stage · conversion from previous">
            <div className="funnel">
              {fn.map((f) => (
                <div className="fl" key={f.k}>
                  <span>{f.l}</span>
                  <div className="tr">
                    <div className="fi" style={{ width: `${f.pct}%` }} />
                  </div>
                  <span className="rt num">
                    {f.n}
                    {f.conv !== null ? ` · ${f.conv}%` : ''}
                  </span>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Top 10 to move next" aside="by priority score">
            <div className="body">
              {next.length ? next.map((i) => <Row key={i._id} i={i} today={t} />) : <div className="empty">No uncontacted investors left on the list.</div>}
            </div>
          </Panel>
        </div>
      </div>
    </section>
  )
}
