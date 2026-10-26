/** Word postings for already-normalized page text. */

export type Posting = {
  sliceIndex: number;
  start: number;
};

export type PageIndex = {
  pages: string[];
  postings: Map<string, Posting[]>;
  trigrams: Map<string, string[]>;
};

/** Index every token once. Later quotes look up a few words instead of scanning. */
export function buildPageIndex(pages: string[]): PageIndex {
  const postings = new Map<string, Posting[]>();
  const trigrams = new Map<string, string[]>();
  const seenTrigram = new Set<string>();

  pages.forEach((page, sliceIndex) => {
    const re = /\S+/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(page))) {
      const word = match[0];
      const list = postings.get(word);
      const posting = { sliceIndex, start: match.index };
      if (list) {
        list.push(posting);
      } else {
        postings.set(word, [posting]);
        for (const gram of trigramsOf(word)) {
          const key = `${gram}\n${word}`;
          if (seenTrigram.has(key)) {
            continue;
          }
          seenTrigram.add(key);
          const words = trigrams.get(gram);
          if (words) {
            words.push(word);
          } else {
            trigrams.set(gram, [word]);
          }
        }
      }
    }
  });

  return { pages, postings, trigrams };
}

/**
 * Places a quote word can anchor. An exact dictionary word uses its postings.
 * Anything else is a short vocabulary scan: length, shared trigrams, then `similar`.
 */
export function postingsFor(
  index: PageIndex,
  seed: string,
  similar: (candidate: string) => boolean,
): Posting[] {
  const exact = index.postings.get(seed);
  if (exact) {
    return exact;
  }
  const grams = trigramsOf(seed);
  if (!grams.length) {
    return [];
  }
  const shared = new Map<string, number>();
  for (const gram of grams) {
    const words = index.trigrams.get(gram);
    if (!words) {
      continue;
    }
    for (const word of words) {
      if (Math.abs(word.length - seed.length) > 2) {
        continue;
      }
      shared.set(word, (shared.get(word) || 0) + 1);
    }
  }
  const postings: Posting[] = [];
  for (const [word, count] of shared) {
    if (count * 2 < grams.length) {
      continue;
    }
    if (!similar(word)) {
      continue;
    }
    const list = index.postings.get(word);
    if (list) {
      postings.push(...list);
    }
  }
  return postings;
}

function trigramsOf(word: string): string[] {
  if (word.length < 3) {
    return word ? [word] : [];
  }
  const grams: string[] = [];
  for (let i = 0; i <= word.length - 3; i++) {
    grams.push(word.slice(i, i + 3));
  }
  return grams;
}
