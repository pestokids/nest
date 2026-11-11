# Nest

Pesto's internal app. Its first section is the **pre-seed raise tracker** under `/raise`: every investor, their stage, next step and date, an activity log, and weekly targets to the close. Other internal tools can move in later as their own sections.

## Layout

```
src/            Frontend: TanStack Start (React, TypeScript, file-based routes)
  routes/       _app (signed-in layout: top bar) → / Home, /raise/{today,pipeline,investors,plan,settings}
  components/   ui/ (design system: Button, Chip, Input, Tabs, Toast, Icon…), sign-in desk, top bar, data providers
  lib/          Shared logic: stages, scoring, round maths, dates, money, CSV, Home, motion, sound (unit-tested)
  styles/       Plain CSS: tokens (named after the Sketch swatches), base, motion, ui, shell, sign-in, home, raise
  preview/      ?preview fixture (made-up data; local dev and Vercel PR previews only)
public/         mascot/ (WebP), sounds/snd01/ (the UI sound kit, copied in at build time; not in git)
convex/         Backend: schema, queries, mutations, Convex Auth (Google), seed
scripts/        Auth key generator, unauthenticated-access check, preview screenshots
internal/       Private, never committed (design handoff, prototype, seed.json); copied into worktrees by .worktreeinclude
```

Everything behind sign-in is client-rendered (`ssr: false` on the `_app` layout), so nothing private is rendered on the server. The app is a Convex client with no server functions of our own.

## Design system

Tokens are CSS custom properties in `src/styles/tokens.css`, named after the Sketch swatches (`Brand/Forest` → `--brand-forest`), light theme only. Fonts: Bricolage Grotesque (display, at its 14pt optical size), Inter (UI), JetBrains Mono (labels). Components live in `src/components/ui/`; illustrations in `src/components/illustrations.tsx`.

Motion (`src/lib/motion.ts` + `src/styles/motion.css`): rise, pop, wobble, shake, pulse, shine, bob, confetti and toast slide, all respecting `prefers-reduced-motion`. Sound (`src/lib/sound.ts`): one Web Audio player, `play(action)`, silent until the first gesture, while the tab is hidden, or when the user turns Sounds off in the avatar menu or Settings › Sounds (stored per user in Convex, `prefs` table). See UI sounds below.

## Local setup

```sh
pnpm install
cp .env.example .env.local   # or let .worktreeinclude copy it in
pnpm dev                     # convex dev (push + watch) and Vite on http://localhost:3000
```

Other scripts: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm dev:web` (Vite only).

Preview: `?preview` renders Home and every Raise view from a small made-up fixture (`src/preview/fixture.ts`) with in-memory writes, without signing in. It works on `http://localhost:3000/?preview` in local dev and on the Vercel preview build of every PR (`https://<preview-url>/?preview`), which always uses the fake fixture (never `internal/seed.json` or real data). Add `&seed` (local dev only) to use `internal/seed.json` instead, `&home=firstrun` or `&home=prepdone` for the Home states, `&signin=default|hover|checking|noaccess|error|signedout` for the sign-in states, `&today=nothingdue|win` for Raise · Today, `&drawer=view|edit|new|advance|touch|history|emails|delete` for the investor drawer (on any Raise view; add `&sheet` for the phone bottom sheet at any width), or `&pipeline=hidden|shown|end` (with `&stage=<key>` on a phone) for the Pipeline board states. Investors, Plan, Settings and the system states: `&investors=filtered|empty|bulk|exported|import1|import2|import3`, `&sort=priority` (Investors sorted by Priority), `&plan=mid`, `&insights=default|behind|empty` (Plan › Insights on track, behind, or with too little history), `&settings=errors`, `&system=cmdk|cmdk-empty|cmdk-none|offline|savefailed|loading`, any unknown path for the 404 (e.g. `/nowhere?preview`), `&suggestions=all|tidy|none|agent` for Suggested fixes (the list open, cleared, no card, or an agent's row arriving), `&google=connected|syncing|reconnect` for Calendar and Gmail (Today's meetings, Waiting on you and Who's this?, the Settings card, the palette's Gmail row; `&drawer=emails` implies `connected`), and `&fail` to make every write fail (the save-failed toast with Retry). It's stripped from production builds.

<!-- PST-294 -->
Introducers (PST-294): `&investors=introducers` (Investors › Introducers), `&introducer=panel|add|ask` (one introducer's panel, the Add introducer dialog, the Ask for an intro dialog), `&draft=forwardable` (the forwardable intro draft) and `&drawer=warm-path` (the drawer's warm path with its steps).
<!-- end PST-294 -->

<!-- PST-305 -->
Network (PST-305): `&investors=network` (Investors › Network; `&investors=introducers` and `?view=introducers` still open it), `&network=founder|friend|advisor` (a founder's, a friend's or an advisor-who-invests' panel), `&network=lookup` (a founder's Find their investors with results to tick), `&network=import` (the CSV import with its preview), `&draft=intro-ask` (Ask Ankur for intros), and `&drawer=view&network=advisor` (an investor's drawer with "Also your advisor").
<!-- end PST-305 -->
<!-- PST-307 -->
Advisor (PST-307): `/raise/advisor?preview&advisor=empty|chat|story|blocks|streaming|cap` (the new-chat starters, a Coach chat, a Storyteller chat on Opus, one answer with every block, an answer still writing, the monthly cap reached), and `/raise/pipeline?preview&pipeline=race&advisor=panel` (the ⌘J panel over Race). Answers sent in the preview are canned; Claude is never called.
<!-- end PST-307 -->
<!-- PST-308 -->
Advisor order (PST-308): `/raise/advisor?preview&advisor=order|order-streaming` (an answer with its words and blocks in the order written, after one saved before that; the same answer still writing below its plan), and `/raise/pipeline?preview&advisor=order-panel` (that answer in the ⌘J panel).
<!-- end PST-308 -->

Screenshots of every preview screen at 1440 × 900, 440 × 956 and 412 × 915: run `pnpm dev:web`, then `node scripts/screenshots.mjs http://localhost:3000` (writes to `.context/screens/`). They use the fixture, never real data. The script also reports any screen that scrolls sideways and, on phones, any control under 44 × 44 (`checks.json`).

## Environment variables

**Frontend / CLI** (`.env.local`, see `.env.example`):

| Var | What |
| --- | --- |
| `VITE_CONVEX_URL` | Convex deployment URL the browser talks to |
| `CONVEX_DEPLOY_KEY` | Deploy key: dev deployment locally, production on Vercel only |

**Convex** (set per deployment with `npx convex env set NAME value`, add `--prod` for production):

| Var | What |
| --- | --- |
| `ALLOWED_EMAILS` | Comma-separated, compared lowercased, e.g. `you@yourcompany.com` |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Google OAuth client (Internal consent screen, pestokids.com Workspace) |
| `SITE_URL` | Where sign-in returns to: `http://localhost:3000` (dev), `https://nest.pestokids.com` (prod) |
| `JWT_PRIVATE_KEY`, `JWKS` | Convex Auth signing keys: `node scripts/generate-auth-keys.mjs --set` (add `--prod` for production) |
| `ANTHROPIC_API_KEY` | Optional. Turns on investor enrichment and Who's this? lookups (Claude with web search). Without it the app shows "AI isn't set up here" and nothing is sent anywhere. |
| `LINEAR_API_KEY` | Optional (PST-289). A Linear personal API key (Settings › Account › Security & access), used to file ⌘. feedback as issues in Pesto › Nest. Without it feedback is saved and waits in Settings › Feedback. |
| `TYPESAFE_API_KEY` | Optional (PST-292). Turns on Jev, TypeSafe's yes/no model (see Jev below). Without it everything works as it did before Jev. |
| `GOOGLE_TOKEN_KEY` | Encrypts Google refresh tokens (Calendar and Gmail) and Wispr Flow's tokens at rest. 32 random bytes, base64: `openssl rand -base64 32`. Set it straight into Convex; don't keep a copy anywhere else. Changing it means everyone reconnects. |

Google OAuth redirect URIs per deployment: `https://<deployment>.convex.site/api/auth/callback/google` (sign-in) and `https://<deployment>.convex.site/google/callback` (Connect Google). The Google Cloud project needs the Gmail API and the Google Calendar API turned on.

## Access

Google sign-in only (Convex Auth). Google must report the email as verified. Every public query and mutation calls `requireUser(ctx)` (`convex/lib/access.ts`), which checks the user's email against `ALLOWED_EMAILS` and throws otherwise. An account that signs in but isn't on the list is signed out with "This account doesn't have access". `access:members` (Settings, "Who can get in") lists `ALLOWED_EMAILS` to people already on it. `access:status` is the only public function that answers outsiders, and it returns nothing but their own status (and their own name and email, for the avatar menu and the "Not on the list" screen).

Check it: `node --env-file=.env.local scripts/check-unauth.mjs <investor id>` calls every public function signed out and expects each to be refused.

## Round settings

Nothing about the raise is hard-coded. Target, stretch, close and kickoff dates, instrument, cap, minimum check, phases (dates, targets, to-dos), stage odds, the "gone quiet" days and wave labels live in the `settings` row keyed `round`, editable on `/raise/settings`; each change is logged in `settingsLog`. `src/lib/round.ts` `DEFAULT_ROUND` (neutral placeholders) is used only until that row exists. Dollar phase targets are stored as a share of the raise target, so changing the target rescales them.

## Raise · Today and the investor drawer

`/raise/today` (`src/routes/_app/raise/today.tsx`, rules in `src/lib/today.ts`): the summary card, **Your next 3 moves** (the current phase's unmet targets in phase order, then "ask for a number" for the furthest-along conversation between a first meeting and a yes that hasn't been asked yet; filled in from what's due, who's quiet and who's next), the KPIs, **Due today** (a next step dated today or earlier on a live conversation, or a parked investor whose park-until day has come), **Gone quiet** (live and uncommitted, no touch in the round's quiet days) and **How a conversation moves**. Logging the ask, ticking a due step and nudging all write an activity with a `touch` kind (`ask`, `done`, `nudge`).

The drawer (`src/components/Drawer.tsx`) is a side drawer on desktop and a bottom sheet on phones (swipe down or tap outside to close). Only moving forward a stage celebrates (`celebrates()` in `src/lib/today.ts`); back, passed, parked and reopening don't. Delete hides the investor at once and sends the delete when the Undo toast goes (6s), or straight away when you leave Raise or close the tab.

## Calendar and Gmail

Each teammate connects their own Google account on Settings (Connect Google: a separate OAuth flow from sign-in, read-only scopes `calendar.readonly` and `gmail.readonly`, offline; connections made before PST-293 have `gmail.metadata` and keep working on headers). The callback is an HTTP action at `/google/callback` (`convex/googleOAuth.ts`). A cron (`convex/crons.ts`) syncs every connection every 10 minutes (`convex/googleSync.ts`): Calendar incrementally with a sync token (first sync 30 days back, 60 ahead), Gmail from the stored history id (first sync reads the last 30 days of threads, newest first). Matching and rules live in `src/lib/google.ts`:

- An investor is matched by exact email first (`email` and `emails`), then by firm domain (`domains`). Personal mail domains (gmail.com, outlook.com…) and our own pestokids.com addresses never match.
- A future meeting moves the investor to Booked if they're behind it (forward only, never past Diligence), and sets the next step and date. A past meeting, or an email either way, sets Last touch. Stage changes from sync are logged with `source: calendar`.
- "Gone quiet" uses the latest of Last touch, the latest email and the latest past meeting (`lastContact` / `quietFor` in `src/lib/pipeline.ts`, used by Today, Pipeline, Investors, the palette and the drawer).
- Today: meetings today and tomorrow (and "How did it go?" the morning after), Waiting on you (the investor wrote last 48+ hours ago), and Who's this? (outside people from your recent meetings who match nobody).
- A token Google stops accepting marks the connection "needs reconnecting" on Settings; the cron skips it until you reconnect.

### Privacy

What Nest stores, per teammate who connects:

- **The connection**: the Google address, sync cursors, last sync time, and the refresh token, encrypted (AES-256-GCM) with `GOOGLE_TOKEN_KEY`. No query returns the token and it never reaches the browser.
- **Meetings**: calendar events with at least one person from outside pestokids.com: title, start and end, the outside attendees' emails and display names, and the event link. Meetings that match no investor are only shown to the person whose calendar they're on, and are dropped after 15 days.
- **Email touches**: only Gmail threads with an investor in them: subject, participants' email addresses, the date and sender of the last message, the message count and the Gmail link. Never bodies, snippets or attachments. PST-293: each new email from an investor is read once in the sync, stripped of quoted replies and the signature, and handed to Jev for signals; the text is never stored (see Decisions and signals).

Disconnecting (Settings → Disconnect) deletes your connection, your meetings and your email touches, and asks Google to revoke the grant. Stage moves that sync already made stay in each investor's History.

## Wispr Flow notes

Wispr Flow's Notetaker writes notes for your meetings. Nest fetches the note after each investor meeting and saves it on the investor, so nobody has to paste it. Nest's read then runs as it does for a pasted note (when "Read meeting notes" is on in Settings › AI), and everything it proposes waits in Suggestions. Wispr Flow has no API or webhooks, only a read-only remote MCP server with browser sign-in, so Nest connects to it as an MCP client, the same way Claude or ChatGPT do.

**Connect it** (each teammate connects their own account):

1. In Wispr Flow, open Settings › MCP and copy the server URL.
2. In Nest, open Raise › Settings, paste it into the Wispr Flow card and click Connect.
3. Sign in to Wispr Flow in the browser and approve Nest. You land back on Settings with "Wispr Flow connected"; Nest fetches the last 7 days straight away.

"Fetch past 30 days" does the same for meetings that ended in the last 30 days. Disconnect forgets the connection and its tokens; notes already fetched stay on each investor. If Wispr Flow stops accepting Nest's sign-in, the card says "Needs reconnecting" and the fetch pauses until you click Reconnect.

**How it works** (`convex/wispr.ts`, `convex/wisprOAuth.ts`, `convex/lib/mcpClient.ts`; rules in `src/lib/wispr.ts`):

- Connect follows the MCP authorization spec: an unauthenticated call gets a 401 whose `WWW-Authenticate` names the protected resource metadata (RFC 9728), which names the authorization server (RFC 8414 metadata). Nest registers itself with dynamic client registration (RFC 7591) and signs in with OAuth 2.1, PKCE (S256) and the `resource` parameter. If the server doesn't offer dynamic client registration, Connect stops and says so; nothing is stored.
- The sign-in comes back to `/wispr/callback`: `https://nest.pestokids.com/wispr/callback` in production (rewritten to Convex by `vercel.json` on the production host only, so preview deployments never reach production Convex) and `http://localhost:3000/wispr/callback` in dev (Vite proxies it to the dev deployment's `.convex.site`).
- The client secret, the PKCE verifier and both tokens are encrypted at rest with `GOOGLE_TOKEN_KEY`, like Google's refresh token; no query returns them. An expired access token is refreshed before a run (and once more if the server answers 401). A refresh Wispr Flow refuses marks the connection "Needs reconnecting"; an outage is retried on the next run.
- A cron every 15 minutes (`crons.ts`) runs one silent fetch per connected teammate. It covers their investor meetings (calendar meetings with an investor) that ended between 10 minutes and 7 days ago and have no Wispr note yet: first `get_meeting_by_calendar_id` with the Google event id, then, if that finds nothing, `search_meetings` around the meeting's time, taking the result that starts within 15 minutes of it and has the same title, and `get_meeting` for its notes. Tool arguments are always built from the input schemas `tools/list` returns, never from names written into Nest.
- A note is saved through the same path as the `add_meeting_notes` MCP tool (source `wispr`): on the meeting and its investor when the meeting has exactly one, else wherever the notes matcher puts it, else in Unmatched notes on Today.
- `wisprFetches` records each attempt (`convex/wisprSchema.ts`). The Wispr meeting id is the dedupe key, so the same note is never fetched or saved twice, Disconnect and Reconnect included. A meeting without a note is tried every run for the first hour, then hourly, then every 6 hours, and the cron stops trying 7 days after it ended.
- Logs carry ids, counts and statuses only: never note text, titles or names.

Preview: `/raise/settings?preview&wispr=off|connected|reconnect|fetching`.

## Suggested fixes

Nest spots mistakes and missing data in the investor list and queues them on Today (`suggestions` table, `convex/suggestions.ts`; rules in `src/lib/suggestions.ts`). Nothing changes until someone accepts. The rule checks use no AI and run every morning at 09:00 IST (`crons.ts`), after each Google sync, and when Today or the list opens:

- **Stage**: a meeting with a Booked investor has happened since they were booked → 1st meeting (the next stage, never further).
- **Missing info**: a live conversation with no email and no domain → a firm domain from an invite or thread that names the firm, or a look in the drawer.
- **Duplicate**: the same firm once normalised (lowercase, no punctuation, no Capital/Cap/Ventures/VC/Partners/Fund/LLP/LLC) or a shared domain → Merge, which moves activities, meetings and email threads to the kept card, then deletes the other.
- **Next step**: a live conversation with none, or one more than 7 days late → a default for its stage, five days out.
- **Expected**: Verbal or later with no amount → a look in the drawer.

Each suggestion is unique by `key`, so a dismissed one never comes back; an open one whose rule stops firing is withdrawn. Accept applies the change with the investor writes' own rules and keeps what Undo needs on the row (Undo reverts it, merges included). "Accept N safe ones" never includes merges, reviews, enrichment or anything from an agent. Other features add rows with the internal `suggestions:addSuggestion` (enrichment, and agents through the Nest MCP server, shown as "From <agent>").

## Plan › Insights and Sort: Priority

Both come from Nest's own data, with no AI. Rules in `src/lib/insights.ts` and `src/lib/priority.ts` (unit-tested).

- **Projected close** (top of Plan): the day committed dollars reach the target at the last 7 days' pace (verbal and later, from the day each first went verbal), against the close date. With nothing committed this week, it uses asks a week times what an ask has been worth (committed so far over asks so far; before anything is committed, the average Expected times the round's odds at "Intro asked"). Behind, it says how many more asks this week would catch up, or which furthest-along conversations (Diligence, 2nd, 1st meeting) would close the gap as verbals. It needs two weeks of activity and a saved round; until then it says which is missing. "See who to ask" opens Investors sorted by Priority.
- **Where the funnel leaks**: for each stage pair, the share of investors who ever reached the first stage (current stage, furthest stage or stage history) who also reached the next. The biggest leak is the lowest step under 75% with at least 3 people through it. It points to the Q&A bank only when two or more of the investors who stalled there asked about the same theme.
- **Warm vs cold**: asks that reached a first meeting, warm paths against cold or applied ones (Warmth "Cold", or a path that says cold or applied).
- **Days in each stage**: the average stay so far, from stage moves (a current stay counts up to today); the slowest gets a tip.
- **Priority** (Investors › Sort: Priority, and `priority` in the MCP `search_investors` results): 0–100, `100 × fit^0.35 × warmth^0.3 × check^0.2 × activity^0.15`. Fit is the Fit score from kept fund facts (0.55 when unknown); warmth is 1 existing, 0.9 warm, 0.6 needs intro, 0.3 cold or applied; check is Expected against the average Expected (0.4 to 1, 0.5 when unknown); activity is the latest touch, email or meeting (1 within 3 days down to 0.45; 0.1 when passed, parked or money in). Each row shows up to three reasons, plus "Possible conflict" when a Fit reason flags one.

## Agents and the Nest MCP server

Agents (Grok Bot, Claude, Capy, anything that speaks MCP) can read the raise and suggest changes through the Nest MCP server. Every write an agent makes is a Suggestions row from that agent ("From Grok Bot"), never a direct change, and "Accept N safe ones" never includes them.

- **Server**: `https://nest.pestokids.com/mcp` (rewritten to Convex by `vercel.json`, on the production host only, so preview deployments never reach production Convex). If the rewrite isn't in place, use the deployment's own URL, `https://grandiose-armadillo-852.convex.site/mcp` for production. Streamable HTTP, one JSON-RPC request per POST answered as `application/json` (no SSE, no sessions). It serves MCP 2026-07-28 statelessly (`server/discover`, `params._meta` version plus matching `MCP-Protocol-Version` / `Mcp-Method` / `Mcp-Name` headers) and the 2025-03-26, 2025-06-18 and 2025-11-25 versions through `initialize`. Code: `convex/mcpHttp.ts` (protocol), `convex/mcp.ts` (tools), tool definitions and the skill in `src/lib/agents.ts`.
- **Skill**: `GET /mcp/skill` returns the Nest skill as markdown (suggest, never edit; the stage rules; never invent numbers). Settings › Agents copies it too.
- **Keys**: made on Raise › Settings › Agents and sent as `Authorization: Bearer nest_ak_…`. A key is shown once; Convex keeps only its SHA-256 and the 8 characters after `nest_ak_` (`agentKeys` in `convex/agentsSchema.ts`). Revoke stops it on the next call. Each key gets 60 calls a minute (then 429 with `Retry-After`).
- **Scopes**: *Read only* keys see `search_investors`, `get_investor`, `todays_moves`, `list_questions`, `round_totals` (committed, verbal and signed against the target), `material_opens` (who opened which material) and `meetings_between` (meetings in a time range). *Can suggest changes* keys also get `log_touch`, `add_investor` (a "new investor" suggestion; accepting creates the investor, Undo removes it), `suggest_change` (stage, next step or Expected) and `enrich` (starts the existing lookup as an automatic run, within the daily cap).
- **Activity**: each call is logged in `agentCalls` with the tool, time, outcome and duration, never arguments or results; Settings shows a key's last 50. Email bodies are never stored, so no tool can return one.

Connect an agent: create a key, add the server URL with the key as a Bearer token, then give the agent the Nest skill.

## Enrichment

Claude (Haiku 5.5 unless Settings › AI picks another model, with the web search and web fetch tools) looks up an investor's person and fund, or an outside person from a recent meeting (Who's this?). Each fact comes back with the page it came from and waits for review in the drawer: Keep or Dismiss per fact, or all at once. Rules live in `src/lib/enrich.ts`; the client is `convex/lib/anthropic.ts`, prompts `convex/lib/research.ts`, the queue `convex/lib/enrichQueue.ts`, and the tables (`people`, `enrichRuns`, `facts`) are in `convex/enrichSchema.ts`.

- Keeping a fact only ever fills an empty field (Type and Geography count as empty at their new-investor defaults; Expected comes from the average check). A value someone typed is never overwritten: the fact is kept with a note saying so. Person facts and the rest of the fund facts live in the drawer's fund card and People.
- Two runs at a time; the rest queue. A lookup of the same email or firm domain from the last 30 days is reused instead of asking again. Automatic runs (a new or imported investor, a new person from a meeting) stop at 30 a day and can be turned off on Settings; clicking Enrich always runs.
- Spend is worked out from each run's token and search counts and shown on Settings with the last few runs. Logs carry ids, never names or emails.

What goes to Claude: the investor's name, firm, type, email addresses and domains, your notes and next step for them and the subjects of their matched emails; for Who's this?, the person's email, the name on the invite and the meeting title. Never email bodies (Nest doesn't store them).

## Ask Nest and the morning brief

**Ask**: ⌘K, then Tab (or the Ask chip) asks Claude (the Ask model, Haiku by default, no web tools) a question about the raise. It answers only with the MCP read tools (the same definitions and handlers as agents, through `internal.mcp.read`), at most 6 calls a question; a refused call still counts. Ask never writes: it offers the existing buttons (Open, the prep brief, Draft, Log the ask) instead, and nothing happens until Dev clicks one. The answer streams, cites investors as `[[investor:<id>|Name]]` (chips that open the drawer), ends with "From N investors, M email threads and K meetings · cost", and says "I don't know from Nest's data." rather than guess a number. Rules and parsing in `src/lib/ask.ts`, the loop in `convex/lib/ask.ts`, runs in `convex/ask.ts` (`askRuns`).

**Morning brief**: a cron at 08:00 IST (`convex/crons.ts`) builds one brief a day (`convex/brief.ts`, `briefs`): since yesterday (replies, decks opened, meetings done with notes read or not, open suggestions), and today's three moves with a one-line reason from Claude (Haiku by default). A reason that's too long or has a number that isn't in the facts is dropped, and the move's own why is shown instead (also without a key). It sits at the top of Today until dismissed, then shrinks to one line. Turn it off with "Morning brief at 08:00" on Settings › AI; it costs well under 1¢ a day.

Ask and brief runs show in Settings › AI's recent runs with their cost and count toward the month's spend. Both tables are in `convex/askSchema.ts`. What goes to Claude: the question and what the read tools return (never email bodies); for the brief, the three moves and their why text, plus each investor's name, stage, next step and date, last touch, Expected, committed and what happened since yesterday.

Preview: `&ask=empty|thinking|streaming|answer|verbal|prep|deck|unknown|failed` (with `&ai=nokey` for "AI isn't set up here") and `&brief=default|fallback|quiet|dismissed` on Today.

**Models and cost**: every AI feature runs on Claude Haiku 5.5 unless Settings › AI picks another model: a default (Haiku, Sonnet or Opus) and, per feature, its own. Each row there shows what a run costs on its model (from the feature's last 50 runs once 5 of them stored their usage, else typical token counts) and what a month would cost at this month's pace. "Redo" in the drawer runs one enrichment on Sonnet or Opus, and the model chip in Ask picks one for a single question; neither changes the setting. Every run row (`enrichRuns`, `noteReads`, `drafts`, `askRuns`, `briefs`) keeps its `model` and `usage` (tokens in and out, cache reads and writes, web searches), and its cost is priced with that model (Haiku's long-prompt prices past 100K tokens). Prices, typical runs and the estimate maths are in `src/lib/models.ts`. Preview: `&ai=models` and `&ai=spend` on Settings.

<!-- PST-292: Jev -->
## Jev

Jev is TypeSafe's "System One" model (`jev-latest`, docs.typesafe.ai). It never writes text: it answers typed questions about a piece of text with probabilities (Choice, Score and Noul). Claude stays for writing and research; Jev only makes small yes/no and pick-one calls, and only when something happens, never on a timer or a sweep of the whole list.

- **Who's this? pre-check**: before the Haiku lookup of a new calendar attendee, one Noul: "This person is likely a venture investor or angel investor." Jev reads their email domain, the invite title, the other attendees' domains and whether the domain is a known investor's firm (no names, no email bodies). Below 0.3 the lookup is skipped and the person shows as "Probably not an investor" with Look up anyway; otherwise the lookup runs as before.
- **Unmatched notes**: notes Nest can't tie to one investor get a Choice among that meeting's investors plus a companion Noul ("None of these investors is the one this note is about"). At 0.9 or above with the companion below 0.3 the notes are attached and read; otherwise they stay in Unmatched with "Probably <name>".
- **Duplicate firms**: when an investor is added or renamed, it's compared only with investors whose name is at least 0.6 similar (trigrams), one Noul each ("These two records are the same firm"). At 0.8 or above it becomes a Duplicate in Suggestions, from Jev. Nothing merges until Dev clicks Merge. CSV imports aren't checked (they already skip name and firm duplicates).
- **Q&A repeats**: a question added from notes gets a Choice among the 5 closest questions in the bank (trigrams) plus a companion Noul ("None of these asks the same thing"). At 0.85 or above with the companion below 0.3 it's marked "Same as …" under New from meetings, with Merge or Not the same (Undo in the toast).

**The cap**: $4.00 a month by default, changed in Settings › AI's Jev row (on/off, "This month $0.0x of $4.00", the cap). Before each call Nest adds this month's spend to the call's estimate (input characters / 4 tokens at $0.042 per million; output is free) and doesn't call past the cap (log line `jev cap reached`). Answers are cached by the sha256 of (model, state, questions) in `jevCache`, so the same text is never asked twice. Every call, cache hit and capped call leaves a `jevRuns` row (feature, tokens, cost, cached, ok or error with a short reason); Jev shows in the spend view as its own model. Logs carry ids and counts, never the text.

**Fallbacks**: with no `TYPESAFE_API_KEY`, Jev switched off, the cap reached, or a failed call (429 and 5xx are retried twice), `askJev` returns null and everything works as it did before Jev: people are looked up, notes wait in Unmatched, and no duplicate or repeat is flagged.

Code: the client `askJev(ctx, { feature, state, questions })` is in `convex/lib/jev.ts` (it re-exports the question builders for signals and scoring), the pure parts (questions, thresholds, trigrams, cost) in `src/lib/jev.ts`, the event hooks in `convex/lib/jevHooks.ts`, the checks in `convex/jevHousekeeping.ts` and the tables in `convex/jevSchema.ts`. Preview: `&ai=jev` (Settings), `&whos=prechecked` (Today), `&suggestions=jev`, `&notes=probably` and `&qanda=jev`.
<!-- end PST-292 -->

<!-- PST-293: decisions and signals -->
## Decisions and signals

Each investor has a decision apart from their stage (`convex/decisions.ts`, table `decisions`): a status (Interested, Maybe, Yes or No), a decide-by date (7 days after the 1st call unless Dev sets or clears it, in the drawer or with ⌘K "Set a decide-by date"), the calls so far (days with a past Calendar meeting, a logged call or meeting, or a move to 1st or 2nd meeting; "ask or drop" at the 3rd) and how long they've been a maybe. Every status change is logged (`decisionLog`) for History and Undo. In the drawer, Y marks Yes.

**Signals (Jev)**: one call per new Gmail message from an investor (Dev's own, auto-replies and no-reply senders skipped; subject plus body, quoted replies and signature cut) asks what they want (deck, data, numbers, a meeting, an intro, nothing), whether it's a pass, and whether it's real interest. One call per new meeting note tied to an investor asks their status, whether they offered to lead, whether they said to come back with a lead, and their interest from 1 to 5. Each lands in `signals` with the answers and probabilities and a reference to the email or note (never the text). Sure answers (a Choice at 0.85, a Noul at 0.85 or 0.15; `THRESHOLDS` in `src/lib/jev.ts`) change the status by themselves, with an Undo toast and "Auto" in History: a pass sets No, "come back with a lead" sets Maybe ("wants a lead"). A Yes or No Dev holds is never changed by itself. Unsure answers become Decide rows; sure asks become Inbox rows. When Jev can't answer, nothing changes.

**Pipeline › Maybes** (`?view=maybes` until PST-295's switcher): maybes, the longest first, with Ask for a yes or no (a "Yes or no" draft), Mark as no or Set a date. **Inbox selectors** for PST-297 are in `src/lib/inbox.ts` (decide-by passed, 3rd call done, new asks, Decide rows); Today shows them in Due today for now. `useDecisions().latestSignal(investor)` is for PST-295's race lanes.

Code: pure parts in `src/lib/decisions.ts` and `src/lib/signals.ts`, hooks in `convex/lib/signalHooks.ts`, Jev calls in `convex/signals.ts`, tables in `convex/decisionsSchema.ts`. Preview: `&drawer=decision`, `&pipeline=maybes`, `&signal=auto` and `&signal=decide`.
<!-- end PST-293 -->
<!-- PST-296: Find more and Jev fit scores -->
## Find more like these, and Priority with Jev

**Find more like these** on Investors (`convex/findMore.ts`, rules in `src/lib/findMore.ts`) starts from the companies one step ahead of Pesto (editable chips, saved in `findSettings`) and the top three Priority investors. The panel shows the estimated cost before anything runs: Haiku's tokens plus a web search per seed (at most 10) at $10 per 1,000, and a Jev call per candidate. A run asks Haiku with the web search tool only (`convex/lib/findPrompt.ts`) for investors who backed those companies or invest alongside those investors, then keeps those with a deal in the last 12 months, drops anyone already in Nest (same firm domain, or the same firm or name once normalised) or already suggested, and keeps at most 30. The run's real cost is on its `findRuns` row and in Settings › AI's spend view under Find more (its Jev calls count under Jev).

Each candidate gets one Jev call with four Score questions (stage fit, check-size fit, thesis fit, recent activity). Jev reads the round's facts (pre-seed, the target, and checks from the minimum check to a quarter of the target) and the candidate's own facts, never another investor's name. Nest weighs the answers into a fit score (`src/lib/fitScore.ts`: stage 0.3, check size 0.25, thesis 0.3, activity 0.15). When Jev answers null (off, no key, the cap), the candidate gets the Priority score Nest always worked out. Each result shows its reason chips, a warm path when someone on the team met or emailed a person at the firm's domain (Gmail and Calendar), and its sources.

"Add" and "Add N to Wave 2" file new-investor suggestions (source `find_more`). Nothing is on the list until Dev accepts one in Suggestions; then it's added as Not contacted (in Wave 2 for the batch), with the firm's domain and its Jev score.

**Sort: Priority** uses the same Jev fit score in place of the light Fit for investors already in Nest (`jevScores`). A score is only recomputed when enrichment keeps a fund fact and the facts Jev reads have changed: Nest hashes those facts with the questions (`factsHash`) and skips the call when the hash matches. There is no sweep.
<!-- end PST-296 -->

## System states

App-wide, in the shell: the ⌘K palette (`openCommandPalette()`, `src/components/system/CommandPalette.tsx`; ranking in `src/lib/palette.ts`), the offline banner (browser offline or the Convex socket down for more than 2.5s), the 404 for any unknown route (`src/routes/_app/$.tsx`), and one loading skeleton (`Skeleton`). Every write goes through `useSaveAction()` (`src/components/system/useSaveAction.ts`): on failure it plays `save-failed` and shows an error toast whose Retry runs the same write again.

## Home

`/` is the company overview (PST-289, `round5/home-company-overview.png`). It greets you by time of day (Asia/Kolkata), then shows three cards from the same data as `/raise`:

- **Raise**: committed of the target, days to close, in conversation (intro made and on) and intros out (intro asked). PST-295 adds "in the race", offers and the lead in the marked slot in `src/routes/_app/index.tsx` (see Pipeline › Race and the lead).
- **Inbox**: the top 4 rows from Today's own lists (Waiting on you, Due today, Gone quiet, then Suggested fixes), one row per investor, through `inboxPreview()` in `src/lib/inbox.ts`. A row opens that investor on Today. PST-297 replaces it with the real Inbox.
- **This week**: the next five working days with investor meetings, dated next steps and phase starts and ends (`thisWeek()` in `src/lib/home.ts`).

The top bar shows only Home and Raise. Growth, Families, Hiring and Ops & Legal are hidden in `src/lib/nav.ts` (`hidden: true`) until each has real content.

Preview: `/?preview&home=default` (or `firstrun`, `prepdone`).

<!-- PST-289 -->
## Feedback

⌘. on any screen (Ctrl+. elsewhere), Send feedback in the avatar menu, or Send feedback in ⌘K opens it (`src/components/system/Feedback.tsx`; rules in `src/lib/feedback.ts`). Pick Bug, Idea, Slow or Confusing, write it, and Send (⌘↵; Esc closes). "Screenshot of this page" is on by default: the browser draws the page with html-to-image (without the dialog) and uploads the PNG to Convex file storage.

Send saves a `feedback` row (type, text, the page path without its query string, viewport, app version, screenshot id) and then makes a Linear issue through Linear's GraphQL API with `LINEAR_API_KEY` (`convex/feedback.ts`, `convex/lib/linear.ts`): team Pesto, project Nest, label Feedback (created on the team if it's missing), titled with the first line of the text. The screenshot goes up with Linear's `fileUpload` flow and is embedded in the description with the page and the viewport. The toast says "Sent as PST-xxx. Thanks!" with Open.

Without a key, or when Linear fails, the row stays "Not sent yet": Raise › Settings › Feedback lists it with Send now, and a cron (`crons.ts`) sends what's waiting every hour once a key is set. Logs carry ids and statuses, never the text.

Preview: `?preview&feedback=open|sent|unsent` (unsent also fills Settings › Feedback with rows waiting and no key).
<!-- end PST-289 -->

<!-- PST-305 -->
## Network: founders, friends and advisors

Investors › Network (it was Introducers) is everyone who can introduce Dev to investors. Filter chips: All, Founders, Friends, Advisors, Angels, and Investors who intro (committed investors, and anyone who also invests). Each row has the relation and company, role chips, how many investors they can introduce, asked, made, meetings, money in, and what's next, sorted by what's next and then by intros made. ⌘K has "Go to Network".

**People**: an `introducers` row now also keeps `company`, `companyDomain` (founders), `roles` (`canIntro`, on by default; `wantsToInvest`; `givesAdvice`, on by default for advisors) and `investorId` when they're also an investor. Relations are founder, friend, advisor, angel, committed (derived) and other. Old `portfolio` rows are read as founders and rewritten once by `network.migrateRelations`, which the Network calls on first load while the list says some are left (`legacy`); it's idempotent, so there's nothing to run by hand. Add person labels its fields by relation (src/lib/network.ts `personFieldCopy`), and editing saves only the fields you touched. Import CSV takes name, email, relation, company and notes, shows a preview first, and skips anyone already there by email or name.

**"To ask"**: an intro with no steps yet is "to ask", ahead of the six steps (which are unchanged). Who do they know adds investors from the list, or a firm and partner not in Nest yet (added as Not contacted, source Network, warm path "via <name>"), each as an intro "to ask". The thank, report-back and nudge rows treat "to ask" as not started, and the Inbox has an "Ask <name> for intros" row (When you can) for someone with investors to ask and no ask waiting on a reply.

**Find their investors** (founders): Haiku with web search looks up who backed the founder's company. Only the company's name and website leave Nest. The panel shows the estimate first; the real cost goes into Settings › AI spend under Find. Up to 15 results (firm, partner when a page names one, round, year, source link), with the ones already in Nest marked by domain or name. Nothing is added until you tick: an investor in Nest gets the founder as a warm path, a new one is added as above, each with an intro "to ask" (`founderLookups`, convex/network.ts).

**Ask for intros**: a draft type (`introAsk`, Haiku). Pick 2–3 of a person's "to ask" investors (the three highest by Priority come ticked); it writes one line on why each fits from Nest's kept facts only (a missing reason stays `[why they fit]`), and a short note about Pesto they can forward. Numbers Nest doesn't have stay `[__]`. Copy it, or send it from nest@ with reply-to you; sending (or "I sent it") ticks Asked on each of those intros and logs no investor touch.

**Wants to invest**: switching it on makes an Angel at Intro asked (source Network) linked both ways, or offers to link an investor already in Nest with the same email or name. The panel shows an Investing card, the row shows their stage, and the investor's drawer says "Also your advisor · <name>" with a link back. They're one person in the Network (a committed investor linked to someone isn't listed twice) and one investor everywhere else. Switching it off unlinks them and keeps the investor, with Undo.

**Agents**: `add_person` and `add_to_network_list` on the MCP server wait in Suggestions like every other agent change, and the same suggestion is never queued twice.
<!-- end PST-305 -->

<!-- PST-294 -->
## Introducers and the forwardable intro

Investors › Introducers (`round5/investors-introducers.png`) lists the people who make intros: an `introducers` row (name, optional email, relation: portfolio founder, angel, friend or other, and notes) for each person, plus every committed investor, who shows up as an introducer without a stored row so you can ask them for intros too. Each row shows how many intros they were asked for, made, turned into meetings and into commitments, and what's next. Clicking one opens their panel with every intro.

An `intros` row joins one introducer (or committed investor) to one investor and dates six steps: asked → they said yes → forwardable sent → intro made → thanked → reported back. Ticking a step ticks the ones before it on the same day; unticking one unticks the ones after it. They can be ticked from the panel and from the drawer's warm path (`round5/drawer-decision-lead-warm-path.png`), which shows the person and their steps. Rules are in `src/lib/introducers.ts`; `warmPathFor(investor, sources)` there (and `useWarmPathFor` in `src/components/introducers/data.tsx`) is what PST-296 reads.

**Migration**: the old free-text warm path (`investors.path`) is turned into people automatically the first time Introducers or a drawer with an unmigrated warm path opens (`introducers.migrate`, signed in). Names are matched after normalising (case, spaces, accents and punctuation), and a lone first name matches the one person with that first name, so the same person across several investors becomes one introducer. Each intro keeps the text it came from in `fromPath`, so running it again does nothing, and the text itself stays on the investor because the list, Today, Insights and the MCP still read it. There's nothing to run by hand.

**The forwardable intro** (`round5/draft-forwardable-intro.png`) is a draft type in the drafts system (Haiku by default, like the others). It writes two emails: the ask to the introducer, and a short note they can forward to the investor. It uses the investor's tracked deck link when Nest has one and `[deck link]` otherwise, and any number the input didn't give (amounts, percentages, multiples, counts) becomes `[__]`, so it never makes up traction or terms. Copy it, or send the ask from nest@ with reply-to you through the usual send; sending (or "I sent it") ticks "asked".

**Today**: `src/lib/inbox.ts` has three selectors in a PST-294 block that PST-297's Inbox takes as they are: thank the introducer the same day the intro is made, report back after the investor decides (a Yes or No on their decision, or committed or passed), and nudge an introducer 3 days after an ask with no reply. Until then they show in Today's Due today and Gone quiet.

Preview: see the PST-294 line under Local setup.
<!-- end PST-294 -->

<!-- PST-295: Pipeline › Race and the lead -->
## Pipeline › Race and the lead

Pipeline has three views, switched with V or the tabs above it: Board, Race and Maybes (PST-293's `src/components/pipeline/Maybes.tsx`, with its count on the tab; `src/components/pipeline/views.ts`). The view is in the URL (`/raise/pipeline?view=race`, `?view=maybes`). Race follows `round5/pipeline-race.png`; the rules are pure functions in `src/lib/race.ts`.

- **Kickoff week**: the dates of the round plan's Kickoff phase (a phase named "Kickoff"); outside it, the same numbers for this week, labelled "This week". Intros out, 1st meetings in the window, firms in the race (Booked through Verbal), partner meetings, offers (Verbal) against two in the same week, and meetings per day from the synced calendar. At two offers the card turns lime.
- **Who's ahead**: a lane per firm in the race, 1st meeting → partner → diligence → offer, with PST-293's decide-by date in effect (Dev's own, else 7 days after the 1st meeting) and its latest signal from `useDecisions().latestSignal` (the next step when there's none). When the leader is past the 1st meeting and a stage ahead of everyone else, the "slow down" note suggests holding it for three working days so the next two can catch up.
- **The lead**: the round's lead is `leadId` on the round settings row; "They're leading" in the drawer sets it (Undo in the toast). Can lead comes from enrichment (`canLead`: yes, no or unknown, and a short reason), but Dev's switch in the drawer (`leadOverride`) always wins, and the existing "Can lead or anchor" box counts as Dev's word too. Enrichment isn't re-run for anyone: new and refreshed enrichments fill it, and a refresh that can't tell keeps the earlier answer. Steps: asked to lead (ticked when an "Ask to lead" draft is marked sent, or by "I already asked") → partner meeting → offer → leading. "Ask if they'll lead" is a draft type (`lead`) and a ⌘K action.
- **Get to a no**: under the race, PST-293's Maybes card, as in the design.
- **Who to update**: in the race, maybes (PST-293's Maybe status), committed, and passed but warm, each with Copy emails, plus Copy all. Nest never sends these: Dev writes the update from their own email and clicks Mark sent, which adds an `investorUpdates` row so the card shows when the last one went out.

Home's Raise card shows in the race, offers and the lead in PST-289's slot (`src/components/race/RaceStats.tsx`).

Code: `convex/race.ts` and `convex/raceSchema.ts`; the UI in `src/components/race/` and `src/styles/race.css`. Preview: `/raise/pipeline?preview&pipeline=race` (or `race-lead`, `update`), `/?preview&home=race` and `&drafts=lead`.
<!-- end PST-295 -->

<!-- PST-303 -->
## Investor fields by type

The drawer's edit form and Add investor name their fields by type, and the labels change as soon as Type does (`src/lib/investorForm.ts`). VCs: Partner, Fund, Partner's email (one card per fund). Accelerators: Programme (and batch), Accelerator, Contact email (optional). Angels: Name, Title or company, Their email. Other emails and domains go one per line under More details. Fields Dev didn't touch show the investor as it is now and Save never writes them, so a type set by enrichment, a suggestion or Jev while the form is open stays. The Investors table's first column is "Name · Firm / title", with a tooltip saying what goes there for each type.

Preview: `/raise/pipeline?preview&drawer=edit-vc` (or `edit-accelerator`, `edit-angel`).
<!-- end PST-303 -->

<!-- ---------- PST-304: UI sounds ---------- -->
## UI sounds

Nest's UI sounds are one designed kit: **SND01 “sine” by Yasuhiro Tsuchiya**, from [SND](https://snd.dev/) (Dentsu), via the `snd-lib` npm package. The kit's code is MIT; the sounds are free to use, and their copyright stays with the designer.

- **Self-hosted.** `vite.config.ts` copies the kit's one sprite (`audioSprite.m4a`, 140 KB) from `node_modules/snd-lib` into `public/sounds/snd01/` whenever Vite starts (dev or build), so the app serves it from its own origin and nothing loads from a CDN. SND's terms forbid redistributing the raw files on their own, so that folder is gitignored and never committed.
- **One table.** `ACTIONS` in `src/lib/sound.ts` maps each Nest action to a kit sound (`play('save')` → BUTTON, `play('undo')` → TRANSITION_DOWN, `play('nope')` → CAUTION…), and `KIT_SOUNDS` holds where each sound sits in the sprite and its gain, so the kit plays at an even loudness. Master volume 30%, ±4% random pitch, never two sounds within 120 ms.
- **Fewer sounds.** Only for something you changed, or a refused action you just tried. Nothing for navigation, ⌘K, the ? sheet, focus moves, hover or page load. `src/lib/soundCalls.test.ts` checks every `play()` call in `src` against the table.
- **Settings › Sounds** has the on/off switch, a Preview button per kind of sound, and the kit's credit (`?preview&settings=sounds`).
<!-- ---------- end PST-304 ---------- -->

<!-- ---------- PST-307: the Advisor ---------- -->
## The Advisor

Raise › Advisor is a fundraising coach (what to do next) and storyteller (how to say it) that chats with you about the raise. ⌘J opens it as a panel on any screen, and it starts from what you're looking at (the route, the Pipeline view, the open investor); "Open full chat" moves the chat to the tab.

- It runs on Sonnet by default; pick Opus for a chat with the model chip, or for one answer with "Ask Opus instead". Settings › AI › Advisor sets the default, the monthly cap and web search.
- It reads all of Nest, read-only (the Nest MCP read tools plus its own reads), and the web for public facts about firms and the market. "From:" chips under an answer show what it read.
- It never sends or changes anything. An email draft lands in Drafts; a Q&A answer or story waits for Save; a change (decide-by, stage, next step, application) waits for "Send to Suggestions" and your OK there; a fact is remembered only after you say yes to "Remember this?". Ticking a plan step sets that investor's next step through the normal save, with Undo, and picking an option sends it back as your next message.
- It never invents a number: anything Nest doesn't have is a [__] blank you fill in.
- The composer shows an answer's estimated cost before you send, and each answer shows what it really cost. A run that would pass this month's cap is refused, with a notice and a link to Settings, and a long run checks the cap again between its turns. Advisor spend shows in Settings › AI's spend view.
- The prompt is in `convex/lib/advisor.ts` and holds no company facts; memory (Settings › AI › Advisor › Memory) is where those live, each one added by you.
<!-- ---------- end PST-307 ---------- -->
<!-- ---------- PST-308 ---------- -->
- An answer shows its words and blocks in the order the model wrote them (`parts` on the message: runs of text and blocks by index). The prompt asks for a short lead-in before each block that names it, never "above" or "below". Answers saved before this show their words, then their blocks.
<!-- ---------- end PST-308 ---------- -->

## Seed

```sh
pnpm seed        # dev: imports internal/seed.json
pnpm seed:prod   # production
```

`seed:importSeed` is an internal mutation: round settings merged over `DEFAULT_ROUND`, plus investors upserted by `slug`. Running it twice changes nothing.

## Deploy

Vercel (nest.pestokids.com) builds with:

```sh
npx convex deploy --cmd 'pnpm build' --cmd-url-env-var-name VITE_CONVEX_URL
```

which pushes Convex functions to production, then runs `vite build` with `VITE_CONVEX_URL` set to the production URL. Vercel needs `CONVEX_DEPLOY_KEY` (production deploy key). TanStack Start builds through Nitro with the `vercel` preset (`vite.config.ts`), which writes `.vercel/output` (Vercel Build Output API). Never deploy to production from a laptop.

Preview deployments (every PR) build with `pnpm build` only: `vercel.json` skips `convex deploy` unless `VERCEL_ENV` is `production`, so a preview never touches the production deployment. Previews set `VITE_PREVIEW_MODE=1` and `VITE_CONVEX_URL` (the dev deployment) for the Preview environment, which turns on `?preview` with the fake fixture. Production never sets `VITE_PREVIEW_MODE`.
