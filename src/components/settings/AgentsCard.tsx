// Settings › Agents (PST-276, screens/raise-ai/settings-agents.png and
// settings-agent-key-created.png): the keys agents use to reach the Nest MCP
// server, with Activity and Revoke; making a key (shown once); and the side card
// on connecting Grok Bot. Keys never come back from Convex after they're made.
import { useEffect, useRef, useState } from 'react'
import { agentInitials, AGENTS_CAN, AGENTS_NEVER, callLabel, keyHint, keyMeta, NAME_MAX, nestSkill, SCOPE_LABEL, type AgentKeyRow, type AgentScope, type CreatedKey } from '../../lib/agents'
import { todayIST } from '../../lib/dates'
import { timeOf } from '../../lib/google'
import { dayLabel } from '../../lib/investorView'
import { useRaise } from '../data'
import { copyText } from '../materials/parts'
import { usePreviewState } from '../preview-state'
import { useUI } from '../raise-ui'
import { Confirm } from '../system/Confirm'
import { Modal, useTitleId } from '../system/Modal'
import { useSaveAction } from '../system/useSaveAction'
import { Button, Chip, Icon, Input, Segmented } from '../ui'

type Dialog = { kind: 'create' } | { kind: 'created'; key: CreatedKey } | { kind: 'activity'; key: AgentKeyRow } | { kind: 'revoke'; key: AgentKeyRow } | null

function useCopy() {
  const { toast } = useUI()
  return async (text: string, what: string) => {
    if (await copyText(text)) toast({ tone: 'info', icon: 'check', message: `Copied ${what}.` })
    else toast({ tone: 'error', message: 'Couldn’t copy. Select it and copy it yourself.' })
  }
}

export function AgentsCard() {
  const { agents, agentsDo } = useRaise()
  const { toast } = useUI()
  const save = useSaveAction()
  const preview = usePreviewState()?.agents
  const [dialog, setDialog] = useState<Dialog>(null)
  const now = Date.now()

  // ?preview&agents=create|created|activity|revoke opens that dialog once.
  const opened = useRef(false)
  useEffect(() => {
    if (opened.current || !agents.loaded || !preview) return
    opened.current = true
    const first = agents.keys[0]
    if (preview === 'create') setDialog({ kind: 'create' })
    else if (preview === 'created') void agentsDo.create('Grok Bot', 'suggest').then((key) => setDialog({ kind: 'created', key }))
    else if ((preview === 'activity' || preview === 'revoke') && first) setDialog({ kind: preview, key: first })
  }, [preview, agents.loaded, agents.keys, agentsDo])

  async function revoke(k: AgentKeyRow) {
    await save(() => agentsDo.revoke(k._id), {
      failMessage: `Couldn’t revoke ${k.name}’s key.`,
      onDone: () => toast({ tone: 'info', message: `Revoked. ${k.name} can’t use Nest any more.` }),
    })
  }

  return (
    <section className="set-card set-agents" aria-labelledby="set-agents-title" aria-busy={agents.loaded ? undefined : true}>
      <div className="enrich-eyebrow eyebrow-mono">
        <Icon name="spark" size={16} className="enrich-spark" />
        Agents
      </div>
      <h2 id="set-agents-title" className="set-agents__title">
        Agents that can use Nest
      </h2>
      <p className="set-card__lede">They read your pipeline and suggest changes. Everything they change waits in Suggestions for you.</p>
      {!agents.loaded ? (
        <span className="sk" style={{ display: 'block', width: '100%', height: 160, borderRadius: 14, marginTop: 20 }} />
      ) : agents.keys.length ? (
        <ul className="set-agents__list">
          {agents.keys.map((k) => (
            <li key={k._id} className="set-agents__row">
              <span className={'set-agents__avatar' + (k.scope === 'suggest' ? ' is-suggest' : '')} aria-hidden="true">
                {agentInitials(k.name)}
              </span>
              <div className="set-agents__who">
                <span className="set-agents__head">
                  <span className="set-agents__name">{k.name}</span>
                  <Chip tone={k.scope === 'suggest' ? 'success' : 'neutral'} dot={k.scope === 'suggest'}>
                    {SCOPE_LABEL[k.scope]}
                  </Chip>
                </span>
                <span className="set-agents__meta">{keyMeta(k, now, todayIST)}</span>
              </div>
              <div className="set-agents__actions">
                <button type="button" className="set-agents__link" onClick={() => setDialog({ kind: 'activity', key: k })} aria-label={`${k.name}: activity`}>
                  Activity
                </button>
                <button type="button" className="set-agents__link set-agents__link--danger" onClick={() => setDialog({ kind: 'revoke', key: k })} aria-label={`Revoke ${k.name}’s key`}>
                  Revoke
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="set-agents__empty">No agents yet. Give Grok Bot, Claude or Capy a key of its own, and you can revoke it any time.</p>
      )}
      <Button variant="primary" icon="plus" className="set-agents__add" onClick={() => setDialog({ kind: 'create' })}>
        Connect an agent
      </Button>

      {dialog?.kind === 'create' ? <CreateDialog onClose={() => setDialog(null)} onCreated={(key) => setDialog({ kind: 'created', key })} /> : null}
      {dialog?.kind === 'created' ? <CreatedDialog created={dialog.key} serverUrl={agents.serverUrl} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === 'activity' ? <ActivityDialog agent={dialog.key} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === 'revoke' ? (
        <Confirm
          title={`Revoke ${dialog.key.name}’s key?`}
          body={
            <>
              {dialog.key.name} stops reaching Nest straight away (key {keyHint(dialog.key.prefix)}). What it already suggested stays in Suggestions. To connect it again, make a new key.
            </>
          }
          confirm="Revoke"
          busyLabel="Revoking…"
          onConfirm={() => revoke(dialog.key)}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </section>
  )
}

/** "Connect an agent": a name and what it may do. */
function CreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (key: CreatedKey) => void }) {
  const { agentsDo } = useRaise()
  const save = useSaveAction()
  const titleId = useTitleId()
  const [name, setName] = useState('')
  const [scope, setScope] = useState<AgentScope>('suggest')
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const missing = !name.trim()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setTried(true)
    if (missing) return
    setBusy(true)
    const key = await save(() => agentsDo.create(name, scope), { failMessage: 'Couldn’t make the key.' })
    setBusy(false)
    if (key) onCreated(key)
  }

  return (
    <Modal onClose={onClose} labelledBy={titleId} className="set-agents-dialog">
      <form onSubmit={submit} noValidate>
        <p className="enrich-eyebrow eyebrow-mono">
          <Icon name="spark" size={16} className="enrich-spark" />
          New agent key
        </p>
        <h2 id={titleId} className="set-agents-dialog__title">
          Connect an agent
        </h2>
        <p className="set-agents-dialog__lede">Each agent gets its own key, so you can see what it does and revoke it on its own.</p>
        <Input
          label="Name"
          value={name}
          maxLength={NAME_MAX}
          placeholder="Grok Bot"
          autoFocus
          onChange={(e) => setName(e.target.value)}
          error={tried && missing ? 'Give the agent a name.' : undefined}
          help="Shown on each suggestion it makes: “From Grok Bot”."
        />
        <p className="field__label set-agents-dialog__label" id={titleId + '-access'}>
          Access
        </p>
        <Segmented
          label="Access"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'read', label: SCOPE_LABEL.read },
            { value: 'suggest', label: SCOPE_LABEL.suggest },
          ]}
        />
        <p className="field__help set-agents-dialog__help">
          {scope === 'read' ? 'It can read investors, today’s moves and the Q&A bank.' : 'It can also log touches, add investors and suggest changes. Each one waits in Suggestions until you accept it.'}
        </p>
        <div className="set-agents-dialog__foot">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" loading={busy} loadingLabel="Making the key…">
            Create key
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/** The key, shown this once, with the server URL and access. */
function CreatedDialog({ created, serverUrl, onClose }: { created: CreatedKey; serverUrl: string; onClose: () => void }) {
  const titleId = useTitleId()
  const copy = useCopy()
  return (
    <Modal onClose={onClose} labelledBy={titleId} className="set-agents-dialog set-agents-dialog--created" initialFocus=".set-agents-key__copy">
      <p className="enrich-eyebrow eyebrow-mono">
        <Icon name="spark" size={16} className="enrich-spark" />
        New agent key
      </p>
      <h2 id={titleId} className="set-agents-dialog__title">
        {created.name} can now use Nest
      </h2>
      <p className="set-agents-dialog__lede">Copy the key now. It won’t be shown again; you can always revoke it and make a new one.</p>
      <div className="set-agents-key">
        <code className="set-agents-key__value">{created.key}</code>
        <button type="button" className="set-agents__link set-agents-key__copy" onClick={() => void copy(created.key, 'the key')}>
          Copy
        </button>
      </div>
      <dl className="set-agents-facts">
        <dt>Server</dt>
        <dd>{serverUrl}</dd>
        <dt>Access</dt>
        <dd>{SCOPE_LABEL[created.scope]}</dd>
        <dt>Expires</dt>
        <dd>Never (revoke any time)</dd>
      </dl>
      <div className="set-agents-dialog__foot set-agents-dialog__foot--split">
        <button type="button" className="set-agents__link" onClick={() => void copy(nestSkill(serverUrl), 'the Nest skill')}>
          Copy the Nest skill too
        </button>
        <Button variant="primary" onClick={onClose}>
          I’ve saved it
        </Button>
      </div>
    </Modal>
  )
}

function when(at: number, today: string) {
  const day = todayIST(at)
  return (day === today ? 'Today' : dayLabel(day, today)) + ' · ' + timeOf(at)
}

/** Activity: the key's last 50 calls. */
function ActivityDialog({ agent, onClose }: { agent: AgentKeyRow; onClose: () => void }) {
  const { useAgentActivity } = useRaise()
  const calls = useAgentActivity(agent._id)
  const titleId = useTitleId()
  const today = todayIST()
  return (
    <Modal onClose={onClose} labelledBy={titleId} className="set-agents-dialog set-agents-dialog--activity">
      <h2 id={titleId} className="set-agents-dialog__title">
        {agent.name} · Activity
      </h2>
      <p className="set-agents-dialog__lede">The last 50 calls. Nest logs which tool, when, and whether it worked; never what was asked or answered.</p>
      {!calls ? (
        <span className="sk" style={{ display: 'block', width: '100%', height: 120, borderRadius: 14 }} />
      ) : calls.length ? (
        <ul className="set-agents-calls">
          {calls.map((c) => (
            <li key={c._id}>
              <span className="set-agents-calls__when">{when(c.at, today)}</span>
              <span className="set-agents-calls__what">{callLabel(c.tool)}</span>
              {c.ok ? <span className="set-agents-calls__ms num">{c.ms} ms</span> : <Chip tone="error">Failed</Chip>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="set-agents__empty">No calls yet. They show here as soon as {agent.name} connects.</p>
      )}
      <div className="set-agents-dialog__foot">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  )
}

/** The side card: connecting Grok Bot in three steps, and what agents can and can't do. */
export function ConnectAgentCard() {
  const { agents } = useRaise()
  const copy = useCopy()
  const url = agents.serverUrl
  return (
    <section className="set-card set-connect" aria-labelledby="set-connect-title">
      <h2 id="set-connect-title">Connect Grok Bot</h2>
      <p className="set-card__lede">Grok Bot supports MCP servers. Three steps:</p>
      <ol className="set-connect__steps">
        <li>
          <span className="set-connect__n" aria-hidden="true">
            1
          </span>
          <div>
            <strong>Create a key here</strong>
            <span>Name it “Grok Bot”, pick “Can suggest changes”. It’s shown once.</span>
          </div>
        </li>
        <li>
          <span className="set-connect__n" aria-hidden="true">
            2
          </span>
          <div>
            <strong>Add Nest as an MCP server</strong>
            <span>In Grok Bot, add this server with the key as a Bearer token.</span>
            <div className="set-connect__copy">
              <code>{url || '…'}</code>
              <button type="button" className="set-agents__link" disabled={!url} onClick={() => void copy(url, 'the server URL')}>
                Copy
              </button>
            </div>
          </div>
        </li>
        <li>
          <span className="set-connect__n" aria-hidden="true">
            3
          </span>
          <div>
            <strong>Give it the Nest skill</strong>
            <span>Tells the bot to suggest, never edit, and to follow the stage rules.</span>
            <div className="set-connect__copy">
              <code>nest-skill.md</code>
              <button type="button" className="set-agents__link" onClick={() => void copy(nestSkill(url || undefined), 'the Nest skill')} aria-label="Copy the Nest skill">
                Copy
              </button>
            </div>
          </div>
        </li>
      </ol>
      <h3 className="set-sub set-connect__sub">Agents can</h3>
      <ul className="set-connect__can">
        {AGENTS_CAN.map((x) => (
          <li key={x}>
            <span className="set-ai-sees__tick" aria-hidden="true">
              <Icon name="check" size={14} strokeWidth={2.5} />
            </span>
            {x}
          </li>
        ))}
        <li className="is-never">
          <span className="set-connect__box" aria-hidden="true" />
          {AGENTS_NEVER}
        </li>
      </ul>
    </section>
  )
}
