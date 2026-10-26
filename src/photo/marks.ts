import type { OcrWord } from "./types";

export type RgbaImage = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

export type DetectedPassage = {
  /** Word indexes, in reading order. */
  words: number[];
  color: string;
};

const DEFAULT_COLOR = "#ffd400";

type LineWord = { index: number; word: OcrWord };

type Stroke = { minX: number; maxX: number; top: number };

/**
 * Find biro and pencil underlines and group them into passages.
 * Each OCR line is searched once, for a long flat dark stroke just under
 * the baseline. Highlighter washes are ignored.
 */
export function detectMarkedPassages(
  image: RgbaImage,
  words: OcrWord[],
): DetectedPassage[] {
  if (!image.width || !image.height || !words.length) {
    return [];
  }
  if (image.data.length < image.width * image.height * 4) {
    return [];
  }
  const passages: DetectedPassage[] = [];
  for (const line of groupLines(words)) {
    passages.push(...detectLine(image, line));
  }
  return passages;
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

function detectLine(image: RgbaImage, line: LineWord[]): DetectedPassage[] {
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
  const paper = bandLuma(image, band);
  const width = band.right - band.left;
  const height = band.bottom - band.top;
  const ink = new Uint8Array(width * height);
  for (let y = band.top; y < band.bottom; y++) {
    for (let x = band.left; x < band.right; x++) {
      const pixel = sample(image, x, y);
      if (pixel && isMonochromeInk(pixel, paper)) {
        ink[(y - band.top) * width + (x - band.left)] = 1;
      }
    }
  }
  const strokes = mergeStrokes(
    components(ink, width, height, band).filter((stroke) =>
      isUnderline(stroke, em, band.top),
    ),
    em,
  );
  const claimed = new Set<number>();
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

function bandLuma(
  image: RgbaImage,
  band: { left: number; right: number; top: number; bottom: number },
): number {
  const values: number[] = [];
  for (let y = band.top; y < band.bottom; y++) {
    for (let x = band.left; x < band.right; x++) {
      const pixel = sample(image, x, y);
      if (pixel) {
        values.push(luma(pixel[0], pixel[1], pixel[2]));
      }
    }
  }
  return percentile(values, 0.5);
}

function isMonochromeInk(
  pixel: [number, number, number],
  paperLuma: number,
): boolean {
  const [red, green, blue] = pixel;
  const pixelLuma = luma(red, green, blue);
  if (paperLuma - pixelLuma < 40) {
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
