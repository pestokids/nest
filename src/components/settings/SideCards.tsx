import { groupLog, logTime, type LogEntry } from '../../lib/changeLog'
import type { Member } from '../data'
import { Avatar, Chip } from '../ui'

/** Who can get in: the access list (changed in the server settings, not here). */
export function MembersCard({ members }: { members: Member[] | undefined }) {
  return (
    <section className="set-card set-members" aria-labelledby="set-members-title">
      <h2 id="set-members-title">Who can get in</h2>
      <p className="set-card__lede">Google accounts on the access list. Changed in the server settings, not here.</p>
      <ul className="set-members__list">
        {members === undefined ? (
          <li className="set-members__loading">
            <span className="sk" style={{ width: 40, height: 40, borderRadius: 20 }} />
            <span className="sk" style={{ width: 160, height: 12, borderRadius: 6 }} />
          </li>
        ) : (
          members.map((m) => (
            <li key={m.email}>
              <Avatar name={m.name} size={40} className={m.me ? '' : 'avatar--soft'} />
              <span className="set-members__who">
                <strong>{m.name}</strong>
                <span>{m.email}</span>
              </span>
              {m.me ? (
                <Chip tone="outline" dot={false}>
                  You
                </Chip>
              ) : null}
            </li>
          ))
        )}
      </ul>
    </section>
  )
}

/** Change log: who changed what, as sentences, kept forever. */
export function ChangeLog({ rows }: { rows: LogEntry[] | undefined }) {
  const events = rows ? groupLog(rows).slice(0, 30) : undefined
  return (
    <section className="set-card set-log" aria-labelledby="set-log-title">
      <h2 id="set-log-title">Change log</h2>
      <p className="set-card__lede">Who changed what. Kept forever.</p>
      {events === undefined ? null : events.length ? (
        <ol className="set-log__list">
          {events.map((e) => (
            <li key={e.id}>
              <time className="set-log__when" dateTime={new Date(e.at).toISOString()}>
                {logTime(e.at)}
              </time>
              <Avatar name={e.by} size={28} className="set-log__avatar" title={e.by} />
              <div className="set-log__what">
                <p>
                  <span className="sr-only">{e.by}: </span>
                  {e.lines[0]}
                </p>
                {e.lines.length > 1 ? (
                  <details>
                    <summary>and {e.lines.length - 1} more change{e.lines.length === 2 ? '' : 's'}</summary>
                    <ul>
                      {e.lines.slice(1).map((l, i) => (
                        <li key={i}>{l}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="set-log__empty">No changes yet. The first save starts the log.</p>
      )}
    </section>
  )
}
