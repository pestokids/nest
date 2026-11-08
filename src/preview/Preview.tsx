// DEV ONLY. `?preview` renders Home and Raise from a fake fixture without signing in.
//   &seed                    use internal/seed.json instead of the fixture
//   &home=firstrun|prepdone  Home states
//   &signin=<state>          a sign-in state: default, hover, checking, noaccess, error, signedout
//   &pipeline=hidden|shown|end  Pipeline board states (adds a few fake cards; see components/pipeline/preview.ts)
//   &stage=<key>             with &pipeline on a phone: the stage chip that starts selected
//   &today=nothingdue|win    Raise · Today states (PST-297 adds inbox, phone and clear below)
//   &drawer=<state>          the investor drawer: view, edit, new, advance, touch, history, emails, notes, delete
//   &google=<state>          Calendar and Gmail: none (default), connected, syncing, reconnect (&drawer=emails implies connected)
//   &sheet                   the drawer as the phone bottom sheet at any width
//   &investors=filtered|empty|bulk|enrich|exported|import1|import2|import3  (enrich: pair with &ai=bulk)
//   &plan=mid                mid-round: targets hit and missed
//   &insights=default|behind|empty  Plan › Insights (PST-284): a month of history on track or behind; empty is the
//                            plain fixture (too little history to project). See preview/insightsFixture.ts
//   &sort=priority           Investors sorted by Priority (PST-284; any Investors sort key works the same way)
//   &settings=errors         validation errors
//   &system=cmdk|cmdk-empty|cmdk-none|offline|savefailed|loading
//   &suggestions=all|tidy|none|agent  Suggested fixes: the list open, cleared ("All tidy."), none (no card), an agent's row arriving
//   &ai=enriching|review|nokey|bulk  investor enrichment: a run in progress, facts to review, AI not set up, four enriching
//                            (default: Kite Angels enriched; with &google=connected Today shows Who's this? lookups)
//   &ai=models|spend         Settings › AI (PST-273): features on their own models with estimates from real runs; a month's
//                            spend split across Haiku, Sonnet and Opus
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
//   &feedback=<state>        Send feedback (PST-289): open (the ⌘. dialog), sent (the "Sent as PST-301" toast), unsent (saved,
//                            not sent: the toast, and Settings › Feedback with rows waiting and no Linear key)
//   &home=default            Home, the company overview (PST-289); firstrun and prepdone as above
//   PST-290 keyboard:
//   &system=shortcuts        the ? sheet;  &system=cmdk-actions  ⌘K acting on "orch dd"
//   &system=list-focus       the J/K focus ring on a list's second row (Investors, Pipeline, Today)
//   &system=undo             a logged touch's toast with Undo
//   &density=compact|comfortable  list density (⇧D), kept on this device
//   ---------- PST-292: Jev ----------
//   &ai=jev                  Settings › AI's Jev row set up (on, this month's spend of the cap) and Jev in the spend view
//   &whos=prechecked         Who's this? with someone Jev said probably isn't an investor ("Look up anyway"; implies &google=connected)
//   &suggestions=jev         a Duplicate Jev found (Juniper Seed and a misspelt second card)
//   &notes=probably          Unmatched notes on Today with Jev's "Probably …" pick (Add to …)
//   &qanda=jev               Q&A: a new question Jev marked "Same as …" one in the bank (Merge, Not the same)
//   ---------- end PST-292 ----------
//   ---------- PST-293: decisions and signals (see preview/decisionsFixture.ts) ----------
//   &drawer=decision         the drawer's decision on Orchard Capital: status, decide-by, 2 of 3 calls, read from notes
//   &pipeline=maybes         Pipeline › Maybes (also /raise/pipeline?view=maybes): the maybes, longest first
//   &signal=auto             a note arrives and Nest marks Kite Angels a maybe by itself: toast with Undo (&drawer=history: "Auto")
//   &signal=decide           Decide rows and a new ask from an email in Today's Due today
//   &google=metadata         Settings: connected on an old gmail.metadata grant ("Reconnect Google to read email bodies")
//   ---------- end PST-293 ----------
//   PST-294 introducers (see preview/introducersFixture.ts):
//   &investors=introducers   Investors › Introducers (warm paths migrate on load)
//   &introducer=panel|add|ask  one introducer's panel open (Ankur), on phones too; Add introducer; Ask for another intro
//   &draft=forwardable       the forwardable intro draft: the ask, and the note to forward
//   &drawer=warm-path        the drawer on Kite Angels, scrolled to the warm path and its steps
//   PST-303: &drawer=edit-vc|edit-accelerator|edit-angel  the edit form on Orchard Capital (fund), Northwind Accelerator
//                            and Kite Angels (angel), with the type's labels and help
//   PST-295 Race and the lead (see preview/raceFixture.ts; a made-up kickoff week):
//   &pipeline=race           Pipeline › Race: kickoff week, who's ahead with the slow-down note, no lead yet
//   &pipeline=race-lead      two offers the same week (the lime card), and Orchard is leading
//   &pipeline=update         the race, scrolled to Who to update;  &home=race  Home's Raise card with the race
//   &drafts=lead             the "Ask if they'll lead" draft
//   ---------- PST-302: applications and free stage moves (made-up investors in preview/fixture.ts) ----------
//   &drawer=application      Northwind Accelerator's drawer with its Application row open to edit
//   &card=awaiting-decision  Pipeline: Northwind's card with "Applied C12 · awaiting decision" and a calm foot (open /raise/pipeline)
//   &suggestions=notes|outreach|application  an agent's notes (before and after), outreach or application fix
//   &stage=correction        (on /raise/today: Investors reads &stage as its filter) Bluebird Seed's history after "Intro asked → Not contacted", with "Mark as a correction"
//   ---------- end PST-302 ----------
//   ---------- PST-296: Find more like these (see preview/findMoreFixture.ts) ----------
//   &investors=find-more      the Find more panel open, before a run (Search the web plays a pretend run)
//   &find=running|results|empty  with &investors=find-more: a run searching, eight new investors, a run that found nobody new
//   ---------- end PST-296 ----------
//   ---------- PST-297: the Today Inbox (see preview/inboxFixture.ts) ----------
//   &today=inbox             Today as one Inbox with a row of every type (made-up sources over the fixture; Google connected)
//   &today=phone             the same, with the first row half-swiped to Done (screenshot at 440 wide)
//   &today=clear             every row done: the sleeping nest and the once-a-day confetti
//   &today=win               the ask logged from its Next move row (confetti and the Cheer toast)
//   &system=list-focus       on Today: the J/K focus ring on the second row
//   ---------- end PST-297 ----------
//   ---------- PST-298 empty states (every empty list says why and offers one next step) ----------
//   &home=firstrun           on any route, no investors and no round: Home's This week, the board's columns (and the
//                            phone stage view at 440), Race's Who's ahead and Who to update, Maybes, Insights with no target
//   &today=clear             also Home's Inbox card with nothing waiting
//   &materials=noopens       links sent, nobody has opened one yet (Recent views)
//   &materials=empty         with &drawer=materials: the drawer's Materials tab before anything is uploaded
//   &close=empty             with /raise/close?view=allocation: nobody has said a number yet
//   &feedback=empty          Settings › Feedback with nothing sent yet
//   ---------- end PST-298 empty states ----------
//   ---------- PST-298 skeletons ----------
//   &system=loading          on any Raise view: the skeleton shaped like that view (Today, Pipeline, Race, Investors,
//                            Close, Plan, Settings)
//   &system=loading-drawer   with &drawer=history|materials|notes: the drawer's lists as skeleton rows
//   ---------- end PST-298 skeletons ----------
//   ---------- PST-298 interactions (see preview/momentsFixture.tsx) ----------
//   &moment=<name>           one interaction from interactions-batch-1.png, played a moment after load: inbox-done, inbox-move,
//                            inbox-snooze (with &today=inbox); race-move, race-ahead, race-offer, race-lead, maybe-no (with
//                            &pipeline=race); intro-step, intro-thanked (with &introducer=panel)
//   ---------- end PST-298 interactions ----------
//   &fail                    every write fails (save-failed toast with Retry)
//   any unknown path         the 404, e.g. /nowhere?preview
import { useEffect, useRef } from 'react'
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
import { IntroducersProvider } from '../components/introducers/data' // PST-294
import { closePreview, rememberClosePreview } from './closeFixture'
import { PREVIEW_DRAFTS, type PreviewDrafts } from './draftsFixture'
import { PREVIEW_ASK, PREVIEW_BRIEF, type PreviewAsk, type PreviewBrief } from './askFixture'
import { PreviewWispr } from './wisprFixture'
import { WISPR_PREVIEW, type WisprPreview } from '../lib/wispr'
import { PREVIEW_FEEDBACK, PreviewFeedback, type PreviewFeedback as FeedbackState } from './feedbackFixture' // PST-289
import { saveLocalDensity } from '../lib/density'
import { useRaise } from '../components/data'
import { useInstant } from '../components/system/useInstant'
import { DecisionsProvider } from '../components/decisions/data' // PST-293
import { RaceProvider } from '../components/race/data' // PST-295
import { PREVIEW_RACE, type PreviewRace } from './raceFixture' // PST-295
import { InboxProvider } from '../components/inbox/data' // PST-297
import { isInboxPreview } from './inboxFixture' // PST-297
import { Moments, PREVIEW_MOMENTS, type PreviewMoment } from './momentsFixture' // PST-298 interactions

const session = { me: { firstName: 'Dev', name: 'Dev Preview', email: 'dev@example.com' }, signOut: () => {} }

export function Preview() {
  const q = new URLSearchParams(location.search)
  if (q.has('seed')) sessionStorage.setItem('nest_preview_data', 'seed')
  else if (q.has('preview')) sessionStorage.removeItem('nest_preview_data')
  if (q.has('pipeline')) sessionStorage.setItem('nest_preview_board', '1')
  else if (q.has('preview')) sessionStorage.removeItem('nest_preview_board')
  rememberClosePreview(q)
  // PST-290
  const density = q.get('density')
  if (density === 'compact' || density === 'comfortable') saveLocalDensity(density)
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
  // PST-294: &drawer=warm-path is the drawer's view, scrolled to the warm path.
  const warmPath = q.get('drawer') === 'warm-path'
  const drawer = warmPath ? 'view' : (PREVIEW_DRAWER as readonly string[]).includes(q.get('drawer') ?? '') ? (q.get('drawer') as PreviewDrawer) : drafts === 'history' ? 'history' : undefined
  const suggestions = (PREVIEW_SUGGESTIONS as readonly string[]).includes(q.get('suggestions') ?? '') ? (q.get('suggestions') as PreviewSuggestions) : 'default'
  const materials = (PREVIEW_MATERIALS as readonly string[]).includes(q.get('materials') ?? '') ? (q.get('materials') as MaterialsState) : 'default'
  const agents = (PREVIEW_AGENTS as readonly string[]).includes(q.get('agents') ?? '') ? (q.get('agents') as PreviewAgents) : 'default'
  const ask = (PREVIEW_ASK as readonly string[]).includes(q.get('ask') ?? '') ? (q.get('ask') as PreviewAsk) : null
  const brief = (PREVIEW_BRIEF as readonly string[]).includes(q.get('brief') ?? '') ? (q.get('brief') as PreviewBrief) : null
  const wispr: WisprPreview = (WISPR_PREVIEW as readonly string[]).includes(q.get('wispr') ?? '') ? (q.get('wispr') as WisprPreview) : 'off'
  // PST-289
  const feedback = (PREVIEW_FEEDBACK as readonly string[]).includes(q.get('feedback') ?? '') ? (q.get('feedback') as FeedbackState) : null
  // PST-295
  const raceParam = q.get('home') === 'race' ? 'home' : q.get('pipeline')
  const race = (PREVIEW_RACE as readonly string[]).includes(raceParam ?? '') ? (raceParam as PreviewRace) : null
  const state = { today, drawer, sheet: q.has('sheet'), investors: q.get('investors'), plan: q.get('plan'), settings: q.get('settings'), system: q.get('system'), suggestions, qanda: q.get('qanda'), materials, agents, notes: q.get('notes'), drafts, ask, introducer: q.get('introducer'), draft: q.get('draft'), warmPath, race }
  const insights = q.get('insights')
  const extra = { loading: state.system === 'loading', mid: state.plan === 'mid', fail: q.has('fail'), insights: insights === 'default' || insights === 'behind' ? (insights as 'default' | 'behind') : undefined, race: race ? (race === 'race-lead' ? ('lead' as const) : ('race' as const)) : undefined }
  const google: PreviewGoogle = (PREVIEW_GOOGLE as readonly string[]).includes(q.get('google') ?? '') ? (q.get('google') as PreviewGoogle) : drawer === 'emails' || q.get('qanda') === 'prep' || ask === 'prep' || /* PST-297 */ isInboxPreview(today) ? 'connected' : 'none'
  const ai: PreviewAI = (PREVIEW_AI as readonly string[]).includes(q.get('ai') ?? '') ? (q.get('ai') as PreviewAI) : 'default'
  /* ---------- PST-293: &signal=auto|decide and &pipeline=maybes ---------- */
  const decisionState = { signal: q.get('signal'), pipeline: q.get('pipeline') }
  /* ---------- end PST-293 ---------- */
  /* ---------- PST-302: &card=awaiting-decision and &stage=correction ---------- */
  const applicationState = { card: q.get('card'), stage: q.get('stage') }
  /* ---------- end PST-302 ---------- */
  /* ---------- PST-292: &whos=prechecked (Jev's Who's this? pre-check) ---------- */
  const whos = q.get('whos') === 'prechecked'
  /* ---------- end PST-292 ---------- */
  /* ---------- PST-298 interactions: &moment=<name> ---------- */
  const moment = (PREVIEW_MOMENTS as readonly string[]).includes(q.get('moment') ?? '') ? (q.get('moment') as PreviewMoment) : null
  /* ---------- end PST-298 interactions ---------- */
  return (
    <LocalSounds>
      <SessionContext.Provider value={session}>
        <PreviewStateContext.Provider value={{ ...state, ...decisionState, /* PST-302 */ ...applicationState }}>
          <PreviewData
            source={sessionStorage.getItem('nest_preview_data') === 'seed' ? 'seed' : 'fixture'}
            home={home}
            today={today}
            board={sessionStorage.getItem('nest_preview_board') === '1'}
            extra={extra}
            google={whos ? 'connected' : google}
            suggestions={suggestions}
            ai={whos ? 'prechecked' : ai}
            close={closePreview()}
            agents={agents}
            ask={ask}
            brief={brief}
          >
            <PreviewMaterials state={materials}>
              {/* PST-294 */}
              <IntroducersProvider>
              <DraftsProvider>
                {/* PST-293 */}
                <DecisionsProvider>
                {/* PST-295 */}
                <RaceProvider>
                {/* PST-297 */}
                <InboxProvider>
                <PreviewWispr state={wispr} fail={extra.fail}>
                  {/* PST-289 */}
                  <PreviewFeedback state={feedback} fail={extra.fail}>
                    <AppShell>
                      {state.system === 'savefailed' ? <FailOnce /> : null}
                      {state.system === 'undo' ? <UndoOnce /> : null}
                      {/* PST-298 interactions */}
                      {moment ? <Moments moment={moment} /> : null}
                      <OpenToasts />
                    </AppShell>
                  </PreviewFeedback>
                </PreviewWispr>
                </InboxProvider>
                </RaceProvider>
                </DecisionsProvider>
              </DraftsProvider>
              </IntroducersProvider>
            </PreviewMaterials>
          </PreviewData>
        </PreviewStateContext.Provider>
      </SessionContext.Provider>
    </LocalSounds>
  )
}

/** PST-290 &system=undo: a touch logged the instant way, so its toast with Undo shows. */
function UndoOnce() {
  const d = useRaise()
  const instant = useInstant()
  const done = useRef(false)
  useEffect(() => {
    const inv = d.investors.find((i) => i.name === 'Kite Angels') ?? d.investors[0]
    if (!d.loaded || !inv || done.current) return
    done.current = true
    instant.logTouch(inv, 'Call about the deck.', { touch: 'call' }, 'Call logged.')
  }, [d.loaded, d.investors, instant])
  return null
}

/** &system=savefailed: one write that fails, so the toast with Retry shows. */
function FailOnce() {
  const save = useSaveAction()
  useEffect(() => {
    void save(() => Promise.reject(new Error('preview')), { failMessage: 'Couldn’t move Lantern Ventures. It’s back in Intro.' })
  }, [save])
  return null
}
