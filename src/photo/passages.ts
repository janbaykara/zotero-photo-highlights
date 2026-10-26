import type { DetectedPassage } from "./marks";
import type { OcrWord, Passage, PhotoDraft } from "./types";

export const DEFAULT_PASSAGE_COLOR = "#ffd400";

let nextPassageId = 1;

export function newPassageId(): string {
  nextPassageId += 1;
  return `p${nextPassageId}`;
}

export function passagesFromDetection(
  words: OcrWord[],
  detected: DetectedPassage[],
): Passage[] {
  return detected.map((span) => ({
    id: newPassageId(),
    quote: quoteFromWords(words, span.words),
    selected: span.words,
    comment: "",
    color: span.color,
  }));
}

export function pendingPassages(photo: PhotoDraft): Passage[] {
  if (photo.skipped) {
    return [];
  }
  return photo.passages.filter(
    (passage) => !passage.committed && passage.quote.trim().length > 0,
  );
}

export function passageOwning(
  passages: Passage[],
  wordIndex: number,
): string | null {
  for (const passage of passages) {
    if (passage.committed) {
      continue;
    }
    if (passage.selected.includes(wordIndex)) {
      return passage.id;
    }
  }
  return null;
}

export function addEmptyPassage(passages: Passage[]): {
  passages: Passage[];
  id: string;
} {
  const id = newPassageId();
  return {
    id,
    passages: [
      ...passages,
      {
        id,
        quote: "",
        selected: [],
        comment: "",
        color: DEFAULT_PASSAGE_COLOR,
      },
    ],
  };
}

/**
 * Replace `passageId`, or create it when `create` is set.
 * Each call starts from the passages it is given, so a drag can recompute
 * the same edit before the wizard re-renders. Claimed words leave other
 * passages. A passage with no words and no typed quote is removed.
 * Committed words stay put.
 */
export function applyPassageDrag(
  passages: Passage[],
  words: OcrWord[],
  anchor: number | null,
  end: number | null,
  passageId: string,
  create: boolean,
): Passage[] {
  const range = rangeBetween(words, anchor, end);
  const blocked = new Set(
    passages
      .filter((passage) => passage.committed)
      .flatMap((passage) => passage.selected),
  );
  const selected = range.selected.filter((index) => !blocked.has(index));
  if (!selected.length) {
    return passages;
  }
  const quote = quoteFromWords(words, selected);
  const claimed = new Set(selected);
  const next: Passage[] = [];
  let wrote = false;
  for (const passage of passages) {
    if (passage.id === passageId) {
      next.push({ ...passage, selected, quote });
      wrote = true;
      continue;
    }
    if (passage.committed || passage.selected.length === 0) {
      next.push(passage);
      continue;
    }
    const remaining = passage.selected.filter((index) => !claimed.has(index));
    if (remaining.length === 0) {
      continue;
    }
    if (remaining.length === passage.selected.length) {
      next.push(passage);
      continue;
    }
    next.push({
      ...passage,
      selected: remaining,
      quote: quoteFromWords(words, remaining),
    });
  }
  if (!wrote && create) {
    next.push({
      id: passageId,
      quote,
      selected,
      comment: "",
      color: DEFAULT_PASSAGE_COLOR,
    });
  }
  return next;
}

export function samePassages(current: Passage[], next: Passage[]): boolean {
  if (current === next) {
    return true;
  }
  if (current.length !== next.length) {
    return false;
  }
  return current.every((passage, index) => {
    const other = next[index];
    return (
      !!other &&
      passage.id === other.id &&
      passage.quote === other.quote &&
      passage.comment === other.comment &&
      passage.color === other.color &&
      passage.committed === other.committed &&
      sameIndexes(passage.selected, other.selected)
    );
  });
}

/** Words from the anchor through the word under the pointer, in reading order. */
export function rangeBetween(
  words: OcrWord[],
  anchor: number | null,
  end: number | null,
): { quote: string; selected: number[] } {
  if (anchor == null && end == null) {
    return { quote: "", selected: [] };
  }
  const from = anchor ?? end;
  const to = end ?? anchor;
  if (from == null || to == null) {
    return { quote: "", selected: [] };
  }
  const order = readingOrder(words);
  const startAt = order.indexOf(from);
  const endAt = order.indexOf(to);
  if (startAt < 0 || endAt < 0) {
    return { quote: "", selected: [] };
  }
  const selected = order.slice(
    Math.min(startAt, endAt),
    Math.max(startAt, endAt) + 1,
  );
  return { selected, quote: quoteFromWords(words, selected) };
}

export function selectionContext(
  words: OcrWord[],
  selectedIndexes: number[],
): { before: string; after: string } {
  const selected = new Set(selectedIndexes);
  if (!selected.size) {
    return { before: "", after: "" };
  }
  const order = readingOrder(words);
  let first = -1;
  let last = -1;
  for (let place = 0; place < order.length; place++) {
    if (!selected.has(order[place] ?? -1)) {
      continue;
    }
    if (first < 0) {
      first = place;
    }
    last = place;
  }
  if (first < 0 || last < 0) {
    return { before: "", after: "" };
  }
  const textAt = (indexes: number[]) =>
    indexes
      .map((index) => words[index]?.text || "")
      .filter(Boolean)
      .join(" ");
  const wing = 12;
  return {
    before: textAt(order.slice(Math.max(0, first - wing), first)),
    after: textAt(order.slice(last + 1, last + 1 + wing)),
  };
}

export function readingOrder(words: OcrWord[]): number[] {
  if (words.length && words.every((word) => Number.isFinite(word.line))) {
    return words
      .map((word, index) => ({ word, index }))
      .sort((a, b) => a.word.line - b.word.line || a.index - b.index)
      .map((entry) => entry.index);
  }
  const items = words.map((word, index) => ({ word, index }));
  items.sort((a, b) => a.word.y0 - b.word.y0 || a.word.x0 - b.word.x0);
  const lines: { word: OcrWord; index: number }[][] = [];
  for (const item of items) {
    const line = lines[lines.length - 1];
    const mid = (item.word.y0 + item.word.y1) / 2;
    if (
      line &&
      mid >= Math.min(...line.map((entry) => entry.word.y0)) &&
      mid <= Math.max(...line.map((entry) => entry.word.y1))
    ) {
      line.push(item);
    } else {
      lines.push([item]);
    }
  }
  return lines.flatMap((line) =>
    line.sort((a, b) => a.word.x0 - b.word.x0).map((entry) => entry.index),
  );
}

function quoteFromWords(words: OcrWord[], selected: number[]): string {
  return selected.map((index) => words[index]?.text || "").join(" ");
}

function sameIndexes(current: number[], next: number[]): boolean {
  if (current.length !== next.length) {
    return false;
  }
  return current.every((index, place) => index === next[place]);
}
