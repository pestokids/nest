// DEV ONLY (PST-298): ?preview&moment=<name> plays one interaction from
// round5/interactions-batch-1.png a moment after load, through the same code a
// click or a key runs, so it can be seen and screenshotted (sounds stay silent:
// nobody has clicked yet). Every firm and person is from the preview fixtures.
//   inbox-done     /raise/today?preview&today=inbox: E on the first row (the tick pops, the row folds up, the count ticks down)
//   inbox-move     the same, J and J again: the focus ring glides to the next row
//   inbox-snooze   the same, S on the first row: it slides away, "Back tomorrow at 09:00 · Undo"
//   race-move      /raise/pipeline?preview&pipeline=race: Lantern moves on to Partner, its marker glides forward
//   race-ahead     the same, Lantern moves on twice and gets a stage ahead: the slow-down note rises in under its lane
//   race-offer     the same, Orchard's offer is in (as from a sync, no cheer), then you move Lantern to Verbal: lime, one confetti burst
//   race-lead      the same, Orchard agrees to lead: the lead card flips to forest and the egg cracks
//   maybe-no       the same, Saltmarsh Angels marked as no: the row greys and folds away, Passed, but warm ticks up
//   intro-step     /raise/investors?preview&introducer=panel: tick Intro on Ankur's intro to Quill; the step after it pulses lime
//   intro-thanked  the same, Thank Ankur for the Lantern intro: "Ankur thanked · report back after Lantern decides"
import { useEffect, useRef } from 'react'
import { useRaise } from '../components/data'
import { useDecide } from '../components/decisions/data'
import { useMoveCard } from '../components/pipeline/useMoveCard'
import { useRace } from '../components/race/data'
import type { Stage } from '../lib/stages'

export const PREVIEW_MOMENTS = ['inbox-done', 'inbox-move', 'inbox-snooze', 'race-move', 'race-ahead', 'race-offer', 'race-lead', 'maybe-no', 'intro-step', 'intro-thanked'] as const
export type PreviewMoment = (typeof PREVIEW_MOMENTS)[number]

const key = (k: string) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
const click = (intro: string, selector: string) =>
  [...document.querySelectorAll('.intro-panel__intro')].find((el) => el.textContent?.includes(intro))?.querySelectorAll<HTMLElement>(selector)
const ROUTINE: Record<PreviewMoment, number[]> = {
  'inbox-done': [400], 'inbox-move': [300, 520], 'inbox-snooze': [400], 'race-move': [400], 'race-ahead': [300, 560], 'race-offer': [0, 450],
  'race-lead': [400], 'maybe-no': [400], 'intro-step': [400], 'intro-thanked': [400],
}

export function Moments({ moment }: { moment: PreviewMoment }) {
  const d = useRaise()
  const race = useRace()
  const decide = useDecide()
  const moveCard = useMoveCard()
  const ready = d.loaded && race.loaded
  const investors = useRef(d.investors)
  useEffect(() => {
    investors.current = d.investors
  })
  useEffect(() => {
    if (!ready) return
    const firm = (name: string) => investors.current.find((i) => i.name === name)
    const own = (name: string, to: Stage) => {
      const i = firm(name)
      if (i) moveCard(i, to)
    }
    const steps: (() => void)[] = {
      'inbox-done': [() => key('e')],
      'inbox-move': [() => key('j'), () => key('j')],
      'inbox-snooze': [() => key('s')],
      'race-move': [() => own('Lantern Ventures', 'm2')],
      'race-ahead': [() => own('Lantern Ventures', 'm2'), () => own('Lantern Ventures', 'dd')],
      'race-offer': [
        () => {
          const o = firm('Orchard Capital')
          const l = firm('Lantern Ventures')
          if (o) void d.move(o._id, 'verbal')
          if (l) void d.move(l._id, 'dd')
        },
        () => own('Lantern Ventures', 'verbal'),
      ],
      'race-lead': [() => void race.setLead(firm('Orchard Capital')?._id ?? null)],
      'maybe-no': [
        () => {
          const i = firm('Saltmarsh Angels')
          if (i) decide.status(i, 'no')
        },
      ],
      'intro-step': [() => click('Quill Capital', '.isteps__btn')?.[3]?.click()],
      'intro-thanked': [() => click('Lantern Ventures', '.intro-panel__act')?.[0]?.click()],
    }[moment]
    const timers = steps.map((step, k) => setTimeout(step, ROUTINE[moment][k]))
    return () => timers.forEach(clearTimeout)
  }, [ready]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}
