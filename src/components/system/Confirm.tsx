import { useState, type ReactNode } from 'react'
import { Button } from '../ui'
import { Modal, useTitleId } from './Modal'

/** "Delete 2 investors?" with the safe choice focused first. */
export function Confirm({ title, body, confirm, keep = 'Cancel', onConfirm, onClose }: { title: string; body: ReactNode; confirm: string; keep?: string; onConfirm: () => Promise<unknown> | void; onClose: () => void }) {
  const id = useTitleId()
  const [busy, setBusy] = useState(false)
  return (
    <Modal onClose={onClose} labelledBy={id} className="sys-confirm" initialFocus=".sys-confirm__actions .btn">
      <h2 className="sys-confirm__title" id={id}>
        {title}
      </h2>
      <p className="sys-confirm__body">{body}</p>
      <div className="sys-confirm__actions">
        <Button variant="secondary" onClick={onClose} autoFocus>
          {keep}
        </Button>
        <Button
          variant="orange"
          loading={busy}
          loadingLabel="Deleting…"
          onClick={async () => {
            setBusy(true)
            await onConfirm()
            setBusy(false)
            onClose()
          }}
        >
          {confirm}
        </Button>
      </div>
    </Modal>
  )
}
