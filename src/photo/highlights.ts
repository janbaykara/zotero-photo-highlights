import { ZOTERO_ANNOTATION_COLOR_ORDER } from "@janbaykara/zotero-annotations";
import type { RgbaImage } from "./marks";

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

const DEFAULT_COLOR = "#ffd400";
/** a/b distance from the page margin. A whole line of pale marker still clears this. */
const WASH_DISTANCE = 15;

/**
 * Highlighter behind the letters, for one OCR line.
 * Paper colour comes from the bright pixels of the whole photo, so a line that
 * is entirely marked still differs from the margin. The mean colour of the wash
 * is snapped to the Zotero palette, and a colour change starts a new passage.
 */
export function detectHighlightPassages(
  image: RgbaImage,
  words: HighlightWord[],
): ColoredPassage[] {
  const usable = words.filter((word) => {
    return word.x1 - word.x0 >= 2 && word.y1 - word.y0 >= 2;
  });
  if (!usable.length || !image.width || !image.height) {
    return [];
  }
  const paper = pagePaper(image);
  if (!paper) {
    return [];
  }
  const colors = new Map<number, string>();
  for (const word of usable) {
    const wash = wordWash(image, word, paper);
    if (wash) {
      colors.set(word.index, wash);
    }
  }
  return groupColored(usable, colors);
}

const PALETTE_HUES = PALETTE.map((hex) => ({
  hex,
  hue: hueOf(
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ),
}));

/**
 * Nearest Zotero highlight colour by hue. A washed-out yellow is still yellow;
 * grey ink and pencil stay the default yellow.
 */
export function snapMarkColor(
  red: number,
  green: number,
  blue: number,
): string {
  const span = Math.max(red, green, blue) - Math.min(red, green, blue);
  const hue = hueOf(red, green, blue);
  if (hue === null) {
    return DEFAULT_COLOR;
  }
  let best: string = PALETTE[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const entry of PALETTE_HUES) {
    if (entry.hue === null) {
      continue;
    }
    const distance = Math.min(
      Math.abs(hue - entry.hue),
      360 - Math.abs(hue - entry.hue),
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      best = entry.hex;
    }
  }
  // Pencil and shadow on cream sit near yellow and are barely coloured.
  // A pale blue stroke is far from yellow, so it still snaps.
  if (span < 28 && best !== DEFAULT_COLOR) {
    const yellowHue =
      PALETTE_HUES.find((entry) => entry.hex === DEFAULT_COLOR)?.hue ?? hue;
    const fromYellow = Math.min(
      Math.abs(hue - yellowHue),
      360 - Math.abs(hue - yellowHue),
    );
    if (fromYellow < 36) {
      return DEFAULT_COLOR;
    }
  }
  return best;
}

function hueOf(red: number, green: number, blue: number): number | null {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const span = max - min;
  // Pale photographed marker still has a hue. Grey ink and pencil do not.
  if (span < 12) {
    return null;
  }
  let hue: number;
  if (max === red) {
    hue = ((green - blue) / span) % 6;
  } else if (max === green) {
    hue = (blue - red) / span + 2;
  } else {
    hue = (red - green) / span + 4;
  }
  hue *= 60;
  if (hue < 0) {
    hue += 360;
  }
  return hue;
}

function pagePaper(image: RgbaImage): Lab | null {
  const step = Math.max(
    4,
    Math.round(Math.min(image.width, image.height) / 200),
  );
  const samples: { luma: number; red: number; green: number; blue: number }[] =
    [];
  for (let y = 0; y < image.height; y += step) {
    for (let x = 0; x < image.width; x += step) {
      const pixel = read(image, x, y);
      if (!pixel) {
        continue;
      }
      samples.push({
        luma: luma(pixel.red, pixel.green, pixel.blue),
        ...pixel,
      });
    }
  }
  if (samples.length < 20) {
    return null;
  }
  samples.sort((a, b) => a.luma - b.luma);
  const from = Math.floor(samples.length * 0.82);
  const to = Math.max(from + 1, Math.floor(samples.length * 0.97));
  const chosen = samples.slice(from, to);
  const count = chosen.length || 1;
  const red = chosen.reduce((sum, sample) => sum + sample.red, 0) / count;
  const green = chosen.reduce((sum, sample) => sum + sample.green, 0) / count;
  const blue = chosen.reduce((sum, sample) => sum + sample.blue, 0) / count;
  return toLab(red, green, blue);
}

function wordWash(
  image: RgbaImage,
  word: HighlightWord,
  paper: Lab,
): string | null {
  const pixels = pixelsIn(image, word.x0, word.y0, word.x1, word.y1);
  if (pixels.length < 8) {
    return null;
  }
  const light = lightest(pixels, 0.55);
  const mean = meanRgb(light);
  if (
    chromaDistance(toLab(mean.red, mean.green, mean.blue), paper) <
    WASH_DISTANCE
  ) {
    return null;
  }
  return snapMarkColor(mean.red, mean.green, mean.blue);
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

type Rgb = { red: number; green: number; blue: number };

type Lab = { l: number; a: number; b: number };

function pixelsIn(
  image: RgbaImage,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Rgb[] {
  const left = clamp(Math.floor(x0), 0, image.width - 1);
  const right = clamp(Math.ceil(x1), left + 1, image.width);
  const top = clamp(Math.floor(y0), 0, image.height - 1);
  const bottom = clamp(Math.ceil(y1), top + 1, image.height);
  const pixels: Rgb[] = [];
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const pixel = read(image, x, y);
      if (pixel) {
        pixels.push(pixel);
      }
    }
  }
  return pixels;
}

function lightest(pixels: Rgb[], startFraction: number): Rgb[] {
  const ranked = [...pixels].sort(
    (a, b) => luma(a.red, a.green, a.blue) - luma(b.red, b.green, b.blue),
  );
  const start = Math.min(
    ranked.length - 1,
    Math.floor(ranked.length * startFraction),
  );
  return ranked.slice(start);
}

function meanRgb(pixels: Rgb[]): Rgb {
  const count = pixels.length || 1;
  return {
    red: pixels.reduce((sum, pixel) => sum + pixel.red, 0) / count,
    green: pixels.reduce((sum, pixel) => sum + pixel.green, 0) / count,
    blue: pixels.reduce((sum, pixel) => sum + pixel.blue, 0) / count,
  };
}

function read(image: RgbaImage, x: number, y: number): Rgb | null {
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

export function chromaDistance(left: Lab, right: Lab): number {
  return Math.hypot(left.a - right.a, left.b - right.b);
}

export function toLab(red: number, green: number, blue: number): Lab {
  const r = linear(red);
  const g = linear(green);
  const b = linear(blue);
  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
  const y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
  const z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;
  const fx = pivot(x);
  const fy = pivot(y);
  const fz = pivot(z);
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

function linear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function pivot(channel: number): number {
  return channel > 0.008856 ? Math.cbrt(channel) : 7.787 * channel + 16 / 116;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
