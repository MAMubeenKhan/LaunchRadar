import { NextResponse } from "next/server";
import db, { type Post } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Reddit's public JSON listing of the newest posts on reddit.com.
const REDDIT_URL = "https://www.reddit.com/new.json?limit=100";

type RedditChild = {
  data: {
    id: string;
    title?: string;
    selftext?: string;
    permalink?: string;
    subreddit_name_prefixed?: string;
  };
};

export async function GET() {
  const keywords = (db.prepare("SELECT phrase FROM keywords").all() as { phrase: string }[])
    .map((k) => k.phrase.trim().toLowerCase())
    .filter(Boolean);

  let fetchError: string | null = null;
  let scanned = 0;
  let inserted = 0;

  if (keywords.length > 0) {
    try {
      const res = await fetch(REDDIT_URL, {
        headers: { "User-Agent": "LaunchRadar/1.0 (founder distribution monitor)" },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Reddit responded with ${res.status}`);

      const json = await res.json();
      const children: RedditChild[] = json?.data?.children ?? [];
      scanned = children.length;

      const insert = db.prepare(
        `INSERT OR IGNORE INTO posts (id, title, url, content, platform, status, ai_reply)
         VALUES (@id, @title, @url, @content, @platform, 'Pending', NULL)`
      );

      const insertMany = db.transaction((rows: RedditChild[]) => {
        for (const { data } of rows) {
          const title = data.title ?? "";
          const content = data.selftext ?? "";
          const haystack = `${title}\n${content}`.toLowerCase();
          if (!keywords.some((k) => haystack.includes(k))) continue;

          const result = insert.run({
            id: `reddit_${data.id}`,
            title,
            url: data.permalink ? `https://www.reddit.com${data.permalink}` : "https://www.reddit.com",
            content,
            platform: data.subreddit_name_prefixed ? `Reddit · ${data.subreddit_name_prefixed}` : "Reddit",
          });
          inserted += result.changes;
        }
      });

      insertMany(children);
    } catch (err) {
      fetchError = err instanceof Error ? err.message : "Failed to fetch Reddit";
    }
  }

  const matches = db.prepare("SELECT * FROM posts ORDER BY rowid DESC").all() as Post[];

  return NextResponse.json({ matches, scanned, inserted, error: fetchError });
}
