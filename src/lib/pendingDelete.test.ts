import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PendingDeletes } from './pendingDelete'

class FakeDoc extends EventTarget {
  visibilityState = 'visible'
  hide() {
    this.visibilityState = 'hidden'
    this.dispatchEvent(new Event('visibilitychange'))
  }
  show() {
    this.visibilityState = 'visible'
    this.dispatchEvent(new Event('visibilitychange'))
  }
}

describe('pending delete (Undo window)', () => {
  let sent: string[]
  let p: PendingDeletes
  beforeEach(() => {
    vi.useFakeTimers()
    sent = []
    p = new PendingDeletes((id) => sent.push(id), 6000)
  })
  afterEach(() => vi.useRealTimers())

  it('sends when the Undo window ends, not before', () => {
    p.add('a')
    vi.advanceTimersByTime(5999)
    expect(sent).toEqual([])
    vi.advanceTimersByTime(1)
    expect(sent).toEqual(['a'])
    expect(p.has('a')).toBe(false)
  })

  it('Undo within the window means it is never sent', () => {
    p.add('a')
    vi.advanceTimersByTime(3000)
    expect(p.undo('a')).toBe(true)
    vi.advanceTimersByTime(10000)
    expect(sent).toEqual([])
    expect(p.undo('a')).toBe(false)
  })

  it('sends right away when the page is closed (pagehide)', () => {
    const win = new EventTarget()
    const doc = new FakeDoc()
    p.listen(win, doc)
    p.add('a')
    p.add('b')
    win.dispatchEvent(new Event('pagehide'))
    expect(sent).toEqual(['a', 'b'])
    vi.advanceTimersByTime(10000)
    expect(sent).toEqual(['a', 'b']) // once each
  })

  it('sends right away when the page is hidden, and not when it becomes visible', () => {
    const win = new EventTarget()
    const doc = new FakeDoc()
    p.listen(win, doc)
    p.add('a')
    doc.show()
    expect(sent).toEqual([])
    doc.hide()
    expect(sent).toEqual(['a'])
  })

  it('flush (navigating away) sends everything pending; undone ones stay unsent', () => {
    p.add('a')
    p.add('b')
    p.undo('b')
    p.flush()
    expect(sent).toEqual(['a'])
  })

  it('stops listening after cleanup', () => {
    const win = new EventTarget()
    const doc = new FakeDoc()
    const stop = p.listen(win, doc)
    stop()
    p.add('a')
    win.dispatchEvent(new Event('pagehide'))
    doc.hide()
    expect(sent).toEqual([])
    vi.advanceTimersByTime(6000)
    expect(sent).toEqual(['a'])
  })
})
