import { NextResponse } from "next/server";
import db, { type Post, type Profile } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-5-5";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const postId = typeof body.postId === "string" ? body.postId : "";
  if (!postId) return NextResponse.json({ error: "postId is required" }, { status: 400 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set" }, { status: 500 });

  const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(postId) as Post | undefined;
  if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });

  const profile = db.prepare("SELECT * FROM profile WHERE id = 1").get() as Profile | undefined;

  const system = [
    "You are a founder replying to another founder in an online community thread.",
    "Write a direct, genuinely helpful reply: answer their actual question or problem first, with concrete specifics from experience.",
    "No marketing fluff, no hype words, no emojis, no hashtags, no sales pitch, no greetings like 'Great question!'.",
    "Only mention the product if it truly fits the problem, at most once, near the end, framed plainly (e.g. 'I built X for this — happy to share if useful').",
    "Keep it under 150 words, conversational, plain text. Output only the reply text.",
  ].join(" ");

  const userPrompt = `Thread on ${post.platform}:
Title: ${post.title}
Body: ${post.content?.slice(0, 4000) || "(no body)"}

My product:
Name: ${profile?.name || "(not set)"}
URL: ${profile?.url || "(not set)"}
What it does: ${profile?.description || "(not set)"}

Draft my reply.`;

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 600,
      system,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    return NextResponse.json({ error: `Anthropic API error (${res.status})`, detail }, { status: 502 });
  }

  const data = await res.json();
  const reply: string = (data?.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("\n")
    .trim();

  db.prepare("UPDATE posts SET ai_reply = ?, status = 'Drafted' WHERE id = ?").run(reply, postId);

  return NextResponse.json({ postId, reply });
}
