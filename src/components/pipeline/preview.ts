// `?preview&pipeline=hidden|shown|end[&stage=<key>]`: open the board in one of its
// designed states for screenshots. Dev and preview builds only; null in production.
import { isBoardStage, type BoardStage } from '../../lib/board'

export type BoardPreview = { state: 'hidden' | 'shown' | 'end'; stage: BoardStage | null }

const ON = import.meta.env.DEV || import.meta.env.VITE_PREVIEW_MODE === '1'

export function boardPreview(): BoardPreview | null {
  if (!ON || typeof location === 'undefined') return null
  const q = new URLSearchParams(location.search)
  const state = q.get('pipeline')
  if (state !== 'hidden' && state !== 'shown' && state !== 'end') return null
  const stage = q.get('stage')
  return { state, stage: isBoardStage(stage) ? stage : null }
}
