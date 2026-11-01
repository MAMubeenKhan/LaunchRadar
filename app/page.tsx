"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DIRECTORIES, DIRECTORY_STATUSES, type DirectoryStatus } from "@/lib/directories";

type Keyword = { id: number; phrase: string };
type Post = {
  id: string;
  title: string;
  url: string;
  content: string;
  platform: string;
  status: string;
  ai_reply: string | null;
};
type Profile = { name: string; url: string; description: string };
type AutoFillInput = { field: string; selector: string; inputId: string | null; value: string };
type AutoFillPayload = {
  directory: string;
  submitUrl: string;
  requiresLogin: boolean;
  formSelector: string;
  inputs: AutoFillInput[];
  submitButton: string;
  notes: string | null;
};

const card =
  "bg-white shadow-[0_4px_20px_-4px_rgba(229,222,208,0.5)] border border-[#EFEAE2] rounded-2xl";

const inputCls =
  "w-full rounded-xl border border-[#EFEAE2] bg-[#FAF8F5] px-4 py-2.5 text-sm outline-none transition focus:border-amber-400 focus:ring-4 focus:ring-amber-100";

const STATUS_STYLES: Record<DirectoryStatus, string> = {
  "Not started": "bg-[#F5F1EA] text-[#8A7F77] border-[#E8E1D6]",
  Submitted: "bg-amber-50 text-amber-800 border-amber-200",
  Live: "bg-emerald-50 text-emerald-800 border-emerald-200",
};

function PlatformBadge({ platform }: { platform: string }) {
  if (platform.startsWith("Hacker News")) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#A0472B] px-3 py-1 text-xs font-medium tracking-wide text-[#FFF5EC] shadow-sm">
        <span className="font-bold">Y</span> Hacker News
      </span>
    );
  }
  if (platform.startsWith("Reddit")) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[#F6D5B5] bg-[#FFF1E2] px-3 py-1 text-xs font-medium tracking-wide text-[#B8561C]">
        <span className="h-1.5 w-1.5 rounded-full bg-[#E8702A]" /> Reddit
      </span>
    );
  }
  return (
    <span className="rounded-full border border-[#EFEAE2] bg-[#FAF8F5] px-3 py-1 text-xs font-medium text-[#70655E]">
      {platform}
    </span>
  );
}

function agentPrompt(url: string) {
  return `Use browser_navigate to open ${url}, read the post and top comments, then draft a short founder-to-founder reply using my LaunchRadar profile.`;
}

export default function Dashboard() {
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [newKeyword, setNewKeyword] = useState("");
  const [posts, setPosts] = useState<Post[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [fetchBlocked, setFetchBlocked] = useState(false);
  const [drafting, setDrafting] = useState<string | null>(null);
  const [openReply, setOpenReply] = useState<string | null>(null);
  const [agentMode, setAgentMode] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);

  const [profile, setProfile] = useState<Profile>({ name: "", url: "", description: "" });
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);

  const [dirStatus, setDirStatus] = useState<Record<string, DirectoryStatus>>({});
  const [filling, setFilling] = useState<string | null>(null);
  const [autoFill, setAutoFill] = useState<AutoFillPayload | null>(null);
  const [autoFillError, setAutoFillError] = useState<string | null>(null);

  const [brainId, setBrainId] = useState<number | null>(null);
  const [brainDump, setBrainDump] = useState("");
  const [brainState, setBrainState] = useState<"idle" | "loading" | "saving" | "saved" | "error">("loading");
  const brainLoaded = useRef(false);

  const scan = useCallback(async () => {
    setScanning(true);
    setScanNote(null);
    try {
      const res = await fetch("/api/monitor");
      const data = await res.json();
      setPosts(data.matches ?? []);
      setFetchBlocked(!!data.error);
      if (data.error) setScanNote(`Some sources were blocked — ${data.error}`);
      else if (data.scanned > 0)
        setScanNote(
          `Scanned ${data.channels.reddit.scanned} Reddit + ${data.channels.hackerNews.scanned} HN posts · ${data.inserted} new match${data.inserted === 1 ? "" : "es"}`
        );
    } catch {
      setFetchBlocked(true);
      setScanNote("Scan failed. Try again, or use Agent Mode on a card.");
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    fetch("/api/keywords")
      .then((r) => r.json())
      .then((d) => setKeywords(d.keywords ?? []))
      .catch(() => {});
    fetch("/api/profile")
      .then((r) => r.json())
      .then(
        (d) =>
          d.profile &&
          setProfile({ name: d.profile.name ?? "", url: d.profile.url ?? "", description: d.profile.description ?? "" })
      )
      .catch(() => {});
    fetch("/api/directories")
      .then((r) => r.json())
      .then((d) => {
        const map: Record<string, DirectoryStatus> = {};
        for (const row of d.directories ?? []) map[row.name] = row.status;
        setDirStatus(map);
      })
      .catch(() => {});
    fetch("/api/knowledge")
      .then((r) => r.json())
      .then((d) => {
        const first = d.entries?.[0];
        if (first) {
          setBrainId(first.id);
          setBrainDump(first.content ?? "");
        }
        setBrainState("idle");
      })
      .catch(() => setBrainState("error"))
      .finally(() => {
        brainLoaded.current = true;
      });
    scan();
  }, [scan]);

  // Autosave the brain dump shortly after typing stops.
  useEffect(() => {
    if (!brainLoaded.current) return;
    setBrainState("saving");
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/knowledge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(brainId === null ? { content: brainDump } : { id: brainId, content: brainDump }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        if (brainId === null && typeof data.id === "number") setBrainId(data.id);
        setBrainState("saved");
      } catch {
        setBrainState("error");
      }
    }, 800);
    return () => clearTimeout(timer);
    // brainId is set from the first save; re-running on it would save twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brainDump]);

  const exportWorkspace = () => {
    window.location.href = "/api/export";
  };

  const addKeyword = async (e: React.FormEvent) => {
    e.preventDefault();
    const phrase = newKeyword.trim();
    if (!phrase) return;
    setNewKeyword("");
    const res = await fetch("/api/keywords", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phrase }),
    });
    const data = await res.json();
    if (data.keywords) setKeywords(data.keywords);
  };

  const removeKeyword = async (id: number) => {
    setKeywords((k) => k.filter((x) => x.id !== id));
    await fetch("/api/keywords", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  };

  const draftReply = async (postId: string) => {
    setDrafting(postId);
    setOpenReply(postId);
    try {
      const res = await fetch("/api/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId }),
      });
      const data = await res.json();
      const reply = data.reply ?? `⚠️ ${data.error ?? "Could not draft a reply."}`;
      setPosts((ps) =>
        ps.map((p) => (p.id === postId ? { ...p, ai_reply: reply, status: data.reply ? "Drafted" : p.status } : p))
      );
    } catch {
      setPosts((ps) => ps.map((p) => (p.id === postId ? { ...p, ai_reply: "⚠️ Request was blocked or failed." } : p)));
      setAgentMode((m) => ({ ...m, [postId]: true }));
    } finally {
      setDrafting(null);
    }
  };

  const copyText = async (key: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1600);
  };

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 1800);
    } finally {
      setSavingProfile(false);
    }
  };

  const runAutoFill = async (directory: string) => {
    setFilling(directory);
    setAutoFillError(null);
    try {
      const res = await fetch("/api/auto-submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ directory, profile }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAutoFillError(data.error ?? "Auto-fill failed.");
        if (data.payload) setAutoFill(data.payload);
        return;
      }
      setAutoFill(data.payload);
      setDirStatus((s) => ({ ...s, [directory]: "Submitted" }));
    } catch {
      setAutoFillError("Auto-fill request failed.");
    } finally {
      setFilling(null);
    }
  };

  const cycleStatus = async (directory: string) => {
    const current = dirStatus[directory] ?? "Not started";
    const next = DIRECTORY_STATUSES[(DIRECTORY_STATUSES.indexOf(current) + 1) % DIRECTORY_STATUSES.length];
    setDirStatus((s) => ({ ...s, [directory]: next }));
    await fetch("/api/directories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: directory, status: next }),
    }).catch(() => {});
  };

  const liveCount = DIRECTORIES.filter((d) => dirStatus[d] === "Live").length;
  const submittedCount = DIRECTORIES.filter((d) => dirStatus[d] === "Submitted").length;
  const livePct = (liveCount / DIRECTORIES.length) * 100;
  const submittedPct = (submittedCount / DIRECTORIES.length) * 100;

  return (
    <div className="min-h-screen bg-[#FAF8F5] text-[#2C221E]">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-[#EFEAE2] bg-[#FAF8F5]/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">📻 LaunchRadar</h1>
            <p className="font-serif text-sm italic text-[#70655E]">Your quiet, passive distribution engine</p>
          </div>
          <div className="flex items-center gap-4">
          <div className="hidden items-center gap-2 text-xs text-[#70655E] sm:flex">
            <span
              className={`h-2 w-2 rounded-full ${
                scanning ? "animate-pulse bg-amber-500" : fetchBlocked ? "bg-[#A0472B]" : "bg-emerald-500/80"
              }`}
            />
            {scanning ? "Listening…" : `${posts.length} conversation${posts.length === 1 ? "" : "s"} on file`}
          </div>
          <button
            onClick={exportWorkspace}
            title="Download posts, keywords, directories and notes as CSV"
            className="rounded-full border border-[#E5DED0] bg-white px-4 py-2 text-sm font-medium text-[#2C221E] shadow-[0_2px_10px_-4px_rgba(229,222,208,0.8)] transition hover:border-amber-400 hover:text-amber-800"
          >
            📦 Export Workspace
          </button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl grid-cols-1 gap-8 px-6 py-10 lg:grid-cols-12">
        {/* Left: The Discovery Deck */}
        <section className="space-y-6 lg:col-span-7">
          <div className="flex items-baseline justify-between">
            <h2 className="font-serif text-2xl">The Discovery Deck</h2>
            <span className="text-xs uppercase tracking-[0.2em] text-[#70655E]">Reddit · Hacker News</span>
          </div>

          {/* Keywords */}
          <div className={`${card} p-6`}>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="font-medium">Listening for</h3>
                <p className="text-sm text-[#70655E]">Phrases your future users say out loud.</p>
              </div>
              <button
                onClick={scan}
                disabled={scanning}
                className="rounded-full bg-[#2C221E] px-4 py-2 text-sm font-medium text-[#FAF8F5] transition hover:bg-[#4A3A33] disabled:opacity-60"
              >
                {scanning ? "Scanning…" : "Scan now"}
              </button>
            </div>

            <form onSubmit={addKeyword} className="flex gap-2">
              <input
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                placeholder="e.g. looking for a tool to…"
                className="flex-1 rounded-full border border-[#EFEAE2] bg-[#FAF8F5] px-5 py-2.5 text-sm outline-none transition placeholder:text-[#A89E96] focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
              />
              <button
                type="submit"
                className="rounded-full border border-[#E5DED0] bg-white px-5 py-2.5 text-sm font-medium transition hover:border-amber-400 hover:text-amber-700"
              >
                Add
              </button>
            </form>

            <div className="mt-4 flex flex-wrap gap-2">
              {keywords.length === 0 && (
                <p className="font-serif text-sm italic text-[#A89E96]">No phrases yet — add one to start listening.</p>
              )}
              {keywords.map((k) => (
                <span
                  key={k.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-amber-200/70 bg-amber-50 px-3.5 py-1.5 text-sm text-amber-900 transition hover:border-amber-300"
                >
                  {k.phrase}
                  <button
                    onClick={() => removeKeyword(k.id)}
                    aria-label={`Remove ${k.phrase}`}
                    className="text-amber-700/50 transition hover:text-amber-900"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            {scanNote && (
              <p className={`mt-4 text-xs ${fetchBlocked ? "text-[#A0472B]" : "text-[#70655E]"}`}>{scanNote}</p>
            )}
          </div>

          {/* Feed */}
          <div className="space-y-4">
            {posts.length === 0 && !scanning && (
              <div className={`${card} p-10 text-center`}>
                <p className="font-serif text-lg italic text-[#70655E]">All quiet on the radar.</p>
                <p className="mt-1 text-sm text-[#A89E96]">Matching conversations will gather here.</p>
              </div>
            )}

            {posts.map((post) => {
              const isOpen = openReply === post.id;
              const isDrafting = drafting === post.id;
              const agentOn = !!agentMode[post.id];
              return (
                <article
                  key={post.id}
                  data-post-id={post.id}
                  data-platform={post.platform}
                  data-status={post.status}
                  className={`post-card ${card} p-6 transition hover:-translate-y-0.5`}
                >
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <PlatformBadge platform={post.platform} />
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors duration-500 ${
                        post.status === "Drafted" ? "bg-emerald-50 text-emerald-800" : "bg-[#FAF3E8] text-amber-800"
                      }`}
                    >
                      {post.status}
                    </span>
                  </div>

                  <a
                    href={post.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="post-title block text-lg font-medium leading-snug hover:text-amber-800"
                  >
                    {post.title}
                  </a>
                  {post.content && (
                    <p className="mt-2 line-clamp-3 whitespace-pre-line text-sm leading-relaxed text-[#70655E]">
                      {post.content.replace(/<[^>]+>/g, " ")}
                    </p>
                  )}

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => draftReply(post.id)}
                      disabled={isDrafting}
                      data-post-id={post.id}
                      className="draft-response-btn rounded-full bg-amber-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-700 disabled:opacity-60"
                    >
                      {isDrafting ? "Drafting…" : post.ai_reply ? "Redraft reply" : "Draft reply"}
                    </button>
                    {post.ai_reply && (
                      <button
                        onClick={() => setOpenReply(isOpen ? null : post.id)}
                        className="rounded-full border border-[#E5DED0] px-4 py-2 text-sm text-[#70655E] transition hover:border-amber-400 hover:text-[#2C221E]"
                      >
                        {isOpen ? "Hide draft" : "View draft"}
                      </button>
                    )}
                    <button
                      onClick={() => setAgentMode((m) => ({ ...m, [post.id]: !agentOn }))}
                      aria-pressed={agentOn}
                      className={`rounded-full border px-4 py-2 text-sm transition ${
                        agentOn
                          ? "border-[#A0472B]/40 bg-[#FBEEE8] text-[#A0472B]"
                          : "border-[#E5DED0] text-[#70655E] hover:border-amber-400 hover:text-[#2C221E]"
                      }`}
                    >
                      💡 Toggle Agent Mode
                    </button>
                    <a
                      href={post.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-full px-3 py-2 text-sm text-[#70655E] transition hover:text-[#2C221E]"
                    >
                      Open ↗
                    </a>
                  </div>

                  {isOpen && (isDrafting || post.ai_reply) && (
                    <div className="mt-5 rounded-r-xl border-l-4 border-amber-600 bg-[#FDFBF7] px-5 py-4">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="font-serif text-sm italic text-[#70655E]">
                          A note from one founder to another
                        </span>
                        {post.ai_reply && !isDrafting && (
                          <button
                            onClick={() => copyText(post.id, post.ai_reply!)}
                            className="text-xs font-medium text-amber-700 hover:text-amber-900"
                          >
                            {copied === post.id ? "Copied ✓" : "Copy"}
                          </button>
                        )}
                      </div>
                      {isDrafting ? (
                        <p className="animate-pulse font-serif text-[#A89E96]">Thinking it through…</p>
                      ) : (
                        <p className="draft-reply-text whitespace-pre-wrap font-serif leading-relaxed text-[#2C221E]">
                          {post.ai_reply}
                        </p>
                      )}
                    </div>
                  )}

                  {agentOn && (
                    <div className="mt-5 rounded-xl border border-[#EBD9CF] bg-[#FCF6F2] p-5">
                      <p className="text-sm font-medium text-[#A0472B]">
                        {fetchBlocked ? "Fetching was blocked — read it with Claude Code's browser" : "Read this thread with Claude Code's browser"}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-[#70655E]">
                        If CORS, rate limits or bot checks stop the normal fetch, let Claude Code open the page in a
                        real browser instead. Copy the prompt below, then follow the steps.
                      </p>
                      <textarea
                        readOnly
                        rows={6}
                        value={`1. In your local terminal, connect a browser tool once:
   claude mcp add playwright -- npx @playwright/mcp@latest
2. Start Claude Code and run /mcp to check "playwright" is connected (it provides browser_navigate).
3. Paste this prompt:
   ${agentPrompt(post.url)}`}
                        className="mt-3 w-full resize-none rounded-lg border border-[#EBD9CF] bg-white/70 p-3 font-mono text-xs leading-relaxed text-[#4A3A33] outline-none"
                      />
                      <div className="mt-2 flex justify-end">
                        <button
                          onClick={() => copyText(`agent-${post.id}`, agentPrompt(post.url))}
                          className="text-xs font-medium text-[#A0472B] hover:text-[#7E3620]"
                        >
                          {copied === `agent-${post.id}` ? "Copied ✓" : "Copy prompt"}
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>

        {/* Right: The Control Desk */}
        <aside className="space-y-6 lg:col-span-5">
          <h2 className="font-serif text-2xl">The Control Desk</h2>

          {/* Profile */}
          <form onSubmit={saveProfile} className={`${card} space-y-4 p-6`}>
            <div>
              <h3 className="font-medium">Project Profile</h3>
              <p className="text-sm text-[#70655E]">Used by reply drafts and directory auto-fill.</p>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[#70655E]">Name</span>
              <input
                value={profile.name}
                onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                placeholder="LaunchRadar"
                className={inputCls}
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[#70655E]">URL</span>
              <input
                value={profile.url}
                onChange={(e) => setProfile({ ...profile, url: e.target.value })}
                placeholder="https://"
                className={inputCls}
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[#70655E]">
                What it does
              </span>
              <textarea
                value={profile.description}
                onChange={(e) => setProfile({ ...profile, description: e.target.value })}
                rows={4}
                placeholder="One honest paragraph about the problem you solve and who it's for."
                className={`${inputCls} resize-none py-3 leading-relaxed`}
              />
            </label>

            <div className="flex items-center justify-end gap-3">
              {profileSaved && <span className="text-xs text-emerald-700">Saved ✓</span>}
              <button
                type="submit"
                disabled={savingProfile}
                className="rounded-full bg-[#2C221E] px-5 py-2 text-sm font-medium text-[#FAF8F5] transition hover:bg-[#4A3A33] disabled:opacity-60"
              >
                {savingProfile ? "Saving…" : "Save profile"}
              </button>
            </div>
          </form>

          {/* Founder Brain Dump */}
          <div className={`${card} p-6`}>
            <div className="mb-4 flex items-end justify-between">
              <div>
                <h3 className="font-medium">🧠 Founder Brain Dump</h3>
                <p className="text-sm text-[#70655E]">Raw dev logs and lessons. Replies borrow your voice and facts from here.</p>
              </div>
              <span
                className={`text-xs transition-colors duration-300 ${
                  brainState === "error"
                    ? "text-[#A0472B]"
                    : brainState === "saved"
                      ? "text-emerald-700"
                      : "text-[#A89E96]"
                }`}
              >
                {brainState === "loading" && "Loading…"}
                {brainState === "saving" && "Saving…"}
                {brainState === "saved" && "Saved ✓"}
                {brainState === "error" && "Not saved"}
              </span>
            </div>
            <textarea
              value={brainDump}
              onChange={(e) => setBrainDump(e.target.value)}
              disabled={brainState === "loading"}
              rows={9}
              placeholder={"e.g. spent two nights fighting reddit's rate limits — fix was a real user-agent + 60s backoff.\nswitched sqlite to WAL mode, concurrent reads stopped locking.\nusers keep asking for slack alerts, not email."}
              className="w-full resize-y rounded-xl border border-[#F0E3CF] bg-[#FDF8EF] px-4 py-3 font-serif text-sm leading-relaxed text-[#2C221E] outline-none transition placeholder:text-[#B9AC9F] focus:border-amber-400 focus:ring-4 focus:ring-amber-100 disabled:opacity-60"
            />
            <p className="mt-2 text-right text-xs text-[#A89E96]">{brainDump.length.toLocaleString()} / 50,000</p>
          </div>

          {/* Directory checklist */}
          <div className={`${card} p-6`}>
            <div className="mb-4 flex items-end justify-between">
              <div>
                <h3 className="font-medium">Launch Directories</h3>
                <p className="text-sm text-[#70655E]">Auto-fill, then tap the badge as each one goes live.</p>
              </div>
              <span className="font-serif text-sm text-[#70655E]">
                {liveCount} live · {submittedCount} sent
              </span>
            </div>

            <div className="mb-5 flex h-1.5 overflow-hidden rounded-full bg-[#F3EEE6]">
              <div className="h-full bg-emerald-500/80 transition-all duration-500" style={{ width: `${livePct}%` }} />
              <div className="h-full bg-amber-500 transition-all duration-500" style={{ width: `${submittedPct}%` }} />
            </div>

            <ul className="divide-y divide-[#F3EEE6]">
              {DIRECTORIES.map((name) => {
                const status = dirStatus[name] ?? "Not started";
                const isFilling = filling === name;
                return (
                  <li key={name} className="flex items-center gap-3 py-2">
                    <span
                      className={`flex-1 text-sm transition-all duration-300 ${
                        status === "Live" ? "text-[#A89E96] line-through decoration-amber-600/60" : "text-[#2C221E]"
                      }`}
                    >
                      {name}
                    </span>
                    <button
                      onClick={() => runAutoFill(name)}
                      disabled={isFilling}
                      className="rounded-full border border-amber-200 bg-white px-3 py-1 text-xs font-medium text-amber-800 transition hover:border-amber-400 hover:bg-amber-50 disabled:opacity-60"
                    >
                      {isFilling ? "Filling…" : "⚡ Auto-Fill"}
                    </button>
                    <button
                      onClick={() => cycleStatus(name)}
                      title="Click to change status"
                      className={`w-24 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors duration-500 ${STATUS_STYLES[status]}`}
                    >
                      {status === "Live" ? "✓ Live" : status}
                    </button>
                  </li>
                );
              })}
            </ul>

            {autoFillError && <p className="mt-4 text-xs text-[#A0472B]">{autoFillError}</p>}

            {autoFill && (
              <div className="mt-5 rounded-r-xl border-l-4 border-amber-600 bg-[#FDFBF7] px-5 py-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="font-serif text-sm italic text-[#70655E]">Form map · {autoFill.directory}</span>
                  <button onClick={() => setAutoFill(null)} className="text-xs text-[#A89E96] hover:text-[#2C221E]">
                    Close
                  </button>
                </div>
                <a
                  href={autoFill.submitUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate text-xs font-medium text-amber-700 hover:text-amber-900"
                >
                  {autoFill.submitUrl} ↗
                </a>
                <ul className="mt-3 space-y-2">
                  {autoFill.inputs.map((input) => (
                    <li key={input.field} className="text-xs">
                      <div className="flex justify-between gap-3">
                        <span className="font-medium capitalize text-[#2C221E]">{input.field}</span>
                        <code className="truncate text-[#70655E]">{input.inputId ? `#${input.inputId}` : input.selector}</code>
                      </div>
                      <p className="mt-0.5 truncate text-[#A89E96]">{input.value || "—"}</p>
                    </li>
                  ))}
                  <li className="flex justify-between gap-3 border-t border-[#EFEAE2] pt-2 text-xs">
                    <span className="font-medium text-[#2C221E]">Submit</span>
                    <code className="truncate text-[#70655E]">{autoFill.submitButton}</code>
                  </li>
                </ul>
                {autoFill.notes && <p className="mt-3 text-xs italic text-[#70655E]">{autoFill.notes}</p>}
                <button
                  onClick={() => copyText("autofill", JSON.stringify(autoFill, null, 2))}
                  className="mt-3 text-xs font-medium text-amber-700 hover:text-amber-900"
                >
                  {copied === "autofill" ? "Copied ✓" : "Copy JSON"}
                </button>
              </div>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}
