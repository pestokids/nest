// PST-281: shows the Q&A panels that are open (panels.ts), in the Raise layout so
// they sit over any view and over the drawer. Also opens one asked for from ⌘K
// (a question it found), and the ?preview states.
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useEffect } from 'react'
import { todayIST } from '../../lib/dates'
import { dayOf } from '../../lib/google'
import { earlierAnswers, unanswered } from '../../lib/qanda'
import { useRaise } from '../data'
import { usePreviewState } from '../preview-state'
import { AnswerPanel } from './AnswerPanel'
import { useQanda } from './data'
import { closeAllPanels, closePanel, openPanel, usePanels } from './panels'
import { PrepBrief } from './PrepBrief'
import { SameDialog } from './SameDialog'

declare module '@tanstack/react-router' {
  interface HistoryState {
    /** Open this question's Answer panel (a ⌘K result). */
    question?: string
  }
}

export function QandaHost() {
  const panels = usePanels()
  const { loaded, questions } = useQanda()
  const { google } = useRaise()
  const preview = usePreviewState()?.qanda

  useEffect(() => closeAllPanels, [])

  const navigate = useNavigate()
  const request = useRouterState({ select: (s) => s.location.state.question })
  useEffect(() => {
    if (!request || !loaded) return
    openPanel({ kind: 'answer', id: request })
    void navigate({ to: '.', search: true, hash: true, replace: true, state: (s) => ({ ...s, question: undefined }) })
  }, [request, loaded, navigate])

  // Preview: &qanda=answer|edit|new|same|prep opens that panel once the data is in.
  const meetings = google.meetings
  useEffect(() => {
    if (!preview || !loaded) return
    const fresh = unanswered(questions)
    if (preview === 'new') openPanel({ kind: 'new' })
    else if (preview === 'answer' && fresh.length) openPanel({ kind: 'answer', id: (fresh.find((q) => /safe/i.test(q.text)) ?? fresh[0])._id })
    else if (preview === 'same' && fresh.length) openPanel({ kind: 'same', id: (fresh.find((q) => /round/i.test(q.text)) ?? fresh[0])._id })
    else if (preview === 'edit') {
      const q = [...questions].sort((a, b) => earlierAnswers(b).length - earlierAnswers(a).length)[0]
      if (q) openPanel({ kind: 'answer', id: q._id })
    } else if (preview === 'prep') {
      const m = meetings.find((x) => x.investorIds.length && dayOf(x.start) === todayIST())
      if (m) openPanel({ kind: 'prep', meetingId: m._id })
    }
  }, [preview, loaded, meetings.length]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {panels.map((p, level) => {
        const close = () => closePanel(p)
        if (p.kind === 'same') return <SameDialog key={`same-${p.id}`} id={p.id} onClose={close} />
        if (p.kind === 'prep') return <PrepBrief key={`prep-${p.meetingId}`} meetingId={p.meetingId} level={level} onClose={close} />
        return <AnswerPanel key={p.kind === 'answer' ? `answer-${p.id}` : 'new'} req={p} level={level} onClose={close} />
      })}
    </>
  )
}
