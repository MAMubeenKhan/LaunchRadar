#!/usr/bin/env node
/**
 * LaunchRadar visual automation — drives the real dashboard in a browser.
 *
 * What it does:
 *   1. Launches a headless browser.
 *   2. Opens the dashboard (default http://localhost:3000).
 *   3. Waits for post cards to load.
 *   4. Clicks the `.draft-response-btn` on a post card.
 *   5. Waits for the drafted reply and prints the DOM text as JSON.
 *
 * ─── How Claude should run this ───────────────────────────────────────────
 *
 *   One-time setup (in the project folder):
 *     npm install --save-dev playwright
 *     npx playwright install chromium
 *
 *   Or with Puppeteer instead:
 *     npm install --save-dev puppeteer        (downloads its own Chrome)
 *
 *   Then, with the app running in another terminal (npm run dev):
 *     node scripts/radar-browser.js                 # first Pending post
 *     node scripts/radar-browser.js <postId>        # a specific post
 *     node scripts/radar-browser.js --headed        # watch it happen
 *
 *   The script uses Playwright if installed, otherwise Puppeteer. If
 *   neither is installed it prints setup steps and exits with code 2. It
 *   never crashes on a missing package.
 *
 *   Environment:
 *     RADAR_URL            Dashboard URL (default http://localhost:3000)
 *     BROWSER_EXECUTABLE   Path to an existing Chrome/Chromium binary
 *
 * ─── DOM hooks it relies on (defined in app/page.tsx) ──────────────────────
 *
 *   article.post-card[data-post-id][data-platform][data-status]   one per post
 *   .post-title                                                  post title link
 *   button.draft-response-btn[data-post-id]                      "Draft reply"
 *   .draft-reply-text                                            the drafted reply
 *
 * Tip: if the reply API itself is the target, `node scripts/radar-mcp.js reply
 * <postId>` is faster. Use this script when you need to see or verify the UI.
 */

"use strict";

const BASE_URL = (process.env.RADAR_URL || "http://localhost:3000").replace(/\/+$/, "");
const DRAFT_TIMEOUT_MS = 120_000;

const SELECTORS = {
  card: "article.post-card",
  title: ".post-title",
  draftButton: ".draft-response-btn",
  replyText: ".draft-reply-text",
};

function print(data) {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

function fail(message, code = 1) {
  process.stderr.write(JSON.stringify({ ok: false, error: message }, null, 2) + "\n");
  process.exit(code);
}

function parseArgs(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const positional = argv.filter((a) => !a.startsWith("--"));
  return { postId: positional[0] || null, headed: flags.has("--headed") };
}

/** Load whichever automation library is installed and return a small common interface. */
function loadDriver() {
  try {
    const { chromium } = require("playwright");
    return {
      name: "playwright",
      launch: (headed) =>
        chromium.launch({
          headless: !headed,
          ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
        }),
    };
  } catch {}

  try {
    const puppeteer = require("puppeteer");
    return {
      name: "puppeteer",
      launch: (headed) =>
        puppeteer.launch({
          headless: !headed,
          args: ["--no-sandbox"],
          ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
        }),
    };
  } catch {}

  return null;
}

async function run() {
  const { postId, headed } = parseArgs(process.argv.slice(2));
  const driver = loadDriver();

  if (!driver) {
    print({
      ok: false,
      error: "No browser automation library installed.",
      setup: [
        "npm install --save-dev playwright",
        "npx playwright install chromium",
        "npm run dev   # in another terminal",
        `node scripts/radar-browser.js${postId ? " " + postId : ""}`,
      ],
      alternative: "Use a browser MCP tool (browser_navigate) on " + BASE_URL + ", or `node scripts/radar-mcp.js reply <postId>`.",
    });
    process.exit(2);
  }

  const browser = await driver.launch(headed);
  try {
    // Playwright and Puppeteer share these page methods: goto, waitForSelector, $, $$eval, evaluate.
    const page = await browser.newPage();

    try {
      // Playwright calls it "networkidle"; Puppeteer calls it "networkidle2".
      await page.goto(BASE_URL, { waitUntil: driver.name === "puppeteer" ? "networkidle2" : "networkidle" });
    } catch (err) {
      fail(`Could not open ${BASE_URL} (${err.message}). Is the app running? Start it with: npm run dev`);
    }

    try {
      await page.waitForSelector(SELECTORS.card, { timeout: 30_000 });
    } catch {
      fail("No post cards appeared. Add keywords and run a scan first (node scripts/radar-mcp.js monitor).");
    }

    // Pick the target card: the requested id, else the first Pending post, else the first post.
    const target = await page.evaluate(
      ({ sel, wanted }) => {
        const cards = Array.from(document.querySelectorAll(sel.card));
        const card =
          (wanted && cards.find((c) => c.getAttribute("data-post-id") === wanted)) ||
          (!wanted && cards.find((c) => c.getAttribute("data-status") === "Pending")) ||
          (!wanted && cards[0]) ||
          null;
        if (!card) return null;
        return {
          id: card.getAttribute("data-post-id"),
          platform: card.getAttribute("data-platform"),
          title: card.querySelector(sel.title)?.textContent?.trim() || "",
          url: card.querySelector(sel.title)?.getAttribute("href") || "",
        };
      },
      { sel: SELECTORS, wanted: postId }
    );

    if (!target) fail(`Post ${postId} is not on the dashboard.`);

    const cardSel = `${SELECTORS.card}[data-post-id="${target.id}"]`;
    const button = await page.$(`${cardSel} ${SELECTORS.draftButton}`);
    if (!button) fail(`No ${SELECTORS.draftButton} found on post ${target.id}.`);
    await button.click();

    // The reply box appears with "Thinking it through…" and fills in when the API returns.
    try {
      await page.waitForSelector(`${cardSel} ${SELECTORS.replyText}`, { timeout: DRAFT_TIMEOUT_MS });
    } catch {
      fail(`No reply appeared within ${DRAFT_TIMEOUT_MS / 1000}s.`);
    }

    const replyText = await page.evaluate(
      (selector) => document.querySelector(selector)?.textContent?.trim() || "",
      `${cardSel} ${SELECTORS.replyText}`
    );

    print({
      ok: !replyText.startsWith("⚠️"),
      driver: driver.name,
      post: target,
      reply: replyText,
    });
  } finally {
    await browser.close();
  }
}

run().catch((err) => fail(err && err.message ? err.message : String(err)));
