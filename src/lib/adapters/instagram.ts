import type { DateRange, SocialData } from "./types";

/**
 * Instagram Graph API connector (read-only, organic — not Instagram ads).
 * Requires a Business or Creator account. Auth is a long-lived access token
 * scoped with `instagram_basic` + `instagram_manage_insights`, paired with
 * the account's numeric IG User ID (Business Suite → Settings, or via
 * /me/accounts?fields=instagram_business_account on the linked Facebook Page).
 */

const GRAPH = "https://graph.facebook.com/v21.0";
const MAX_PAGES = 12;

class InstagramError extends Error {}

/** Thrown when the stored token is expired/invalid — surfaces a reconnect hint. */
export class InstagramTokenExpiredError extends InstagramError {}

type GraphErrorBody = { error?: { message?: string; code?: number; type?: string } };

async function graphGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const json = (await res.json()) as T & GraphErrorBody;
  if (!res.ok || json.error) {
    const e = json.error;
    const expired = e?.code === 190 || e?.type === "OAuthException";
    if (expired) {
      throw new InstagramTokenExpiredError(
        "Instagram access token has expired — reconnect it on the Connections page (Instagram → Edit).",
      );
    }
    throw new InstagramError(e?.message ?? `Instagram API error (HTTP ${res.status}).`);
  }
  return json;
}

/** Accept a raw ID or a pasted "@handle" / profile URL — strip to digits. */
export function normalizeIgUserId(input: string): string {
  return input.trim().replace(/[^0-9]/g, "");
}

// ── Save & Test ─────────────────────────────────────────────────────────────
export type InstagramTestResult = {
  ok: boolean;
  message: string;
  username?: string;
  followers?: number;
};

export async function testInstagramConnection(
  accessToken: string,
  rawIgUserId: string,
): Promise<InstagramTestResult> {
  const igUserId = normalizeIgUserId(rawIgUserId);
  if (!igUserId) return { ok: false, message: "Enter a valid Instagram Business Account ID." };
  if (!accessToken.trim()) return { ok: false, message: "Enter an access token." };
  try {
    const data = await graphGet<{ username?: string; followers_count?: number }>(
      `${GRAPH}/${igUserId}?fields=username,followers_count&access_token=${encodeURIComponent(accessToken)}`,
    );
    return {
      ok: true,
      message: `Connected to @${data.username ?? "instagram"} (${(data.followers_count ?? 0).toLocaleString()} followers).`,
      username: data.username,
      followers: data.followers_count ?? 0,
    };
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof InstagramError
          ? err.message
          : "Couldn't reach Instagram. Check the account ID and token (needs instagram_basic + instagram_manage_insights).",
    };
  }
}

// ── Metrics ─────────────────────────────────────────────────────────────────
type MediaNode = {
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
};
type MediaResponse = { data: MediaNode[]; paging?: { next?: string } };
type InsightValue = { value?: number; end_time?: string };
type InsightsResponse = { data?: { name: string; values?: InsightValue[] }[] };

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Fetches every media item and sums likes/comments for items inside `range`. */
async function fetchMediaTotals(
  accessToken: string,
  igUserId: string,
  range: DateRange,
): Promise<{ posts: number; likes: number; comments: number }> {
  let posts = 0;
  let likes = 0;
  let comments = 0;
  const start = new Date(`${range.start}T00:00:00Z`).getTime();
  const end = new Date(`${range.end}T23:59:59Z`).getTime();

  let url =
    `${GRAPH}/${igUserId}/media?fields=timestamp,like_count,comments_count&limit=50` +
    `&access_token=${encodeURIComponent(accessToken)}`;
  let stop = false;
  for (let page = 0; page < MAX_PAGES && url && !stop; page++) {
    const res = await graphGet<MediaResponse>(url);
    for (const m of res.data ?? []) {
      const t = m.timestamp ? new Date(m.timestamp).getTime() : NaN;
      if (Number.isNaN(t)) continue;
      // Media is returned newest-first — once we're older than the range start
      // there's nothing left to find, so stop paginating.
      if (t < start) {
        stop = true;
        break;
      }
      if (t > end) continue;
      posts += 1;
      likes += m.like_count ?? 0;
      comments += m.comments_count ?? 0;
    }
    url = res.paging?.next ?? "";
  }
  return { posts, likes, comments };
}

/** Account reach for the range, from the Insights API (daily reach, summed). */
async function fetchReach(accessToken: string, igUserId: string, range: DateRange): Promise<number> {
  try {
    const since = Math.floor(new Date(`${range.start}T00:00:00Z`).getTime() / 1000);
    const until = Math.floor(new Date(`${range.end}T23:59:59Z`).getTime() / 1000);
    const res = await graphGet<InsightsResponse>(
      `${GRAPH}/${igUserId}/insights?metric=reach&period=day&since=${since}&until=${until}` +
        `&access_token=${encodeURIComponent(accessToken)}`,
    );
    const values = res.data?.[0]?.values ?? [];
    return values.reduce((s, v) => s + (v.value ?? 0), 0);
  } catch {
    // Insights requires a linked Facebook Page + extra permissions; degrade to 0
    // rather than failing the whole connector.
    return 0;
  }
}

export async function fetchInstagramData(
  accessToken: string,
  rawIgUserId: string,
  range: DateRange,
): Promise<SocialData> {
  const igUserId = normalizeIgUserId(rawIgUserId);
  const [account, media, reach] = await Promise.all([
    graphGet<{ followers_count?: number }>(
      `${GRAPH}/${igUserId}?fields=followers_count&access_token=${encodeURIComponent(accessToken)}`,
    ),
    fetchMediaTotals(accessToken, igUserId, range),
    fetchReach(accessToken, igUserId, range),
  ]);

  const followers = account.followers_count ?? 0;
  const interactions = media.likes + media.comments;
  return {
    followers,
    posts: media.posts,
    likes: media.likes,
    comments: media.comments,
    shares: 0, // not exposed on standard Business/Creator accounts
    views: reach,
    interactions,
    engagementRate: reach ? round1((interactions / reach) * 100) : 0,
  };
}
