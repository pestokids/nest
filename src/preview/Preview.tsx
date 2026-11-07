// DEV ONLY. `?preview` renders Home and Raise from a fake fixture without signing in.
//   &seed                    use internal/seed.json instead of the fixture
//   &home=firstrun|prepdone  Home states
//   &signin=<state>          a sign-in state: default, hover, checking, noaccess, error, signedout
//   &pipeline=hidden|shown|end  Pipeline board states (adds a few fake cards; see components/pipeline/preview.ts)
//   &stage=<key>             with &pipeline on a phone: the stage chip that starts selected
//   &today=nothingdue|win    Raise · Today states
//   &drawer=<state>          the investor drawer: view, edit, new, advance, touch, history, emails, notes, delete
//   &google=<state>          Calendar and Gmail: none (default), connected, syncing, reconnect (&drawer=emails implies connected)
//   &sheet                   the drawer as the phone bottom sheet at any width
//   &investors=filtered|empty|bulk|enrich|exported|import1|import2|import3  (enrich: pair with &ai=bulk)
//   &plan=mid                mid-round: targets hit and missed
//   &settings=errors         validation errors
//   &system=cmdk|cmdk-empty|cmdk-none|offline|savefailed|loading
//   &suggestions=all|tidy|none|agent  Suggested fixes: the list open, cleared ("All tidy."), none (no card), an agent's row arriving
//   &ai=enriching|review|nokey|bulk  investor enrichment: a run in progress, facts to review, AI not set up, four enriching
//                            (default: Kite Angels enriched; with &google=connected Today shows Who's this? lookups)
//   &qanda=empty|answer|edit|new|same|prep  Q&A: an empty bank, the Answer panel (new question, edit with earlier answers, add),
//                            Same as another, Today's prep brief (implies &google=connected). &drawer=notes for the Notes tab
//   &materials=<state>       Materials (PST-282): empty, versions, views, share, sent, upload, noemail, opened (a first open arrives)
//   &notes=<state>           Nest reads meeting notes (PST-277; pair with &drawer=notes): default (Kite Angels' 1st meeting read,
//                            updates to apply), none, reading, applied, failed; unmatched adds Unmatched notes on Today.
//                            &ai=nokey: AI isn't set up (notes save, nothing is read). &qanda=answer has Draft from past answers
//   &close=<state>           Close (PST-283): default, record, status, remind, modeller, captable, nocaptable, closed, empty
//                            (see preview/closeFixture.ts; the closing investors stay while you move between tabs)
//   &agents=<state>          Settings › Agents (PST-276): empty, create (new key), created (shown once), activity, revoke
//   &drafts=<state>          Drafts (PST-278): followup, intro, blurb, nudge, thanks, dataroom, writing, nokey, noemail, copied, failed,
//                            history (see preview/draftsFixture.ts). Without it, Draft still works with made-up text
//   &ask=<state>             Ask Nest in ⌘K (PST-279): empty, thinking, streaming, answer, verbal, prep, deck, unknown, failed
//                            (pair with &ai=nokey for "AI isn't set up here"; prep implies &google=connected)
//   &brief=<state>           the morning brief on Today (PST-279): default, fallback (no AI: Today's own whys), quiet, dismissed
//   &wispr=<state>           Settings › Wispr Flow (PST-285): off (default), connected, reconnect, fetching
//   &fail                    every write fails (save-failed toast with Retry)
//   any unknown path         the 404, e.g. /nowhere?preview
import { useEffect } from 'react'
import { AppShell } from '../components/AppShell'
import { useSaveAction } from '../components/system/useSaveAction'
import { PreviewData, type PreviewHome } from '../components/PreviewData'
import { LocalSounds, SessionContext } from '../components/session'
import { SignIn, SIGN_IN_STATES, type SignInState } from '../components/SignIn'
import { PREVIEW_DRAWER, PREVIEW_TODAY, PreviewStateContext, type PreviewDrawer, type PreviewToday } from '../components/preview-state'
import { PREVIEW_AI, type PreviewAI } from './aiFixture'
import { PREVIEW_GOOGLE, type PreviewGoogle } from './googleFixture'
import { PREVIEW_SUGGESTIONS, type PreviewSuggestions } from './suggestionsFixture'
import { PREVIEW_AGENTS, type PreviewAgents } from './agentsFixture'
import { PREVIEW_MATERIALS, PreviewMaterials, type PreviewMaterials as MaterialsState } from './materialsFixture'
import { OpenToasts } from '../components/materials/Opens'
import { DraftsProvider } from '../components/drafts/data'
import { closePreview, rememberClosePreview } from './closeFixture'
import { PREVIEW_DRAFTS, type PreviewDrafts } from './draftsFixture'
import { PREVIEW_ASK, PREVIEW_BRIEF, type PreviewAsk, type PreviewBrief } from './askFixture'
import { PreviewWispr } from './wisprFixture'
import { WISPR_PREVIEW, type WisprPreview } from '../lib/wispr'

const session = { me: { firstName: 'Dev', name: 'Dev Preview', email: 'dev@example.com' }, signOut: () => {} }

export function Preview() {
  const q = new URLSearchParams(location.search)
  if (q.has('seed')) sessionStorage.setItem('nest_preview_data', 'seed')
  else if (q.has('preview')) sessionStorage.removeItem('nest_preview_data')
  if (q.has('pipeline')) sessionStorage.setItem('nest_preview_board', '1')
  else if (q.has('preview')) sessionStorage.removeItem('nest_preview_board')
  rememberClosePreview(q)
  const signin = q.get('signin') as SignInState | null
  if (signin && SIGN_IN_STATES.includes(signin))
    return (
      <LocalSounds>
        <SignIn state={signin === 'hover' ? 'default' : signin} forceHover={signin === 'hover'} email="someone@example.com" onSignIn={() => {}} onSignOut={() => {}} />
      </LocalSounds>
    )
  const home = (q.get('home') ?? 'default') as PreviewHome
  const today = (PREVIEW_TODAY as readonly string[]).includes(q.get('today') ?? '') ? (q.get('today') as PreviewToday) : 'default'
  const drafts = (PREVIEW_DRAFTS as readonly string[]).includes(q.get('drafts') ?? '') ? (q.get('drafts') as PreviewDrafts) : null
  const drawer = (PREVIEW_DRAWER as readonly string[]).includes(q.get('drawer') ?? '') ? (q.get('drawer') as PreviewDrawer) : drafts === 'history' ? 'history' : undefined
  const suggestions = (PREVIEW_SUGGESTIONS as readonly string[]).includes(q.get('suggestions') ?? '') ? (q.get('suggestions') as PreviewSuggestions) : 'default'
  const materials = (PREVIEW_MATERIALS as readonly string[]).includes(q.get('materials') ?? '') ? (q.get('materials') as MaterialsState) : 'default'
  const agents = (PREVIEW_AGENTS as readonly string[]).includes(q.get('agents') ?? '') ? (q.get('agents') as PreviewAgents) : 'default'
  const ask = (PREVIEW_ASK as readonly string[]).includes(q.get('ask') ?? '') ? (q.get('ask') as PreviewAsk) : null
  const brief = (PREVIEW_BRIEF as readonly string[]).includes(q.get('brief') ?? '') ? (q.get('brief') as PreviewBrief) : null
  const wispr: WisprPreview = (WISPR_PREVIEW as readonly string[]).includes(q.get('wispr') ?? '') ? (q.get('wispr') as WisprPreview) : 'off'
  const state = { today, drawer, sheet: q.has('sheet'), investors: q.get('investors'), plan: q.get('plan'), settings: q.get('settings'), system: q.get('system'), suggestions, qanda: q.get('qanda'), materials, agents, notes: q.get('notes'), drafts, ask }
  const extra = { loading: state.system === 'loading', mid: state.plan === 'mid', fail: q.has('fail') }
  const google: PreviewGoogle = (PREVIEW_GOOGLE as readonly string[]).includes(q.get('google') ?? '') ? (q.get('google') as PreviewGoogle) : drawer === 'emails' || q.get('qanda') === 'prep' || ask === 'prep' ? 'connected' : 'none'
  const ai: PreviewAI = (PREVIEW_AI as readonly string[]).includes(q.get('ai') ?? '') ? (q.get('ai') as PreviewAI) : 'default'
  return (
    <LocalSounds>
      <SessionContext.Provider value={session}>
        <PreviewStateContext.Provider value={state}>
          <PreviewData
            source={sessionStorage.getItem('nest_preview_data') === 'seed' ? 'seed' : 'fixture'}
            home={home}
            today={today}
            board={sessionStorage.getItem('nest_preview_board') === '1'}
            extra={extra}
            google={google}
            suggestions={suggestions}
            ai={ai}
            close={closePreview()}
            agents={agents}
            ask={ask}
            brief={brief}
          >
            <PreviewMaterials state={materials}>
              <DraftsProvider>
                <PreviewWispr state={wispr} fail={extra.fail}>
                  <AppShell>
                    {state.system === 'savefailed' ? <FailOnce /> : null}
                    <OpenToasts />
                  </AppShell>
                </PreviewWispr>
              </DraftsProvider>
            </PreviewMaterials>
          </PreviewData>
        </PreviewStateContext.Provider>
      </SessionContext.Provider>
    </LocalSounds>
  )
}

/** &system=savefailed: one write that fails, so the toast with Retry shows. */
function FailOnce() {
  const save = useSaveAction()
  useEffect(() => {
    void save(() => Promise.reject(new Error('preview')), { failMessage: 'Couldn’t move Lantern Ventures. It’s back in Intro.' })
  }, [save])
  return null
}
