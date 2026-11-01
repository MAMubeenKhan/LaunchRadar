// Lightweight "semantic" keyword matcher: no ML, just normalisation rules.
// A keyword matches when either:
//   1. the full phrase appears in the text (case/punctuation-insensitive), or
//   2. every meaningful word of the phrase appears in the text after light
//      stemming (so "landing pages" matches "built a landing page"), and
//      those words sit within a small window of each other.

const STOP_WORDS = new Set([
  "a", "an", "the", "to", "for", "of", "and", "or", "in", "on", "with", "my", "your",
  "is", "are", "be", "i", "we", "it", "that", "this", "at", "by", "from", "any",
]);

const WINDOW = 12; // max distance in words between the first and last matched term

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, " ") // strip HTML (HN text is HTML)
    .replace(/&[a-z#0-9]+;/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stem(word: string): string {
  if (word.length <= 3) return word;
  for (const suffix of ["ing", "ers", "ies", "ed", "er", "es", "s"]) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) {
      return suffix === "ies" ? word.slice(0, -3) + "y" : word.slice(0, -suffix.length);
    }
  }
  return word;
}

function tokens(text: string): string[] {
  return normalise(text).split(" ").filter(Boolean).map(stem);
}

export function matchKeyword(title: string, body: string, keywords: string[]): string | null {
  const text = `${title} ${body}`;
  const flat = normalise(text);
  const words = tokens(text);

  for (const keyword of keywords) {
    const phrase = normalise(keyword);
    if (!phrase) continue;

    if (` ${flat} `.includes(` ${phrase} `)) return keyword;

    const terms = tokens(keyword).filter((t) => !STOP_WORDS.has(t));
    if (terms.length === 0) continue;

    const positions = terms.map((t) =>
      words.reduce<number[]>((acc, w, i) => (w === t ? [...acc, i] : acc), [])
    );
    if (positions.some((p) => p.length === 0)) continue;
    if (terms.length === 1) return keyword;

    // Any combination of positions that fits inside the window counts.
    const fits = positions[0].some((start) =>
      positions.every((p) => p.some((i) => Math.abs(i - start) <= WINDOW))
    );
    if (fits) return keyword;
  }

  return null;
}
