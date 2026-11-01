import Database from "better-sqlite3";
import path from "path";

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
  `);

  db.prepare(
    "INSERT OR IGNORE INTO profile (id, name, url, description) VALUES (1, '', '', '')"
  ).run();

  return db;
}

// Reuse one connection across hot reloads in dev.
const globalForDb = globalThis as unknown as { radarDb?: Database.Database };

export const db: Database.Database = globalForDb.radarDb ?? init();

if (process.env.NODE_ENV !== "production") globalForDb.radarDb = db;

export default db;
