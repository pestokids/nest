// DEV ONLY: Send feedback for ?preview (PST-289). &feedback=open (the dialog with
// an idea typed), sent (the "Sent as PST-301" toast), unsent (saved, not sent:
// the toast, and Settings › Feedback with rows waiting and no Linear key).
// Writes stay in memory; &fail makes them fail. Text and links are made up.
import { useMemo, useState, type ReactNode } from 'react'
import { FeedbackContext, type FeedbackSource } from '../components/system/Feedback'
import { feedbackTitle, type FeedbackList, type FeedbackResult, type FeedbackRow } from '../lib/feedback'

export const PREVIEW_FEEDBACK = ['open', 'sent', 'unsent'] as const
export type PreviewFeedback = (typeof PREVIEW_FEEDBACK)[number]

const H = 36e5
const issue = (n: number) => ({ identifier: `PST-${n}`, url: `https://linear.app/example/issue/PST-${n}` })

function rows(state: PreviewFeedback | null, now: number): FeedbackRow[] {
  const sent: FeedbackRow[] = [
    { _id: 'fb3', type: 'bug', title: 'The board jumps when a card drops into Diligence', path: '/raise/pipeline', status: 'sent', issue: issue(298), createdAt: now - 26 * H, by: 'Dev' },
    { _id: 'fb4', type: 'slow', title: 'Investors takes a second to filter with 200 names', path: '/raise/investors', status: 'sent', issue: issue(296), createdAt: now - 3 * 24 * H, by: 'Dev' },
  ]
  if (state !== 'unsent') return sent
  return [
    { _id: 'fb1', type: 'idea', title: 'Show who hasn’t booked yet in kickoff week', path: '/raise/pipeline', status: 'unsent', createdAt: now - 2 * H, by: 'Dev' },
    { _id: 'fb2', type: 'confusing', title: 'Not sure what “weighted” means on Plan', path: '/raise/plan', status: 'unsent', createdAt: now - 20 * H, by: 'Dev' },
    ...sent,
  ]
}

export function PreviewFeedback({ state, fail, children }: { state: PreviewFeedback | null; fail: boolean; children: ReactNode }) {
  const [list, setList] = useState<FeedbackList>(() => ({ linear: state !== 'unsent', rows: rows(state, Date.now()) }))
  const [n, setN] = useState(301)
  const [preview] = useState<FeedbackSource['preview']>(() =>
    state === 'open'
      ? { open: { type: 'idea', text: 'Pipeline should also show the firms I haven’t booked yet, so I can see who’s missing from kickoff week.' } }
      : state === 'sent'
        ? { result: { status: 'sent', ...issue(301) } }
        : state === 'unsent'
          ? { result: { status: 'unsent', reason: 'nokey' } }
          : undefined,
  )
  const value = useMemo<FeedbackSource>(() => {
    const result = (id: string): FeedbackResult => {
      if (!list.linear) return { status: 'unsent', reason: 'nokey' }
      setN((x) => x + 1)
      setList((l) => ({ ...l, rows: l.rows.map((r) => (r._id === id ? { ...r, status: 'sent', issue: issue(n) } : r)) }))
      return { status: 'sent', ...issue(n) }
    }
    const wait = async () => {
      await new Promise((r) => setTimeout(r, 700))
      if (fail) throw new Error('preview')
    }
    return {
      list,
      send: async (f) => {
        await wait()
        const id = 'fb' + Date.now()
        setList((l) => ({ ...l, rows: [{ _id: id, type: f.type, title: feedbackTitle(f.text), path: f.path, status: 'unsent', createdAt: Date.now(), by: 'Dev' }, ...l.rows] }))
        return result(id)
      },
      sendNow: async (id) => {
        await wait()
        return result(id)
      },
      preview,
    }
  }, [list, n, fail, preview])
  return <FeedbackContext.Provider value={value}>{children}</FeedbackContext.Provider>
}
