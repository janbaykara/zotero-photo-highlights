import { detectHighlightPassages } from "./highlights";
import type { OpenCv } from "./opencv";
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

type LineWord = { index: number; word: OcrWord };

type Stroke = { minX: number; maxX: number; top: number };

/**
 * Find pen underlines and, when asked, highlighter behind the words.
 * Each OCR line is searched once. A word that is both highlighted and underlined
 * stays with the highlighter passage.
 */
export function detectMarkedPassages(
  image: RgbaImage,
  words: OcrWord[],
  cv?: OpenCv | null,
  scan?: { underlines?: boolean; highlights?: boolean },
): DetectedPassage[] {
  if (!image.width || !image.height || !words.length) {
    return [];
  }
  if (image.data.length < image.width * image.height * 4) {
    return [];
  }
  const underlines = scan?.underlines !== false;
  const highlights = scan ? scan.highlights === true : Boolean(cv);
  const passages: DetectedPassage[] = [];
  for (const line of groupLines(words)) {
    const highlighted =
      highlights && cv
        ? safeHighlights(cv, image, line).map((span) => ({
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
  cv: OpenCv,
  image: RgbaImage,
  line: LineWord[],
): { words: number[]; color: string }[] {
  try {
    return detectHighlightPassages(
      cv,
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
  const usable = line.filter((entry) => {
    const width = entry.word.x1 - entry.word.x0;
    const height = entry.word.y1 - entry.word.y0;
    return width >= 2 && height >= 2;
  });
  if (!usable.length) {
    return [];
  }
  const em = percentile(
    usable.map((entry) => entry.word.y1 - entry.word.y0),
    0.5,
  );
  const baseline = percentile(
    usable.map((entry) => entry.word.y1),
    0.35,
  );
  const band = {
    left: clamp(
      Math.floor(Math.min(...usable.map((entry) => entry.word.x0))),
      0,
      image.width,
    ),
    right: clamp(
      Math.ceil(Math.max(...usable.map((entry) => entry.word.x1))),
      0,
      image.width,
    ),
    top: clamp(Math.floor(baseline - em * 0.2), 0, image.height),
    bottom: clamp(Math.ceil(baseline + em * 0.55), 0, image.height),
  };
  if (band.right - band.left < 2 || band.bottom - band.top < 2) {
    return [];
  }
  const width = band.right - band.left;
  const height = band.bottom - band.top;
  const ink = strokeMask(image, band, width, height, em);
  const strokes = mergeStrokes(
    components(ink, width, height, band).filter((stroke) =>
      isUnderline(stroke, em, band.top),
    ),
    em,
  );
  const passages: DetectedPassage[] = [];
  for (const stroke of strokes) {
    const selected = usable.filter((entry) => {
      if (claimed.has(entry.index)) {
        return false;
      }
      const overlap =
        Math.min(entry.word.x1, stroke.maxX + 1) -
        Math.max(entry.word.x0, stroke.minX);
      const wordWidth = Math.max(1, entry.word.x1 - entry.word.x0);
      return overlap / wordWidth >= 0.4;
    });
    if (!selected.length) {
      continue;
    }
    for (const entry of selected) {
      claimed.add(entry.index);
    }
    passages.push({
      words: selected.map((entry) => entry.index),
      color: DEFAULT_COLOR,
      kind: "underline",
    });
  }
  return passages;
}

function isUnderline(
  stroke: Stroke & { height: number; columns: number; thickness: number[] },
  em: number,
  bandTop: number,
): boolean {
  const width = stroke.maxX - stroke.minX + 1;
  if (width < em * 1.5 || stroke.columns / width < 0.55) {
    return false;
  }
  const thick = percentile(stroke.thickness, 0.85);
  const thin = percentile(stroke.thickness, 0.15);
  const limit = Math.max(4, em * 0.28);
  if (thick > limit || thick - thin > Math.max(3, em * 0.2)) {
    return false;
  }
  return bandTop === 0 || stroke.top > bandTop;
}

function mergeStrokes(strokes: Stroke[], em: number): Stroke[] {
  const sorted = [...strokes].sort((a, b) => a.minX - b.minX || a.top - b.top);
  const merged: Stroke[] = [];
  for (const stroke of sorted) {
    const previous = merged[merged.length - 1];
    const gap = previous ? stroke.minX - previous.maxX : Infinity;
    const aligned = previous
      ? Math.abs(stroke.top - previous.top) <= em * 0.35
      : false;
    if (previous && gap <= em * 1.5 && aligned) {
      previous.maxX = Math.max(previous.maxX, stroke.maxX);
      continue;
    }
    merged.push({ ...stroke });
  }
  return merged.filter((stroke) => stroke.maxX - stroke.minX + 1 >= em * 1.5);
}

type RawStroke = Stroke & {
  height: number;
  columns: number;
  thickness: number[];
};

function components(
  ink: Uint8Array,
  width: number,
  height: number,
  band: { left: number; top: number },
): RawStroke[] {
  const seen = new Uint8Array(ink.length);
  const strokes: RawStroke[] = [];
  const stack: number[] = [];
  for (let start = 0; start < ink.length; start++) {
    if (!ink[start] || seen[start]) {
      continue;
    }
    let minX = Infinity;
    let maxX = -1;
    let minY = Infinity;
    let maxY = -1;
    const tops = new Map<number, number>();
    const thick = new Map<number, number>();
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const pixel = stack.pop();
      if (pixel == null) {
        continue;
      }
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      const absX = band.left + x;
      const absY = band.top + y;
      minX = Math.min(minX, absX);
      maxX = Math.max(maxX, absX);
      minY = Math.min(minY, absY);
      maxY = Math.max(maxY, absY);
      const previousTop = tops.get(absX);
      tops.set(absX, previousTop == null ? absY : Math.min(previousTop, absY));
      thick.set(absX, (thick.get(absX) ?? 0) + 1);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) {
            continue;
          }
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
            continue;
          }
          const next = ny * width + nx;
          if (!ink[next] || seen[next]) {
            continue;
          }
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    const columns = [...tops.values()];
    strokes.push({
      minX,
      maxX,
      top: percentile(columns, 0.2),
      height: maxY - minY + 1,
      columns: tops.size,
      thickness: [...thick.values()],
    });
  }
  return strokes;
}

function strokeMask(
  image: RgbaImage,
  band: { left: number; right: number; top: number; bottom: number },
  width: number,
  height: number,
  em: number,
): Uint8Array {
  const plane = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = sample(image, band.left + x, band.top + y);
      plane[y * width + x] = pixel ? luma(pixel[0], pixel[1], pixel[2]) : 255;
    }
  }
  const paper = columnPaper(
    plane,
    width,
    height,
    Math.max(8, Math.round(em * 2)),
  );
  const ink = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = sample(image, band.left + x, band.top + y);
      if (pixel && isMonochromeInk(pixel, paper[x] ?? 255)) {
        ink[y * width + x] = 1;
      }
    }
  }
  const closed = horizontalClose(
    ink,
    width,
    height,
    Math.max(2, Math.round(em * 0.45)),
  );
  return horizontalOpen(
    closed,
    width,
    height,
    Math.max(1, Math.round(em * 0.12)),
  );
}

/** Moving average of each column's luma, so a shadow does not set the cutoff. */
function columnPaper(
  plane: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  const columns = new Float64Array(width);
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = 0; y < height; y++) {
      sum += plane[y * width + x] ?? 0;
    }
    columns[x] = sum / height;
  }
  const prefix = new Float64Array(width + 1);
  for (let x = 0; x < width; x++) {
    prefix[x + 1] = (prefix[x] ?? 0) + (columns[x] ?? 0);
  }
  const paper = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    const left = Math.max(0, x - radius);
    const right = Math.min(width - 1, x + radius);
    paper[x] =
      ((prefix[right + 1] ?? 0) - (prefix[left] ?? 0)) / (right - left + 1);
  }
  return paper;
}

function horizontalClose(
  ink: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  return horizontalErode(
    horizontalDilate(ink, width, height, radius),
    width,
    height,
    radius,
  );
}

function horizontalOpen(
  ink: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  return horizontalDilate(
    horizontalErode(ink, width, height, radius),
    width,
    height,
    radius,
  );
}

function horizontalDilate(
  ink: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  const dilated = new Uint8Array(ink.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width - 1, x + radius);
      for (let neighbor = left; neighbor <= right; neighbor++) {
        if (ink[row + neighbor]) {
          dilated[row + x] = 1;
          break;
        }
      }
    }
  }
  return dilated;
}

function horizontalErode(
  ink: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  const eroded = new Uint8Array(ink.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width - 1, x + radius);
      if (right - left < radius * 2) {
        continue;
      }
      let solid = true;
      for (let neighbor = left; neighbor <= right; neighbor++) {
        if (!ink[row + neighbor]) {
          solid = false;
          break;
        }
      }
      if (solid) {
        eroded[row + x] = 1;
      }
    }
  }
  return eroded;
}

function isMonochromeInk(
  pixel: [number, number, number],
  paperLuma: number,
): boolean {
  const [red, green, blue] = pixel;
  const pixelLuma = luma(red, green, blue);
  const margin = Math.max(22, paperLuma * 0.08);
  if (paperLuma - pixelLuma < margin) {
    return false;
  }
  if (chroma(red, green, blue) <= 42) {
    return true;
  }
  return pixelLuma < paperLuma * 0.45;
}

function sample(
  image: RgbaImage,
  x: number,
  y: number,
): [number, number, number] | null {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) {
    return null;
  }
  const offset = (y * image.width + x) * 4;
  return [
    image.data[offset] ?? 0,
    image.data[offset + 1] ?? 0,
    image.data[offset + 2] ?? 0,
  ];
}

function luma(red: number, green: number, blue: number): number {
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function chroma(red: number, green: number, blue: number): number {
  return Math.max(red, green, blue) - Math.min(red, green, blue);
}

function percentile(values: number[], fraction: number): number {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round((sorted.length - 1) * fraction)),
  );
  return sorted[index] ?? 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
