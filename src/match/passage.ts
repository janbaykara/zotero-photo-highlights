import { buildPageIndex, postingsFor, type PageIndex } from "./pageIndex";

/** Normalize quotes and file text before scoring. */

const CURLY_SINGLE = /[\u2018\u2019\u201A\u201B]/g;
const CURLY_DOUBLE = /[\u201C\u201D\u201E\u201F\u00AB\u00BB]/g;
const DASHES = /[\u2010\u2011\u2012\u2013\u2014\u2212]/g;

export function normalizePassage(input: string): string {
  return normalizeWithMap(input).text;
}

/** Normalized text plus the original index of each output character. */
export function normalizeWithMap(input: string): {
  text: string;
  map: number[];
} {
  const source = String(input || "");
  let text = "";
  const map: number[] = [];
  const push = (char: string, index: number) => {
    text += char;
    map.push(index);
  };

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === "\u00ad") {
      continue;
    }
    if (CURLY_SINGLE.test(char)) {
      CURLY_SINGLE.lastIndex = 0;
      push("'", i);
      continue;
    }
    CURLY_SINGLE.lastIndex = 0;
    if (CURLY_DOUBLE.test(char)) {
      CURLY_DOUBLE.lastIndex = 0;
      push('"', i);
      continue;
    }
    CURLY_DOUBLE.lastIndex = 0;
    if (DASHES.test(char)) {
      DASHES.lastIndex = 0;
      push("-", i);
      continue;
    }
    DASHES.lastIndex = 0;

    if (isLetter(char) && source[i + 1] === "-") {
      let j = i + 2;
      while (j < source.length && /[\r\n]/.test(source[j])) {
        j++;
      }
      let k = j;
      while (
        k < source.length &&
        /\s/.test(source[k]) &&
        !/[\r\n]/.test(source[k])
      ) {
        k++;
      }
      if (k < source.length && isLetter(source[k]) && j > i + 2) {
        push(char.toLowerCase(), i);
        i = k - 1;
        continue;
      }
    }

    if (/\s/.test(char)) {
      if (!text.length || text.endsWith(" ")) {
        continue;
      }
      push(" ", i);
      continue;
    }
    push(char.toLowerCase(), i);
  }

  while (text.endsWith(" ")) {
    text = text.slice(0, -1);
    map.pop();
  }
  return { text, map };
}

function isLetter(char: string | undefined): boolean {
  return !!char && /\p{L}/u.test(char);
}

/** Words immediately before and after [start, end) in `text`. */
export function wordsAround(
  text: string,
  start: number,
  end: number,
  words = 12,
): { lead: string; trail: string } {
  const source = String(text || "");
  const from = Math.max(0, Math.min(start, source.length));
  const to = Math.max(from, Math.min(end, source.length));
  const before = source.slice(0, from).trim().split(/\s+/).filter(Boolean);
  const after = source.slice(to).trim().split(/\s+/).filter(Boolean);
  const leadWords = before.slice(-words);
  const trailWords = after.slice(0, words);
  return {
    lead: leadWords.length
      ? `${before.length > words ? "… " : ""}${leadWords.join(" ")}`
      : "",
    trail: trailWords.length
      ? `${trailWords.join(" ")}${after.length > words ? " …" : ""}`
      : "",
  };
}

export function quotesOverlap(paragraph: string, quote: string): boolean {
  const left = normalizePassage(paragraph);
  const right = normalizePassage(quote);
  if (!left || !right || left.length < 8 || right.length < 8) {
    return false;
  }
  return left.includes(right) || right.includes(left);
}

/** 1 is identical. Length-normalized Levenshtein. */
export function editSimilarity(left: string, right: string): number {
  if (left === right) {
    return left ? 1 : 0;
  }
  const maxLen = Math.max(left.length, right.length);
  if (!maxLen) {
    return 0;
  }
  const distance = levenshtein(left, right);
  return 1 - distance / maxLen;
}

function levenshtein(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  if (!left.length) {
    return right.length;
  }
  if (!right.length) {
    return left.length;
  }
  let previous = new Array<number>(right.length + 1);
  let current = new Array<number>(right.length + 1);
  for (let j = 0; j <= right.length; j++) {
    previous[j] = j;
  }
  for (let i = 1; i <= left.length; i++) {
    current[0] = i;
    const leftChar = left.charCodeAt(i - 1);
    for (let j = 1; j <= right.length; j++) {
      const cost = leftChar === right.charCodeAt(j - 1) ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost,
      );
    }
    const swap = previous;
    previous = current;
    current = swap;
  }
  return previous[right.length];
}

type WordSpan = { text: string; start: number };

function wordsOf(text: string): WordSpan[] {
  const words: WordSpan[] = [];
  const re = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    words.push({ text: match[0], start: match.index });
  }
  return words;
}

export type PassageHit = {
  score: number;
  start: number;
  end: number;
  matched: string;
};

/** How many rare quote words are probed. Each one is followed through every posting. */
const MAX_SEED_PROBES = 4;

/**
 * Best windows of `text` for `quote`.
 * Anchors on longer words so a book page is not scored at every character.
 */
export function findPassageHits(
  quote: string,
  text: string,
  limit = 5,
): PassageHit[] {
  const needle = normalizePassage(quote);
  const hay = normalizePassage(text);
  if (needle.length < 8 || !hay) {
    return [];
  }
  return locateOnIndex(buildPageIndex([hay]), needle, limit)[0] || [];
}

/**
 * Same hits as `findPassageHits`. Yields once so the wizard can paint, then
 * finishes. The page index makes the search itself short.
 */
export async function findPassageHitsAsync(
  quote: string,
  text: string,
  limit = 5,
  onCompare?: (done: number, total: number) => void,
): Promise<PassageHit[]> {
  const needle = normalizePassage(quote);
  const hay = normalizePassage(text);
  const hits = findPassageHits(quote, text, limit);
  if (onCompare && needle.length >= 8 && hay && !hay.includes(needle)) {
    onCompare(1, 1);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return hits;
}

/**
 * Hits for each already-normalized page. Exact quotes return immediately.
 * Other quotes score only the windows of a few rare words.
 */
export function locateOnIndex(
  index: PageIndex,
  needle: string,
  limit = 5,
): PassageHit[][] {
  const hits = index.pages.map(() => [] as PassageHit[]);
  if (needle.length < 8) {
    return hits;
  }
  const pending: number[] = [];
  index.pages.forEach((page, sliceIndex) => {
    const exact = exactPassageHits(needle, page, limit);
    if (exact.length) {
      hits[sliceIndex] = exact;
    } else if (page) {
      pending.push(sliceIndex);
    }
  });
  if (!pending.length) {
    return hits;
  }

  const quoteWords = wordsOf(needle);
  const anchors = quoteWords.filter((word) => word.text.length >= 5);
  const seeds = anchors.length
    ? anchors
    : quoteWords.filter((word) => word.text.length >= 4);
  const probes = seeds
    .map((seed) => ({
      start: seed.start,
      postings: postingsFor(
        index,
        seed.text,
        (candidate) => wordSimilarity(seed.text, candidate) >= 0.75,
      ),
    }))
    .filter((seed) => seed.postings.length)
    .sort((a, b) => a.postings.length - b.postings.length)
    .slice(0, MAX_SEED_PROBES);
  const pendingSet = new Set(pending);
  const seen = new Map<number, Map<number, PassageHit>>();
  for (const seed of probes) {
    for (const posting of seed.postings) {
      if (!pendingSet.has(posting.sliceIndex)) {
        continue;
      }
      let pageSeen = seen.get(posting.sliceIndex);
      if (!pageSeen) {
        pageSeen = new Map();
        seen.set(posting.sliceIndex, pageSeen);
      }
      considerPassageWindow(
        pageSeen,
        index.pages[posting.sliceIndex],
        needle,
        posting.start - seed.start,
      );
    }
  }
  for (const [sliceIndex, pageSeen] of seen) {
    hits[sliceIndex] = [...pageSeen.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
  return hits;
}

function exactPassageHits(
  needle: string,
  hay: string,
  limit: number,
): PassageHit[] {
  const exact: PassageHit[] = [];
  let from = 0;
  while (exact.length < limit) {
    const start = hay.indexOf(needle, from);
    if (start < 0) {
      break;
    }
    exact.push({
      score: 1,
      start,
      end: start + needle.length,
      matched: hay.slice(start, start + needle.length),
    });
    from = start + needle.length;
  }
  return exact;
}

function considerPassageWindow(
  seen: Map<number, PassageHit>,
  hay: string,
  needle: string,
  start: number,
): void {
  const clamped = Math.max(0, Math.min(start, Math.max(0, hay.length - 1)));
  const end = Math.min(hay.length, clamped + needle.length);
  const slice = hay.slice(clamped, end);
  if (slice.length < Math.min(8, needle.length)) {
    return;
  }
  const score = editSimilarity(needle, slice);
  const bucket = Math.round(clamped / 8);
  const prev = seen.get(bucket);
  if (!prev || score > prev.score) {
    seen.set(bucket, { score, start: clamped, end, matched: slice });
  }
}

function wordSimilarity(left: string, right: string): number {
  if (left === right) {
    return 1;
  }
  if (Math.abs(left.length - right.length) > 2) {
    return 0;
  }
  return editSimilarity(left, right);
}

export const AUTO_LOCATE_SCORE = 0.84;
export const AMBIGUOUS_GAP = 0.08;
export const ASK_SCORE = 0.72;

/** How much a flank match can raise or lower a quote score. */
const CONTEXT_WEIGHT = 0.3;
const MIN_CONTEXT_CHARS = 8;

/**
 * 1 when the page text beside `hit` matches `before` and `after`.
 * 0.5 when there is no usable flank, so the quote score is unchanged.
 */
export function contextAgreement(
  pageText: string,
  hit: PassageHit,
  before: string,
  after: string,
): number {
  const hay = normalizePassage(pageText);
  const scores: number[] = [];
  const prior = normalizePassage(before);
  if (prior.length >= MIN_CONTEXT_CHARS) {
    const window = hay.slice(
      Math.max(0, hit.start - prior.length - 12),
      hit.start,
    );
    scores.push(
      window.includes(prior)
        ? 1
        : editSimilarity(prior, window.slice(-prior.length)),
    );
  }
  const following = normalizePassage(after);
  if (following.length >= MIN_CONTEXT_CHARS) {
    const window = hay.slice(hit.end, hit.end + following.length + 12);
    scores.push(
      window.includes(following)
        ? 1
        : editSimilarity(following, window.slice(0, following.length)),
    );
  }
  if (!scores.length) {
    return 0.5;
  }
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

/** Quote score, nudged by how well the surrounding text agrees. */
export function scoreWithContext(
  quoteScore: number,
  contextScore: number,
): number {
  return quoteScore + (contextScore - 0.5) * CONTEXT_WEIGHT;
}

export type LocatedBand<T> = { kind: "located"; hit: T };
export type AmbiguousBand<T> = { kind: "ambiguous"; hits: T[] };
export type UnmatchedBand = { kind: "unmatched" };
export type ScoreBand<T> = LocatedBand<T> | AmbiguousBand<T> | UnmatchedBand;

export function bandScores<T extends { score: number }>(
  hits: T[],
): ScoreBand<T> {
  const sorted = [...hits].sort((a, b) => b.score - a.score);
  const best = sorted[0];
  if (!best || best.score < ASK_SCORE) {
    return { kind: "unmatched" };
  }
  const askers = sorted.filter((hit) => hit.score >= ASK_SCORE);
  const runner = askers[1];
  if (
    best.score >= AUTO_LOCATE_SCORE &&
    (!runner || best.score - runner.score >= AMBIGUOUS_GAP)
  ) {
    return { kind: "located", hit: best };
  }
  if (askers.length >= 2) {
    return { kind: "ambiguous", hits: askers };
  }
  return { kind: "unmatched" };
}
