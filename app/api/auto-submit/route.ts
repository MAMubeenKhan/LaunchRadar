import { NextResponse } from "next/server";
import db, { type Profile } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Optional: set this to forward each payload to your own automation
// (n8n, Zapier, a Playwright worker, etc.). Without it the route returns
// the payload so you or an agent can run it.
const WEBHOOK_URL = process.env.AUTO_SUBMIT_WEBHOOK_URL;

type Step =
  | { action: "goto"; url: string }
  | { action: "fill"; selector: string; inputId?: string; field: keyof Profile | "tagline"; value: string }
  | { action: "click"; selector: string; note?: string }
  | { action: "manual"; note: string };

type DirectorySpec = {
  submitUrl: string;
  requiresLogin: boolean;
  formSelector: string;
  fields: { field: keyof Profile | "tagline"; selector: string; inputId?: string }[];
  submitButton: string;
  notes?: string;
};

// Selectors are best-effort starting points. Directory sites change their
// markup often, so verify each one in the browser before running unattended.
const SPECS: Record<string, DirectorySpec> = {
  "Product Hunt": {
    submitUrl: "https://www.producthunt.com/posts/new",
    requiresLogin: true,
    formSelector: "form",
    fields: [
      { field: "url", selector: 'input[name="url"]', inputId: "url" },
      { field: "name", selector: 'input[name="name"]', inputId: "name" },
      { field: "tagline", selector: 'input[name="tagline"]', inputId: "tagline" },
      { field: "description", selector: 'textarea[name="description"]', inputId: "description" },
    ],
    submitButton: 'button[type="submit"]',
    notes: "Multi-step wizard: URL first, then details, media and schedule.",
  },
  "Indie Hackers": {
    submitUrl: "https://www.indiehackers.com/products/new",
    requiresLogin: true,
    formSelector: "form",
    fields: [
      { field: "name", selector: 'input[name="name"]' },
      { field: "url", selector: 'input[name="website"]' },
      { field: "tagline", selector: 'input[name="tagline"]' },
      { field: "description", selector: 'textarea[name="description"]' },
    ],
    submitButton: 'button[type="submit"]',
  },
  Microlaunch: {
    submitUrl: "https://microlaunch.net/submit",
    requiresLogin: true,
    formSelector: "form",
    fields: [
      { field: "name", selector: 'input[name="name"]' },
      { field: "url", selector: 'input[name="url"]' },
      { field: "tagline", selector: 'input[name="tagline"]' },
      { field: "description", selector: 'textarea[name="description"]' },
    ],
    submitButton: 'button[type="submit"]',
  },
  "Hacker News (Show HN)": {
    submitUrl: "https://news.ycombinator.com/submit",
    requiresLogin: true,
    formSelector: 'form[action="/r"]',
    fields: [
      { field: "name", selector: 'input[name="title"]' },
      { field: "url", selector: 'input[name="url"]' },
      { field: "description", selector: 'textarea[name="text"]' },
    ],
    submitButton: 'input[type="submit"]',
    notes: 'Title should start with "Show HN: ". Use either URL or text, not both, for best results.',
  },
  BetaList: {
    submitUrl: "https://betalist.com/submit",
    requiresLogin: true,
    formSelector: "form",
    fields: [
      { field: "name", selector: 'input[name="startup[name]"]' },
      { field: "url", selector: 'input[name="startup[url]"]' },
      { field: "tagline", selector: 'input[name="startup[pitch]"]' },
      { field: "description", selector: 'textarea[name="startup[description]"]' },
    ],
    submitButton: 'input[type="submit"], button[type="submit"]',
  },
  Uneed: {
    submitUrl: "https://www.uneed.best/submit-a-tool",
    requiresLogin: true,
    formSelector: "form",
    fields: [
      { field: "url", selector: 'input[type="url"]' },
      { field: "name", selector: 'input[name="name"]' },
      { field: "description", selector: "textarea" },
    ],
    submitButton: 'button[type="submit"]',
  },
  DevHunt: {
    submitUrl: "https://devhunt.org/account/tools/new",
    requiresLogin: true,
    formSelector: "form",
    fields: [
      { field: "name", selector: 'input[name="tool_name"]' },
      { field: "url", selector: 'input[name="tool_website"]' },
      { field: "tagline", selector: 'input[name="tool_slogan"]' },
      { field: "description", selector: 'textarea[name="tool_description"]' },
    ],
    submitButton: 'button[type="submit"]',
  },
  AlternativeTo: {
    submitUrl: "https://alternativeto.net/manage-item/",
    requiresLogin: true,
    formSelector: "form",
    fields: [
      { field: "name", selector: 'input[name="name"]' },
      { field: "url", selector: 'input[name="url"]' },
      { field: "description", selector: 'textarea[name="description"]' },
    ],
    submitButton: 'button[type="submit"]',
  },
};

// Heuristic selectors that work on most simple "submit your tool" forms.
function genericSpec(directory: string): DirectorySpec {
  return {
    submitUrl: `https://www.google.com/search?q=${encodeURIComponent(`${directory} submit startup`)}`,
    requiresLogin: false,
    formSelector: "form",
    fields: [
      { field: "name", selector: 'input[name*="name" i], input[placeholder*="name" i]' },
      { field: "url", selector: 'input[type="url"], input[name*="url" i], input[name*="website" i]' },
      { field: "tagline", selector: 'input[name*="tagline" i], input[name*="slogan" i], input[name*="pitch" i]' },
      { field: "description", selector: 'textarea[name*="desc" i], textarea' },
    ],
    submitButton: 'button[type="submit"], input[type="submit"]',
    notes: "No saved spec for this directory — find its submit page and confirm these generic selectors.",
  };
}

function tagline(description: string): string {
  const first = description.split(/(?<=[.!?])\s+/)[0] ?? "";
  return first.length > 60 ? `${first.slice(0, 57).trimEnd()}…` : first;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const directory = typeof body.directory === "string" ? body.directory.trim() : "";
  if (!directory) return NextResponse.json({ error: "directory is required" }, { status: 400 });

  // Use the profile sent by the client, falling back to the saved one.
  const saved = db.prepare("SELECT * FROM profile WHERE id = 1").get() as Profile | undefined;
  const p = body.profile ?? {};
  const profile = {
    name: (typeof p.name === "string" && p.name.trim()) || saved?.name || "",
    url: (typeof p.url === "string" && p.url.trim()) || saved?.url || "",
    description: (typeof p.description === "string" && p.description.trim()) || saved?.description || "",
  };

  if (!profile.name || !profile.url) {
    return NextResponse.json({ error: "Save a product name and URL in your profile first." }, { status: 400 });
  }

  const spec = SPECS[directory] ?? genericSpec(directory);
  const values: Record<string, string> = {
    ...profile,
    name: directory.startsWith("Hacker News") ? `Show HN: ${profile.name}` : profile.name,
    tagline: tagline(profile.description),
  };

  const steps: Step[] = [
    { action: "goto", url: spec.submitUrl },
    ...(spec.requiresLogin ? [{ action: "manual" as const, note: "Sign in to your account if prompted." }] : []),
    ...spec.fields.map((f) => ({
      action: "fill" as const,
      selector: `${spec.formSelector} ${f.selector}`.trim(),
      ...(f.inputId ? { inputId: f.inputId } : {}),
      field: f.field,
      value: values[f.field] ?? "",
    })),
    { action: "click", selector: spec.submitButton, note: "Review the filled form before clicking." },
  ];

  const payload = {
    directory,
    submitUrl: spec.submitUrl,
    requiresLogin: spec.requiresLogin,
    formSelector: spec.formSelector,
    inputs: spec.fields.map((f) => ({
      field: f.field,
      selector: f.selector,
      inputId: f.inputId ?? null,
      value: values[f.field] ?? "",
    })),
    submitButton: spec.submitButton,
    steps,
    notes: spec.notes ?? null,
    generatedAt: new Date().toISOString(),
  };

  let mode: "webhook" | "payload" = "payload";
  if (WEBHOOK_URL) {
    try {
      const res = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Webhook responded with ${res.status}`);
      mode = "webhook";
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Webhook failed", payload },
        { status: 502 }
      );
    }
  }

  db.prepare(
    `INSERT INTO directories (name, status, submitted_at) VALUES (?, 'Submitted', ?)
     ON CONFLICT(name) DO UPDATE SET status = 'Submitted', submitted_at = excluded.submitted_at`
  ).run(directory, payload.generatedAt);

  return NextResponse.json({ ok: true, mode, status: "Submitted", payload });
}
