// PST-298: Investors' bulk Move to stage and Set wave show on every row at once
// and offer Undo instead of waiting row by row; Delete keeps its confirmation.
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { MoveRecord } from '../../lib/board'
import { fieldsOf, type Investor } from '../../lib/pipeline'
import { bulkChange } from './bulk'

const inv = (id: string, extra: Partial<Investor> = {}) =>
  ({ _id: id, name: 'Made-up ' + id, firm: '', type: 'Angel', geo: 'India', warmth: 'warm', path: '', tier: 'B', wave: 1, stage: 'm1', maxStage: 'm1', lead: false, nextStep: '', notes: '', source: '', ...extra }) as Investor

function fakeRaise() {
  const pending: (() => void)[] = []
  const later = <T>(v: T) => new Promise<T>((res) => pending.push(() => res(v)))
  const d = {
    move: vi.fn((id: string, to: MoveRecord['to']) => later<MoveRecord>({ id, to, from: { stage: 'm1', maxStage: 'm1' }, activityId: 'act-' + id })),
    undoMove: vi.fn(async (_rec: MoveRecord) => null),
    save: vi.fn(async (id: string | null, _fields: unknown) => id ?? ''),
  }
  return { d, settle: () => pending.splice(0).forEach((f) => f()) }
}

describe('bulk Move to stage', () => {
  it('starts every move at once, skipping rows already there', () => {
    const { d } = fakeRaise()
    bulkChange(d, [inv('a'), inv('b'), inv('c', { stage: 'dd' })], { stage: 'dd' })
    expect(d.move.mock.calls).toEqual([['a', 'dd'], ['b', 'dd']])
  })

  it('Undo waits for the moves and takes each one back with its record', async () => {
    const { d, settle } = fakeRaise()
    const { saved, undo } = bulkChange(d, [inv('a'), inv('b')], { stage: 'dd' })
    const undone = undo()
    expect(d.undoMove).not.toHaveBeenCalled()
    settle()
    await undone
    expect(await saved).toBeUndefined()
    expect(d.undoMove.mock.calls.map(([r]) => r.activityId)).toEqual(['act-a', 'act-b'])
  })

  it('reports a failed move and leaves it out of the Undo', async () => {
    const { d, settle } = fakeRaise()
    d.move.mockImplementationOnce(() => Promise.reject(new Error('Couldn’t save')))
    const { saved, undo } = bulkChange(d, [inv('a'), inv('b')], { stage: 'dd' })
    settle()
    expect(await saved).toEqual(new Error('Couldn’t save'))
    await undo()
    expect(d.undoMove.mock.calls.map(([r]) => r.id)).toEqual(['b'])
  })
})

describe('bulk Set wave', () => {
  it('saves the new wave on every row at once, and Undo saves each row as it was', async () => {
    const { d } = fakeRaise()
    const rows = [inv('a', { wave: 1 }), inv('b', { wave: 3 }), inv('c', { wave: 2 })]
    const { undo } = bulkChange(d, rows, { wave: 2 })
    expect(d.save.mock.calls).toEqual([['a', { ...fieldsOf(rows[0]), wave: 2 }], ['b', { ...fieldsOf(rows[1]), wave: 2 }]])
    await undo()
    expect(d.save.mock.calls.slice(2)).toEqual([['a', fieldsOf(rows[0])], ['b', fieldsOf(rows[1])]])
  })
})

describe('Undo instead of a confirmation', () => {
  it('the bulk bar confirms only Delete (permanent); Move to stage and Set wave offer Undo', () => {
    const src = readFileSync(new URL('./BulkBar.tsx', import.meta.url), 'utf8')
    expect(src.match(/<Confirm\b/g)).toHaveLength(1)
    expect(src).toMatch(/title=\{`Delete \$\{plural\(n\)\}\?`\}/)
    expect(src).toMatch(/bulkChange\(d, picked, change\)[\s\S]*label: 'Undo'/)
  })

  it('confirmation dialogs are left only on permanent deletes', () => {
    const root = new URL('../../', import.meta.url)
    const files = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.tsx') && /<Confirm\b/.test(readFileSync(new URL(f, root), 'utf8')))
    expect(files.map((f) => f.replace(/\\/g, '/')).sort()).toEqual(['components/close/ClosingPanel.tsx', 'components/investors/BulkBar.tsx', 'components/settings/AgentsCard.tsx'])
  })
})
