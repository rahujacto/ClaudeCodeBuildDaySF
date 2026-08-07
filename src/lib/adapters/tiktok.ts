import type { DateRange, SocialData } from "./types";

/**
 * TikTok Display API (v2) connector (read-only, organic — not TikTok ads).
 * Auth is a single OAuth access token (TikTok for Developers → Login Kit,
 * scopes `user.info.basic` + `video.list`) — the account is derived from the
 * token itself, so unlike Instagram there's no separate ID to enter.
 */

const TIKTOK_API = "https://open.tiktokapis.com/v2";
const MAX_PAGES = 12;

class TiktokError extends Error {}

/** Thrown when the stored token is expired/invalid — surfaces a reconnect hint. */
export class TiktokTokenExpiredError extends TiktokError {}

type TiktokErrorBody = { error?: { code?: string; message?: string } };

async function tiktokFetch<T>(accessToken: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${TIKTOK_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { data?: T } & TiktokErrorBody;
  const code = json.error?.code;
  if (!res.ok || (code && code !== "ok")) {
    if (code === "access_token_invalid" || code === "access_token_expired" || res.status === 401) {
      throw new TiktokTokenExpiredError(
        "TikTok access token has expired — reconnect it on the Connections page (TikTok → Edit).",
      );
    }
    throw new TiktokError(json.error?.message ?? `TikTok API error (HTTP ${res.status}).`);
  }
  return json.data as T;
}

// ── Save & Test ─────────────────────────────────────────────────────────────
export type TiktokTestResult = {
  ok: boolean;
  message: string;
  displayName?: string;
  followers?: number;
};

export async function testTiktokConnection(accessToken: string): Promise<TiktokTestResult> {
  if (!accessToken.trim()) return { ok: false, message: "Enter a TikTok access token." };
  try {
    const data = await tiktokFetch<{ user?: { display_name?: string; follower_count?: number } }>(
      accessToken,
      "/user/info/?fields=display_name,follower_count",
    );
    const user = data.user ?? {};
    return {
      ok: true,
      message: `Connected to ${user.display_name ?? "TikTok"} (${(user.follower_count ?? 0).toLocaleString()} followers).`,
      displayName: user.display_name,
      followers: user.follower_count ?? 0,
    };
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof TiktokError
          ? err.message
          : "Couldn't reach TikTok. Check the access token (needs user.info.basic + video.list).",
    };
  }
}

// ── Metrics ─────────────────────────────────────────────────────────────────
type VideoNode = {
  create_time?: number; // unix seconds
  view_count?: number;
  like_count?: number;
  comment_count?: number;
  share_count?: number;
};
type VideoListResponse = { videos?: VideoNode[]; cursor?: number; has_more?: boolean };

const round1 = (n: number) => Math.round(n * 10) / 10;

async function fetchVideoTotals(
  accessToken: string,
  range: DateRange,
): Promise<{ posts: number; views: number; likes: number; comments: number; shares: number }> {
  const startSec = Math.floor(new Date(`${range.start}T00:00:00Z`).getTime() / 1000);
  const endSec = Math.floor(new Date(`${range.end}T23:59:59Z`).getTime() / 1000);

  let posts = 0;
  let views = 0;
  let likes = 0;
  let comments = 0;
  let shares = 0;

  let cursor: number | undefined;
  let hasMore = true;
  for (let page = 0; page < MAX_PAGES && hasMore; page++) {
    const data = await tiktokFetch<VideoListResponse>(
      accessToken,
      "/video/list/?fields=create_time,view_count,like_count,comment_count,share_count",
      { method: "POST", body: JSON.stringify({ max_count: 20, cursor }) },
    );
    let stop = false;
    for (const v of data.videos ?? []) {
      const t = v.create_time ?? NaN;
      if (Number.isNaN(t)) continue;
      // Videos come back newest-first — once older than the range, stop paging.
      if (t < startSec) {
        stop = true;
        break;
      }
      if (t > endSec) continue;
      posts += 1;
      views += v.view_count ?? 0;
      likes += v.like_count ?? 0;
      comments += v.comment_count ?? 0;
      shares += v.share_count ?? 0;
    }
    hasMore = Boolean(data.has_more) && !stop;
    cursor = data.cursor;
  }
  return { posts, views, likes, comments, shares };
}

export async function fetchTiktokData(accessToken: string, range: DateRange): Promise<SocialData> {
  const [user, video] = await Promise.all([
    tiktokFetch<{ user?: { follower_count?: number } }>(
      accessToken,
      "/user/info/?fields=follower_count",
    ),
    fetchVideoTotals(accessToken, range),
  ]);

  const followers = user.user?.follower_count ?? 0;
  const interactions = video.likes + video.comments + video.shares;
  return {
    followers,
    posts: video.posts,
    likes: video.likes,
    comments: video.comments,
    shares: video.shares,
    views: video.views,
    interactions,
    engagementRate: video.views ? round1((interactions / video.views) * 100) : 0,
  };
}
