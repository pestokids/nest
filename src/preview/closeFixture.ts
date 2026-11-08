// DEV ONLY: made-up closing investors, records and a cap table for the Close
// tab (`?preview&close=<state>`). Every name, amount and link is invented.
//   default      the round mid-close: soft circles, verbals, a SAFE out, one signed, one waiting on the wire
//   record       … with Record SAFE sent open          status   … with Marigold's timeline open
//   remind       … with the reminder for Marigold open  modeller the round modeller
//   captable     the cap table after the close          nocaptable  no founder shares entered yet
//   closed       every SAFE wired (the "Round closed" banner)
//   empty        nobody in Verbal yet
// PST-291:
//   kit          the Close kit on Heron Angels, verbal today: the written confirmation to send
//   kit-sent     … the confirmation went two hours ago: the 48-hour offer is running
//   allocation   oversubscribed ($2.05M wanted, $1.5M of room): Close › Allocation
//   tranche2     … with tranche 2 set up at a $20M cap, Bramble Capital in it
import type { CapTable, Closing, Step, StepKey } from '../lib/close'
import type { Allocation, Tranche2 } from '../lib/closeKit'
import type { Investor } from '../lib/pipeline'

export const PREVIEW_CLOSE = ['default', 'record', 'status', 'remind', 'modeller', 'captable', 'nocaptable', 'closed', 'empty', 'kit', 'kit-sent', 'allocation', 'tranche2'] as const
/** PST-291: the states that add Heron Angels (verbal today), and the oversubscribed ones. */
export const isKitState = (s: PreviewClose | null) => s === 'kit' || s === 'kit-sent'
export const isAllocState = (s: PreviewClose | null) => s === 'allocation' || s === 'tranche2'
export type PreviewClose = (typeof PREVIEW_CLOSE)[number]

const ON = import.meta.env.DEV || import.meta.env.VITE_PREVIEW_MODE === '1'
const KEY = 'nest_preview_close'

/** The Close preview state: from `&close=` on this load, else the one this tab started with (kept while you move between views). */
export function closePreview(): PreviewClose | null {
  if (!ON || typeof location === 'undefined') return null
  const q = new URLSearchParams(location.search)
  const v = q.get('close') ?? (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(KEY) : null)
  if (v === null) return null
  return (PREVIEW_CLOSE as readonly string[]).includes(v) ? (v as PreviewClose) : 'default'
}
/** Called by Preview on load: remember `&close` for the tab, or forget it. */
export function rememberClosePreview(q: URLSearchParams) {
  if (q.has('close')) sessionStorage.setItem(KEY, q.get('close') || 'default')
  else if (q.has('preview')) sessionStorage.removeItem(KEY)
}

const add = (iso: string, days: number) => new Date(Date.parse(iso + 'T00:00:00Z') + days * 864e5).toISOString().slice(0, 10)

type Row = Partial<Investor> & Pick<Investor, 'name' | 'stage'>

/** The investors the Close tab needs (none for `empty`). Ids are fixed so the records can point at them. */
export function fixtureCloseInvestors(today: string, state: PreviewClose): Investor[] {
  if (state === 'empty') return []
  const d = (n: number) => add(today, n)
  const closed = state === 'closed'
  const rows: (Row | null)[] = [
    { name: 'Marigold Capital', firm: 'Marigold Capital', type: 'Pre-seed fund', warmth: 'warm', path: 'Ria', stage: closed ? 'wired' : 'verbal', committed: 100000, expected: 100000, nextStep: 'Chase the signature', nextDate: d(1), lastTouch: d(-4), email: 'tara@marigold.example.com' },
    { name: 'Asha Linden', firm: '', type: 'Angel', warmth: 'existing', path: 'Direct', stage: closed ? 'wired' : 'signed', committed: 25000, expected: 25000, nextStep: 'Countersign', nextDate: d(0), lastTouch: d(-1), email: 'asha@linden.example.com' },
    { name: 'Cobalt Angels', firm: 'Cobalt Angels', type: 'Angel', warmth: 'warm', path: 'Ankur', stage: closed ? 'wired' : 'verbal', committed: 50000, expected: 50000, nextStep: 'Send the SAFE', nextDate: d(0), lastTouch: d(-2), notes: 'Angel syndicate. Asked for pro-rata.' },
    { name: 'Bramble Capital', firm: 'Bramble Capital', type: 'Pre-seed fund', warmth: 'intro', path: 'Mira', stage: closed ? 'wired' : 'verbal', committed: 150000, expected: 150000, nextStep: 'Send the SAFE with the side letter', nextDate: d(1), lastTouch: d(-2) },
    { name: 'Neel Ember', firm: '', type: 'Angel', warmth: 'warm', path: 'Ria', stage: closed ? 'wired' : 'signed', committed: 75000, expected: 75000, nextStep: 'Look out for the wire', nextDate: d(2), lastTouch: d(-3), email: 'neel@ember.example.com' },
    closed ? null : { name: 'Ravi Thistle', firm: '', type: 'Angel', warmth: 'warm', path: 'Mira (operator)', stage: 'dd', expected: 25000, nextStep: 'Confirm the amount', nextDate: d(2), lastTouch: d(-1) },
    closed ? null : { name: 'Wren Partners', firm: 'Wren Partners', type: 'Micro-VC', warmth: 'intro', path: 'Ankur', stage: 'm2', expected: 125000, nextStep: 'Partner call', nextDate: d(3), lastTouch: d(-2) },
    isKitState(state) ? { name: 'Heron Angels', firm: 'Heron Angels', type: 'Angel', warmth: 'warm', path: 'Ria', stage: 'verbal', committed: 150000, expected: 150000, nextStep: 'Confirm in writing', nextDate: d(0), lastTouch: d(0), email: 'sam@heron.example.com' } : null,
    isAllocState(state) ? { name: 'Alder Partners', firm: 'Alder Partners', type: 'Pre-seed fund', warmth: 'warm', path: 'Ankur', stage: 'verbal', lead: true, committed: 600000, expected: 600000, nextStep: 'Agree the allocation', nextDate: d(0), lastTouch: d(-1), email: 'lena@alder.example.com' } : null,
    isAllocState(state) ? { name: 'Lumen Ventures', firm: 'Lumen Ventures', type: 'Micro-VC', warmth: 'intro', path: 'Mira', stage: 'dd', expected: 500000, nextStep: 'Partner vote', nextDate: d(1), lastTouch: d(-1), email: 'deals@lumen.example.com' } : null,
    isAllocState(state) ? { name: 'Sorrel Capital', firm: 'Sorrel Capital', type: 'Seed fund', warmth: 'intro', path: 'Ria', stage: 'm2', expected: 400000, nextStep: 'Second meeting notes', nextDate: d(2), lastTouch: d(-2), email: 'team@sorrel.example.com' } : null,
  ]
  return rows.flatMap((r, i) =>
    r
      ? [{
          _id: `fxc${i}`, firm: '', geo: 'India', tier: 'A', wave: 1, lead: false, notes: '', source: 'Preview fixture',
          maxStage: r.stage as Investor['maxStage'], _creationTime: Date.parse(d(-20) + 'T06:00:00Z'), ...r,
        } as Investor]
      : [],
  )
}

const steps = (xs: [StepKey, string][]): Step[] => xs.map(([key, at]) => ({ key, at }))
const terms = { instrument: 'post-money SAFE', cap: 16000000, proRata: false, mfn: false }

/** The closing records, cap table, tranche 2 and allocation rows for a preview state. */
export function fixtureCloseStore(today: string, state: PreviewClose, now = Date.now()): { closings: Closing[]; capTable: CapTable | null; tranche2: Tranche2 | null; allocations: Allocation[] } {
  const d = (n: number) => add(today, n)
  const all = (from: number): Step[] => steps([['sent', d(from)], ['viewed', d(from + 1)], ['signed', d(from + 2)], ['countersigned', d(from + 3)], ['wireSent', d(from + 3)], ['wired', d(from + 5)]])
  const closed = state === 'closed'
  const closings: Closing[] =
    state === 'empty'
      ? []
      : [
          {
            _id: 'pc0', investorId: 'fxc0', amount: 100000, ...terms, proRata: true, sideLetter: 'Pro-rata in the seed round',
            signerName: 'Tara Quill', signerEmail: 'tara@marigold.example.com', requestUrl: 'https://sign.example.com/requests/marigold',
            steps: closed ? all(-14) : steps([['sent', d(-5)], ['viewed', d(-4)]]),
          },
          {
            _id: 'pc1', investorId: 'fxc1', amount: 25000, ...terms, signerName: 'Asha Linden', signerEmail: 'asha@linden.example.com',
            steps: closed ? all(-12) : steps([['sent', d(-6)], ['viewed', d(-5)], ['signed', d(-1)]]),
          },
          ...(closed ? [{ _id: 'pc2', investorId: 'fxc2', amount: 50000, ...terms, proRata: true, signerName: 'Kabir Cobalt', steps: all(-11) }] : []),
          { _id: 'pc3', investorId: 'fxc3', amount: 150000, ...terms, proRata: true, mfn: true, sideLetter: 'Information rights', steps: closed ? all(-10) : [] },
          {
            _id: 'pc4', investorId: 'fxc4', amount: 75000, ...terms, signerName: 'Neel Ember', signerEmail: 'neel@ember.example.com',
            signedUrl: 'https://files.example.com/safes/neel-ember.pdf',
            steps: closed ? all(-9) : steps([['sent', d(-9)], ['viewed', d(-8)], ['signed', d(-6)], ['countersigned', d(-3)], ['wireSent', d(-3)]]),
          },
        ]
  if (closed) for (const c of closings) c.signedUrl ??= `https://files.example.com/safes/${c._id}.pdf`
  if (state === 'kit-sent') closings.push({ _id: 'pc7', investorId: 'fxc7', amount: 150000, ...terms, signerName: 'Sam Heron', signerEmail: 'sam@heron.example.com', steps: [], confirmationSentAt: now - 2 * 3600_000 })
  if (isAllocState(state)) closings.push({ _id: 'pc8', investorId: 'fxc8', amount: 600000, ...terms, proRata: true, signerName: 'Lena Alder', steps: [], confirmationSentAt: now - 26 * 3600_000, acceptedAt: now - 20 * 3600_000 })
  const tranche2 = state === 'tranche2' ? { cap: 20000000 } : null
  if (tranche2) for (const c of closings) if (c._id === 'pc3') Object.assign(c, { tranche: 2, cap: tranche2.cap })
  const allocations: Allocation[] = isAllocState(state)
    ? [
        { investorId: 'fxc8', gets: 600000, why: 'Leading the round' },
        { investorId: 'fxc9', gets: 350000, why: 'Second offer, same week' },
        { investorId: 'fxc10', gets: 200000, why: 'Late to the race' },
        { investorId: 'fxc0', why: 'In early, sent two intros' },
        { investorId: 'fxc1', why: 'Introducer, kids operator' },
        { investorId: 'fxc3', gets: 50000, why: 'Strategic: parent network' },
        { investorId: 'fxc6', gets: 0, why: 'Came in last; next round' },
      ]
    : []
  const capTable: CapTable | null =
    state === 'nocaptable'
      ? null
      : { founders: [{ name: 'Dev', shares: 4500000 }, { name: 'Sam', shares: 4500000 }], optionPool: 1000000, safes: [{ name: 'Friends and family SAFE', amount: 50000, cap: 6000000 }] }
  return { closings, capTable, tranche2, allocations }
}
