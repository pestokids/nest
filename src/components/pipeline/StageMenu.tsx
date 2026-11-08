// PST-302: move an investor to any stage, backward or forward, in one move (the
// drawer's stage chip and the board card's menu). One move logs one activity.
import type { Investor } from '../../lib/pipeline'
import { ALL, STAGE_TILE, type Stage } from '../../lib/stages'
import { Menu } from '../system/Menu'

export function StageMenu({ inv, anchor, onPick, onClose }: { inv: Pick<Investor, 'name' | 'stage'>; anchor: HTMLElement | null; onPick: (to: Stage) => void; onClose: () => void }) {
  return (
    <Menu
      anchor={anchor}
      title={'Move ' + inv.name + ' to'}
      align="start"
      onClose={onClose}
      items={ALL.map((s) => ({ label: STAGE_TILE[s.k], checked: inv.stage === s.k, onSelect: () => (inv.stage === s.k ? undefined : onPick(s.k)) }))}
    />
  )
}
