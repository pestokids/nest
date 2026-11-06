import { createFileRoute } from '@tanstack/react-router'
import type { CSSProperties } from 'react'
import { useRaise } from '../../../components/data'
import { shortDate, todayIST } from '../../../lib/dates'
import { money } from '../../../lib/money'
import { mixByType, phaseActual, totals, warmPaths } from '../../../lib/pipeline'
import { isDollarMetric, targetValue } from '../../../lib/round'

export const Route = createFileRoute('/_app/raise/plan')({ component: Plan })

function Plan() {
  const { investors: inv, acts, round: r } = useRaise()
  const t = todayIST()
  const { committed } = totals(inv, r, t)
  return (
    <section>
      <div className="phases" style={{ '--phases': r.phases.length } as CSSProperties}>
        {r.phases.map((p) => {
          const now = t >= p.from && t <= p.to
          return (
            <div className={`phase ${now ? 'now' : ''}`} key={p.k}>
              <div>
                <div className="eyebrow">
                  {shortDate(p.from)} – {shortDate(p.to)}
                  {now ? ' · now' : ''}
                </div>
                <h3>{p.name}</h3>
              </div>
              {p.targets.map((x, ix) => {
                const a = phaseActual(p, x.m, inv, acts, committed)
                const tv = targetValue(r, x)
                const isM = isDollarMetric(x.m)
                return (
                  <div className="met" key={ix}>
                    <div className="lbl">
                      <span>{x.l}</span>
                      <span className="num">
                        {isM ? money(a) : a} / {isM ? money(tv) : tv}
                      </span>
                    </div>
                    <div className="tr">
                      <div className="fi" style={{ width: `${Math.min(100, (a / tv) * 100)}%` }} />
                    </div>
                  </div>
                )
              })}
              <ul>
                {p.todo.map((x, ix) => (
                  <li key={ix}>{x}</li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
      <div className="grid2" style={{ marginTop: 18 }}>
        <div className="panel">
          <header>
            <h2>Warm paths</h2>
            <span className="muted">who can intro, and how far each got</span>
          </header>
          <div className="tbl" style={{ border: 0 }}>
            <table style={{ minWidth: 520 }}>
              <thead>
                <tr>
                  <th>Connector</th>
                  <th className="r">Targets</th>
                  <th className="r">Asked</th>
                  <th className="r">Met</th>
                  <th className="r">Committed</th>
                </tr>
              </thead>
              <tbody>
                {warmPaths(inv).map(([k, o]) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td className="r num">{o.n}</td>
                    <td className="r num">{o.asked}</td>
                    <td className="r num">{o.met}</td>
                    <td className="r num">{o.c ? money(o.c) : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="panel">
          <header>
            <h2>Mix by type</h2>
            <span className="muted">targets and committed $</span>
          </header>
          <div className="tbl" style={{ border: 0 }}>
            <table style={{ minWidth: 480 }}>
              <thead>
                <tr>
                  <th>Type</th>
                  <th className="r">Targets</th>
                  <th className="r">In talks</th>
                  <th className="r">Committed</th>
                </tr>
              </thead>
              <tbody>
                {mixByType(inv).map((m) => (
                  <tr key={m.type}>
                    <td>{m.type}</td>
                    <td className="r num">{m.n}</td>
                    <td className="r num">{m.talking}</td>
                    <td className="r num">{money(m.c)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  )
}
