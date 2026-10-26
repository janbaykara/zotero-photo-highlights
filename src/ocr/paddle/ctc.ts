import type { PaddleSplit } from "./models";

export type CropWord = {
  text: string;
  x0: number;
  x1: number;
  /** 0–100, matching the other engines. */
  confidence: number;
};

type Glyph = {
  text: string;
  start: number;
  end: number;
  score: number;
};

/**
 * Blank is class 0. A dictionary whose model also appends a space has one
 * more class than the file's line count.
 */
export function characterTable(
  lines: string[],
  classes: number,
): string[] | null {
  if (classes === lines.length + 1) {
    return ["", ...lines];
  }
  if (classes === lines.length + 2) {
    return ["", ...lines, " "];
  }
  return null;
}

export function wordsFromCtc(args: {
  data: Float32Array;
  time: number;
  classes: number;
  characters: string[];
  split: PaddleSplit;
  cropWidth: number;
  tensorWidth: number;
  contentWidth: number;
}): CropWord[] {
  const glyphs = decodeGlyphs(
    args.data,
    args.time,
    args.classes,
    args.characters,
  );
  const groups = groupGlyphs(glyphs, args.split);
  return groups.map((group) => ({
    text: group.map((glyph) => glyph.text).join(""),
    x0: toCrop(group[0].start, args),
    x1: toCrop(group[group.length - 1].end, args),
    confidence:
      (group.reduce((sum, glyph) => sum + glyph.score, 0) / group.length) * 100,
  }));
}

function decodeGlyphs(
  data: Float32Array,
  time: number,
  classes: number,
  characters: string[],
): Glyph[] {
  const probs = probabilities(data, time, classes);
  const glyphs: Glyph[] = [];
  let previous = -1;
  let start = 0;
  let score = 0;
  let count = 0;
  const flush = (index: number, end: number) => {
    const text = characters[index] ?? "";
    if (!text) {
      return;
    }
    glyphs.push({ text, start, end, score: count ? score / count : 0 });
  };
  for (let step = 0; step < time; step++) {
    let best = 0;
    let bestValue = -Infinity;
    const offset = step * classes;
    for (let klass = 0; klass < classes; klass++) {
      const value = probs[offset + klass];
      if (value > bestValue) {
        bestValue = value;
        best = klass;
      }
    }
    if (best === previous) {
      if (best !== 0) {
        score += bestValue;
        count += 1;
      }
      continue;
    }
    if (previous > 0) {
      flush(previous, step);
    }
    previous = best;
    start = step;
    score = best > 0 ? bestValue : 0;
    count = best > 0 ? 1 : 0;
  }
  if (previous > 0) {
    flush(previous, time);
  }
  return glyphs;
}

function groupGlyphs(glyphs: Glyph[], split: PaddleSplit): Glyph[][] {
  const groups: Glyph[][] = [];
  let current: Glyph[] = [];
  const flush = () => {
    if (current.length) {
      groups.push(current);
      current = [];
    }
  };
  for (const glyph of glyphs) {
    if (glyph.text === " " || split === "char") {
      flush();
      if (glyph.text !== " ") {
        groups.push([glyph]);
      }
      continue;
    }
    current.push(glyph);
  }
  flush();
  return groups;
}

function toCrop(
  step: number,
  args: {
    time: number;
    tensorWidth: number;
    contentWidth: number;
    cropWidth: number;
  },
): number {
  const along = (step / args.time) * args.tensorWidth;
  return (along / args.contentWidth) * args.cropWidth;
}

function probabilities(
  data: Float32Array,
  time: number,
  classes: number,
): Float32Array {
  let min = Infinity;
  let max = -Infinity;
  for (let index = 0; index < data.length; index++) {
    const value = data[index];
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (min >= -0.01 && max <= 1.01) {
    return data;
  }
  const out = new Float32Array(data.length);
  for (let step = 0; step < time; step++) {
    const offset = step * classes;
    let peak = -Infinity;
    for (let klass = 0; klass < classes; klass++) {
      const value = data[offset + klass];
      if (value > peak) peak = value;
    }
    let sum = 0;
    for (let klass = 0; klass < classes; klass++) {
      const value = Math.exp(data[offset + klass] - peak);
      out[offset + klass] = value;
      sum += value;
    }
    for (let klass = 0; klass < classes; klass++) {
      out[offset + klass] /= sum;
    }
  }
  return out;
}
