# Pulse — Build Session Log

**Event:** Claude Build Day (SF) · **Date:** 2026-06-13 · **Model:** Claude Opus 4.8
**Live URL:** https://claude-code-build-day-sf.vercel.app
**Repo:** https://github.com/rahujacto/ClaudeCodeBuildDaySF

> This log documents how the build was directed and how Claude verified its own
> work. The **brief and rubric** are in [`README.md`](README.md). What was built
> during the event is everything in `src/` plus the Supabase schema and the
> deployment — all of the commit history below.

---

## 1. What we built

**Pulse** — an agentic AI business analyst for a small Shopify store. The owner
signs in with Google, connects their own data sources (bring-your-own-keys), and
then *asks questions in plain English*. A docked assistant runs **real tool
calls** over the user's live data, computes period-over-period comparisons,
proactively flags anomalies, and recommends a concrete next action. A dashboard
visualizes the same per-user store, and the date range drives both the charts
and what the agent sees.

The differentiator is the **agentic chat**, not the dashboard (kept deliberately
in line with the event's "no dashboard-as-main-feature" rule).

**Live, real integrations:**
- **Shopify** — GraphQL Admin API, live (Capgown / cap-and-gown store).
- **Google Analytics 4** — OAuth + Data API, live, with **property auto-detection
  by matching the GA4 web-stream domain to the Shopify store's primary domain**.

---

## 2. How the build was directed (orchestration)

The operator gave Claude the brief + rubric ([`README.md`](README.md)) and the
event PDF, and required a **stop-and-check at three gates**. Claude tracked the
plan with a task list and ran each gate to a verified state before continuing.

### Gate 1 — Foundation
Scaffolded Next.js 16 (App Router) + TypeScript + Tailwind v4 + shadcn/ui,
deployed to Vercel via the GitHub integration. Committed a `.gitignore` that
ignores all `.env*` **before** the first commit. Verified the live URL (HTTP 200
on `/` and `/login`) before proceeding.

### Gate 2 — Auth + live Shopify spine
- Supabase (`@supabase/ssr`) with Google OAuth login; a `proxy.ts` (Next 16's
  middleware) refreshes sessions and guards protected routes.
- `connections` + `metric_cache` tables with **Row-Level Security**
  (`user_id = auth.uid()`), applied via the Supabase Management API and verified
  by querying `pg_policies`.
- App-level **AES-256-GCM** secret encryption; tokens encrypted before they touch
  the DB, decrypted only server-side.
- Connections page with a Shopify card; **Save & Test pulls one real order**
  before storing.

### Gate 3 — Agentic chat (the differentiator)
- `/api/chat` runs an Anthropic **tool-use loop** (`claude-opus-4-8`, adaptive
  thinking) scoped to the signed-in user (RLS), streaming SSE events so the UI
  shows tool calls firing.
- Four tools: `get_metrics_summary`, `compare_periods`,
  `breakdown_by_dimension`, `detect_anomalies` — pure computations over live data.
- Chat UI renders the live tool-call trace + a streamed, data-backed answer with
  a recommendation.

### Expand-if-time (after gates, operator-directed)
Recharts dashboard + date-range selector (incl. YTD) wired to a cookie the chat
reads; a persistent minimizable chat dock; the GA4 live integration with domain
auto-match; a combined revenue+sessions chart; landing-page redesign.

---

## 3. Moments Claude caught & fixed its own failures

These were found and fixed by Claude during the build (not by the operator):

1. **App-wide serif bug.** After the landing redesign, the hero rendered in Times
   serif. Claude diagnosed a self-referential `--font-sans: var(--font-sans)` in
   `globals.css` (shadcn init artifact) that left `font-sans` undefined →
   browser serif fallback **across the entire app**. Fixed to point at the Geist
   variable. (`bb0ec4e`)
2. **Don't crash the live site before env vars exist.** Recognized the `proxy`
   runs on every route and would 500 the public homepage if it called Supabase
   with missing env. Added a graceful pass-through guard so the deployed site
   stayed up between Gate 1 and Gate 2 config. (`da6ab5e`)
3. **Shopify token model mismatch.** The Capgown store uses the **Dev Dashboard**
   (no in-admin `shpat_` token). Claude pivoted to the **client-credentials
   grant**, minting + caching tokens server-side from a stored Client ID/secret —
   which also removed the 24-hour token-expiry footgun. (`a965211`)
4. **`redirect_uri_mismatch` on Google login.** Diagnosed by extracting the exact
   `redirect_uri`/`client_id` Supabase sends to Google and pointing the operator
   at the precise GCP field to fix.
5. **Chat dock scroll.** Long answers overflowed the dock. Identified the classic
   flexbox issue (a flex child needs `min-h-0` to scroll) and fixed it. (`74f7495`)
6. **GA4 403 opacity.** The generic "denied access" message hid the real cause, so
   Claude changed the adapter to surface Google's literal `error.message` (API not
   enabled vs. no property access) to make the fix obvious. (`964b3f8`)

---

## 4. How "done" was made verifiable (without a human)

- **Type safety / build:** `tsc --noEmit` and `next build` run green before every
  ship; routes enumerated in build output.
- **Live HTTP checks:** curl assertions against the deployed URL (route codes,
  redirects, presence of copy) after each deploy.
- **Live data pipeline, proven independently:** a standalone script exercised the
  Anthropic tool-use loop against the live store — the agent called
  `get_metrics_summary` for two periods in parallel and returned correct deltas
  (revenue −44.7% WoW, AOV steady) with a concrete recommendation — confirming
  model id, tool format, and reasoning before wiring the UI.
- **Security verified at the DB:** queried the row after Save & Test to confirm
  `secret_ref` is ciphertext (not the raw token), no secret leaked into `config`,
  and the row is `user_id`-scoped under RLS.
- **The rubric file itself** ([`README.md`](README.md) §7) is the gradeable
  contract Claude optimized against.

---

## 5. Architecture

```
Next.js (Vercel) ── Supabase (Postgres + Auth + RLS)
  /                         · auth.users (Google OAuth)
  /login                    · connections (encrypted secret_ref, RLS)
  /dashboard  (charts)      · metric_cache (RLS)
  /connections (BYO keys)
  /api/chat   (tool loop) ─ Anthropic claude-opus-4-8 (adaptive thinking)
        │
        └ server-side adapters (decrypt creds, RLS-scoped):
             ShopifyAdapter  → GraphQL Admin API (client-credentials)
             Ga4Adapter      → OAuth + Admin API (auto-detect) + Data API
```

- Secrets are AES-256-GCM encrypted with an env `ENCRYPTION_KEY`, decrypted only
  in server routes. **Production note:** this would move to a managed KMS /
  Supabase Vault — the env-key approach is the hackathon-appropriate version of
  the same pattern.
- The date-range selector writes a `pulse_range` cookie; `/api/chat` reads it so
  the agent defaults to the window the user is viewing (charts + chat in sync).

---

## 6. Rubric coverage (see README §7)

- **Auth & multi-tenancy:** Google sign-in, session persistence, protected-route
  redirects, RLS enforced at the DB (verified via `pg_policies`).
- **Connections/config:** Shopify Save&Test (one real order); GA4 OAuth connect
  with domain auto-match; secrets encrypted, never sent to client.
- **Agentic chat:** real tool calls, derived metrics (deltas/AOV), proactive
  anomaly detection, concrete recommendations — across **two live sources**.
- **Shopify live:** revenue/orders/AOV/top products over the selected range;
  throttle back-off + graceful empty states.
- **Dashboard & other sources:** Shopify + **live GA4**, combined chart,
  date-range selector drives charts **and** chat.
- **Deployment:** live public URL; 60-second cold happy path.

---

## 7. Commit timeline

| Time | Commit | Summary |
|---|---|---|
| 11:51 | f1a4528 | Gate 1: scaffold Next.js + TS + Tailwind v4 + shadcn |
| 12:14 | da6ab5e | Gate 2: auth + Shopify live data spine |
| 12:38 | 3835150 | Fix Base UI link-button warning |
| 12:55 | a965211 | Gate 2: Shopify via Dev Dashboard client-credentials grant |
| 13:54 | 72d50c1 | Gate 3: agentic chat with tool-use loop over live Shopify |
| 14:16 | bb0ec4e | Redesign landing + fix app-wide serif fallback |
| 14:19 | e854d4a | Landing copy: single-pane-of-glass framing |
| 14:23 | bba2c86 | Landing: Shippo in integrations grid |
| 14:34 | 87cd228 | Dashboard: metric cards + trend chart + date-range selector |
| 14:46 | 2e22e7a | Landing: agentic action-taking section |
| 14:57 | 45ac6c3 | Persistent chat dock + YTD range |
| 15:14 | b04d6a2 | GA4 live integration (OAuth + Data API) + domain auto-match |
| 15:32 | c95c251 | GA4: account chooser + reconnect |
| 15:36 | 7e34de7 | Dashboard: GA4 strip |
| 15:38 | f228ed3 | GA4: subdomain-tolerant auto-match |
| 15:46 | ba9631b | Landing: "boost your business with AI" CTA |
| 15:48 | 964b3f8 | GA4: surface Google's real error message |
| 16:00 | 437d92a | Dashboard: GA4 row + combined revenue/sessions chart |
| 16:09 | 74f7495 | Fix chat scroll + GA4 top-channels full-width row |
| 16:11 | 2914a90 | Landing: "Shopify store" wording |

---

## 8. 60-second demo happy path

1. Sign in with Google → land on the dashboard.
2. Connections → Shopify **connected** (live), Google Analytics **connected**
   (auto-matched to the store domain).
3. Dashboard shows live **Shopify** (revenue/orders/AOV) + **GA4**
   (sessions/users/channels), one combined chart; toggle 7/30/90/YTD.
4. Open the docked assistant → *"What can you tell me from my site traffic and
   Shopify orders?"* → watch tool calls fire → data-backed cross-source answer
   with a recommendation.
5. *"Anything I should worry about?"* → proactive anomaly detection + a concrete
   next move.
