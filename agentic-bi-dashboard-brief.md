# Agentic BI Dashboard — Build Brief & Rubric

> Hand this whole file to Claude Code as the kickoff brief. It defines the goal,
> the success criteria, the architecture, and the exact interfaces to build against.
> **Ship target: live URL by 5pm today.**

---

## 1. Brief

**Problem.** Small business owners have their numbers scattered across Google
Analytics, Google Ads, Meta, Shopify, and email tools, with no analyst to
synthesize them into decisions.

**Who it's for.** Non-technical SMB owners and solo marketers who can't read a
SQL dashboard but can ask a question in plain English.

**What "done" looks like today.** A deployed dashboard surfacing GA4 + Google
Ads metrics, with an *agentic* chat that doesn't just answer questions but pulls
the relevant metrics, computes comparisons, flags anomalies, and recommends
actions — using tool calls over the metrics store.

**Scope today:** Google Analytics (GA4) + Google Ads only.
**Stubbed (visible "coming soon"):** Meta Ads, Shopify, Email (Resend/Mailchimp).

---

## 2. Data Strategy (read this first — it's the #1 risk)

Real Google Ads API access needs a developer token Google must approve (days).
GA4's Data API needs a GCP project + OAuth consent screen and can eat the whole
afternoon if anything snags.

**Decision: build to a clean adapter interface, backed today by (a) realistic
seeded data and (b) CSV upload** (GA4 and Google Ads both export CSV natively).
The agentic chat — the actual differentiator — gets all the time, and a real
OAuth/API adapter drops in behind the same interface later with zero UI/chat
rewrites.

This is non-negotiable for the 5pm ship. Do not block on live API auth.

---

## 3. Rubric (this is the contract — every line must be click-verifiable)

### Agentic chat — the differentiator (~40%)
1. Answers natural-language questions about the data ("how did my ads do last week vs the week before?").
2. Uses **real tool calls** to fetch/compute metrics — answers trace to actual data in the store, never hallucinated numbers.
3. Computes derived insights on demand: period-over-period deltas, ROAS, CPA, conversion rate, top/bottom performers.
4. Surfaces at least one **proactive** insight (e.g. "your CPA jumped 40% on Campaign X this week"), not only reactive answers.
5. Recommends a concrete next action tied to the data, not generic advice.

### Dashboard functionality (~25%)
6. GA4 view: sessions, users, conversions, top channels/pages over a selectable date range.
7. Google Ads view: spend, clicks, impressions, CTR, conversions, ROAS by campaign.
8. Date-range selector works and updates **both** the charts and what the chat sees.
9. Charts render correctly with empty/sparse data instead of crashing.

### Data layer (~15%)
10. Adapter interface cleanly separates data source from UI/chat (swap mock → CSV → API without rewrites).
11. Realistic seeded data loads on first run; CSV upload for GA4/Ads works.

### Polish & demo (~10%)
12. Loads in under ~2s, mobile-legible, no console errors on the deployed URL.
13. A clear empty/first-run state guiding the user to data + a sample question.

### Deployment (~10%)
14. Live, publicly reachable URL (Vercel/Render).
15. A 60-second happy path a judge can run cold: open → see metrics → ask a question → get a data-backed answer with a recommendation.

**Out of scope today:** Meta Ads, Shopify, email integrations, multi-user auth, real Google Ads API.

---

## 4. Suggested Stack (optimized for shipping fast)

- **Next.js (App Router) + TypeScript** — one deploy target, API routes for the chat.
- **Tailwind + shadcn/ui** for fast, clean UI.
- **Recharts** for charts.
- **Anthropic SDK** (`@anthropic-ai/sdk`) for the agentic chat with tool use.
- **In-memory / JSON store** for metrics today (seeded + CSV-parsed). No DB needed to ship.
- **Deploy to Vercel.**

---

## 5. Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Dashboard  │     │   /api/chat      │     │  Metrics Store  │
│  (charts +  │────▶│  (Claude + tool  │────▶│  (adapter-fed)  │
│   chat UI)  │     │   use loop)      │     │                 │
└─────────────┘     └──────────────────┘     └────────┬────────┘
                                                       │
                                       ┌───────────────┼───────────────┐
                                       ▼               ▼               ▼
                                  MockAdapter     CsvAdapter      (later) ApiAdapter
                                  (seeded)        (upload)        (GA4/Ads OAuth)
```

The chat and the charts **read from the same store**, so the date-range selector
changes what the agent sees. This is what makes rubric item #8 pass.

---

## 6. Data Adapter Interface

Build everything against this. The store is fed by whichever adapter is active.

```typescript
// types.ts
export type DateRange = { start: string; end: string }; // ISO dates

export interface DailyMetric {
  date: string;            // ISO
  source: 'ga4' | 'google_ads';
}

export interface Ga4DailyMetric extends DailyMetric {
  source: 'ga4';
  sessions: number;
  users: number;
  newUsers: number;
  conversions: number;
  channel: string;         // e.g. "Organic Search", "Paid Search", "Direct"
  topPage?: string;
}

export interface GoogleAdsDailyMetric extends DailyMetric {
  source: 'google_ads';
  campaign: string;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  conversionValue: number; // revenue attributed — needed for ROAS
}

export interface DataAdapter {
  id: string;                              // 'mock' | 'csv' | 'ga4-api' | ...
  label: string;                           // shown in UI
  isConnected(): boolean;
  getGa4Metrics(range: DateRange): Promise<Ga4DailyMetric[]>;
  getGoogleAdsMetrics(range: DateRange): Promise<GoogleAdsDailyMetric[]>;
}

// Stubs so "coming soon" sources render but don't block:
export interface SourceStatus {
  id: 'ga4' | 'google_ads' | 'meta_ads' | 'shopify' | 'email';
  label: string;
  status: 'connected' | 'coming_soon';
}
```

Implement `MockAdapter` first (seeded), then `CsvAdapter`. Ship with `MockAdapter`
active on first run so the dashboard is never empty for a judge.

---

## 7. Seeded Data Shape (make it realistic)

Generate ~60 days of daily data so period-over-period comparisons work.

- **GA4:** daily rows per channel (Organic Search, Paid Search, Direct, Social, Referral, Email). Sessions ~ tied to spend on paid channels. Conversions ~1–4% of sessions.
- **Google Ads:** 3–4 campaigns (e.g. "Brand", "Prospecting", "Retargeting", "Shopping"). Give one campaign a **deliberate anomaly** — e.g. CPA spikes 40% in the most recent 7 days — so the proactive-insight rubric item (#4) has something real to find. Bake in the numbers; don't fake them in the chat.

Derived metrics the agent computes (don't store, compute on demand):
`CTR = clicks/impressions`, `CPA = spend/conversions`, `ROAS = conversionValue/spend`,
`conversion rate = conversions/sessions`.

---

## 8. Chat Tool Definitions (the agentic core)

Give Claude these tools in the `/api/chat` route and run a tool-use loop. The key
to winning: the agent should **call tools to get real numbers**, then reason.
Surface the tool calls in the UI ("Pulling Google Ads spend… comparing to last week").

```typescript
const tools = [
  {
    name: "get_metrics_summary",
    description: "Get aggregated totals for a source over a date range. Use this for top-level questions about how a channel is doing.",
    input_schema: {
      type: "object",
      properties: {
        source: { type: "string", enum: ["ga4", "google_ads"] },
        start: { type: "string", description: "ISO date" },
        end: { type: "string", description: "ISO date" }
      },
      required: ["source", "start", "end"]
    }
  },
  {
    name: "compare_periods",
    description: "Compare a metric between two date ranges and return the delta and % change. Use for 'vs last week' style questions.",
    input_schema: {
      type: "object",
      properties: {
        source: { type: "string", enum: ["ga4", "google_ads"] },
        metric: { type: "string", description: "e.g. spend, conversions, ctr, roas, cpa, sessions" },
        current: { type: "object", properties: { start: {type:"string"}, end: {type:"string"} }, required: ["start","end"] },
        previous: { type: "object", properties: { start: {type:"string"}, end: {type:"string"} }, required: ["start","end"] }
      },
      required: ["source", "metric", "current", "previous"]
    }
  },
  {
    name: "breakdown_by_dimension",
    description: "Rank performers by a metric, broken down by campaign (Ads) or channel (GA4). Use for 'top/worst performing' questions.",
    input_schema: {
      type: "object",
      properties: {
        source: { type: "string", enum: ["ga4", "google_ads"] },
        dimension: { type: "string", enum: ["campaign", "channel"] },
        metric: { type: "string" },
        start: { type: "string" },
        end: { type: "string" },
        order: { type: "string", enum: ["asc", "desc"], default: "desc" }
      },
      required: ["source", "dimension", "metric", "start", "end"]
    }
  },
  {
    name: "detect_anomalies",
    description: "Scan recent data for significant changes (spikes/drops) in key metrics vs the prior period. Use this to proactively surface what the user should worry about.",
    input_schema: {
      type: "object",
      properties: {
        source: { type: "string", enum: ["ga4", "google_ads"] },
        lookbackDays: { type: "number", default: 7 }
      },
      required: ["source"]
    }
  }
];
```

**System prompt guidance for the chat agent:**
- Always use tools to get numbers; never invent figures.
- When you answer, lead with the number, then the comparison, then **one concrete recommended action**.
- Proactively run `detect_anomalies` when the user opens the chat or asks an open-ended "how am I doing" question.
- Be concise — the user is a busy small-business owner, not an analyst.

---

## 9. Suggested Build Order (to hit 5pm)

1. **Scaffold** Next.js + Tailwind + shadcn, deploy a hello-world to Vercel **first** (de-risk deploy early).
2. **Types + MockAdapter + store.** Get seeded data flowing.
3. **Dashboard views** (GA4 + Ads charts) reading from store, with date-range selector.
4. **Chat API route** with the 4 tools + tool-use loop. This is the differentiator — give it the most time.
5. **Chat UI** with visible tool-call trace.
6. **CsvAdapter** + upload (if time).
7. **Polish:** empty state, "coming soon" sources, mobile, loading states.
8. **Final deploy + run the 60-second happy path** end to end on the live URL.

---

## 10. Demo Happy Path (rehearse this for judges)

1. Open live URL → dashboard shows GA4 + Ads metrics for last 30 days.
2. Point out the "coming soon" sources (Meta, Shopify, Email) — shows the vision.
3. Open chat, ask: *"How did my Google Ads do last week vs the week before?"*
4. Judge sees tool calls fire, then a data-backed answer with deltas.
5. Ask: *"Anything I should be worried about?"* → agent runs anomaly detection, finds the CPA spike, recommends pausing/investigating the campaign.

That last beat — proactive insight + recommendation grounded in real data — is the moment that wins the room.
