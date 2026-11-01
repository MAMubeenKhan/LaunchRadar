import db, { type DirectoryRow, type Keyword, type KnowledgeRow, type Post } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One unified sheet: every row says which table it came from.
const COLUMNS = [
  "table",
  "id",
  "title",
  "url",
  "platform",
  "status",
  "content",
  "ai_reply",
  "submitted_at",
] as const;

type Row = Partial<Record<(typeof COLUMNS)[number], string | number | null>>;

function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  // Stop spreadsheet apps from running scraped text as a formula.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows: Row[]): string {
  const lines = [COLUMNS.join(",")];
  for (const row of rows) lines.push(COLUMNS.map((c) => csvCell(row[c])).join(","));
  // BOM so Excel reads UTF-8 (emoji, accents) correctly.
  return "﻿" + lines.join("\r\n") + "\r\n";
}

function toMarkdown(data: {
  posts: Post[];
  keywords: Keyword[];
  directories: DirectoryRow[];
  knowledge: KnowledgeRow[];
}): string {
  const cell = (v: unknown) => String(v ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
  const out: string[] = [`# LaunchRadar Workspace`, ``, `_Exported ${new Date().toISOString()}_`, ``];

  out.push(`## Keywords (${data.keywords.length})`, ``);
  out.push(data.keywords.length ? data.keywords.map((k) => `- ${k.phrase}`).join("\n") : "_None_", ``);

  out.push(`## Posts (${data.posts.length})`, ``);
  for (const p of data.posts) {
    out.push(`### [${p.title || "(untitled)"}](${p.url})`, ``, `**${p.platform}** · ${p.status}`, ``);
    if (p.content) out.push(`> ${p.content.replace(/<[^>]+>/g, " ").slice(0, 600).replace(/\n+/g, "\n> ")}`, ``);
    if (p.ai_reply) out.push(`**Draft reply:** ${p.ai_reply}`, ``);
  }

  out.push(`## Directories`, ``, `| Directory | Status | Submitted |`, `| --- | --- | --- |`);
  for (const d of data.directories) out.push(`| ${cell(d.name)} | ${cell(d.status)} | ${cell(d.submitted_at)} |`);
  out.push(``);

  out.push(`## Founder Brain Dump`, ``);
  out.push(
    data.knowledge.filter((k) => k.content?.trim()).map((k) => k.content.trim()).join("\n\n---\n\n") || "_Empty_",
    ``
  );

  return out.join("\n");
}

export async function GET(req: Request) {
  const posts = db.prepare("SELECT * FROM posts ORDER BY rowid DESC").all() as Post[];
  const keywords = db.prepare("SELECT id, phrase FROM keywords ORDER BY id").all() as Keyword[];
  const directories = db.prepare("SELECT name, status, submitted_at FROM directories ORDER BY name").all() as DirectoryRow[];
  const knowledge = db.prepare("SELECT id, content FROM knowledge_base ORDER BY id").all() as KnowledgeRow[];

  const stamp = new Date().toISOString().slice(0, 10);
  const format = new URL(req.url).searchParams.get("format");

  if (format === "md") {
    return new Response(toMarkdown({ posts, keywords, directories, knowledge }), {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename=launchradar-workspace-${stamp}.md`,
        "Cache-Control": "no-store",
      },
    });
  }

  const rows: Row[] = [
    ...keywords.map((k) => ({ table: "keywords", id: k.id, content: k.phrase })),
    ...posts.map((p) => ({
      table: "posts",
      id: p.id,
      title: p.title,
      url: p.url,
      platform: p.platform,
      status: p.status,
      content: p.content,
      ai_reply: p.ai_reply,
    })),
    ...directories.map((d) => ({ table: "directories", id: d.name, title: d.name, status: d.status, submitted_at: d.submitted_at })),
    ...knowledge.map((k) => ({ table: "knowledge_base", id: k.id, content: k.content })),
  ];

  return new Response(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=launchradar-workspace.csv",
      "Cache-Control": "no-store",
    },
  });
}
