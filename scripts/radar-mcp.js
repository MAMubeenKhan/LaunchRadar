#!/usr/bin/env node
/**
 * LaunchRadar tool broker — a small CLI that lets Claude (or you) drive the
 * app from the terminal.
 *
 *   node scripts/radar-mcp.js monitor            Scan Reddit + Hacker News now
 *   node scripts/radar-mcp.js reply <postId>     Draft an anti-slop reply for a post
 *   node scripts/radar-mcp.js db-query           List all 'Pending' posts straight from radar.db
 *   node scripts/radar-mcp.js help               Show this help
 *
 * monitor and reply need the Next.js server running (npm run dev).
 * db-query reads radar.db directly and works without the server.
 *
 * Output is always JSON on stdout, so it can be piped or parsed.
 * Errors are JSON on stderr with a non-zero exit code.
 *
 * Environment:
 *   RADAR_URL   Base URL of the app (default http://localhost:3000)
 *   RADAR_DB    Path to the SQLite file (default <project>/radar.db)
 */

"use strict";

const path = require("path");
const fs = require("fs");

const BASE_URL = (process.env.RADAR_URL || "http://localhost:3000").replace(/\/+$/, "");
const DB_PATH = process.env.RADAR_DB || path.join(__dirname, "..", "radar.db");
const TIMEOUT_MS = 120_000; // reply can retry the model up to 3 times

function print(data) {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

function fail(message, extra = {}) {
  process.stderr.write(JSON.stringify({ ok: false, error: message, ...extra }, null, 2) + "\n");
  process.exit(1);
}

async function request(route, options = {}) {
  const url = `${BASE_URL}${route}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    const reason = err && err.name === "AbortError" ? `timed out after ${TIMEOUT_MS / 1000}s` : err.message;
    fail(`Could not reach ${url} (${reason}). Is the app running? Start it with: npm run dev`);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  if (!res.ok) fail(`${route} responded with HTTP ${res.status}`, { response: body });
  return body;
}

async function monitor() {
  const data = await request("/api/monitor");
  print({
    ok: true,
    command: "monitor",
    scanned: data.scanned,
    inserted: data.inserted,
    channels: data.channels,
    error: data.error || null,
    pendingCount: (data.matches || []).filter((m) => m.status === "Pending").length,
    matches: data.matches || [],
  });
}

async function reply(postId) {
  if (!postId) fail("Usage: node scripts/radar-mcp.js reply <postId>  (get ids from db-query)");
  const data = await request("/api/reply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ postId }),
  });
  print({ ok: true, command: "reply", ...data });
}

function dbQuery() {
  if (!fs.existsSync(DB_PATH)) {
    fail(`No database at ${DB_PATH}. Start the app once (npm run dev) so it creates radar.db.`);
  }

  let Database;
  try {
    Database = require("better-sqlite3");
  } catch {
    fail("better-sqlite3 is not installed. Run: npm install");
  }

  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  try {
    const posts = db
      .prepare(
        "SELECT id, title, url, platform, status, content, ai_reply FROM posts WHERE status = 'Pending' ORDER BY rowid DESC"
      )
      .all();
    print({ ok: true, command: "db-query", database: DB_PATH, count: posts.length, posts });
  } finally {
    db.close();
  }
}

function help() {
  print({
    ok: true,
    usage: "node scripts/radar-mcp.js <command> [args]",
    baseUrl: BASE_URL,
    database: DB_PATH,
    commands: {
      monitor: "GET /api/monitor — scan Reddit + Hacker News for keyword matches",
      "reply <postId>": "POST /api/reply — draft and save an anti-slop reply",
      "db-query": "Read radar.db directly — list all Pending posts as JSON",
      help: "Show this help",
    },
  });
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "monitor":
      return monitor();
    case "reply":
      return reply(args[0]);
    case "db-query":
      return dbQuery();
    case undefined:
    case "help":
    case "--help":
    case "-h":
      return help();
    default:
      fail(`Unknown command "${command}". Run: node scripts/radar-mcp.js help`);
  }
}

main().catch((err) => fail(err && err.message ? err.message : String(err)));
