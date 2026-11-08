// DEV ONLY: made-up drafts for ?preview&drafts=<state> (PST-278). Claude and
// Resend are faked: "generating" waits a moment and returns the text below.
// Every name, address and link is invented.
//   followup  the Draft dialog on Kite Angels' follow-up (screens/raise-ai/draft-follow-up.png)
//   intro     an intro ask to the warm path (Lantern Ventures, through Ankur)
//   blurb     an intro ask with no warm path in Gmail or Calendar: To is empty, a forwardable blurb
//   nudge     a nudge (as from Today › Gone quiet)          thanks    a thank-you with the data room
//   dataroom  sharing the data room                         writing   still writing (the shimmer)
//   nokey     "AI isn't set up here" (no ANTHROPIC_API_KEY): write it yourself, Copy and Send still work
//   noemail   Send hidden (no RESEND_API_KEY)              copied    after Copy, with "I sent it"
//   failed    Claude failed (Try again)                    history   the drawer's History with the last drafts
//   lead      PST-295: "Ask if they'll lead" (Orchard Capital)
import { DECK_LINK, type AiDraftType, type Draft, type DraftType, type Known, type Tweak } from '../lib/drafts'
import type { Investor } from '../lib/pipeline'
import { todayIST } from '../lib/dates' // PST-293
import { dayMonth } from '../lib/home'
import { addDays } from '../lib/today'

export const PREVIEW_DRAFTS = ['followup', 'intro', 'blurb', 'nudge', 'thanks', 'dataroom', 'writing', 'nokey', 'noemail', 'copied', 'failed', 'history', 'lead'] as const
export type PreviewDrafts = (typeof PREVIEW_DRAFTS)[number]

/** People Dev has met or emailed, so warm paths named "Ankur" and "Ria" resolve (Mira's doesn't). */
export const PREVIEW_KNOWN: Known[] = [
  { email: 'ankur.mehra@larkspur.example.com', name: 'Ankur Mehra', at: Date.parse('2026-10-28T10:00:00Z') },
  { email: 'ria.sen@quietwater.example.com', name: 'Ria Sen', at: Date.parse('2026-10-21T10:00:00Z') },
]

/** Who each preview state opens the dialog on, and as what. */
export function previewOpen(state: PreviewDrafts, investors: readonly Investor[]): { investorId: string; type: DraftType } | null {
  const by = (name: string) => investors.find((i) => i.name === name)?._id
  const pick = (name: string, type: DraftType) => {
    const investorId = by(name) ?? investors[0]?._id
    return investorId ? { investorId, type } : null
  }
  switch (state) {
    case 'history': return null
    case 'intro': return pick('Lantern Ventures', 'intro')
    case 'blurb': return pick('Fernhill Fund', 'intro')
    case 'nudge': return pick('Saltmarsh Angels', 'nudge')
    case 'thanks': return pick('Orchard Capital', 'thanks')
    case 'dataroom': return pick('Orchard Capital', 'dataroom')
    case 'lead': return pick('Orchard Capital', 'lead')
    default: return pick('Kite Angels', 'followup')
  }
}

const HI: Record<string, string> = { 'Kite Angels': 'Sam', 'Orchard Capital': 'Leela', 'Saltmarsh Angels': 'Omar', 'Lantern Ventures': 'Priya' }
const fit = (i: Investor) => [
  'Why it’s a fit: ' + i.name + ' backs ' + (i.type === 'Angel' ? 'consumer and kids founders' : 'consumer and kids companies at pre-seed') + ', and Pesto is a kids and family company.',
  'They write early checks of about [__], which fits the round.',
]

function base(type: AiDraftType, i: Investor, deck: string, dataRoom: string): { subject: string; paras: string[] } {
  const hi = 'Hi ' + (HI[i.name] ?? 'there') + ','
  switch (type) {
    case 'followup':
      return {
        subject: 'Pesto · week-8 retention, as promised',
        paras: [
          hi,
          'Thanks again for Friday. As promised, here’s week-8 retention: [__]% of the families who started in September are still playing weekly, up from [__]% at week 4.',
          'On your safety question: every story is written and reviewed by our content team before it ships; nothing is generated live for a child.',
          'Here’s the updated deck: ' + deck,
          'Happy to walk you through it this week.',
          'Dev',
        ],
      }
    case 'nudge':
      return { subject: 'Pesto · a quick one', paras: [hi, 'Quick one: is there anything I can send that would help you decide on Pesto?', 'Happy to do a short call this week if that’s easier.', 'Dev'] }
    case 'thanks':
      return {
        subject: 'Thank you, and the data room',
        paras: [hi, 'Thank you for the yes. It means a lot this early.', 'Here’s the data room for the paperwork side: ' + dataRoom, 'Shall I send the SAFE over for [__] this week?', 'Dev'],
      }
    case 'lead':
      return {
        subject: 'Pesto · would you lead?',
        paras: [hi, 'Thanks for the partner meeting. The questions on retention and safety were the right ones.', 'You know consumer and kids at pre-seed better than anyone we’ve met, which is why I’m asking first: would you lead the round, at [__]?', 'If it helps, tell me what you’d need to see to decide, and I’ll get it to you this week.', 'Dev'],
      }
    case 'dataroom':
      return { subject: 'Pesto · data room', paras: [hi, 'Here’s our data room: ' + dataRoom, 'Everything we’ve shared so far is in one place.', 'What would you like to see first?', 'Dev'] }
    // PST-293: "Ask for a yes or no"
    case 'decision':
      return {
        subject: 'Pesto · a yes or a no?',
        paras: [hi, 'Thanks for the time you’ve given Pesto so far.', 'Could you let me know by ' + dayMonth(addDays(todayIST(), 5)) + ' whether you’re in? A no is completely fine and helps me plan the round.', 'Dev'],
      }
    case 'forwardable':
    case 'intro': {
      const warm = /ankur/i.test(i.path) ? 'Ankur' : /ria/i.test(i.path) ? 'Ria' : null
      return warm
        ? {
            subject: 'Intro to ' + i.name + '?',
            paras: ['Hi ' + warm + ',', 'Would you be up for introducing me to ' + i.name + '? We’re raising Pesto’s pre-seed and they look like a strong fit.', fit(i).join('\n'), 'Happy to send a short note you can forward as it is.', 'Thanks,\nDev'],
          }
        : {
            subject: 'Pesto × ' + i.name,
            paras: ['Hi,', 'I’m Dev, a founder of Pesto, a kids and family company raising a pre-seed round. I’d love an intro to ' + i.name + '.', fit(i).join('\n'), 'Could you pass this on?', 'Thanks,\nDev'],
          }
    }
  }
}

/** The preview's "Claude": fixed text per type, changed by a tweak the way Claude would. */
export function previewDraftText(o: { type: AiDraftType; investor: Investor; tweak?: Tweak; current?: { subject: string; body: string }; deck: string; dataRoom: string }) {
  const b = base(o.type, o.investor, o.deck, o.dataRoom)
  let paras = o.current?.body.trim() ? o.current.body.trim().split(/\n{2,}/) : b.paras
  const subject = o.current?.subject.trim() || b.subject
  const [hi, ...rest] = paras
  const sign = rest.pop() ?? 'Dev'
  if (o.tweak === 'shorter') paras = [hi, ...rest.filter((p) => !/safety|everything we’ve/i.test(p)).slice(-2), sign]
  else if (o.tweak === 'warmer') paras = [hi, ...(rest[0]?.startsWith('Really') ? [] : ['Really enjoyed talking with you.']), ...rest, sign]
  else if (o.tweak === 'direct') paras = [hi, ...rest.slice(-1), ...rest.slice(0, -1), sign]
  else if (o.tweak === 'deck' && !rest.some((p) => p.includes(o.deck) || p.includes(DECK_LINK))) paras = [hi, ...rest.slice(0, -1), 'Here’s the latest deck: ' + o.deck, ...rest.slice(-1), sign]
  return { subject, body: paras.join('\n\n') }
}

/** A few earlier drafts for Kite Angels, for the drawer's History. */
export function previewHistory(investors: readonly Investor[], now: number): Draft[] {
  const kite = investors.find((i) => i.name === 'Kite Angels')
  if (!kite) return []
  const D = 864e5
  return [
    {
      _id: 'pdh1', investorId: kite._id, type: 'followup', status: 'sent', via: 'nest', costUsd: 0.012, createdAt: now - 4 * D, sentAt: now - 4 * D + 6e5, to: 'sam@kite.example.com',
      subject: 'Pesto: notes from Friday', body: 'Hi Sam,\n\nThanks for the time on Friday. The parent angle you asked about: parents pay, kids play.\n\nCould we find 30 minutes next week for the numbers?\n\nDev',
    },
    {
      _id: 'pdh2', investorId: kite._id, type: 'intro', status: 'copied', via: 'whatsapp', costUsd: 0.009, createdAt: now - 12 * D,
      subject: 'Intro to Kite Angels?', body: 'Hi Ankur,\n\nWould you be up for introducing me to Kite Angels?\n\nThanks,\nDev',
    },
  ]
}
