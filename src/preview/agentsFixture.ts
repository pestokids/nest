// DEV ONLY: made-up agent keys and calls for ?preview (PST-276, Settings › Agents).
// &agents=empty (no keys), create (the new-key dialog), created (a key just made,
// shown once), activity (Grok Bot's last calls), revoke (the confirm). The key in
// "created" is a placeholder, never a real one.
import { useMemo, useState } from 'react'
import { PROD_MCP_URL, type AgentCall, type AgentKeyRow, type AgentScope, type CreatedKey } from '../lib/agents'
import type { AgentActions, AgentsData } from '../components/data'

export const PREVIEW_AGENTS = ['default', 'empty', 'create', 'created', 'activity', 'revoke'] as const
export type PreviewAgents = (typeof PREVIEW_AGENTS)[number]

const M = 6e4
const H = 60 * M
const PREVIEW_KEY = 'nest_ak_7HQ2pReviewOnlyNotARealKeyXXXXXXXXXXXXXX'

/** Grok Bot (can suggest, busy this week), Claude (read only, used yesterday), Capy (read only, never used). "created" starts without Grok Bot, which it then adds. */
function fixtureKeys(state: PreviewAgents, now: number): AgentKeyRow[] {
  if (state === 'empty') return []
  const keys: AgentKeyRow[] = [
    { _id: 'pa1', name: 'Grok Bot', scope: 'suggest', prefix: '7HQ2pRev', createdAt: now - 9 * 24 * H, lastUsedAt: now - 12 * M, calls7d: 41 },
    { _id: 'pa2', name: 'Claude', scope: 'read', prefix: 'Lk40aXcQ', createdAt: now - 6 * 24 * H, lastUsedAt: now - 26 * H, calls7d: 6 },
    { _id: 'pa3', name: 'Capy', scope: 'read', prefix: 'c9Tz1mWe', createdAt: now - 2 * 24 * H, calls7d: 0 },
  ]
  return state === 'created' ? keys.slice(1) : keys
}

function fixtureCalls(now: number): Record<string, AgentCall[]> {
  const row = (k: string, i: number, tool: string, ago: number, ms: number, ok = true): AgentCall => ({ _id: `${k}-${i}`, tool, at: now - ago, ok, ms })
  return {
    pa1: [
      row('pa1', 1, 'log_touch', 12 * M, 210),
      row('pa1', 2, 'get_investor', 13 * M, 160),
      row('pa1', 3, 'search_investors', 13 * M, 120),
      row('pa1', 4, 'suggest_change', 2 * H, 95, false),
      row('pa1', 5, 'todays_moves', 3 * H, 240),
      row('pa1', 6, 'tools/list', 3 * H, 40),
      row('pa1', 7, 'initialize', 3 * H, 35),
      row('pa1', 8, 'list_questions', 27 * H, 130),
      row('pa1', 9, 'add_investor', 28 * H, 180),
    ],
    pa2: [row('pa2', 1, 'todays_moves', 26 * H, 230), row('pa2', 2, 'tools/list', 26 * H, 38), row('pa2', 3, 'initialize', 26 * H, 31)],
  }
}

const failing = async (): Promise<never> => {
  await new Promise((r) => setTimeout(r, 400))
  throw new Error('Preview: writes fail (&fail)')
}

/** In-memory agents for ?preview: create and revoke change the list; nothing leaves the browser. */
export function useAgentsPreview(state: PreviewAgents, fail: boolean): { agents: AgentsData; agentsDo: AgentActions; useAgentActivity: (keyId: string | null) => AgentCall[] | undefined } {
  const [keys, setKeys] = useState(() => fixtureKeys(state, Date.now()))
  const [calls] = useState(() => fixtureCalls(Date.now()))
  const agentsDo = useMemo<AgentActions>(
    () => ({
      create: async (name: string, scope: AgentScope): Promise<CreatedKey> => {
        if (fail) return failing()
        const id = 'pa' + Date.now()
        const clean = name.trim().replace(/\s+/g, ' ')
        setKeys((ks) => [...ks, { _id: id, name: clean, scope, prefix: PREVIEW_KEY.slice(8, 16), createdAt: Date.now(), calls7d: 0 }])
        return { id, key: PREVIEW_KEY, name: clean, scope }
      },
      revoke: async (id: string) => {
        if (fail) return failing()
        setKeys((ks) => ks.filter((k) => k._id !== id))
      },
    }),
    [fail],
  )
  return useMemo(
    () => ({ agents: { loaded: true, serverUrl: PROD_MCP_URL, keys }, agentsDo, useAgentActivity: (keyId: string | null) => (keyId ? (calls[keyId] ?? []) : undefined) }),
    [keys, agentsDo, calls],
  )
}
