import { NextResponse } from "next/server";
import db, { type Post } from "@/lib/db";
import { matchKeyword } from "@/lib/match";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Reddit's public JSON listing of the newest posts on reddit.com.
const REDDIT_URL = "https://www.reddit.com/new.json?limit=100";

// Official Hacker News Firebase API.
const HN_BASE = "https://hacker-news.firebaseio.com/v0";
const HN_LIMIT = 50;

const USER_AGENT = "LaunchRadar/1.0 (founder distribution monitor)";

type Platform = "Reddit" | "Hacker News";

type Candidate = {
  id: string;
  title: string;
  url: string;
  content: string;
  platform: Platform;
};

type ChannelResult = {
  scanned: number;
  inserted: number;
  error: string | null;
};

type RedditChild = {
  data: { id: string; title?: string; selftext?: string; permalink?: string };
};

type HNItem = {
  id: number;
  type?: string;
  title?: string;
  text?: string;
  url?: string;
  deleted?: boolean;
  dead?: boolean;
};

async function fetchReddit(): Promise<Candidate[]> {
  const res = await fetch(REDDIT_URL, { headers: { "User-Agent": USER_AGENT }, cache: "no-store" });
  if (!res.ok) throw new Error(`Reddit responded with ${res.status}`);

  const json = await res.json();
  const children: RedditChild[] = json?.data?.children ?? [];

  return children.map(({ data }) => ({
    id: `reddit_${data.id}`,
    title: data.title ?? "",
    url: data.permalink ? `https://www.reddit.com${data.permalink}` : `https://www.reddit.com/comments/${data.id}`,
    content: data.selftext ?? "",
    platform: "Reddit",
  }));
}

async function fetchHackerNews(): Promise<Candidate[]> {
  const res = await fetch(`${HN_BASE}/newstories.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Hacker News responded with ${res.status}`);

  const ids: number[] = ((await res.json()) ?? []).slice(0, HN_LIMIT);

  const items = await Promise.all(
    ids.map(async (id) => {
      try {
        const r = await fetch(`${HN_BASE}/item/${id}.json`, { cache: "no-store" });
        return r.ok ? ((await r.json()) as HNItem | null) : null;
      } catch {
        return null;
      }
    })
  );

  return items
    .filter((it): it is HNItem => !!it && !it.deleted && !it.dead && it.type === "story")
    .map((it) => ({
      id: `hn_${it.id}`,
      title: it.title ?? "",
      // Link to the discussion thread — that's where replies happen.
      url: `https://news.ycombinator.com/item?id=${it.id}`,
      content: [it.text ?? "", it.url ? `Link: ${it.url}` : ""].filter(Boolean).join("\n\n"),
      platform: "Hacker News",
    }));
}

const insert = db.prepare(
  `INSERT OR IGNORE INTO posts (id, title, url, content, platform, status, ai_reply)
   VALUES (@id, @title, @url, @content, @platform, 'Pending', NULL)`
);

function store(candidates: Candidate[], keywords: string[]): number {
  let inserted = 0;
  db.transaction(() => {
    for (const c of candidates) {
      if (!matchKeyword(c.title, c.content, keywords)) continue;
      // INSERT OR IGNORE + PRIMARY KEY(id) + UNIQUE(url) blocks duplicates.
      inserted += insert.run(c).changes;
    }
  })();
  return inserted;
}

async function runChannel(fetcher: () => Promise<Candidate[]>, keywords: string[]): Promise<ChannelResult> {
  try {
    const candidates = await fetcher();
    return { scanned: candidates.length, inserted: store(candidates, keywords), error: null };
  } catch (err) {
    return { scanned: 0, inserted: 0, error: err instanceof Error ? err.message : "Fetch failed" };
  }
}

export async function GET() {
  const keywords = (db.prepare("SELECT phrase FROM keywords").all() as { phrase: string }[])
    .map((k) => k.phrase.trim())
    .filter(Boolean);

  const idle: ChannelResult = { scanned: 0, inserted: 0, error: null };
  const [reddit, hackerNews] =
    keywords.length > 0
      ? await Promise.all([runChannel(fetchReddit, keywords), runChannel(fetchHackerNews, keywords)])
      : [idle, idle];

  const matches = db.prepare("SELECT * FROM posts ORDER BY rowid DESC").all() as Post[];

  return NextResponse.json({
    matches,
    channels: { reddit, hackerNews },
    scanned: reddit.scanned + hackerNews.scanned,
    inserted: reddit.inserted + hackerNews.inserted,
    error: [reddit.error && `Reddit: ${reddit.error}`, hackerNews.error && `Hacker News: ${hackerNews.error}`]
      .filter(Boolean)
      .join(" · ") || null,
  });
}
