import { NextResponse } from "next/server";
import db, { type Keyword } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function all(): Keyword[] {
  return db.prepare("SELECT id, phrase FROM keywords ORDER BY id ASC").all() as Keyword[];
}

export async function GET() {
  return NextResponse.json({ keywords: all() });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const phrase = typeof body.phrase === "string" ? body.phrase.trim().toLowerCase() : "";
  if (!phrase) return NextResponse.json({ error: "phrase is required" }, { status: 400 });

  db.prepare("INSERT OR IGNORE INTO keywords (phrase) VALUES (?)").run(phrase);
  return NextResponse.json({ keywords: all() });
}

export async function DELETE(req: Request) {
  const body = await req.json().catch(() => ({}));
  const id = Number(body.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "id is required" }, { status: 400 });

  db.prepare("DELETE FROM keywords WHERE id = ?").run(id);
  return NextResponse.json({ keywords: all() });
}
