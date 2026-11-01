"use client";

import { useCallback, useEffect, useState } from "react";

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

const DIRECTORIES = [
  "Product Hunt",
  "Indie Hackers",
  "Microlaunch",
  "Hacker News (Show HN)",
  "BetaList",
  "Reddit r/SideProject",
  "AlternativeTo",
  "SaaSHub",
  "Uneed",
  "Peerlist Launchpad",
  "DevHunt",
  "Fazier",
  "TinyLaunch",
  "Launching Next",
  "Startup Stash",
  "StartupBase",
  "Betapage",
  "G2",
  "Capterra",
  "Crunchbase",
  "There's An AI For That",
  "Futurepedia",
  "Toolify",
  "SideProjectors",
  "DEV Community",
  "Lobsters",
  "OpenHunts",
  "Smol Launch",
  "Startups.fyi",
  "F6S",
];

const CHECKLIST_KEY = "launchradar:directories";

const card =
  "bg-white shadow-[0_4px_20px_-4px_rgba(229,222,208,0.5)] border border-[#EFEAE2] rounded-2xl";

export default function Dashboard() {
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [newKeyword, setNewKeyword] = useState("");
  const [posts, setPosts] = useState<Post[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [drafting, setDrafting] = useState<string | null>(null);
  const [openReply, setOpenReply] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const [profile, setProfile] = useState<Profile>({ name: "", url: "", description: "" });
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);

  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const scan = useCallback(async () => {
    setScanning(true);
    setScanNote(null);
    try {
      const res = await fetch("/api/monitor");
      const data = await res.json();
      setPosts(data.matches ?? []);
      if (data.error) setScanNote(`Couldn't reach Reddit: ${data.error}`);
      else if (typeof data.scanned === "number" && data.scanned > 0)
        setScanNote(`Scanned ${data.scanned} posts · ${data.inserted} new match${data.inserted === 1 ? "" : "es"}`);
    } catch {
      setScanNote("Scan failed. Try again in a moment.");
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
      .then((d) => d.profile && setProfile({ name: d.profile.name ?? "", url: d.profile.url ?? "", description: d.profile.description ?? "" }))
      .catch(() => {});
    scan();
    try {
      const saved = localStorage.getItem(CHECKLIST_KEY);
      if (saved) setChecked(JSON.parse(saved));
    } catch {}
  }, [scan]);

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
    } finally {
      setDrafting(null);
    }
  };

  const copyReply = async (post: Post) => {
    if (!post.ai_reply) return;
    await navigator.clipboard.writeText(post.ai_reply);
    setCopied(post.id);
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

  const toggleDirectory = (name: string) => {
    setChecked((prev) => {
      const next = { ...prev, [name]: !prev[name] };
      try {
        localStorage.setItem(CHECKLIST_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const doneCount = DIRECTORIES.filter((d) => checked[d]).length;
  const progress = Math.round((doneCount / DIRECTORIES.length) * 100);

  return (
    <div className="min-h-screen bg-[#FAF8F5] text-[#2C221E]">
      {/* Header */}
      <header className="border-b border-[#EFEAE2] bg-[#FAF8F5]/90 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">📻 LaunchRadar</h1>
            <p className="font-serif text-sm italic text-[#70655E]">Your quiet, passive distribution engine</p>
          </div>
          <div className="hidden items-center gap-2 text-xs text-[#70655E] sm:flex">
            <span className={`h-2 w-2 rounded-full ${scanning ? "animate-pulse bg-amber-500" : "bg-emerald-500/80"}`} />
            {scanning ? "Listening…" : `${posts.length} conversation${posts.length === 1 ? "" : "s"} on file`}
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl grid-cols-1 gap-8 px-6 py-10 lg:grid-cols-12">
        {/* Left: The Discovery Deck */}
        <section className="space-y-6 lg:col-span-7">
          <div className="flex items-baseline justify-between">
            <h2 className="font-serif text-2xl">The Discovery Deck</h2>
            <span className="text-xs uppercase tracking-[0.2em] text-[#70655E]">Listen · Reply · Repeat</span>
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
                className="flex-1 rounded-full border border-[#EFEAE2] bg-[#FAF8F5] px-5 py-2.5 text-sm placeholder:text-[#A89E96] outline-none transition focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
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
                  className="group inline-flex items-center gap-1.5 rounded-full border border-amber-200/70 bg-amber-50 px-3.5 py-1.5 text-sm text-amber-900 transition hover:border-amber-300"
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
            {scanNote && <p className="mt-4 text-xs text-[#70655E]">{scanNote}</p>}
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
              return (
                <article key={post.id} className={`${card} p-6 transition hover:-translate-y-0.5`}>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="text-xs font-medium uppercase tracking-wider text-[#70655E]">{post.platform}</span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        post.status === "Drafted"
                          ? "bg-emerald-50 text-emerald-800"
                          : "bg-[#FAF3E8] text-amber-800"
                      }`}
                    >
                      {post.status}
                    </span>
                  </div>

                  <a
                    href={post.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-lg font-medium leading-snug hover:text-amber-800"
                  >
                    {post.title}
                  </a>
                  {post.content && (
                    <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-[#70655E]">{post.content}</p>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      onClick={() => draftReply(post.id)}
                      disabled={isDrafting}
                      className="rounded-full bg-amber-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-700 disabled:opacity-60"
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
                    <a
                      href={post.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-full px-4 py-2 text-sm text-[#70655E] transition hover:text-[#2C221E]"
                    >
                      Open thread ↗
                    </a>
                  </div>

                  {isOpen && (isDrafting || post.ai_reply) && (
                    <div className="mt-5 rounded-r-xl bg-[#FDFBF7] border-l-4 border-amber-600 px-5 py-4">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="font-serif text-sm italic text-[#70655E]">A note from one founder to another</span>
                        {post.ai_reply && !isDrafting && (
                          <button
                            onClick={() => copyReply(post)}
                            className="text-xs font-medium text-amber-700 hover:text-amber-900"
                          >
                            {copied === post.id ? "Copied ✓" : "Copy"}
                          </button>
                        )}
                      </div>
                      {isDrafting ? (
                        <p className="animate-pulse font-serif text-[#A89E96]">Thinking it through…</p>
                      ) : (
                        <p className="whitespace-pre-wrap font-serif leading-relaxed text-[#2C221E]">{post.ai_reply}</p>
                      )}
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
              <p className="text-sm text-[#70655E]">Context your drafted replies will draw from.</p>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[#70655E]">Name</span>
              <input
                value={profile.name}
                onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                placeholder="LaunchRadar"
                className="w-full rounded-xl border border-[#EFEAE2] bg-[#FAF8F5] px-4 py-2.5 text-sm outline-none transition focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[#70655E]">URL</span>
              <input
                value={profile.url}
                onChange={(e) => setProfile({ ...profile, url: e.target.value })}
                placeholder="https://"
                className="w-full rounded-xl border border-[#EFEAE2] bg-[#FAF8F5] px-4 py-2.5 text-sm outline-none transition focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
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
                className="w-full resize-none rounded-xl border border-[#EFEAE2] bg-[#FAF8F5] px-4 py-3 text-sm leading-relaxed outline-none transition focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
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

          {/* Directory checklist */}
          <div className={`${card} p-6`}>
            <div className="mb-4 flex items-end justify-between">
              <div>
                <h3 className="font-medium">Launch Directories</h3>
                <p className="text-sm text-[#70655E]">Thirty quiet doors to knock on.</p>
              </div>
              <span className="font-serif text-sm text-[#70655E]">
                {doneCount}/{DIRECTORIES.length}
              </span>
            </div>

            <div className="mb-5 h-1.5 overflow-hidden rounded-full bg-[#F3EEE6]">
              <div
                className="h-full rounded-full bg-amber-600 transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>

            <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {DIRECTORIES.map((name) => {
                const done = !!checked[name];
                return (
                  <li key={name}>
                    <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 transition hover:bg-[#FAF8F5]">
                      <input
                        type="checkbox"
                        checked={done}
                        onChange={() => toggleDirectory(name)}
                        className="h-4 w-4 rounded border-[#D9D0C3] accent-amber-600"
                      />
                      <span
                        className={`text-sm transition-all duration-300 ${
                          done ? "text-[#A89E96] line-through decoration-amber-600/60" : "text-[#2C221E]"
                        }`}
                      >
                        {name}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>
      </main>
    </div>
  );
}
