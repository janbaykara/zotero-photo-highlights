import {
  chromaDistance,
  detectHighlightPassages,
  snapMarkColor,
  toLab,
} from "./highlights";
import type { OcrWord } from "./types";

export type RgbaImage = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

export type DetectedKind = "underline" | "highlight";

export type DetectedPassage = {
  /** Word indexes, in reading order. */
  words: number[];
  color: string;
  kind: DetectedKind;
};

const DEFAULT_COLOR = "#ffd400";
const DARK_MARGIN = 26;
const CHROMA_STRONG = 7.2;
const CHROMA_WEAK = 5.5;

type LineWord = { index: number; word: OcrWord };

type UnderlineHit = { rank: 0 | 1 | 2; color: string };

/**
 * Find pen underlines and, when asked, highlighter behind the words.
 * Each word is scored on its own box, so a tilted photo still lines up.
 * A word that is both highlighted and underlined stays with the highlighter.
 */
export function detectMarkedPassages(
  image: RgbaImage,
  words: OcrWord[],
  scan?: { underlines?: boolean; highlights?: boolean },
): DetectedPassage[] {
  if (!image.width || !image.height || !words.length) {
    return [];
  }
  if (image.data.length < image.width * image.height * 4) {
    return [];
  }
  const underlines = scan?.underlines !== false;
  const highlights = scan?.highlights === true;
  const passages: DetectedPassage[] = [];
  for (const line of groupLines(words)) {
    const highlighted = highlights
      ? safeHighlights(image, line).map((span) => ({
          ...span,
          kind: "highlight" as const,
        }))
      : [];
    const claimed = new Set(highlighted.flatMap((span) => span.words));
    const underlined = underlines ? detectLine(image, line, claimed) : [];
    passages.push(...byReadingOrder(line, [...highlighted, ...underlined]));
  }
  return passages;
}

function safeHighlights(
  image: RgbaImage,
  line: LineWord[],
): { words: number[]; color: string }[] {
  try {
    return detectHighlightPassages(
      image,
      line.map((entry) => ({ index: entry.index, ...entry.word })),
    );
  } catch (error) {
    if (typeof ztoolkit !== "undefined") {
      ztoolkit.log("Could not detect highlighter", error);
    }
    return [];
  }
}

function byReadingOrder(
  line: LineWord[],
  spans: DetectedPassage[],
): DetectedPassage[] {
  const xOf = new Map(line.map((entry) => [entry.index, entry.word.x0]));
  return spans
    .filter((span) => span.words.length > 0)
    .sort(
      (a, b) =>
        (xOf.get(a.words[0] ?? -1) ?? 0) - (xOf.get(b.words[0] ?? -1) ?? 0),
    );
}

function groupLines(words: OcrWord[]): LineWord[][] {
  const grouped = new Map<number, LineWord[]>();
  words.forEach((word, index) => {
    const line = grouped.get(word.line);
    const entry = { index, word };
    if (line) {
      line.push(entry);
    } else {
      grouped.set(word.line, [entry]);
    }
  });
  return [...grouped.entries()]
    .sort((a, b) => a[0] - b[0])
    .map((entry) =>
      entry[1].sort((a, b) => a.word.x0 - b.word.x0 || a.index - b.index),
    );
}

function detectLine(
  image: RgbaImage,
  line: LineWord[],
  claimed: Set<number>,
): DetectedPassage[] {
  const hits = line.map((entry) =>
    claimed.has(entry.index)
      ? { rank: 0 as const, color: DEFAULT_COLOR }
      : underlineHit(image, entry.word),
  );
  const kept = hits.map((hit, index) => {
    const before = hits[index - 1]?.rank === 2;
    const after = hits[index + 1]?.rank === 2;
    if (hit.rank === 2) {
      const word = line[index]?.word;
      const narrow = !!word && word.x1 - word.x0 < 34;
      // A lone "A" or "I" is a shadow. The same word stays when the stroke
      // continues into a neighbor, including another short word.
      return !narrow || before || after;
    }
    if (hit.rank !== 1) {
      return false;
    }
    return before && after;
  });
  const passages: DetectedPassage[] = [];
  let current: number[] = [];
  let color = DEFAULT_COLOR;
  const flush = () => {
    if (!current.length) {
      return;
    }
    passages.push({ words: current, color, kind: "underline" });
    current = [];
  };
  line.forEach((entry, index) => {
    if (!kept[index] || claimed.has(entry.index)) {
      flush();
      return;
    }
    if (hits[index]?.rank === 2) {
      const next = hits[index]?.color ?? DEFAULT_COLOR;
      if (current.length && next !== color) {
        flush();
      }
      color = next;
    }
    current.push(entry.index);
    claimed.add(entry.index);
  });
  flush();
  return passages;
}

/**
 * A stroke under this word. Rank 2 is a mark, rank 1 is a short piece kept
 * only when the words on either side are marked. The stroke has to start
 * under the letters and finish, so the highlighter on the next line does not
 * count.
 */
function underlineHit(image: RgbaImage, word: OcrWord): UnderlineHit {
  const left = clamp(Math.floor(word.x0), 0, image.width - 1);
  const right = clamp(Math.ceil(word.x1), left + 1, image.width);
  const top = clamp(Math.floor(word.y0), 0, image.height - 1);
  const bottom = clamp(Math.ceil(word.y1), top + 1, image.height);
  const width = right - left;
  const box = bottom - top;
  if (width < 2 || box < 2) {
    return { rank: 0, color: DEFAULT_COLOR };
  }
  const paper = localPaper(image, left, right, top, bottom);
  if (!paper) {
    return { rank: 0, color: DEFAULT_COLOR };
  }
  const paperLab = toLab(paper.red, paper.green, paper.blue);
  const end = clamp(bottom + Math.round(box * 0.55), bottom, image.height);
  const rows: {
    dark: number;
    chroma: number;
    red: number;
    green: number;
    blue: number;
  }[] = [];
  for (let y = top; y < end; y++) {
    let dark = 0;
    let bright = 0;
    let red = 0;
    let green = 0;
    let blue = 0;
    for (let x = left; x < right; x++) {
      const pixel = read(image, x, y);
      if (!pixel) {
        continue;
      }
      const pixelLuma = luma(pixel.red, pixel.green, pixel.blue);
      if (paper.luma - pixelLuma > DARK_MARGIN) {
        dark++;
      }
      if (pixelLuma > paper.luma * 0.7) {
        bright++;
        red += pixel.red;
        green += pixel.green;
        blue += pixel.blue;
      }
    }
    const chroma =
      bright >= width * 0.62
        ? chromaDistance(
            toLab(red / bright, green / bright, blue / bright),
            paperLab,
          )
        : 0;
    rows.push({
      dark: dark / width,
      chroma,
      red: bright ? red / bright : 0,
      green: bright ? green / bright : 0,
      blue: bright ? blue / bright : 0,
    });
  }
  const glyph = glyphRun(rows, box);
  const gh = glyph
    ? glyph.end - glyph.start
    : Math.max(8, Math.round(box * 0.45));
  const from = glyph ? glyph.end : Math.round(box * 0.45);
  const to = glyph
    ? Math.min(rows.length, glyph.end + Math.max(5, Math.round(gh * 1.6)))
    : rows.length;
  let weak = false;
  let peakDark = 0;
  let peakChroma = 0;
  for (let index = from; index < to; index++) {
    const row = rows[index];
    if (!row) {
      continue;
    }
    peakDark = Math.max(peakDark, row.dark);
    peakChroma = Math.max(peakChroma, row.chroma);
    if (row.dark < 0.56 && row.chroma < CHROMA_STRONG) {
      continue;
    }
    let endIndex = index + 1;
    while (
      endIndex < to &&
      rows[endIndex] &&
      ((rows[endIndex]?.dark ?? 0) >= 0.4 ||
        (rows[endIndex]?.chroma ?? 0) >= 6.2)
    ) {
      endIndex++;
    }
    const closed = endIndex < to;
    let core = 0;
    let best = row;
    for (let cursor = index; cursor < endIndex; cursor++) {
      const sample = rows[cursor];
      if (!sample) {
        continue;
      }
      if (sample.dark >= 0.56 || sample.chroma >= CHROMA_STRONG) {
        core++;
      }
      if (
        Math.max(sample.dark, sample.chroma / 10) >
        Math.max(best.dark, best.chroma / 10)
      ) {
        best = sample;
      }
    }
    const previous = rows[index - 1];
    // A coloured stroke brightens over a few rows, so the row above the
    // threshold is still the same stroke. Letter bottoms stay dark.
    const gap =
      index === from ||
      ((previous?.dark ?? 1) < 0.42 && (previous?.chroma ?? 99) < 8);
    const thin = core >= 1 && core <= Math.max(6, Math.round(gh * 0.9));
    const marked = best.dark >= 0.58 || best.chroma >= CHROMA_STRONG;
    if (closed && gap && thin && marked) {
      return {
        rank: 2,
        color: snapMarkColor(best.red, best.green, best.blue),
      };
    }
    if (best.dark >= 0.3 || best.chroma >= CHROMA_WEAK) {
      weak = true;
    }
    index = endIndex - 1;
  }
  if (weak || peakDark >= 0.3 || peakChroma >= CHROMA_WEAK) {
    return { rank: 1, color: DEFAULT_COLOR };
  }
  return { rank: 0, color: DEFAULT_COLOR };
}

function glyphRun(
  rows: { dark: number; chroma: number }[],
  box: number,
): { start: number; end: number } | null {
  let best: { start: number; end: number } | null = null;
  let index = 0;
  while (index < rows.length) {
    if (!letterRow(rows[index])) {
      index++;
      continue;
    }
    const start = index;
    while (index < rows.length && letterRow(rows[index])) {
      index++;
    }
    if (start > box * 0.72) {
      continue;
    }
    if (!best || index - start > best.end - best.start) {
      best = { start, end: index };
    }
  }
  if (!best || best.end - best.start < 3) {
    return null;
  }
  return best;
}

/** Printed ink. A coloured stroke under the letters is not part of the glyph. */
function letterRow(row: { dark: number; chroma: number } | undefined): boolean {
  return (row?.dark ?? 0) >= 0.2 && (row?.chroma ?? 0) < CHROMA_STRONG;
}

function localPaper(
  image: RgbaImage,
  left: number,
  right: number,
  top: number,
  bottom: number,
): { red: number; green: number; blue: number; luma: number } | null {
  const upperEnd = top + Math.max(1, Math.round((bottom - top) * 0.45));
  const upper = paperFromRows(image, left, right, top, upperEnd);
  if (upper && upper.luma >= 90) {
    return upper;
  }
  return paperFromRows(image, left, right, top, bottom);
}

function paperFromRows(
  image: RgbaImage,
  left: number,
  right: number,
  top: number,
  bottom: number,
): { red: number; green: number; blue: number; luma: number } | null {
  const samples: { red: number; green: number; blue: number; luma: number }[] =
    [];
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const pixel = read(image, x, y);
      if (!pixel) {
        continue;
      }
      samples.push({
        ...pixel,
        luma: luma(pixel.red, pixel.green, pixel.blue),
      });
    }
  }
  if (samples.length < 4) {
    return null;
  }
  samples.sort((a, b) => a.luma - b.luma);
  const light = samples.slice(Math.floor(samples.length * 0.7));
  const count = light.length || 1;
  const red = light.reduce((sum, sample) => sum + sample.red, 0) / count;
  const green = light.reduce((sum, sample) => sum + sample.green, 0) / count;
  const blue = light.reduce((sum, sample) => sum + sample.blue, 0) / count;
  return { red, green, blue, luma: luma(red, green, blue) };
}

function read(
  image: RgbaImage,
  x: number,
  y: number,
): { red: number; green: number; blue: number } | null {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) {
    return null;
  }
  const offset = (y * image.width + x) * 4;
  return {
    red: image.data[offset] ?? 0,
    green: image.data[offset + 1] ?? 0,
    blue: image.data[offset + 2] ?? 0,
  };
}

function luma(red: number, green: number, blue: number): number {
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
