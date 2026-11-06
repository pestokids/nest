# Nest

Pesto's internal app. Its first section is the **pre-seed raise tracker** under `/raise`: every investor, their stage, next step and date, an activity log, and weekly targets to the close. Other internal tools can move in later as their own sections.

## Layout

```
src/            Frontend: TanStack Start (React, TypeScript, file-based routes)
  routes/       _app (signed-in layout: top bar) → / Home, /raise/{today,pipeline,investors,plan,settings}
  components/   ui/ (design system: Button, Chip, Input, Tabs, Toast, Icon…), sign-in desk, top bar, Home logo tile, data providers
  lib/          Shared logic: stages, scoring, round maths, dates, money, CSV, Home, motion, sound (unit-tested)
  styles/       Plain CSS: tokens (named after the Sketch swatches), base, motion, ui, shell, sign-in, home, raise
  preview/      Dev-only ?preview fixture (made-up data)
public/         mascot/ (WebP), sounds/ (UI sounds)
convex/         Backend: schema, queries, mutations, Convex Auth (Google), seed
scripts/        Auth key generator, unauthenticated-access check, preview screenshots
internal/       Private, never committed (design handoff, prototype, seed.json); copied into worktrees by .worktreeinclude
```

Everything behind sign-in is client-rendered (`ssr: false` on the `_app` layout), so nothing private is rendered on the server. The app is a Convex client with no server functions of our own.

## Design system

Tokens are CSS custom properties in `src/styles/tokens.css`, named after the Sketch swatches (`Brand/Forest` → `--brand-forest`), light theme only. Fonts: Bricolage Grotesque (display, at its 14pt optical size), Inter (UI), JetBrains Mono (labels). Components live in `src/components/ui/`; illustrations in `src/components/illustrations.tsx`.

Motion (`src/lib/motion.ts` + `src/styles/motion.css`): rise, pop, wobble, shake, pulse, shine, bob, confetti and toast slide, all respecting `prefers-reduced-motion`. Sound (`src/lib/sound.ts`): one Web Audio player, `play(name, { volume, delay, rate })`, silent until the first gesture, while the tab is hidden, or when the user turns Sounds off in the avatar menu (stored per user in Convex, `prefs` table).

## Local setup

```sh
pnpm install
cp .env.example .env.local   # or let .worktreeinclude copy it in
pnpm dev                     # convex dev (push + watch) and Vite on http://localhost:3000
```

Other scripts: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm dev:web` (Vite only).

Dev-only preview: `http://localhost:3000/?preview` renders Home and every Raise view from a small made-up fixture (`src/preview/fixture.ts`) with in-memory writes, without signing in. Add `&seed` to use `internal/seed.json` instead, `&home=firstrun` or `&home=prepdone` for the Home states, `&signin=default|hover|checking|noaccess|error|signedout` for the sign-in states, `&today=nothingdue|win` for Raise · Today, or `&drawer=view|edit|new|advance|touch|history|delete` for the investor drawer (on any Raise view; add `&sheet` for the phone bottom sheet at any width). It's stripped from production builds.

Screenshots of every preview screen at 1440 × 900, 440 × 956 and 412 × 915: run `pnpm dev:web`, then `node scripts/screenshots.mjs http://localhost:3000` (writes to `.context/screens/`). They use the fixture, never real data.

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

Google OAuth redirect URI per deployment: `https://<deployment>.convex.site/api/auth/callback/google`.

## Access

Google sign-in only (Convex Auth). Google must report the email as verified. Every public query and mutation calls `requireUser(ctx)` (`convex/lib/access.ts`), which checks the user's email against `ALLOWED_EMAILS` and throws otherwise. An account that signs in but isn't on the list is signed out with "This account doesn't have access". `access:status` is the only public function that answers outsiders, and it returns nothing but their own status (and their own name and email, for the avatar menu and the "Not on the list" screen).

Check it: `node --env-file=.env.local scripts/check-unauth.mjs <investor id>` calls every public function signed out and expects each to be refused.

## Round settings

Nothing about the raise is hard-coded. Target, stretch, close and kickoff dates, instrument, cap, minimum check, phases (dates, targets, to-dos), stage odds, the "gone quiet" days and wave labels live in the `settings` row keyed `round`, editable on `/raise/settings`; each change is logged in `settingsLog`. `src/lib/round.ts` `DEFAULT_ROUND` (neutral placeholders) is used only until that row exists. Dollar phase targets are stored as a share of the raise target, so changing the target rescales them.

## Raise · Today and the investor drawer

`/raise/today` (`src/routes/_app/raise/today.tsx`, rules in `src/lib/today.ts`): the summary card, **Your next 3 moves** (the current phase's unmet targets in phase order, then "ask for a number" for the furthest-along conversation between a first meeting and a yes that hasn't been asked yet; filled in from what's due, who's quiet and who's next), the KPIs, **Due today** (a next step dated today or earlier on a live conversation, or a parked investor whose park-until day has come), **Gone quiet** (live and uncommitted, no touch in the round's quiet days) and **How a conversation moves**. Logging the ask, ticking a due step and nudging all write an activity with a `touch` kind (`ask`, `done`, `nudge`).

The drawer (`src/components/Drawer.tsx`) is a side drawer on desktop and a bottom sheet on phones (swipe down or tap outside to close). Only moving forward a stage celebrates (`celebrates()` in `src/lib/today.ts`); back, passed, parked and reopening don't. Delete hides the investor at once and sends the delete when the Undo toast goes (6s), or straight away when you leave Raise or close the tab.

## Home

`/` greets you by time of day (Asia/Kolkata) and shows the round from the same data as `/raise`: committed and phases, days to close, the current phase's prep checklist, the list against its phase targets, and the next three dated items. Checklist ticks live in the `prepTicks` table (phase key, to-do index, done by, done at); unticking deletes the row.

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
