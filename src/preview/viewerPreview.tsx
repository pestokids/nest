// DEV ONLY: the public viewer with made-up answers (/d/preview?preview&viewer=…).
//   gate      asks for an email first, then shows the made-up deck watermarked
//   open      the deck (default)
//   download  the deck with Download PDF
//   link      a link version (a made-up address, so it shows the Open button)
//   expired   "This link has expired"
import { useMemo } from 'react'
import { Viewer, type ViewerApi, type ViewerDoc } from '../components/viewer/Viewer'
import { fakePdf } from './fakePdf'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function PreviewViewer({ state }: { state: string }) {
  const api = useMemo<ViewerApi>(() => {
    const doc: ViewerDoc = { title: 'Pitch deck', n: 4, pages: 14, kind: 'pdf', url: null, download: state === 'download', watermark: null, reply: 'dev@pestokids.com', from: 'Pesto' }
    let asked = false
    let url: string | null = null
    return {
      open: async (email) => {
        await wait(250)
        if (state === 'expired') return { state: 'expired' }
        if (state === 'gate' && (!asked || !email)) {
          asked = true
          return { state: 'email', invalid: false }
        }
        if (state === 'link') return { state: 'ok', sessionId: 'preview', doc: { ...doc, title: 'Investment memo', n: 2, pages: null, kind: 'link', url: 'https://example.com/made-up-memo' } }
        return { state: 'ok', sessionId: 'preview', doc: { ...doc, watermark: state === 'gate' ? email ?? null : null } }
      },
      beat: async () => 200,
      fileUrl: () => (url ??= URL.createObjectURL(fakePdf('Pitch deck', 14))),
    }
  }, [state])
  return <Viewer api={api} />
}
