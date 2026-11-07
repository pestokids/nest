import { exportCsv } from '../../lib/csv'
import { todayIST } from '../../lib/dates'
import type { Investor } from '../../lib/pipeline'
import { play } from '../../lib/sound'
import type { ToastInput } from '../ui'

/**
 * Download investors as CSV, with the `export` sound and the "Exported 40
 * investors to …" toast (raise-investors/exported.png). Open shows the file in
 * a new tab. `download: false` only draws the toast (?preview screenshots).
 */
export function exportInvestors(list: Investor[], toast: (t: ToastInput | string) => void, { download = true }: { download?: boolean } = {}) {
  const name = `nest-investors-${todayIST()}.csv`
  const url = URL.createObjectURL(new Blob([exportCsv(list)], { type: 'text/csv;charset=utf-8' }))
  if (download) {
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    play('export')
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000)
  toast({
    message: `Exported ${list.length} investor${list.length === 1 ? '' : 's'} to ${name}`,
    action: { label: 'Open', onClick: () => window.open(url, '_blank', 'noopener') },
  })
}
