import { useConvex } from 'convex/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { wobble } from '../../lib/motion'
import { NestOffline } from '../illustrations'

/** A dropped socket shorter than this is a blip, not "offline". */
const GRACE_MS = 2500

function useBrowserOnline() {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false)
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return online
}

/** False while Convex has lost its socket (after having had one) for longer than the grace period. */
function useConvexConnected(watch: boolean) {
  const convex = useConvex()
  const [connected, setConnected] = useState(true)
  useEffect(() => {
    if (!watch) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const check = (s: { isWebSocketConnected: boolean; hasEverConnected: boolean }) => {
      clearTimeout(timer)
      if (s.isWebSocketConnected || !s.hasEverConnected) setConnected(true)
      else timer = setTimeout(() => setConnected(false), GRACE_MS)
    }
    check(convex.connectionState())
    const off = convex.subscribeToConnectionState(check)
    return () => {
      clearTimeout(timer)
      off()
    }
  }, [convex, watch])
  return connected
}

/**
 * The "You're offline" banner (system/offline.png), under the top bar. Shows when
 * the browser goes offline or Convex loses its connection, hides when it's back.
 * `watchConvex` is off in ?preview (no live data there); `force` pins it for screenshots.
 */
export function OfflineBanner({ watchConvex, force }: { watchConvex: boolean; force?: boolean }) {
  const online = useBrowserOnline()
  const convexUp = useConvexConnected(watchConvex)
  const offline = force || !online || !convexUp
  const illo = useRef<HTMLSpanElement>(null)
  const retry = useCallback(() => {
    // Nudge the browser and the socket; the banner hides by itself once either is back.
    wobble(illo.current)
    if (typeof navigator !== 'undefined' && navigator.onLine && !force) window.dispatchEvent(new Event('online'))
  }, [force])
  if (!offline) return null
  return (
    <div className="sys-offline" role="status">
      <div className="page sys-offline__inner">
        <span className="sys-offline__illo" ref={illo}>
          <NestOffline size={44} />
        </span>
        <p className="sys-offline__msg">You’re offline. Changes stay on this device and sync when you’re back.</p>
        <button type="button" className="sys-offline__retry" onClick={retry}>
          Try again
        </button>
      </div>
    </div>
  )
}
