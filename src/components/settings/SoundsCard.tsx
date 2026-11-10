// PST-304: Settings › Sounds. The on/off switch (the same preference as the avatar menu), one
// Preview button per kind of sound in the kit, and the kit's credit.
import { useEffect, useRef } from 'react'
import { KIT, PREVIEW, preview } from '../../lib/sound'
import { usePreviewState } from '../preview-state'
import { useSounds } from '../session'
import { Button, Toggle } from '../ui'

export function SoundsCard() {
  const sounds = useSounds()
  const flags = usePreviewState()
  const box = useRef<HTMLElement>(null)
  useEffect(() => {
    if (flags?.settings === 'sounds') box.current?.scrollIntoView({ block: 'start' })
  }, [flags?.settings])

  return (
    <section className="set-card set-sounds" id="set-sounds" aria-labelledby="set-sounds-title" ref={box}>
      <div className="set-card__head">
        <h2 id="set-sounds-title">Sounds</h2>
        <Toggle label={sounds.on ? 'On' : 'Off'} checked={sounds.on} onChange={(e) => sounds.set(e.target.checked)} />
      </div>
      <p className="set-card__lede">A short sound when you change something, and a warning when Nest can’t do what you tried. Never on hover or page load, and silent while the tab is hidden.</p>
      <div className="set-sounds__preview" role="group" aria-labelledby="set-sounds-preview">
        <span className="set-sounds__label" id="set-sounds-preview">
          Preview sounds
        </span>
        <div className="set-sounds__kinds">
          {PREVIEW.map((p) => (
            <Button key={p.kind} size="sm" variant="secondary" disabled={!sounds.on} onClick={() => preview(p.kind)}>
              {p.label}
            </Button>
          ))}
        </div>
        {sounds.on ? null : <span className="set-sounds__hint">Turn Sounds on to hear them.</span>}
      </div>
      <p className="set-sounds__credit">
        Sounds: {KIT.name} by {KIT.designer}, from{' '}
        <a href={KIT.url} target="_blank" rel="noopener noreferrer">
          SND
        </a>
        . Free to use; copyright stays with the designer.
      </p>
    </section>
  )
}
