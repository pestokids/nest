import { createContext, useContext } from 'react'
import type { PreviewRace } from '../preview/raceFixture'

// DEV/preview only: which state `?preview` should show (Today, the drawer, and the
// Investors / Plan / Settings / system states). Null outside preview.
export const PREVIEW_TODAY = ['default', 'nothingdue', 'win'] as const
export const PREVIEW_DRAWER = ['view', 'edit', 'new', 'advance', 'touch', 'history', 'emails', 'materials', 'notes', 'delete', /* PST-293 */ 'decision'] as const
export type PreviewToday = (typeof PREVIEW_TODAY)[number]
export type PreviewDrawer = (typeof PREVIEW_DRAWER)[number]
export type PreviewState = {
  today: PreviewToday
  drawer?: PreviewDrawer
  sheet: boolean
  /** `&investors=filtered|empty|bulk|enrich|exported|import1|import2|import3` */
  investors?: string | null
  /** `&plan=mid` */
  plan?: string | null
  /** `&settings=errors` */
  settings?: string | null
  /** `&system=cmdk|cmdk-empty|cmdk-none|offline|savefailed|loading`; PST-290 `shortcuts|cmdk-actions|list-focus|undo` */
  system?: string | null
  /** PST-275 `&suggestions=all|tidy|none|agent` */
  suggestions?: string | null
  /** PST-281 `&qanda=empty|answer|edit|new|same|prep` */
  qanda?: string | null
  /** PST-282 `&materials=empty|versions|views|share|sent|upload|noemail|opened` */
  materials?: string | null
  /** PST-276 `&agents=empty|create|created|activity|revoke` */
  agents?: string | null
  /** PST-277 `&notes=none|reading|applied|failed|unmatched` */
  notes?: string | null
  /** PST-278 `&drafts=followup|intro|blurb|nudge|thanks|dataroom|writing|nokey|noemail|copied|failed|history` */
  drafts?: string | null
  /** PST-279 `&ask=empty|thinking|streaming|answer|verbal|prep|deck|unknown|failed` (⌘K opens in Ask mode) */
  ask?: string | null
  /* ---------- PST-293 ---------- */
  /** `&signal=auto|decide` (src/preview/decisionsFixture.ts) */
  signal?: string | null
  /** `&pipeline=maybes`: Pipeline › Maybes (the board states stay `hidden|shown|end`) */
  pipeline?: string | null
  /* ---------- end PST-293 ---------- */
  /* ---------- PST-294 ---------- */
  /** `&introducer=panel|add|ask`: Investors › Introducers with one introducer's panel open, Add introducer, or Ask for another intro */
  introducer?: string | null
  /** `&draft=forwardable`: the forwardable intro draft */
  draft?: string | null
  /** `&drawer=warm-path`: the drawer scrolled to its warm path */
  warmPath?: boolean
  /* ---------- end PST-294 ---------- */
  /** PST-295 `&pipeline=race|race-lead|update` and `&home=race` (see src/preview/raceFixture.ts) */
  race?: PreviewRace | null
}

/** PST-279 `&ask=…`: the question ⌘K asks as it opens in Ask mode (empty: just Ask mode). See src/preview/askFixture.ts. */
export const PREVIEW_ASK_QUESTIONS: Record<string, string> = {
  thinking: 'Who should I chase today?',
  streaming: 'Who should I chase today?',
  answer: 'Who should I chase today?',
  verbal: 'How much is verbal but not signed?',
  prep: 'Prep me for my 4pm',
  deck: 'Who hasn’t seen deck v4?',
  unknown: 'What’s our churn by cohort?',
  failed: 'Who should I chase today?',
}

export const PreviewStateContext = createContext<PreviewState | null>(null)
export const usePreviewState = () => useContext(PreviewStateContext)
