// Close › Round modeller (screens/raise-close/round-modeller.png), for
// post-money SAFEs. Every number is a what-if: nothing here is saved.
// The maths, with the formulas written out, is in src/lib/close.ts.
import { useMemo, useState, type CSSProperties } from 'react'
import { capTableAfter, compareCaps, dilution, isAngel, ladder, pct, scenarioSafes, usd, type Safe } from '../../lib/close'
import { money } from '../../lib/money'
import { useInView } from '../../lib/motion'
import { useRaise } from '../data'
import { AmountInput, NumberInput } from '../settings/inputs'
import { Toggle } from '../ui'
import { useClose } from './CloseData'

const STEP = 25_000

export function Modeller() {
  const d = useRaise()
  const c = useClose()
  const l = useMemo(() => ladder(d.investors, c.closings), [d.investors, c.closings])
  const commitments = useMemo(
    () =>
      l.rows
        .filter((r) => r.rung !== 'soft' && r.amount > 0)
        .map((r) => ({ id: r.investor._id, name: r.investor.name, amount: r.amount, angel: isAngel(r.investor.type), proRata: r.closing?.proRata ?? false, mfn: r.closing?.mfn ?? false })),
    [l.rows],
  )
  const savedCap = d.round.cap ?? c.closings[0]?.cap ?? 10_000_000
  const earlier: Safe[] = (c.capTable?.safes ?? []).map((s, i) => ({ id: `earlier-${i}`, name: s.name, amount: s.amount, cap: s.cap, mfn: s.mfn }))
  const startPool = useMemo(() => {
    const t = c.capTable && capTableAfter(c.capTable, commitments.map((x) => ({ ...x, cap: savedCap })))
    return t ? Math.round(t.rows.find((r) => r.kind === 'Reserved')!.after.pct * 1000) / 10 : 10
  }, [c.capTable, commitments, savedCap])

  const [cap, setCap] = useState<number | undefined>(savedCap)
  const [target, setTarget] = useState<number | undefined>(d.round.target)
  const [stretch, setStretch] = useState<number | undefined>(d.round.stretch)
  const [raise, setRaise] = useState(d.round.stretch)
  const [discount, setDiscount] = useState<number | undefined>()
  const [nextPre, setNextPre] = useState<number | undefined>()
  const [pool, setPool] = useState<number | undefined>(startPool)
  const [flags, setFlags] = useState<Record<string, { proRata: boolean; mfn: boolean }>>(() => Object.fromEntries(commitments.map((x) => [x.id, { proRata: x.proRata, mfn: x.mfn }])))

  const good = (x: number | undefined): x is number => x !== undefined && Number.isFinite(x) && x > 0
  const capN = good(cap) ? cap : savedCap
  const disc = discount && discount > 0 && discount < 100 ? discount / 100 : undefined
  const poolPct = pool !== undefined && Number.isFinite(pool) && pool >= 0 && pool < 100 ? pool / 100 : 0.1
  const flagOf = (id: string) => flags[id] ?? commitments.find((x) => x.id === id)
  const withFlags = commitments.map((x) => ({ ...x, ...flagOf(x.id) }))
  const model = (atCap: number, atRaise: number) => {
    const s = scenarioSafes(withFlags, { cap: atCap, discount: disc, raise: atRaise })
    return { ...s, dil: dilution([...earlier, ...s.safes], { poolPct, nextPreMoney: good(nextPre) ? nextPre : undefined }) }
  }
  const now = model(capN, raise)
  const [lo, hi] = compareCaps(capN)
  const committed = commitments.reduce((a, x) => a + x.amount, 0)
  const room = good(stretch) ? stretch : d.round.stretch
  const maxRaise = Math.max(room, committed, raise) * 1.5
  const [bar, seen] = useInView<HTMLDivElement>()
  const notPost = !d.round.instrument.toLowerCase().startsWith('post-money')

  return (
    <div className="close-model">
      <header className="close-head close-head--page">
        <div>
          <h2>Round modeller</h2>
          <p>Try a cap and a round size. Post-money SAFEs make the maths simple: ownership = amount ÷ cap.</p>
        </div>
      </header>
      <p className="close-assume">
        Assumes the YC post-money SAFE; conversion at the next priced round. An estimate, not legal advice: check with a lawyer before signing.
        {notPost ? ` Your round is set to ${d.round.instrument} in Settings, so treat this as a rough guide.` : ''}
      </p>
      <div className="close-model__grid">
        <section className="close-model__inputs card m-rise">
          <h3>Scenario</h3>
          <Money id="m-cap" label="Valuation cap (post-money)" value={cap} onChange={setCap} help={d.round.cap ? `Saved in Settings: ${money(d.round.cap)}.` : 'Not saved in Settings yet.'} />
          <Slider label="Try a cap" min={1_000_000} max={Math.max(capN * 2, 4_000_000)} step={250_000} value={capN} onChange={setCap} />
          <div className="close-model__pair">
            <Money id="m-target" label="Target" value={target} onChange={setTarget} />
            <Money id="m-stretch" label="Room to" value={stretch} onChange={setStretch} />
          </div>
          <Slider label="Amount raised" min={0} max={Math.ceil(maxRaise / STEP) * STEP} step={STEP} value={raise} onChange={(v) => setRaise(v ?? 0)} marks={[good(target) ? target : 0, room]} />
          <div className="close-model__pair">
            <Percent id="m-discount" label="Discount" value={discount} onChange={setDiscount} help="Optional." />
            <Percent id="m-pool" label="Option pool after the round" value={pool} onChange={setPool} help="Comes out of founders’ share." />
          </div>
          {disc ? <Money id="m-next" label="Next round’s pre-money" value={nextPre} onChange={setNextPre} help="Prices the discount. Without it, the cap is used." /> : null}
          <p className="close-sub">Compare caps</p>
          <div className="close-chips" role="group" aria-label="Compare caps">
            {[capN, lo, hi].filter((x, i, a) => a.indexOf(x) === i).map((x) => (
              <button key={x} type="button" className={`close-chip${x === capN ? ' is-on' : ''}`} aria-pressed={x === capN} onClick={() => setCap(x)}>
                {money(x)}
              </button>
            ))}
          </div>
        </section>

        <section className="close-model__out card m-rise">
          <div className="close-model__nums">
            <div>
              <span className="eyebrow-mono">SAFE holders own</span>
              <span className="close-model__big num">{pct(now.dil.safeTotal)}</span>
              <span className="close-model__of">of the company once the SAFEs convert, raising {money(raise)} at {money(capN)}.</span>
            </div>
            {[lo, hi].filter((x) => x !== capN).map((x) => (
              <div key={x} className={x < capN ? 'is-low' : 'is-high'}>
                <span className="eyebrow-mono">At {money(x)} cap</span>
                <span className="close-model__alt num">{pct(model(x, raise).dil.safeTotal)}</span>
              </div>
            ))}
          </div>
          <div className={`close-split${seen ? ' is-seen' : ''}`} ref={bar} aria-hidden="true">
            <span style={{ '--w': `${Math.max(0, now.dil.founders) * 100}%` } as CSSProperties} className="close-split__f" />
            <span style={{ '--w': `${now.dil.pool * 100}%` } as CSSProperties} className="close-split__p" />
            <span style={{ '--w': `${now.dil.safeTotal * 100}%` } as CSSProperties} className="close-split__s" />
          </div>
          <ul className="close-legend close-legend--light">
            <li><span className="close-dot close-dot--f" aria-hidden="true" />Founders {pct(now.dil.founders)}</li>
            <li><span className="close-dot close-dot--p" aria-hidden="true" />Option pool {pct(now.dil.pool)}</li>
            <li><span className="close-dot close-dot--s" aria-hidden="true" />SAFE holders {pct(now.dil.safeTotal)}</li>
          </ul>
          {now.dil.over ? <p className="close-warn">The SAFEs and the pool add up to more than the whole company. Raise the cap or shrink the round.</p> : null}
          <p className="close-model__at">
            At the target ({money(good(target) ? target : d.round.target)}): {pct(model(capN, good(target) ? target : d.round.target).dil.safeTotal)} · at room to ({money(room)}): {pct(model(capN, room).dil.safeTotal)}
          </p>

          <table className="close-convert">
            <caption className="sr-only">What each SAFE converts to</caption>
            <thead>
              <tr>
                <th scope="col">SAFE</th>
                <th scope="col">Amount</th>
                <th scope="col">Pro-rata</th>
                <th scope="col">MFN</th>
                <th scope="col">Converts to</th>
              </tr>
            </thead>
            <tbody>
              {now.dil.safes.map((s) => {
                const f = flagOf(s.id)
                const set = (k: 'proRata' | 'mfn', on: boolean) => f && setFlags((x) => ({ ...x, [s.id]: { proRata: f.proRata ?? false, mfn: f.mfn ?? false, [k]: on } }))
                const earlierSafe = s.id.startsWith('earlier-')
                return (
                  <tr key={s.id} className={s.id === 'gap' ? 'is-gap' : earlierSafe ? 'is-earlier' : ''}>
                    <th scope="row">
                      {s.name}
                      {earlierSafe ? <small>Earlier SAFE · {money(s.cap)} cap</small> : s.terms.cap !== s.cap ? <small>MFN: converts at {money(s.terms.cap)}</small> : null}
                    </th>
                    <td className="num">{usd(s.amount)}</td>
                    <td>{f ? <Toggle aria-label={`${s.name} has pro-rata rights`} checked={!!f.proRata} onChange={(e) => set('proRata', e.target.checked)} /> : '–'}</td>
                    <td>{f ? <Toggle aria-label={`${s.name} has MFN`} checked={!!f.mfn} onChange={(e) => set('mfn', e.target.checked)} /> : '–'}</td>
                    <td className="num">{pct(s.ownership)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {withFlags.some((x) => x.proRata) ? (
            <p className="close-model__note">Pro-rata: {withFlags.filter((x) => x.proRata).map((x) => x.name).join(', ')} can buy into the next round to keep their share.</p>
          ) : null}

          {now.cut ? (
            <div className="close-cut">
              <h3>If you’re oversubscribed</h3>
              <p>
                {money(committed)} is committed against {money(raise)} of room. Suggested cut, keeping angels whole:
              </p>
              <ul>
                {now.cut.map((x) => (
                  <li key={x.id}>
                    <span>{x.name}</span>
                    <span className="num">
                      {money(x.from)} → {money(x.to)}
                    </span>
                    <span className={x.to === x.from ? 'is-kept' : 'is-cut'}>{x.to === x.from ? 'Kept whole' : `−${Math.round((1 - x.to / x.from) * 100)}%`}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : commitments.length ? null : (
            <p className="close-model__note">No commitments yet: the whole round is modelled as one SAFE.</p>
          )}
        </section>
      </div>
    </div>
  )
}

function Money({ id, label, value, onChange, help }: { id: string; label: string; value: number | undefined; onChange: (v: number | undefined) => void; help?: string }) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <span className="input">
        <AmountInput id={id} value={value} onChange={onChange} />
      </span>
      {help ? <span className="field__help">{help}</span> : null}
    </div>
  )
}

function Percent({ id, label, value, onChange, help }: { id: string; label: string; value: number | undefined; onChange: (v: number | undefined) => void; help?: string }) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <span className="input input--suffix">
        <NumberInput id={id} value={value} onChange={onChange} placeholder="0" />
        <span className="input__suffix">%</span>
      </span>
      {help ? <span className="field__help">{help}</span> : null}
    </div>
  )
}

/** A what-if slider; `marks` are ticks under it (the target and room to). */
function Slider({ label, min, max, step, value, onChange, marks = [] }: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void; marks?: number[] }) {
  const at = (x: number) => `${((Math.min(max, Math.max(min, x)) - min) / (max - min || 1)) * 100}%`
  return (
    <label className="close-slider">
      <span className="close-slider__top">
        <span>{label}</span>
        <span className="num">{money(value)}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={Math.min(max, Math.max(min, value))} onChange={(e) => onChange(Number(e.target.value))} />
      {marks.length ? (
        <span className="close-slider__marks" aria-hidden="true">
          {marks.filter((m) => m > min && m < max).map((m) => (
            <span key={m} style={{ left: at(m) }} />
          ))}
        </span>
      ) : null}
    </label>
  )
}
