// DEV ONLY: the Q&A bank in memory for ?preview (PST-281), with the same rules as
// convex/qanda.ts: merges keep every ask, a changed answer becomes a version,
// removing and merging can be undone. &qanda=empty starts with nothing.
// PST-277: Nest's reads of notes (&notes=…, see qandaFixture.ts) and Unmatched
// notes. Apply writes through the preview's own investor writes; no Claude here.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRaise, type RaiseData } from '../components/data'
import { usePreviewState } from '../components/preview-state'
import { QandaContext, type QandaActions, type QandaData } from '../components/qanda/data'
import { isISODate, todayIST } from '../lib/dates'
import { NO_AI_KEY } from '../lib/enrich'
import { canApply, type NoteRead, type Proposal } from '../lib/meetingNotes'
import { fieldsOf } from '../lib/pipeline'
import { cleanQuestion, cleanTheme, guessTheme, LIMITS, looksLikeQuestion, needsAnswer, noteLines, sameText, similarQuestions, type Question } from '../lib/qanda'
import { EMPTY_QANDA, fixtureQanda, PREVIEW_NOTES, type PreviewNotes, type QandaStore, type QRow } from './qandaFixture'

const live = (q: QRow | undefined): q is QRow => !!q && !q.removed && !q.mergedInto
const no = (data: string) => ({ data })

export function PreviewQanda({ fail, children }: { fail: boolean; children: ReactNode }) {
  const raise = useRaise()
  const { investors, loaded } = raise
  const preview = usePreviewState()
  const state = preview?.qanda
  const notesState: PreviewNotes = (PREVIEW_NOTES as readonly string[]).includes(preview?.notes ?? '') ? (preview!.notes as PreviewNotes) : 'default'
  const [store, setStore] = useState<QandaStore | null>(null)
  const cur = useRef<QandaStore>(EMPTY_QANDA)
  // Apply and Undo run later from clicks and toasts: read the latest investor writes through a ref.
  const d = useRef<RaiseData>(raise)
  const undos = useRef(new Map<string, () => Promise<void>>())
  useEffect(() => {
    d.current = raise
  })
  useEffect(() => {
    if (store || !loaded || !raise.ai.loaded) return
    const s = state === 'empty' || !investors.length ? EMPTY_QANDA : fixtureQanda(investors, todayIST(), Date.now(), notesState, raise.ai.connected, state === 'jev')
    cur.current = s
    setStore(s)
  }, [store, loaded, investors, state, notesState, raise.ai.loaded, raise.ai.connected])

  const value = useMemo<QandaData>(() => {
    const s = store ?? EMPTY_QANDA
    const people = new Set(investors.map((i) => i._id))
    const noteById = new Map(s.notes.map((n) => [n._id, n]))
    const questions: Question[] = s.questions.filter(live).map(({ removed: _r, mergedInto: _m, merge: _g, jevSame, ...q }) => {
      const same = jevSame && !jevSame.undone ? s.questions.find((o) => o._id === jevSame.id && live(o)) : undefined
      const asks = s.asks
        .filter((a) => a.questionId === q._id && people.has(a.investorId))
        .map(({ questionId: _q, ...a }) => {
          const n = a.noteId ? noteById.get(a.noteId) : undefined
          return { ...a, quote: n && a.noteLine !== undefined ? n.text.split('\n')[a.noteLine]?.trim() : undefined, label: n?.title }
        })
      return { ...q, askedCount: asks.length, asks, ...(same ? { sameAs: { id: same._id, text: same.text } } : {}) }
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
    const w = <A extends unknown[], R>(fn: (...a: A) => R) => async (...a: A): Promise<Awaited<R>> => {
      if (fail) {
        await new Promise((r) => setTimeout(r, 400))
        throw new Error('Preview: writes fail (&fail)')
      }
      return await fn(...a)
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
      addToDeck: w((id, deck) => {
        const q = get(id)
        if (q.onDeck) throw no('It’s already on a slide.')
        patchQ(id, { deckGap: { deck, at: Date.now() } })
        return deck
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

      /* ---------- PST-277 ---------- */
      readNote: w((noteId) => {
        if (!d.current.ai.connected) throw { data: { code: NO_AI_KEY, message: 'AI isn’t set up here.' } }
        const n = cur.current.notes.find((x) => x._id === noteId && !x.removed)
        if (!n) throw no('Those notes were deleted.')
        const _id = uid('pr')
        const reading: NoteRead = { _id, noteId, investorId: n.investorId, status: 'reading', summary: [], proposals: [], costUsd: 0, startedAt: Date.now() }
        set((x) => ({ ...x, reads: [...x.reads.filter((r) => r.noteId !== noteId), reading] }))
        // No Claude in preview: the question-like lines become the proposals, after a moment.
        setTimeout(() => {
          const lines = noteLines(n.text)
          const qs = lines.filter((l) => looksLikeQuestion(l.text)).map((l) => ({ text: cleanQuestion(l.text), quote: l.text }))
          const proposals: NoteRead['proposals'] = qs.length ? [{ id: 'questions', kind: 'questions', items: qs, state: 'open' }] : []
          set((x) => ({ ...x, reads: x.reads.map((r) => (r._id === _id ? { ...r, status: 'ready', summary: lines.slice(0, 3).map((l) => l.text), proposals, costUsd: 0.014, finishedAt: Date.now() } : r)) }))
        }, 1800)
        return _id
      }),
      applyRead: w(async (readId, ids) => {
        const r = cur.current.reads.find((x) => x._id === readId)
        const i = d.current.investors.find((x) => x._id === r?.investorId)
        if (!r || r.status !== 'ready' || !i) throw no('Those notes were already handled.')
        const take = r.proposals.filter((p) => p.state === 'open' && canApply(p) && ids.includes(p.id))
        const before = fieldsOf(i)
        const fields = { ...before }
        let rec: Awaited<ReturnType<RaiseData['move']>> | null = null
        const askIds: string[] = []
        for (const p of take as Proposal[]) {
          if (p.kind === 'next_step') Object.assign(fields, { nextStep: p.step, nextDate: p.date ?? null })
          else if (p.kind === 'expected' && !i.expected) fields.expected = p.amount
          else if (p.kind === 'warm_path') fields.notes = [fields.notes.trim(), 'Warm path: ' + p.text].filter(Boolean).join('\n')
          else if (p.kind === 'questions') {
            const n = cur.current.notes.find((x) => x._id === r.noteId)
            for (const q of p.items) {
              const id = (q.questionId && live(cur.current.questions.find((x) => x._id === q.questionId)) ? q.questionId : same(q.text)?._id) ?? addQ(cleanQuestion(q.text))
              const line = n ? noteLines(n.text).find((l) => l.text.toLowerCase().includes(q.quote.toLowerCase()))?.line : undefined
              const askId = uid('pa')
              askIds.push(askId)
              set((x) => ({ ...x, asks: [...x.asks, { _id: askId, questionId: id, investorId: i._id, date: n?.date ?? todayIST(), source: 'notes', noteId: r.noteId, noteLine: line }] }))
            }
          }
        }
        await d.current.save(i._id, fields)
        const stage = take.find((p) => p.kind === 'stage')
        if (stage?.kind === 'stage') rec = await d.current.move(i._id, stage.to)
        const decided = new Set(r.proposals.map((p) => p.id))
        set((x) => ({ ...x, reads: x.reads.map((y) => (y._id === readId ? { ...y, status: 'applied', proposals: y.proposals.map((p) => (decided.has(p.id) && p.state === 'open' ? { ...p, state: take.includes(p) ? 'applied' : 'dropped' } : p)) } : y)) }))
        undos.current.set(readId, async () => {
          if (rec) await d.current.undoMove(rec)
          await d.current.save(i._id, before)
          set((x) => ({ ...x, asks: x.asks.filter((a) => !askIds.includes(a._id)), reads: x.reads.map((y) => (y._id === readId ? r : y)) }))
        })
        return { applied: take.length }
      }),
      dismissRead: w((readId) => {
        const r = cur.current.reads.find((x) => x._id === readId)
        if (!r) return null
        set((x) => ({ ...x, reads: x.reads.map((y) => (y._id === readId ? { ...y, status: 'dismissed', proposals: y.proposals.map((p) => (p.state === 'open' ? { ...p, state: 'dropped' } : p)) } : y)) }))
        undos.current.set(readId, async () => set((x) => ({ ...x, reads: x.reads.map((y) => (y._id === readId ? r : y)) })))
        return readId
      }),
      undoRead: w(async (readId) => {
        await undos.current.get(readId)?.()
        undos.current.delete(readId)
      }),
      draftAnswer: w(async (questionId) => {
        if (!d.current.ai.connected) throw { data: { code: NO_AI_KEY, message: 'AI isn’t set up here.' } }
        await new Promise((res) => setTimeout(res, 900))
        const q = get(questionId)
        const like = similarQuestions({ _id: q._id, text: q.text }, questions.filter((x) => !needsAnswer(x)), 2)
        if (!like.length) throw no('Nothing to draft from yet: no past answers or notes for this one.')
        return { text: like.map((x) => x.bestAnswer).join(' '), costUsd: 0.0004, from: like.length }
      }),
      matchUnmatched: w((id, investorId) => {
        const u = cur.current.unmatched.find((x) => x._id === id)
        if (!u) throw no('Those notes were already handled.')
        const _id = uid('pn')
        set((x) => ({
          ...x,
          unmatched: x.unmatched.filter((y) => y._id !== id),
          notes: [...x.notes, { _id, investorId, date: u.date, text: u.text, title: u.meetingTitle, source: u.source, by: 'Wispr Flow', _creationTime: Date.now() }],
        }))
        return _id
      }),
      dropUnmatched: w((id) => {
        set((x) => ({ ...x, unmatched: x.unmatched.map((u) => (u._id === id ? { ...u, dropped: true } : u)) }))
        return id
      }),
      restoreUnmatched: w((id) => {
        set((x) => ({ ...x, unmatched: x.unmatched.map((u) => (u._id === id ? { ...u, dropped: false } : u)) }))
        return id
      }),
      // PST-292: "Not the same" on a question Jev marked, and its Undo.
      notSame: w((id) => {
        set((x) => ({ ...x, questions: x.questions.map((q) => (q._id === id && q.jevSame ? { ...q, jevSame: { ...q.jevSame, undone: true } } : q)) }))
        return null
      }),
      restoreSame: w((id) => {
        set((x) => ({ ...x, questions: x.questions.map((q) => (q._id === id && q.jevSame ? { ...q, jevSame: { id: q.jevSame.id } } : q)) }))
        return null
      }),
    }

    return {
      loaded: !!store,
      questions,
      noteCount: s.notes.filter((n) => !n.removed && people.has(n.investorId)).length,
      useNotes: (investorId) =>
        investorId ? s.notes.filter((n) => !n.removed && n.investorId === investorId).sort((a, b) => b.date.localeCompare(a.date) || (b._creationTime ?? 0) - (a._creationTime ?? 0)) : undefined,
      useReads: (investorId) => (investorId ? s.reads.filter((r) => r.investorId === investorId && s.notes.some((n) => n._id === r.noteId && !n.removed)) : undefined),
      unmatched: s.unmatched.filter((u) => !u.dropped),
      act,
    }
  }, [store, investors, fail])

  return <QandaContext.Provider value={value}>{children}</QandaContext.Provider>
}
