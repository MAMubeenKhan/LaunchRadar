import { NextResponse } from "next/server";
import db, { type Profile } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function read(): Profile {
  return db.prepare("SELECT id, name, url, description FROM profile WHERE id = 1").get() as Profile;
}

export async function GET() {
  return NextResponse.json({ profile: read() });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  db.prepare(
    `INSERT INTO profile (id, name, url, description) VALUES (1, @name, @url, @description)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, url = excluded.url, description = excluded.description`
  ).run({ name: str(body.name), url: str(body.url), description: str(body.description) });

  return NextResponse.json({ profile: read() });
}
