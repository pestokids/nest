// Raise · Today (PST-297, round5/today-inbox.png): one Inbox built from every
// feature's rows, with the race, the round's numbers and today's meetings on the
// right (on a phone the race sits over the list and the rest follows it).
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { TodayMeetings, TodayStrangers } from '../../../components/GoogleToday'
import { Inbox } from '../../../components/inbox/Inbox'
import { RaceBanner, RaceCard, RoundCard, WhereNote } from '../../../components/inbox/Side'
import { UnmatchedNotes } from '../../../components/qanda/UnmatchedNotes'
import { Suggestions } from '../../../components/Suggestions'
import { todayIST } from '../../../lib/dates'

export const Route = createFileRoute('/_app/raise/today')({ component: Today })

function Today() {
  const [today] = useState(() => todayIST())
  return (
    <section className="inbox-page" aria-label="Today">
      <RaceBanner today={today} />
      <div className="inbox-page__main">
        <Inbox />
        <TodayStrangers />
        <UnmatchedNotes />
      </div>
      <aside className="inbox-page__side" aria-label="The race, the round and today’s meetings">
        <RaceCard />
        <RoundCard today={today} />
        <TodayMeetings today={today} />
        <WhereNote />
      </aside>
      <Suggestions today={today} />
    </section>
  )
}
