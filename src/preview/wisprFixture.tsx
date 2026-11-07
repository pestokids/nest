// DEV ONLY: Settings' Wispr Flow card for ?preview (PST-285). &wispr=off (not
// connected), connected (last fetched 2 h ago, 3 notes), reconnect (needs
// reconnecting), fetching ("Fetch past 30 days" running). Writes stay in memory:
// Connect connects, Fetch past 30 days runs for a moment and brings in 2 more,
// Disconnect goes back to off. &fail makes every write fail. The URL is a
// placeholder, never a real one.
import { useMemo, useState, type ReactNode } from 'react'
import { WisprContext, type WisprSource } from '../components/settings/WisprCard'
import type { WisprCardData, WisprPreview } from '../lib/wispr'

const H = 36e5
const URL_PLACEHOLDER = 'https://mcp.example.com/connect/mcp'

export function wisprFixture(state: WisprPreview, now: number): WisprCardData {
  if (state === 'off') return { status: 'off', fetching: false, reads: true }
  return {
    status: state === 'reconnect' ? 'reconnect' : 'connected',
    url: URL_PLACEHOLDER,
    host: new URL(URL_PLACEHOLDER).host,
    lastFetch: { at: now - 2 * H, count: 3 },
    lastCheckAt: now - 6 * 6e4,
    fetching: state === 'fetching',
    reads: true,
  }
}

export function PreviewWispr({ state, fail, children }: { state: WisprPreview; fail: boolean; children: ReactNode }) {
  const [data, setData] = useState<WisprCardData>(() => wisprFixture(state, Date.now()))
  const value = useMemo<WisprSource>(() => {
    const write = async (fn: () => void) => {
      await new Promise((r) => setTimeout(r, 350))
      if (fail) throw new Error('Couldn’t save. Check your connection.')
      fn()
    }
    return {
      data,
      connect: async () => {
        await write(() => setData(wisprFixture('connected', Date.now())))
        return null
      },
      fetchPast: () =>
        write(() => {
          setData((d) => ({ ...d, fetching: true }))
          setTimeout(() => setData((d) => ({ ...d, fetching: false, lastFetch: { at: Date.now(), count: 2 }, lastCheckAt: Date.now() })), 2500)
        }),
      disconnect: () => write(() => setData(wisprFixture('off', Date.now()))),
    }
  }, [data, fail])
  return <WisprContext.Provider value={value}>{children}</WisprContext.Provider>
}
