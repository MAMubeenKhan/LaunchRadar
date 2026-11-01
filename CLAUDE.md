# CLAUDE.md — LaunchRadar operating manual for agents

You are an agentic assistant with access to this folder. You can control LaunchRadar STRUCTURALLY by running `node scripts/radar-mcp.js` or reading `radar.db` directly. You can control it VISUALLY by utilizing your built-in `browser_navigate` tool on `http://localhost:3000` or running `node scripts/radar-browser.js` after installing playwright.

> Note: `browser_navigate` comes from a browser MCP server such as Playwright MCP. If it is not in your tool list, the user can add it with `claude mcp add playwright -- npx @playwright/mcp@latest` and check it with `/mcp`. Until then, use the scripts.

Everything you need to act without asking the user is below. Prefer structural control (scripts, API, DB); use visual control only to see or verify the UI.

---

## 1. What LaunchRadar does

A local Next.js 15 + SQLite app for a solo founder:

1. **Listens** to Reddit and Hacker News for saved keyword phrases.
2. **Drafts** short, human, anti-slop replies to matching posts with the Anthropic API, grounded in the founder's own notes.
3. **Tracks** submissions to 30 launch directories, with auto-fill form maps.
4. **Exports** the whole workspace as CSV or Markdown.

## 2. Running it

| Task | Command |
| --- | --- |
| Install | `npm install` |
| Start (port 3000) | `npm run dev` |
| Required secret | `ANTHROPIC_API_KEY` in `.env.local` |
| Optional | `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`), `AUTO_SUBMIT_WEBHOOK_URL` |

`radar.db` is created in the project root on the first server request. It is git-ignored.

## 3. Structural control — `scripts/radar-mcp.js`

All output is JSON on stdout; errors are JSON on stderr with exit code 1.

| Command | Needs server | What it does |
| --- | --- | --- |
| `node scripts/radar-mcp.js monitor` | yes | `GET /api/monitor` — scans both sources, saves new matches, prints all matches |
| `node scripts/radar-mcp.js reply <postId>` | yes | `POST /api/reply` — drafts and saves a reply, sets status to `Drafted` |
| `node scripts/radar-mcp.js db-query` | no | Reads `radar.db` (read-only) and prints all `Pending` posts |
| `node scripts/radar-mcp.js help` | no | Lists commands |

Env overrides: `RADAR_URL` (default `http://localhost:3000`), `RADAR_DB` (default `./radar.db`). Shortcut: `npm run radar -- <command>`.

**Typical loop:**

```bash
node scripts/radar-mcp.js monitor          # find new posts
node scripts/radar-mcp.js db-query         # list Pending posts, pick ids
node scripts/radar-mcp.js reply reddit_abc123
```

## 4. Visual control — `scripts/radar-browser.js`

Opens the dashboard headlessly, clicks `.draft-response-btn` on a post, waits for the reply and prints it as JSON.

```bash
npm install --save-dev playwright && npx playwright install chromium   # once
node scripts/radar-browser.js [postId] [--headed]
```

Falls back to Puppeteer if installed. With neither installed it prints setup steps and exits with code 2. `BROWSER_EXECUTABLE` points it at an existing Chrome.

**Stable DOM hooks** (in `app/page.tsx`; keep them if you edit the UI):

| Selector | Element |
| --- | --- |
| `article.post-card[data-post-id][data-platform][data-status]` | One post card |
| `.post-title` | Post title link (`href` = thread URL) |
| `button.draft-response-btn[data-post-id]` | "Draft reply" button |
| `.draft-reply-text` | Drafted reply text |

With `browser_navigate`: open `http://localhost:3000`, then use the same selectors.

## 5. HTTP API map

Base URL `http://localhost:3000`. All bodies are JSON unless noted.

### `GET /api/monitor`
Scans Reddit (`https://www.reddit.com/new.json?limit=100`) and the 50 newest Hacker News stories (`https://hacker-news.firebaseio.com/v0/newstories.json` → `/v0/item/{id}.json`). Matches go through the keyword matcher in `lib/match.ts` and are saved with status `Pending`. Does nothing if there are no keywords.
```json
{
  "matches": [Post],
  "channels": { "reddit": {"scanned": 0, "inserted": 0, "error": null}, "hackerNews": { "...": "same" } },
  "scanned": 0, "inserted": 0, "error": "string | null"
}
```

### `POST /api/reply`
Body `{ "postId": "reddit_abc123" }`. Loads the post, profile and all `knowledge_base` notes, then calls the Anthropic Messages API with the anti-slop system prompt. Rewrites up to 3 times if banned words appear, trims to 3 sentences, saves to `posts.ai_reply`, sets `status = 'Drafted'`.
```json
{ "postId": "...", "reply": "...", "status": "Drafted", "model": "...", "flagged": [], "usedNotes": true }
```
Errors: `400` missing postId · `404` unknown post · `500` no API key · `502` Anthropic error.

### `GET | POST /api/profile`
`GET` → `{ "profile": Profile }`. `POST { name, url, description }` → upserts row `id = 1`, returns `{ "profile": Profile }`.

### `GET | POST | DELETE /api/keywords`
`GET` → `{ "keywords": Keyword[] }`. `POST { phrase }` adds it (lower-cased, duplicates ignored). `DELETE { id }` removes it. Both return the full list.

### `GET | POST | DELETE /api/knowledge`
Founder notes used to ground replies. `GET` → `{ "entries": KnowledgeRow[] }`. `POST { content, id? }` upserts (no `id` → new row), returns `{ id, entries, savedAt }`. `DELETE { id }`. Max 50,000 chars per entry. The dashboard's Brain Dump box edits the first entry.

### `GET | POST /api/directories`
`GET` → `{ "directories": DirectoryRow[] }`. `POST { name, status }` with status `Not started | Submitted | Live`.

### `POST /api/auto-submit`
Body `{ "directory": "Product Hunt", "profile"?: { name, url, description } }` (falls back to the saved profile; needs name + url). Returns a form map and sets the directory to `Submitted`. It does **not** submit anything itself unless `AUTO_SUBMIT_WEBHOOK_URL` is set, in which case it forwards the payload there.
```json
{
  "ok": true, "mode": "payload | webhook", "status": "Submitted",
  "payload": {
    "directory": "...", "submitUrl": "...", "requiresLogin": true, "formSelector": "form",
    "inputs": [{ "field": "name", "selector": "...", "inputId": null, "value": "..." }],
    "submitButton": "...", "steps": [{ "action": "goto | fill | click | manual" }], "notes": null
  }
}
```
Selectors are best-effort; verify them on the live page before running unattended. Hacker News's form is the only one known to be stable.

### `GET /api/export`
Downloads `launchradar-workspace.csv` (one sheet; columns `table,id,title,url,platform,status,content,ai_reply,submitted_at`). `?format=md` downloads Markdown instead.

## 6. Database — `radar.db` (SQLite, WAL mode)

Schema is created in `lib/db.ts` on startup.

```sql
keywords       (id INTEGER PRIMARY KEY, phrase TEXT UNIQUE)
posts          (id TEXT PRIMARY KEY, title TEXT, url TEXT, content TEXT,
                platform TEXT, status TEXT, ai_reply TEXT)
               -- UNIQUE INDEX idx_posts_url ON posts(url)
profile        (id INTEGER PRIMARY KEY, name TEXT, url TEXT, description TEXT)   -- single row, id = 1
directories    (name TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'Not started', submitted_at TEXT)
knowledge_base (id INTEGER PRIMARY KEY, content TEXT)
```

| Field | Values |
| --- | --- |
| `posts.id` | `reddit_<id>` or `hn_<id>` |
| `posts.platform` | `Reddit` or `Hacker News` |
| `posts.status` | `Pending` → `Drafted` |
| `posts.url` | Reddit permalink or `https://news.ycombinator.com/item?id=<id>` |
| `directories.status` | `Not started`, `Submitted`, `Live` |

Useful read-only queries:
```bash
sqlite3 radar.db "SELECT id, platform, title FROM posts WHERE status='Pending';"
sqlite3 radar.db "SELECT name, status FROM directories WHERE status <> 'Live';"
```
Prefer the API for writes so the app's rules (lower-casing, dedupe, status changes) apply. Never delete `radar.db`; it is the only copy of the user's data.

## 7. File map

| Path | Purpose |
| --- | --- |
| `lib/db.ts` | SQLite connection + schema + seed data |
| `lib/match.ts` | Keyword matcher (phrase match, or all words within 12 words of each other, light stemming) |
| `lib/directories.ts` | The 30 directories and status values |
| `app/api/*/route.ts` | Routes listed in section 5 |
| `app/page.tsx` | Dashboard (client component) |
| `scripts/radar-mcp.js` | Terminal broker |
| `scripts/radar-browser.js` | Browser automation |

## 8. Rules for agents

- **Never post replies or submit forms on the user's behalf** without their explicit go-ahead. Drafting is fine; posting is the user's call.
- Reply drafts must follow the anti-slop rules in `app/api/reply/route.ts`. Don't loosen them.
- Don't invent founder experiences. Facts come only from `knowledge_base` and `profile`.
- Respect Reddit and Hacker News rate limits: don't run `monitor` more than about once a minute.
- Keep the DOM hooks in section 4 stable when editing the UI.
- If the server isn't running, the scripts say so. Start it with `npm run dev` rather than working around it.
