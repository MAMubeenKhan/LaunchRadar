import Database from "better-sqlite3";
import path from "path";
import { DIRECTORIES } from "./directories";

export type Keyword = { id: number; phrase: string };

export type Post = {
  id: string;
  title: string;
  url: string;
  content: string;
  platform: string;
  status: string;
  ai_reply: string | null;
};

export type Profile = { id: number; name: string; url: string; description: string };

export type DirectoryRow = { name: string; status: string; submitted_at: string | null };

const DB_PATH = path.join(process.cwd(), "radar.db");

function init(): Database.Database {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS keywords (
      id INTEGER PRIMARY KEY,
      phrase TEXT UNIQUE
    );

    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      title TEXT,
      url TEXT,
      content TEXT,
      platform TEXT,
      status TEXT,
      ai_reply TEXT
    );

    CREATE TABLE IF NOT EXISTS profile (
      id INTEGER PRIMARY KEY,
      name TEXT,
      url TEXT,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS directories (
      name TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'Not started',
      submitted_at TEXT
    );
  `);

  // Older databases: normalise platform labels and drop duplicate URLs
  // so the unique index below can be created.
  db.exec(`
    UPDATE posts SET platform = 'Reddit' WHERE platform LIKE 'Reddit%' AND platform <> 'Reddit';
    DELETE FROM posts WHERE rowid NOT IN (SELECT MIN(rowid) FROM posts GROUP BY url);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_url ON posts(url);
  `);

  db.prepare(
    "INSERT OR IGNORE INTO profile (id, name, url, description) VALUES (1, '', '', '')"
  ).run();

  const seedDir = db.prepare("INSERT OR IGNORE INTO directories (name, status) VALUES (?, 'Not started')");
  db.transaction(() => DIRECTORIES.forEach((d) => seedDir.run(d)))();

  return db;
}

// Reuse one connection across hot reloads in dev.
const globalForDb = globalThis as unknown as { radarDb?: Database.Database };

export const db: Database.Database = globalForDb.radarDb ?? init();

if (process.env.NODE_ENV !== "production") globalForDb.radarDb = db;

export default db;
