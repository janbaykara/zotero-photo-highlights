import { ZOTERO_ANNOTATION_COLOR_ORDER } from "@janbaykara/zotero-annotations";
import type { RgbaImage } from "./marks";
import type { OpenCv } from "./opencv";

export type HighlightWord = {
  index: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

type ColoredPassage = { words: number[]; color: string };

const PALETTE = ZOTERO_ANNOTATION_COLOR_ORDER.filter(
  (color) => color !== "#aaaaaa",
);

const PAPER_PERCENTILE = 0.2;
const SATURATION_MARGIN = 36;
const SATURATION_FLOOR = 60;
const VALUE_MIN = 80;
const COVERAGE = 0.22;
const NARROW_COVERAGE = 0.1;
const RAW_COVERAGE = 0.08;

/**
 * Highlighter behind the letters, for one OCR line.
 * Saturation is compared with the paper on that line. The mean colour of the
 * wash is snapped to the Zotero palette, and a colour change starts a new passage.
 */
export function detectHighlightPassages(
  cv: OpenCv,
  image: RgbaImage,
  words: HighlightWord[],
): ColoredPassage[] {
  const usable = words.filter((word) => {
    return word.x1 - word.x0 >= 2 && word.y1 - word.y0 >= 2;
  });
  if (!usable.length || !image.width || !image.height) {
    return [];
  }
  const em = median(usable.map((word) => word.y1 - word.y0));
  if (em < 2) {
    return [];
  }
  const crop = {
    x: clamp(
      Math.floor(Math.min(...usable.map((word) => word.x0))),
      0,
      image.width,
    ),
    y: clamp(
      Math.floor(Math.min(...usable.map((word) => word.y0))),
      0,
      image.height,
    ),
    right: clamp(
      Math.ceil(Math.max(...usable.map((word) => word.x1))),
      0,
      image.width,
    ),
    bottom: clamp(
      Math.ceil(Math.max(...usable.map((word) => word.y1))),
      0,
      image.height,
    ),
  };
  const width = crop.right - crop.x;
  const height = crop.bottom - crop.y;
  if (width < 2 || height < 2) {
    return [];
  }
  const packed = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const src = ((crop.y + y) * image.width + crop.x) * 4;
    packed.set(image.data.subarray(src, src + width * 4), y * width * 4);
  }

  const trash: { delete: () => void }[] = [];
  const keep = <T extends { delete: () => void }>(mat: T): T => {
    trash.push(mat);
    return mat;
  };
  try {
    const rgba = keep(cv.matFromArray(height, width, cv.CV_8UC4, packed));
    const rgb = keep(new cv.Mat());
    const hsv = keep(new cv.Mat());
    cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB);
    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
    const channels = keep(new cv.MatVector());
    cv.split(hsv, channels);
    keep(channels.get(0));
    const saturation = keep(channels.get(1));
    const value = keep(channels.get(2));
    const paper = paperSaturation(saturation.data, value.data);
    if (paper === null) {
      return [];
    }
    const limit = Math.max(SATURATION_FLOOR, paper + SATURATION_MARGIN);
    const saturated = keep(new cv.Mat());
    const bright = keep(new cv.Mat());
    const mask = keep(new cv.Mat());
    cv.threshold(saturation, saturated, limit, 255, cv.THRESH_BINARY);
    cv.threshold(value, bright, VALUE_MIN - 1, 255, cv.THRESH_BINARY);
    cv.bitwise_and(saturated, bright, mask);
    const closeWidth = Math.max(3, Math.round(em * 0.4) | 1);
    const closeKernel = keep(
      cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(closeWidth, 1)),
    );
    const openKernel = keep(
      cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 1)),
    );
    const closed = keep(new cv.Mat());
    const opened = keep(new cv.Mat());
    cv.morphologyEx(mask, closed, cv.MORPH_CLOSE, closeKernel);
    cv.morphologyEx(closed, opened, cv.MORPH_OPEN, openKernel);

    const colors = new Map<number, string>();
    for (const word of usable) {
      const color = wordColor(
        word,
        crop,
        width,
        em,
        mask.data,
        opened.data,
        rgb.data,
      );
      if (color) {
        colors.set(word.index, color);
      }
    }
    return groupColored(usable, colors);
  } finally {
    for (const mat of trash.reverse()) {
      mat.delete();
    }
  }
}

function paperSaturation(
  saturation: Uint8Array,
  value: Uint8Array,
): number | null {
  const samples: number[] = [];
  for (let i = 0; i < saturation.length; i++) {
    if ((value[i] ?? 0) >= VALUE_MIN) {
      samples.push(saturation[i] ?? 0);
    }
  }
  if (samples.length < 20) {
    return null;
  }
  samples.sort((a, b) => a - b);
  const index = Math.floor((samples.length - 1) * PAPER_PERCENTILE);
  return samples[index] ?? 0;
}

function wordColor(
  word: HighlightWord,
  crop: { x: number; y: number },
  stride: number,
  em: number,
  raw: Uint8Array,
  opened: Uint8Array,
  rgb: Uint8Array,
): string | null {
  const x0 = Math.max(0, Math.floor(word.x0) - crop.x);
  const y0 = Math.max(0, Math.floor(word.y0) - crop.y);
  const x1 = Math.min(stride, Math.ceil(word.x1) - crop.x);
  const y1 = Math.min(raw.length / stride, Math.ceil(word.y1) - crop.y);
  const boxWidth = x1 - x0;
  const boxHeight = y1 - y0;
  if (boxWidth < 1 || boxHeight < 1) {
    return null;
  }
  let openedCount = 0;
  let rawCount = 0;
  let red = 0;
  let green = 0;
  let blue = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const index = y * stride + x;
      if (opened[index]) {
        openedCount++;
      }
      if (raw[index]) {
        rawCount++;
        const pixel = index * 3;
        red += rgb[pixel] ?? 0;
        green += rgb[pixel + 1] ?? 0;
        blue += rgb[pixel + 2] ?? 0;
      }
    }
  }
  const area = boxWidth * boxHeight;
  const needed = boxWidth < em * 0.45 ? NARROW_COVERAGE : COVERAGE;
  if (openedCount / area < needed || rawCount / area < RAW_COVERAGE) {
    return null;
  }
  return snapColor(red / rawCount, green / rawCount, blue / rawCount);
}

function groupColored(
  words: HighlightWord[],
  colorOf: Map<number, string>,
): ColoredPassage[] {
  const passages: ColoredPassage[] = [];
  let current: number[] = [];
  let color = "";
  const flush = () => {
    if (!current.length) {
      return;
    }
    passages.push({ words: current, color });
    current = [];
  };
  for (const word of words) {
    const next = colorOf.get(word.index);
    if (!next) {
      flush();
      continue;
    }
    if (current.length && next !== color) {
      flush();
    }
    color = next;
    current.push(word.index);
  }
  flush();
  return passages;
}

function snapColor(red: number, green: number, blue: number): string | null {
  if (Math.max(red, green, blue) - Math.min(red, green, blue) < 28) {
    return null;
  }
  let best: string = PALETTE[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const hex of PALETTE) {
    const paletteRed = Number.parseInt(hex.slice(1, 3), 16);
    const paletteGreen = Number.parseInt(hex.slice(3, 5), 16);
    const paletteBlue = Number.parseInt(hex.slice(5, 7), 16);
    const distance =
      (red - paletteRed) ** 2 +
      (green - paletteGreen) ** 2 +
      (blue - paletteBlue) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = hex;
    }
  }
  return best;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
