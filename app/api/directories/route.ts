import { NextResponse } from "next/server";
import db, { type DirectoryRow } from "@/lib/db";
import { DIRECTORY_STATUSES, type DirectoryStatus } from "@/lib/directories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function all(): DirectoryRow[] {
  return db.prepare("SELECT name, status, submitted_at FROM directories").all() as DirectoryRow[];
}

export async function GET() {
  return NextResponse.json({ directories: all() });
}

// Manually set a directory's status (e.g. mark it Live once approved).
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name : "";
  const status = body.status as DirectoryStatus;

  if (!name || !DIRECTORY_STATUSES.includes(status)) {
    return NextResponse.json({ error: "name and a valid status are required" }, { status: 400 });
  }

  db.prepare(
    `INSERT INTO directories (name, status, submitted_at) VALUES (@name, @status, @at)
     ON CONFLICT(name) DO UPDATE SET status = excluded.status,
       submitted_at = COALESCE(excluded.submitted_at, directories.submitted_at)`
  ).run({ name, status, at: status === "Not started" ? null : new Date().toISOString() });

  return NextResponse.json({ directories: all() });
}
