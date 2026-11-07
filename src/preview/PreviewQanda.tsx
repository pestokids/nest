// DEV ONLY: the Q&A bank in memory for ?preview (PST-281), with the same rules as
// convex/qanda.ts: merges keep every ask, a changed answer becomes a version,
// removing and merging can be undone. &qanda=empty starts with nothing.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRaise } from '../components/data'
import { usePreviewState } from '../components/preview-state'
import { QandaContext, type QandaActions, type QandaData } from '../components/qanda/data'
import { isISODate, todayIST } from '../lib/dates'
import { cleanQuestion, cleanTheme, guessTheme, LIMITS, needsAnswer, NEXT_DECK, noteLines, sameText, type Question } from '../lib/qanda'
import { EMPTY_QANDA, fixtureQanda, type QandaStore, type QRow } from './qandaFixture'

const live = (q: QRow | undefined): q is QRow => !!q && !q.removed && !q.mergedInto
const no = (data: string) => ({ data })

export function PreviewQanda({ fail, children }: { fail: boolean; children: ReactNode }) {
  const { investors, loaded } = useRaise()
  const state = usePreviewState()?.qanda
  const [store, setStore] = useState<QandaStore | null>(null)
  const cur = useRef<QandaStore>(EMPTY_QANDA)
  useEffect(() => {
    if (store || !loaded) return
    const s = state === 'empty' || !investors.length ? EMPTY_QANDA : fixtureQanda(investors, todayIST())
    cur.current = s
    setStore(s)
  }, [store, loaded, investors, state])

  const value = useMemo<QandaData>(() => {
    const s = store ?? EMPTY_QANDA
    const people = new Set(investors.map((i) => i._id))
    const noteById = new Map(s.notes.map((n) => [n._id, n]))
    const questions: Question[] = s.questions.filter(live).map(({ removed: _r, mergedInto: _m, merge: _g, ...q }) => {
      const asks = s.asks
        .filter((a) => a.questionId === q._id && people.has(a.investorId))
        .map(({ questionId: _q, ...a }) => {
          const n = a.noteId ? noteById.get(a.noteId) : undefined
          return { ...a, quote: n && a.noteLine !== undefined ? n.text.split('\n')[a.noteLine]?.trim() : undefined, label: n?.title }
        })
      return { ...q, askedCount: asks.length, asks }
    })

    let k = 0
    const uid = (p: string) => `${p}${Date.now()}-${k++}`
    const set = (fn: (x: QandaStore) => QandaStore) => {
      cur.current = fn(cur.current)
      setStore(cur.current)
    }
    const get = (id: string) => {
      const q = cur.current.questions.find((x) => x._id === id)
      if (!live(q)) throw no('That question was merged or deleted.')
      return q
    }
    const patchQ = (id: string, p: Partial<QRow>) => set((x) => ({ ...x, questions: x.questions.map((q) => (q._id === id ? { ...q, ...p, updatedAt: Date.now() } : q)) }))
    const addQ = (text: string, theme?: string) => {
      const _id = uid('pq')
      const now = Date.now()
      set((x) => ({ ...x, questions: [...x.questions, { _id, text, theme: cleanTheme(theme ?? '') || guessTheme(text), bestAnswer: '', answerVersions: [], onDeck: false, createdAt: now, updatedAt: now }] }))
      return _id
    }
    const same = (text: string) => cur.current.questions.find((q) => live(q) && sameText(q.text, text))
    const asksOf = (id: string) => cur.current.asks.filter((a) => a.questionId === id)
    const day = (d?: string) => (d && isISODate(d) ? d : todayIST())
    const w = <A extends unknown[], R>(fn: (...a: A) => R) => async (...a: A): Promise<R> => {
      if (fail) {
        await new Promise((r) => setTimeout(r, 400))
        throw new Error('Preview: writes fail (&fail)')
      }
      return fn(...a)
    }

    const act: QandaActions = {
      create: w((a) => {
        const text = cleanQuestion(a.text.trim())
        if (!text) throw no('Write the question first.')
        const hit = same(text)
        const id = hit?._id ?? addQ(text, a.theme)
        if (a.investorId) set((x) => ({ ...x, asks: [...x.asks, { _id: uid('pa'), questionId: id, investorId: a.investorId!, date: day(a.date), source: 'manual' }] }))
        return { id, existed: !!hit }
      }),
      save: w((a) => {
        const q = get(a.id)
        const best = a.bestAnswer.trim().slice(0, LIMITS.answer)
        const slide = a.slideRef?.trim().slice(0, LIMITS.slide) || undefined
        const changed = best !== q.bestAnswer.trim()
        patchQ(q._id, {
          text: cleanQuestion(a.text) || q.text, theme: cleanTheme(a.theme) || q.theme, bestAnswer: best,
          answerVersions: changed && best ? [...q.answerVersions, { text: best, at: Date.now(), by: 'Dev' }] : q.answerVersions,
          slideRef: slide, onDeck: !!slide, deckGap: slide ? undefined : q.deckGap,
        })
        return { changed }
      }),
      link: w((a) => {
        get(a.questionId)
        const _id = uid('pa')
        set((x) => ({ ...x, asks: [...x.asks, { ...a, _id, date: day(a.date), source: a.source ?? 'manual' }] }))
        return _id
      }),
      unlink: w((askId) => {
        const a = cur.current.asks.find((x) => x._id === askId)
        if (!a) return null
        set((x) => ({ ...x, asks: x.asks.filter((y) => y._id !== askId) }))
        return { questionId: a.questionId, investorId: a.investorId, date: a.date, source: a.source, noteId: a.noteId, noteLine: a.noteLine }
      }),
      merge: w((dropId, keepId) => {
        if (dropId === keepId) throw no('That’s the same question.')
        const drop = get(dropId)
        const keep = get(keepId)
        const moved = asksOf(dropId).map((a) => a._id)
        const keepBefore = { bestAnswer: keep.bestAnswer, answerVersions: keep.answerVersions, slideRef: keep.slideRef, onDeck: keep.onDeck }
        set((x) => ({
          ...x,
          asks: x.asks.map((a) => (moved.includes(a._id) ? { ...a, questionId: keepId } : a)),
          questions: x.questions.map((q) =>
            q._id === keepId
              ? {
                  ...q, bestAnswer: needsAnswer(keep) ? drop.bestAnswer : keep.bestAnswer, answerVersions: [...keep.answerVersions, ...drop.answerVersions].sort((a, b) => a.at - b.at),
                  slideRef: keep.slideRef ?? drop.slideRef, onDeck: keep.onDeck || drop.onDeck, updatedAt: Date.now(),
                }
              : q._id === dropId
                ? { ...q, mergedInto: keepId, merge: { askIds: moved, keepBefore } }
                : q,
          ),
        }))
        return { keepId, asked: asksOf(keepId).length }
      }),
      unmerge: w((id) => {
        const drop = cur.current.questions.find((q) => q._id === id)
        if (!drop?.mergedInto || !drop.merge) return false
        const { askIds, keepBefore } = drop.merge
        set((x) => ({
          ...x,
          asks: x.asks.map((a) => (askIds.includes(a._id) && a.questionId === drop.mergedInto ? { ...a, questionId: id } : a)),
          questions: x.questions.map((q) => (q._id === drop.mergedInto ? { ...q, ...keepBefore } : q._id === id ? { ...q, mergedInto: undefined, merge: undefined } : q)),
        }))
        return true
      }),
      remove: w((id) => {
        get(id)
        patchQ(id, { removed: true })
        return id
      }),
      restore: w((id) => {
        patchQ(id, { removed: false })
        return id
      }),
      addToDeck: w((id) => {
        const q = get(id)
        if (q.onDeck) throw no('It’s already on a slide.')
        patchQ(id, { deckGap: { deck: NEXT_DECK, at: Date.now() } })
        return NEXT_DECK
      }),
      removeFromDeck: w((id) => {
        patchQ(id, { deckGap: undefined })
        return id
      }),
      addNote: w((a) => {
        const text = a.text.trim().slice(0, LIMITS.note)
        if (!text) throw no('Write the notes first.')
        const _id = uid('pn')
        set((x) => ({ ...x, notes: [...x.notes, { _id, investorId: a.investorId, meetingId: a.meetingId, date: day(a.date), text, title: a.title?.trim() || undefined, by: 'Dev', _creationTime: Date.now() }] }))
        return _id
      }),
      removeNote: w((id) => {
        set((x) => ({ ...x, notes: x.notes.map((n) => (n._id === id ? { ...n, removed: true } : n)) }))
        return id
      }),
      restoreNote: w((id) => {
        set((x) => ({ ...x, notes: x.notes.map((n) => (n._id === id ? { ...n, removed: false } : n)) }))
        return id
      }),
      markLine: w((noteId, line) => {
        const n = cur.current.notes.find((x) => x._id === noteId && !x.removed)
        if (!n) throw no('That note was deleted.')
        const picked = noteLines(n.text).find((l) => l.line === line)
        const text = picked ? cleanQuestion(picked.text) : ''
        if (!text) throw no('That line is no longer in the note.')
        const onLine = cur.current.asks.find((a) => a.noteId === noteId && a.noteLine === line)
        if (onLine && live(cur.current.questions.find((q) => q._id === onLine.questionId))) return { questionId: onLine.questionId, askId: onLine._id, created: false }
        const hit = same(text)
        const questionId = hit?._id ?? addQ(text)
        const askId = uid('pa')
        set((x) => ({ ...x, asks: [...x.asks.filter((a) => a !== onLine), { _id: askId, questionId, investorId: n.investorId, date: n.date, source: 'notes', noteId, noteLine: line }] }))
        return { questionId, askId, created: !hit }
      }),
      unmarkLine: w((noteId, line) => {
        const rows = cur.current.asks.filter((a) => a.noteId === noteId && a.noteLine === line)
        set((x) => ({ ...x, asks: x.asks.filter((a) => !rows.includes(a)) }))
        for (const a of rows) {
          const q = cur.current.questions.find((x) => x._id === a.questionId)
          if (live(q) && !asksOf(q._id).length && needsAnswer(q)) patchQ(q._id, { removed: true })
        }
        return rows.length
      }),
    }

    return {
      loaded: !!store,
      questions,
      noteCount: s.notes.filter((n) => !n.removed && people.has(n.investorId)).length,
      useNotes: (investorId) =>
        investorId ? s.notes.filter((n) => !n.removed && n.investorId === investorId).sort((a, b) => b.date.localeCompare(a.date) || (b._creationTime ?? 0) - (a._creationTime ?? 0)) : undefined,
      act,
    }
  }, [store, investors, fail])

  return <QandaContext.Provider value={value}>{children}</QandaContext.Provider>
}
