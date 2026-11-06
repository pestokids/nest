# Nest

Pesto's internal app. Its first section is the **pre-seed raise tracker** under `/raise`: every investor, their stage, next step and date, an activity log, and weekly targets to the close. Other internal tools can move in later as their own sections.

## Layout

```
src/            Frontend: TanStack Start (React, TypeScript, file-based routes)
  routes/       / → /raise/today; /raise/{today,pipeline,investors,plan,settings}
  components/   Shell (round band, tabs), drawer, auth gate, data providers
  lib/          Shared logic: stages, scoring, round maths, dates, money, CSV (unit-tested; also imported by convex/)
  styles.css    The prototype's stylesheet, both themes
convex/         Backend: schema, queries, mutations, Convex Auth (Google), seed
scripts/        Auth key generator, unauthenticated-access check
internal/       Private, never committed (prototype, seed.json); copied into worktrees by .worktreeinclude
```

The app is a Convex client: no server functions of our own, and the `/raise` routes are client-rendered (`ssr: false`), so nothing private is rendered on the server.

## Local setup

```sh
pnpm install
cp .env.example .env.local   # or let .worktreeinclude copy it in
pnpm dev                     # convex dev (push + watch) and Vite on http://localhost:3000
```

Other scripts: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm dev:web` (Vite only).

Dev-only preview: `http://localhost:3000/raise/today?preview` renders every view from `internal/seed.json` with in-memory writes, without signing in. It's stripped from production builds.

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

Google sign-in only (Convex Auth). Google must report the email as verified. Every public query and mutation calls `requireUser(ctx)` (`convex/lib/access.ts`), which checks the user's email against `ALLOWED_EMAILS` and throws otherwise. An account that signs in but isn't on the list is signed out with "This account doesn't have access". `access:status` is the only public function that answers outsiders, and it returns nothing but their own status.

Check it: `node --env-file=.env.local scripts/check-unauth.mjs <investor id>` calls every public function signed out and expects each to be refused.

## Round settings

Nothing about the raise is hard-coded. Target, stretch, close and kickoff dates, instrument, cap, minimum check, phases (dates, targets, to-dos), stage odds, the "gone quiet" days and wave labels live in the `settings` row keyed `round`, editable on `/raise/settings`; each change is logged in `settingsLog`. `src/lib/round.ts` `DEFAULT_ROUND` (neutral placeholders) is used only until that row exists. Dollar phase targets are stored as a share of the raise target, so changing the target rescales them.

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
