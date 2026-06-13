# Agentic BI Dashboard — Build Brief & Rubric

> Hand this whole file to Claude Code as the kickoff brief. It defines the goal,
> the success criteria, the architecture, and the exact interfaces to build against.
> **Ship target: live URL by 5pm today.**

---

## 1. Brief

**Problem.** Small business owners have their numbers scattered across Shopify,
Google Analytics, Google Ads, Meta, and email tools, with no analyst to
synthesize them into decisions.

**Who it's for.** Non-technical SMB owners and solo marketers who can't read a
SQL dashboard but can ask a question in plain English.

**Product shape.** A **standalone multi-tenant web app**. A user signs in with
**Google**, lands on a dashboard, and connects their own data sources by entering
**their own API keys / tokens** in a **Settings → Connections** page. Each user
sees only their own data. The flagship feature is an **agentic chat** that pulls
the relevant metrics, computes comparisons, flags anomalies, and recommends
actions via tool calls over that user's metrics store.

**Scope today (priority order):**
1. **Auth + multi-tenancy** (Google login, per-user data isolation).
2. **Connections/Settings** where users paste keys (Shopify) or OAuth-connect (GA4).
3. **Shopify — LIVE** (real GraphQL Admin API; demo against the Capgown store). Top integration.
4. **GA4 — LIVE** (OAuth via the Capgown GCP project; friend's Google account as backup).
5. **Google Ads — seeded + CSV** (live deferred; see §2).
6. **Agentic chat** over the connected/seeded data — the differentiator.

**Stubbed ("coming soon" tiles):** Meta Ads, Email (Resend/Mailchimp).

---

## 2. Data Strategy (read this first — it's the #1 risk)

Keys are now **user-supplied via the Connections page** and stored per-user in
Supabase (encrypted, §5). For the demo, you (Raman) sign in and enter the Capgown
Shopify token + connect GA4 via the Capgown GCP.

- **Shopify = lowest-risk live integration.** A custom-app Admin API token, queried
  via the **GraphQL Admin API**, returns real orders/revenue/AOV in minutes. The
  user pastes the token in Connections; you store and use it server-side. Build live first.
- **GA4 = feasible live.** "Connect" is an **OAuth flow**, not a pasted key
  (GA4 has no simple API key). The Capgown GCP removes the painful setup. Fall
  back to seeded/CSV for GA4 only if OAuth fights you — do **not** let it block the ship.
- **Google Ads = seeded/CSV today.** The Connections page collects the fields
  (developer token, client id/secret, customer id), but live pulls stay deferred:
  the Google Ads API **developer token** starts test-only and needs separate Google
  approval (often days) for production data — GCP access doesn't fast-track it.
  Use seeded data + CSV upload now; flip the adapter to live only if a token already
  has Basic Access.

Everything is built behind a clean adapter interface (§9), and **secrets never
reach the client** — adapters run server-side only.

---

## 3. Architecture

```
                 ┌─────────────────────────────────────────────┐
                 │  Next.js app (Vercel)                        │
   Google login  │  ┌───────────┐  ┌──────────┐  ┌───────────┐ │
   ───────────▶  │  │ Dashboard │  │ Settings/ │  │ /api/chat │ │
                 │  │  charts   │  │ Connections│ │ (tool loop)│ │
                 │  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘ │
                 └────────┼──────────────┼──────────────┼───────┘
                          ▼              ▼              ▼
                 ┌─────────────────────────────────────────────┐
                 │  Supabase (Postgres + Auth + RLS + Vault)    │
                 │  auth.users · connections(encrypted) · cache │
                 └───────────────────────┬─────────────────────┘
                                         │ server-side adapters use stored creds
                    ┌────────────────────┼────────────────────┐
                    ▼                    ▼                    ▼
              ShopifyAdapter        Ga4Adapter           AdsAdapter
              (LIVE GraphQL)        (OAuth/seed)         (seed/CSV)
```

Auth is **Supabase Auth (Google provider)**. Hosting: **Vercel** for the Next.js
app + **Supabase Cloud** for DB/Auth. (Railway is a fine alternative if you'd
rather host the app and a long-running backend together; Supabase stays separate
either way.) Chat and charts read the **same per-user store**, so the date-range
selector changes what the agent sees.

---

## 4. Auth & Multi-Tenancy

- **Supabase Auth with the Google provider.** Create an OAuth client in the
  **Capgown GCP** (you have access): add Supabase's callback URL
  (`https://<project>.supabase.co/auth/v1/callback`) as an authorized redirect URI,
  drop the client id/secret into Supabase's Google provider settings. Login is then
  a `supabase.auth.signInWithOAuth({ provider: 'google' })` button.
- **Keep login-OAuth separate from GA4 data-OAuth.** Login asks only for basic
  profile/email scopes. Connecting GA4 is a *second* OAuth consent with the
  `analytics.readonly` scope, triggered from Connections — so users aren't forced
  to grant analytics access just to sign in.
- **Row-Level Security on every table.** Policy: `user_id = auth.uid()`. This is
  what makes "each user sees only their own data" true, not just a UI convention.
- Protected routes redirect unauthenticated users to login; session persists.

---

## 5. Supabase Schema & Secret Storage

```sql
-- Users come from auth.users (managed by Supabase Auth).

create table connections (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  source      text not null check (source in
                ('shopify','ga4','google_ads','meta_ads','email')),
  status      text not null default 'disconnected', -- connected|seeded|disconnected
  config      jsonb not null default '{}',  -- NON-secret fields (domain, property id, customer id)
  secret_ref  text,                          -- pointer to the encrypted secret (see below)
  created_at  timestamptz default now(),
  unique (user_id, source)
);
alter table connections enable row level security;
create policy "own rows" on connections
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Optional: cache pulled metrics to speed the dashboard + reduce API calls.
create table metric_cache (
  user_id uuid references auth.users(id) on delete cascade,
  source  text, day date, payload jsonb, fetched_at timestamptz default now(),
  primary key (user_id, source, day)
);
alter table metric_cache enable row level security;
create policy "own cache" on metric_cache
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
```

**Storing API keys/tokens securely (hackathon-appropriate but not careless):**
- Put the actual secret in **Supabase Vault** (pgsodium-backed) and store only the
  Vault `secret_ref` in the `connections` row. Alternative: an app-level encrypted
  column using a single `ENCRYPTION_KEY` from env (AES-GCM, encrypt/decrypt only in
  server code).
- **Decrypt only server-side** (API routes / server actions). Never send a raw key
  to the browser, never put one in a URL or query string, never log it.
- RLS already isolates rows per user; encryption protects against DB exposure.
- Note in your README that production would move to a managed KMS — judges like
  seeing you know the difference.

---

## 6. Connections / Settings Page

One card per source. Each shows status (connected · seeded · coming soon) and a
**Save & Test** button that pulls one record to verify before marking connected.

- **Shopify** — text inputs: store domain + Admin API access token. On save:
  encrypt token, run a 1-order test query, set status. (See §10 for how to get the token.)
- **GA4** — a **"Connect Google Analytics"** OAuth button (analytics.readonly),
  then a property-ID picker. Store refresh token encrypted.
- **Google Ads** — inputs for developer token, client id/secret, customer id.
  Saves config, but pulls run against seeded/CSV today (live deferred per §2).
  CSV upload control here too.
- **Meta Ads / Email** — disabled "coming soon" cards.

Never echo a saved secret back into the input — show "•••• connected" + a
Replace/Disconnect action.

---

## 7. Rubric (this is the contract — every line must be click-verifiable)

### Auth & multi-tenancy (~15%)
1. Google sign-in works end to end; session persists across reloads; sign-out works.
2. Protected routes redirect to login when signed out.
3. A second user signing in sees **none** of the first user's data (RLS enforced, not just hidden in UI).

### Connections / config (~15%)
4. Settings page lets a user enter Shopify credentials, save, and see a successful test.
5. Saved secrets are stored encrypted and never exposed to the client (verify: not in network responses, not in page source, not in URLs).
6. Each source shows accurate status (connected / seeded / coming soon), including "coming soon" tiles for Meta + Email.

### Agentic chat — the differentiator (~30%)
7. Answers natural-language questions about the user's data ("how did my store do last week vs the week before?").
8. Uses **real tool calls** to fetch/compute metrics — answers trace to actual data, never hallucinated numbers.
9. Computes derived insights on demand: deltas, AOV, ROAS, CPA, conversion rate, top/bottom performers.
10. Surfaces at least one **proactive** insight (e.g. "revenue up but AOV down 15% this week").
11. Recommends a concrete next action tied to the data, not generic advice.

### Shopify (LIVE) — priority integration (~15%)
12. Connects to a live store via GraphQL Admin API using the user's stored token.
13. Shows real metrics: revenue, orders, AOV, top products, sales trend over the selected range.
14. Degrades gracefully on rate limits / empty windows — never crashes.

### Dashboard & other sources (~15%)
15. GA4 view (live if OAuth lands, else seeded/CSV) and Google Ads view (seeded/CSV) render real metrics.
16. Date-range selector updates **both** the charts and what the chat sees.
17. Charts render correctly with empty/sparse data; loads fast, mobile-legible, no console errors.

### Deployment (~10%)
18. Live, publicly reachable URL (Vercel + Supabase Cloud, or Railway).
19. A 60-second happy path a judge can run cold: sign in → see connections → view **live Shopify** numbers → ask a question → get a data-backed answer with a recommendation.

**Out of scope today:** Meta Ads, email integrations, real Google Ads API, team/org accounts.

---

## 8. Suggested Stack

- **Next.js (App Router) + TypeScript** — one deploy target, API routes for chat + adapters.
- **Supabase** — Postgres, Auth (Google provider), RLS, Vault for secrets. `@supabase/ssr` for Next.js session handling.
- **Tailwind + shadcn/ui**; **Recharts** for charts.
- **Anthropic SDK** (`@anthropic-ai/sdk`) for agentic chat with tool use.
- **Shopify GraphQL Admin API** (REST is legacy — don't use it). `@shopify/admin-api-client` or `fetch` + `X-Shopify-Access-Token`.
- **Google Analytics Data API** (`@google-analytics/data`) via OAuth for GA4.
- **Deploy:** Vercel (app) + Supabase Cloud (backend). Railway optional alternative.

---

## 9. Data Adapter Interface

Adapters run **server-side**, read the signed-in user's `connections` row, decrypt
the secret, and return normalized metrics. Build everything against this.

```typescript
export type DateRange = { start: string; end: string };
export type SourceId = 'shopify' | 'ga4' | 'google_ads' | 'meta_ads' | 'email';

export interface ShopifyDailyMetric {
  source: 'shopify'; date: string;
  orders: number; revenue: number; refunds: number;
  newCustomers: number; topProduct?: string;  // AOV derived = revenue/orders
}
export interface Ga4DailyMetric {
  source: 'ga4'; date: string;
  sessions: number; users: number; newUsers: number;
  conversions: number; channel: string; topPage?: string;
}
export interface GoogleAdsDailyMetric {
  source: 'google_ads'; date: string; campaign: string;
  spend: number; clicks: number; impressions: number;
  conversions: number; conversionValue: number;  // for ROAS
}

export interface AdapterContext {
  userId: string;
  config: Record<string, unknown>;       // non-secret fields from connections.config
  getSecret: () => Promise<string | null>; // decrypts server-side
}

export interface DataAdapter {
  source: SourceId;
  label: string;
  isConnected(ctx: AdapterContext): Promise<boolean>;
  test(ctx: AdapterContext): Promise<{ ok: boolean; message: string }>; // for "Save & Test"
  getMetrics(ctx: AdapterContext, range: DateRange): Promise<
    ShopifyDailyMetric[] | Ga4DailyMetric[] | GoogleAdsDailyMetric[]
  >;
}
```

Resolve per source at request time: Shopify → live, GA4 → OAuth (or seeded
fallback), Google Ads → seeded/CSV, Meta + Email → coming_soon. Any unconnected
source falls back to seeded data so the dashboard is never empty.

---

## 10. Shopify Live Setup (priority + demo centerpiece)

**Use the GraphQL Admin API.** REST is legacy (Oct 2024).

**Token (what the user pastes into Connections):**
1. Shopify admin → Settings → Apps and sales channels → **Develop apps** → Create an app.
2. Admin API scopes (read-only): `read_orders`, `read_products`, `read_customers`, `read_reports`.
3. Install → copy the **Admin API access token**.
4. User pastes token + store domain into Connections; you encrypt + store.

> Shopify is moving new custom-app auth toward the Dev Dashboard + client-credentials
> flow during 2026. If in-admin "Develop apps" is unavailable on a store, create the
> app in the **Shopify Dev Dashboard** and use the client-credentials grant. Either
> way the result is a token sent as `X-Shopify-Access-Token`.

**Orders query:**
```graphql
query Orders($query: String!) {
  orders(first: 250, query: $query) {
    edges { node {
      createdAt
      totalPriceSet { shopMoney { amount currencyCode } }
      lineItems(first: 5) { edges { node { title quantity } } }
    } }
    pageInfo { hasNextPage endCursor }
  }
}
```
`query: "created_at:>=2026-05-01 created_at:<=2026-05-31"`. Paginate on
`pageInfo.hasNextPage`; aggregate into `ShopifyDailyMetric[]`. Back off on `THROTTLED`.

---

## 11. GA4 OAuth (second priority — connect from Settings)

1. In the **Capgown GCP**, enable the **Google Analytics Data API**, configure the
   OAuth consent screen, and create an OAuth client (web). Redirect URI → your
   `/api/oauth/ga4/callback`.
2. Connect button requests scope `https://www.googleapis.com/auth/analytics.readonly`.
3. Store the refresh token encrypted; let the user pick a **GA4 property ID**.
4. Pull with `@google-analytics/data` `runReport` (dimensions: date, channel;
   metrics: sessions, totalUsers, conversions). If any step snags, fall back to
   seeded/CSV for GA4 — don't block the ship.

---

## 12. Seeded Data (for any source not yet live)

~60 days of daily data so period-over-period works. Bake one **deliberate anomaly**
(Shopify AOV drops ~15% in the last 7 days, or an Ads campaign CPA spike) so the
proactive-insight rubric item (#10) has something real to find.

Derived on demand: `AOV = revenue/orders`, `CTR = clicks/impressions`,
`CPA = spend/conversions`, `ROAS = conversionValue/spend`,
`conversion rate = conversions/sessions`.

---

## 13. Chat Tool Definitions (the agentic core)

Tools live in `/api/chat`; run a tool-use loop. The agent **calls tools for real
numbers**, then reasons. Surface tool calls in the UI ("Pulling Shopify revenue…
comparing to last week"). Tools must scope every query to the signed-in `user_id`.

```typescript
const tools = [
  { name: "get_metrics_summary",
    description: "Aggregated totals for a source over a date range.",
    input_schema: { type: "object", properties: {
      source: { type: "string", enum: ["shopify","ga4","google_ads"] },
      start: { type: "string" }, end: { type: "string" }
    }, required: ["source","start","end"] } },

  { name: "compare_periods",
    description: "Compare a metric between two ranges; returns delta and % change.",
    input_schema: { type: "object", properties: {
      source: { type: "string", enum: ["shopify","ga4","google_ads"] },
      metric: { type: "string", description: "revenue, orders, aov, spend, conversions, ctr, roas, cpa, sessions" },
      current: { type: "object", properties: { start:{type:"string"}, end:{type:"string"} }, required:["start","end"] },
      previous:{ type: "object", properties: { start:{type:"string"}, end:{type:"string"} }, required:["start","end"] }
    }, required: ["source","metric","current","previous"] } },

  { name: "breakdown_by_dimension",
    description: "Rank performers by metric, by product (Shopify) / campaign (Ads) / channel (GA4).",
    input_schema: { type: "object", properties: {
      source: { type: "string", enum: ["shopify","ga4","google_ads"] },
      dimension: { type: "string", enum: ["product","campaign","channel"] },
      metric: { type: "string" }, start: { type: "string" }, end: { type: "string" },
      order: { type: "string", enum: ["asc","desc"], default: "desc" }
    }, required: ["source","dimension","metric","start","end"] } },

  { name: "detect_anomalies",
    description: "Scan recent data for spikes/drops vs the prior period; use to surface concerns proactively.",
    input_schema: { type: "object", properties: {
      source: { type: "string", enum: ["shopify","ga4","google_ads"] },
      lookbackDays: { type: "number", default: 7 }
    }, required: ["source"] } }
];
```

**System prompt guidance:** always use tools for numbers; lead with the number,
then the comparison, then **one concrete recommended action**; proactively run
`detect_anomalies` on open-ended "how am I doing" questions; be concise.

---

## 14. Suggested Build Order (to hit 5pm)

1. **Scaffold** Next.js + Tailwind + shadcn; deploy a hello-world to **Vercel first** (de-risk deploy).
2. **Supabase project** + `connections` table + RLS; wire **Google login** (Capgown GCP OAuth client). Confirm sign-in/out + a protected route.
3. **Connections page — Shopify card only**: paste token → encrypt → **Save & Test** pulls one real order. This validates auth + secrets + live data in one slice.
4. **Adapter interface + store + MockAdapter** so unconnected sources still render.
5. **Dashboard** (Shopify live + seeded GA4/Ads) with date-range selector.
6. **Chat API route** with the 4 tools + tool-use loop, scoped to `user_id`. Most time here — it's the differentiator.
7. **Chat UI** with a visible tool-call trace.
8. **Expand if time:** GA4 OAuth connect, Google Ads CSV upload, remaining Connections cards.
9. **Polish:** first-run/empty states, "coming soon" tiles, mobile, loading states.
10. **Final deploy + run the 60-second happy path** on the live URL.

> Protect the differentiator: do **not** build all five Connections cards before
> the chat works. Auth + one live Shopify connection + chat is the spine.

---

## 15. Demo Happy Path (rehearse for judges)

1. **Sign in with Google** → land on the dashboard.
2. Open **Connections** → show the Shopify card connected, GA4 connectable, Ads + the "coming soon" tiles. (Tells the multi-tenant "bring your own keys" story.)
3. Dashboard shows **real Capgown Shopify** revenue/orders/AOV for the last 30 days. Lead with live data.
4. Chat: *"How did the store do last week vs the week before?"* → judge sees tool calls fire, then a data-backed answer with deltas.
5. Chat: *"Anything I should be worried about?"* → agent runs anomaly detection, finds the AOV drop, recommends a concrete next move.

That last beat — proactive insight + recommendation grounded in **real** data, in
**your own** authenticated account — is the moment that wins the room.
