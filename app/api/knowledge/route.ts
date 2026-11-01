import { NextResponse } from "next/server";
import db, { type KnowledgeRow } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LENGTH = 50_000;

function all(): KnowledgeRow[] {
  return db.prepare("SELECT id, content FROM knowledge_base ORDER BY id ASC").all() as KnowledgeRow[];
}

export async function GET() {
  return NextResponse.json({ entries: all() });
}

// Upsert one entry. Without an id a new entry is created.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (typeof body.content !== "string") {
    return NextResponse.json({ error: "content must be a string" }, { status: 400 });
  }
  const content = body.content.slice(0, MAX_LENGTH);
  const id = Number.isInteger(body.id) ? (body.id as number) : null;

  let savedId: number;
  if (id === null) {
    savedId = Number(db.prepare("INSERT INTO knowledge_base (content) VALUES (?)").run(content).lastInsertRowid);
  } else {
    db.prepare(
      `INSERT INTO knowledge_base (id, content) VALUES (?, ?)
       ON CONFLICT(id) DO UPDATE SET content = excluded.content`
    ).run(id, content);
    savedId = id;
  }

  return NextResponse.json({ id: savedId, entries: all(), savedAt: new Date().toISOString() });
}

export async function DELETE(req: Request) {
  const body = await req.json().catch(() => ({}));
  const id = Number(body.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "id is required" }, { status: 400 });

  db.prepare("DELETE FROM knowledge_base WHERE id = ?").run(id);
  return NextResponse.json({ entries: all() });
}
