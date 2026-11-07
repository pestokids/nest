// PST-281: the Q&A writes that take something away (merge, delete, unlink, un-pick a
// line, delete notes, off the deck-gaps list) with an Undo toast, as Suggested
// fixes do. Sounds follow interactions-ai.png: one per click, none on Undo but
// the undo sound itself.
import { useMemo } from 'react'
import { NEXT_DECK, type Ask, type Note, type Question } from '../../lib/qanda'
import { play } from '../../lib/sound'
import { useUI } from '../raise-ui'
import { useSaveAction } from '../system/useSaveAction'
import { useQanda } from './data'
import { openPanel } from './panels'

const short = (s: string, n = 48) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)

export function useQandaActions() {
  const { act } = useQanda()
  const ui = useUI()
  const save = useSaveAction()
  return useMemo(() => {
    const undo = (fn: () => Promise<unknown>) => () => {
      play('undo')
      void save(fn, { failMessage: 'Couldn’t undo that.' })
    }
    return {
      /** "Same question": `drop` goes into `keep` with every ask. */
      merge: async (drop: Question, keep: Question) => {
        play('card-drop')
        const r = await save(() => act.merge(drop._id, keep._id), { failMessage: 'Couldn’t merge them.' })
        if (!r) return false
        ui.toast({ message: `Merged into “${short(keep.text)}”. All ${r.asked} asks kept.`, action: { label: 'Undo', onClick: undo(() => act.unmerge(drop._id)) } })
        return true
      },
      remove: async (q: Question) => {
        const r = await save(() => act.remove(q._id), { failMessage: 'Couldn’t delete it.' })
        if (r === undefined) return false
        ui.toast({ tone: 'info', icon: 'trash', message: `Deleted “${short(q.text)}”.`, action: { label: 'Undo', onClick: undo(() => act.restore(q._id)) } })
        return true
      },
      unlink: async (a: Ask, name: string) => {
        const back = await save(() => act.unlink(a._id), { failMessage: `Couldn’t unlink ${name}.` })
        if (!back) return
        ui.toast({ tone: 'info', message: `${name} no longer counts as asking it.`, action: { label: 'Undo', onClick: undo(() => act.link(back)) } })
      },
      addToDeck: async (q: Question) => {
        play('rule-check', { volume: 0.6 })
        const deck = await save(() => act.addToDeck(q._id), { failMessage: 'Couldn’t add it to the deck list.' })
        if (deck === undefined) return
        ui.toast({ message: `On the list for deck v${deck}.`, action: { label: 'Undo', onClick: undo(() => act.removeFromDeck(q._id)) } })
      },
      removeFromDeck: async (q: Question) => {
        const r = await save(() => act.removeFromDeck(q._id), { failMessage: 'Couldn’t take it off the list.' })
        if (r === undefined) return
        ui.toast({ tone: 'info', message: `Off the list for deck v${q.deckGap?.deck ?? NEXT_DECK}.`, action: { label: 'Undo', onClick: undo(() => act.addToDeck(q._id)) } })
      },
      markLine: async (n: Note, line: number, name: string) => {
        play('rule-check', { volume: 0.6 })
        const r = await save(() => act.markLine(n._id, line), { failMessage: 'Couldn’t add it to the bank.' })
        if (!r) return false
        ui.toast({
          message: r.created ? `In the Q&A bank as a question from ${name}.` : `Added ${name} to a question already in the bank.`,
          action: { label: 'Answer', onClick: () => openPanel({ kind: 'answer', id: r.questionId }) },
        })
        return true
      },
      unmarkLine: async (n: Note, line: number) => {
        const r = await save(() => act.unmarkLine(n._id, line), { failMessage: 'Couldn’t take it out.' })
        if (r === undefined) return
        ui.toast({ tone: 'info', message: 'Not a question any more.', action: { label: 'Undo', onClick: undo(() => act.markLine(n._id, line)) } })
      },
      removeNote: async (n: Note) => {
        const r = await save(() => act.removeNote(n._id), { failMessage: 'Couldn’t delete the notes.' })
        if (r === undefined) return
        ui.toast({ tone: 'info', icon: 'trash', message: 'Notes deleted. Their questions stay in the bank.', action: { label: 'Undo', onClick: undo(() => act.restoreNote(n._id)) } })
      },
    }
  }, [act, ui, save])
}
