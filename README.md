# Tarrow

**An AI agent that knows your life, and does the work.** Tarrow interviews you, keeps a living "life file" on you, then researches, plans and takes action on your goals, showing every step while it works (for 10 seconds or 45 minutes).

Live: https://tarrow.vercel.app · iOS + Android: Capacitor shell in `ios/` and `android/`

## What it does

- **Chat first, no account needed**: no landing page. Signed-out visitors land in the interview itself. Their first answer asks for the AI data-sharing OK, then a guest account runs the interview plus 3 free tasks. Signing up or logging in (Google, Apple, email) moves everything into the real account.
- **Onboarding interview**: your first chat is a real conversation (work, money, goals, blockers, people, health, interests) that saves structured memories as you talk. It stays in the chat list and can be continued.
- **Terminal UI**: looks like Claude Code: monospace transcript, `● Tool(args)` / `└ result` lines, thinking spinner with "Thought for Ns", slash commands, shift+tab effort modes, esc to interrupt. Light theme by default, dark and system in Settings or `/theme`.
- **Memory**: memories + an auto-rewritten life file, fully viewable and editable.
- **Agent runs**: Claude-Code-style live activity: status line with timer, tool steps, interim notes, plan checklist, parallel sub-agents, streaming Markdown answers with cited sources.
- **Effort modes**: Auto (triage), Fast, Standard, Deep (plans and spawns sub-agents), Marathon (multi-wave research, saved report).
- **Tools**: web search, page reading (with JSON-LD event extraction), Google Maps places, events finder, weather, goals and tasks, calendar event cards (Google/Apple), message drafts (Mail/SMS/WhatsApp), routines (approval-gated recurring jobs), Library documents.
- **Gmail**: connect it in Settings → Connected accounts (or `/gmail`). The agent can then search and read mail (`gmail_search`, `gmail_read`) and write real Gmail drafts (`gmail_draft`) that show up as a card with a Send button; the user edits and sends, Tarrow never sends. Works in the native apps via the system browser + `tarrow://gmail` deep link. Tokens are AES-GCM encrypted at rest with `GMAIL_TOKEN_KEY`.
- **Proactive**: "For you" suggestions generated from your life file; routines run daily/weekly in the background, with web push when long tasks finish.
- **Voice**: speech input transcribed with Whisper (Groq).
- **Plans**: Free (10 tasks/day, Fast + Standard, 1 routine) and Pro at $20/month or $100/year (150/day, Deep + Marathon, 20 routines). Billed with Stripe on the web, StoreKit 2 on iOS and Play Billing on Android, verified server-side (no RevenueCat).
- **Native**: iOS and Android Capacitor shells with Sign in with Apple, APNs push, haptics and share.

## Architecture

| Piece | Where |
| --- | --- |
| LLM router: GLM-5.3-Flash via OpenRouter, DeepSeek V4.1 Flash backup, Groq fallback (or any OpenAI-compatible endpoint via env), with per-call cost tracking | `src/lib/llm.ts` |
| Billing: Stripe, App Store (StoreKit 2 server verification), Google Play | `src/lib/billing/` |
| Gmail connector: OAuth, encrypted tokens, search/read/drafts/send | `src/lib/gmail.ts` + `src/app/api/integrations/gmail/` |
| Agent runtime: leases, chained worker slices, sub-agents, compaction, finalize | `src/lib/agent/runtime.ts` |
| Tools | `src/lib/agent/tools.ts` |
| Prompts (main, interview, sub-agent, triage) | `src/lib/agent/prompts.ts` |
| Life file + suggestions | `src/lib/agent/memory.ts` |
| Search + page reader (SSRF-guarded) | `src/lib/web.ts` |
| Live stream (SSE over DB events) | `src/app/api/runs/[id]/stream/route.ts` + `src/components/chat/useRunStream.ts` |

Runs are rows in Postgres. `/api/chat` creates a run and kicks `/api/worker`, which takes a lease and works for about 230s. If the task isn't finished, it saves state and kicks a fresh invocation, so tasks can run far past serverless time limits. Sub-agents are child runs; the parent sleeps (`waiting`) until they finish. The stream endpoint also acts as a watchdog that re-kicks stalled runs, and a daily cron sweeps stragglers and fires routines.

## Setup

```bash
pnpm install
vercel env pull .env.local        # DATABASE_URL (Neon)
# add: OPENROUTER_API_KEY, GROQ_API_KEY, GOOGLE_PLACES_API_KEY, WORKER_SECRET, CRON_SECRET, APP_URL (prod)
node --env-file=.env.local scripts/migrate.mjs
pnpm dev
```

Optional env: `OWNER_EMAILS` (owner-only features: coaches, Pipeline), `NEXT_PUBLIC_SUPPORT_EMAIL`, `OPENROUTER_API_KEY` (+ `OPENROUTER_MODELS`), `LLM_BASE_URL`/`LLM_API_KEY`/`LLM_MODELS`, `LLM_MAX_INPUT_TOKENS` (raise to ~30000 on paid tiers), `TAVILY_API_KEY` / `BRAVE_API_KEY` / `SERPER_API_KEY` (reliable search), `DAILY_RUN_LIMIT`.

Gmail connector: set `GMAIL_TOKEN_KEY` (any long random string; rotating it disconnects everyone) next to `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, and in Google Cloud: enable the **Gmail API**, add `<APP_URL>/api/integrations/gmail/callback` to the OAuth client's redirect URIs, and add the `gmail.readonly` + `gmail.compose` scopes to the consent screen. Until the app passes Google's verification for those (restricted) scopes, only test users listed on the consent screen can connect and they see an "unverified app" warning. QA: `node qa/gmail-check.mjs [base]`.

## QA

```bash
node qa/api-smoke.mjs https://tarrow.vercel.app "prompt" standard   # API + agent run, prints the event stream
node qa/e2e.mjs https://tarrow.vercel.app qa/shots                  # Playwright UI suite (mobile + desktop)
```

## Mobile

- `pnpm cap:sync` copies the offline shell and syncs native projects. The apps load `https://tarrow.vercel.app/home`, so web deploys ship to mobile instantly.
- **Android**: GitHub Actions → *Android build* (signed AAB + APK artifacts; `publish` uploads to Play internal testing once the app exists in Play Console).
- **iOS**: GitHub Actions → *iOS build* (App Store-signed IPA artifact; `upload` sends it to TestFlight once the app record exists in App Store Connect).
- Icons/splash: `node scripts/make-icons.mjs && npx capacitor-assets generate`.
