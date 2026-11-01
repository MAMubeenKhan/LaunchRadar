import { NextResponse } from "next/server";
import type Database from "better-sqlite3";
import radarDb, { type Post, type Profile } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const db: Database.Database = radarDb;

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
// Claude 3.5 Sonnet is retired and no longer served by the API, so this
// defaults to the current Sonnet. Override with ANTHROPIC_MODEL if needed.
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const MAX_ATTEMPTS = 3;

const SYSTEM_INSTRUCTION =
  "You are an organic, technical human founder participating in community discussions. You must write with zero corporate AI fluff, zero marketing hype, and zero automated cheerleading. Write in casual, direct lower-case or standard human formatting.";

const SLOP_FILTER =
  "Strictly ban and filter the following words and phrases from your output: 'revolutionize', 'game-changer', 'delve', 'testament', 'beacon', 'seamlessly', 'in conclusion', 'moreover', 'tapestry', 'transformative', 'look no further', 'masterpiece', 'streamline'. Never say 'As an AI...' or 'Here is a tool that...'";

const FORMATTING_RULES = [
  "Formatting rules:",
  "- Max length: 3 concise sentences.",
  "- Tone: A tired but helpful developer who happens to have built a side script that solves this exact problem.",
  "- Flow: Acknowledge the core technical pain point directly first, offer a 1-sentence workaround, and casually mention your app link only if contextually helpful.",
  "- Output only the reply text. No greeting, no sign-off, no quotes around it.",
].join("\n");

const SYSTEM_PROMPT = [SYSTEM_INSTRUCTION, SLOP_FILTER, FORMATTING_RULES].join("\n\n");

// Banned stems, matched case-insensitively (covers "revolutionizes", "streamlined", etc.).
const BANNED: RegExp[] = [
  /revolutioni[sz]/i,
  /game[\s-]?changer/i,
  /\bdelv/i,
  /\btestament\b/i,
  /\bbeacon/i,
  /\bseamless/i,
  /\bin conclusion\b/i,
  /\bmoreover\b/i,
  /\btapestr/i,
  /\btransformative\b/i,
  /\blook no further\b/i,
  /\bmasterpiece/i,
  /\bstreamlin/i,
  /\bas an ai\b/i,
  /\bhere is a tool that\b/i,
  /\bhere's a tool that\b/i,
];

function findSlop(text: string): string[] {
  return BANNED.filter((re) => re.test(text)).map((re) => re.source);
}

function limitSentences(text: string, max = 3): string {
  const sentences = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+(?=\S)/);
  return sentences.slice(0, max).join(" ").trim();
}

type Message = { role: "user" | "assistant"; content: string };

async function callClaude(apiKey: string, messages: Message[]): Promise<string> {
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Anthropic API error (${res.status}): ${detail.slice(0, 500)}`);
  }

  const data = await res.json();
  return (data?.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("\n")
    .trim();
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const postId = typeof body.postId === "string" ? body.postId : "";
  if (!postId) return NextResponse.json({ error: "postId is required" }, { status: 400 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set" }, { status: 500 });

  const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(postId) as Post | undefined;
  if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });

  const profile = db.prepare("SELECT * FROM profile WHERE id = 1").get() as Profile | undefined;

  const userPrompt = `Thread on ${post.platform}:
Title: ${post.title}
Body: ${post.content?.slice(0, 4000) || "(no body)"}
Thread URL: ${post.url}

My app (mention only if it genuinely helps):
Name: ${profile?.name || "(not set)"}
Link: ${profile?.url || "(not set)"}
What it does: ${profile?.description || "(not set)"}

Write my reply.`;

  const messages: Message[] = [{ role: "user", content: userPrompt }];
  let best = "";
  let bestSlop: string[] = [];

  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const draft = limitSentences(await callClaude(apiKey, messages));
      const slop = findSlop(draft);

      if (!best || slop.length < bestSlop.length) {
        best = draft;
        bestSlop = slop;
      }
      if (slop.length === 0) break;

      // Ask for a rewrite that drops the flagged phrasing.
      messages.push(
        { role: "assistant", content: draft },
        {
          role: "user",
          content: `That reply uses banned phrasing (${slop.join(", ")}). Rewrite it without those words, same rules, max 3 sentences.`,
        }
      );
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Draft failed" }, { status: 502 });
  }

  if (!best) return NextResponse.json({ error: "Model returned an empty reply" }, { status: 502 });

  db.prepare("UPDATE posts SET ai_reply = ?, status = 'Drafted' WHERE id = ?").run(best, postId);

  return NextResponse.json({ postId, reply: best, status: "Drafted", model: MODEL, flagged: bestSlop });
}
