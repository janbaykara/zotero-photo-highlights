import { keepOcrWord } from "../boxes";
import type { CropWord } from "./ctc";
import type { OcrWord } from "../../photo/types";

export type Point = { x: number; y: number };
export type Quad = [Point, Point, Point, Point];

export type Raster = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

const DET_MEAN = [0.485, 0.456, 0.406];
const DET_STD = [0.229, 0.224, 0.225];

export function detSize(
  width: number,
  height: number,
  limit = 960,
): { width: number; height: number } {
  const long = Math.max(width, height);
  const ratio = long > limit ? limit / long : 1;
  return {
    width: snap32(Math.trunc(width * ratio)),
    height: snap32(Math.trunc(height * ratio)),
  };
}

export function resizeRgba(
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const fy = ((y + 0.5) * sh) / dh - 0.5;
    const y0 = Math.max(0, Math.floor(fy));
    const y1 = Math.min(sh - 1, y0 + 1);
    const ty = Math.min(1, Math.max(0, fy - y0));
    for (let x = 0; x < dw; x++) {
      const fx = ((x + 0.5) * sw) / dw - 0.5;
      const x0 = Math.max(0, Math.floor(fx));
      const x1 = Math.min(sw - 1, x0 + 1);
      const tx = Math.min(1, Math.max(0, fx - x0));
      const o = (y * dw + x) * 4;
      for (let channel = 0; channel < 4; channel++) {
        const p00 = src[(y0 * sw + x0) * 4 + channel];
        const p10 = src[(y0 * sw + x1) * 4 + channel];
        const p01 = src[(y1 * sw + x0) * 4 + channel];
        const p11 = src[(y1 * sw + x1) * 4 + channel];
        const top = p00 + (p10 - p00) * tx;
        const bottom = p01 + (p11 - p01) * tx;
        out[o + channel] = top + (bottom - top) * ty;
      }
    }
  }
  return out;
}

export function detTensor(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Float32Array {
  const plane = width * height;
  const out = new Float32Array(3 * plane);
  for (let index = 0; index < plane; index++) {
    const pixel = index * 4;
    for (let channel = 0; channel < 3; channel++) {
      out[channel * plane + index] =
        (rgba[pixel + channel] / 255 - DET_MEAN[channel]) / DET_STD[channel];
    }
  }
  return out;
}

export function recTensor(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  targetHeight = 48,
  targetWidth?: number,
): { data: Float32Array; width: number; contentWidth: number; height: number } {
  const ratio = width / Math.max(height, 1);
  let contentWidth = Math.max(1, Math.ceil(targetHeight * ratio));
  if (targetWidth && contentWidth > targetWidth) {
    contentWidth = targetWidth;
  }
  const resized = resizeRgba(rgba, width, height, contentWidth, targetHeight);
  const tensorWidth = targetWidth ?? contentWidth;
  const plane = tensorWidth * targetHeight;
  const data = new Float32Array(3 * plane);
  for (let y = 0; y < targetHeight; y++) {
    for (let x = 0; x < contentWidth; x++) {
      const pixel = (y * contentWidth + x) * 4;
      const dest = y * tensorWidth + x;
      for (let channel = 0; channel < 3; channel++) {
        data[channel * plane + dest] = resized[pixel + channel] / 255 - 0.5;
        data[channel * plane + dest] /= 0.5;
      }
    }
  }
  return { data, width: tensorWidth, contentWidth, height: targetHeight };
}

export function quadsFromScoreMap(
  score: Float32Array,
  width: number,
  height: number,
  options?: {
    thresh?: number;
    boxThresh?: number;
    unclipRatio?: number;
    minSize?: number;
  },
): Quad[] {
  const thresh = options?.thresh ?? 0.3;
  const boxThresh = options?.boxThresh ?? 0.6;
  const unclipRatio = options?.unclipRatio ?? 1.5;
  const minSize = options?.minSize ?? 3;
  const label = new Uint32Array(width * height);
  const components: number[][] = [];
  for (let index = 0; index < score.length; index++) {
    if (score[index] <= thresh || label[index]) continue;
    const id = components.length + 1;
    const pixels: number[] = [];
    const stack = [index];
    label[index] = id;
    while (stack.length) {
      const current = stack.pop() as number;
      pixels.push(current);
      const x = current % width;
      const y = (current - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (label[next] || score[next] <= thresh) continue;
          label[next] = id;
          stack.push(next);
        }
      }
    }
    components.push(pixels);
  }
  components.sort((a, b) => b.length - a.length);
  const quads: Quad[] = [];
  for (const pixels of components.slice(0, 1000)) {
    const id = label[pixels[0]];
    const boundary = boundaryPoints(pixels, label, id, width, height);
    const rect = minAreaRect(boundary);
    if (!rect || Math.min(rect.width, rect.height) < minSize) continue;
    const ordered = orderQuad(rect.corners);
    if (meanScore(score, pixels) < boxThresh) continue;
    const expanded = expandRect(ordered, unclipRatio);
    const widthPx = Math.hypot(
      expanded[1].x - expanded[0].x,
      expanded[1].y - expanded[0].y,
    );
    const heightPx = Math.hypot(
      expanded[2].x - expanded[1].x,
      expanded[2].y - expanded[1].y,
    );
    if (Math.min(widthPx, heightPx) < minSize + 2) continue;
    quads.push(expanded);
  }
  return quads;
}

export function scaleQuad(
  quad: Quad,
  mapWidth: number,
  mapHeight: number,
  photoWidth: number,
  photoHeight: number,
): Quad {
  return quad.map((point) => ({
    x: clamp((point.x / mapWidth) * photoWidth, 0, photoWidth),
    y: clamp((point.y / mapHeight) * photoHeight, 0, photoHeight),
  })) as Quad;
}

export function assignLines(quads: Quad[]): { quad: Quad; line: number }[] {
  const items = quads.map((quad) => ({
    quad,
    y0: Math.min(...quad.map((point) => point.y)),
    y1: Math.max(...quad.map((point) => point.y)),
    x0: Math.min(...quad.map((point) => point.x)),
  }));
  items.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const lines: (typeof items)[] = [];
  for (const item of items) {
    const mid = (item.y0 + item.y1) / 2;
    const line = lines[lines.length - 1];
    if (
      line &&
      mid >= Math.min(...line.map((entry) => entry.y0)) &&
      mid <= Math.max(...line.map((entry) => entry.y1))
    ) {
      line.push(item);
    } else {
      lines.push([item]);
    }
  }
  const ordered: { quad: Quad; line: number }[] = [];
  lines.forEach((line, lineIndex) => {
    line.sort((a, b) => a.x0 - b.x0);
    for (const entry of line) {
      ordered.push({ quad: entry.quad, line: lineIndex });
    }
  });
  return ordered;
}

export function cropSize(quad: Quad): { width: number; height: number } {
  return {
    width: Math.max(
      1,
      Math.round(
        Math.max(distance(quad[0], quad[1]), distance(quad[3], quad[2])),
      ),
    ),
    height: Math.max(
      1,
      Math.round(
        Math.max(distance(quad[0], quad[3]), distance(quad[1], quad[2])),
      ),
    ),
  };
}

export function shouldRotateCrop(width: number, height: number): boolean {
  return height >= width * 1.5;
}

export function mapSpanToPhoto(
  quad: Quad,
  cropWidth: number,
  cropHeight: number,
  rotated: boolean,
  x0: number,
  x1: number,
): { x0: number; y0: number; x1: number; y1: number } | null {
  const transform = homography(
    [
      { x: 0, y: 0 },
      { x: cropWidth, y: 0 },
      { x: cropWidth, y: cropHeight },
      { x: 0, y: cropHeight },
    ],
    quad,
  );
  if (!transform) {
    return null;
  }
  const recHeight = rotated ? cropWidth : cropHeight;
  const corners = [
    { x: x0, y: 0 },
    { x: x1, y: 0 },
    { x: x1, y: recHeight },
    { x: x0, y: recHeight },
  ].map((point) =>
    applyHomography(
      transform,
      rotated ? { x: cropWidth - point.y, y: point.x } : point,
    ),
  );
  return bounds(corners);
}

export function wordsOnQuad(args: {
  quad: Quad;
  cropWidth: number;
  cropHeight: number;
  rotated: boolean;
  words: CropWord[];
  line: number;
  imageWidth: number;
  imageHeight: number;
}): OcrWord[] {
  const kept: OcrWord[] = [];
  for (const word of args.words) {
    if (!keepOcrWord(word.text, word.confidence)) continue;
    const box = mapSpanToPhoto(
      args.quad,
      args.cropWidth,
      args.cropHeight,
      args.rotated,
      word.x0,
      word.x1,
    );
    if (!box) continue;
    const x0 = clamp(box.x0, 0, args.imageWidth);
    const y0 = clamp(box.y0, 0, args.imageHeight);
    const x1 = clamp(box.x1, 0, args.imageWidth);
    const y1 = clamp(box.y1, 0, args.imageHeight);
    if (x1 - x0 < 1 || y1 - y0 < 1) continue;
    kept.push({ text: word.text, x0, y0, x1, y1, line: args.line });
  }
  return kept;
}

export function warpQuad(image: Raster, quad: Quad): Raster | null {
  const size = cropSize(quad);
  if (size.width < 2 || size.height < 2) return null;
  const transform = homography(
    [
      { x: 0, y: 0 },
      { x: size.width, y: 0 },
      { x: size.width, y: size.height },
      { x: 0, y: size.height },
    ],
    quad,
  );
  if (!transform) return null;
  const data = new Uint8ClampedArray(size.width * size.height * 4);
  for (let y = 0; y < size.height; y++) {
    for (let x = 0; x < size.width; x++) {
      const source = applyHomography(transform, { x: x + 0.5, y: y + 0.5 });
      const pixel = sample(image, source.x, source.y);
      const offset = (y * size.width + x) * 4;
      data[offset] = pixel[0];
      data[offset + 1] = pixel[1];
      data[offset + 2] = pixel[2];
      data[offset + 3] = 255;
    }
  }
  return { width: size.width, height: size.height, data };
}

/** Counter-clockwise, matching the recognizer's view of a tall crop. */
export function rotateCrop(image: Raster): Raster {
  const width = image.height;
  const height = image.width;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const dx = y;
      const dy = image.width - 1 - x;
      const from = (y * image.width + x) * 4;
      const to = (dy * width + dx) * 4;
      data[to] = image.data[from];
      data[to + 1] = image.data[from + 1];
      data[to + 2] = image.data[from + 2];
      data[to + 3] = image.data[from + 3];
    }
  }
  return { width, height, data };
}

export function scoreMapSize(dims: readonly number[]): {
  width: number;
  height: number;
} | null {
  if (dims.length === 4) {
    if (dims[3] === 1 && dims[1] !== 1) {
      return { height: dims[1], width: dims[2] };
    }
    return { height: dims[2], width: dims[3] };
  }
  if (dims.length === 3) {
    return { height: dims[1], width: dims[2] };
  }
  if (dims.length === 2) {
    return { height: dims[0], width: dims[1] };
  }
  return null;
}

export function recMatrix(dims: readonly number[]): {
  time: number;
  classes: number;
} | null {
  if (dims.length === 3) {
    return { time: dims[1], classes: dims[2] };
  }
  if (dims.length === 2) {
    return { time: dims[0], classes: dims[1] };
  }
  return null;
}

function snap32(value: number): number {
  return Math.max(32, Math.round(value / 32) * 32);
}

function boundaryPoints(
  pixels: number[],
  label: Uint32Array,
  id: number,
  width: number,
  height: number,
): Point[] {
  const points: Point[] = [];
  for (const index of pixels) {
    const x = index % width;
    const y = (index - x) / width;
    let edge = false;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
        edge = true;
        break;
      }
      if (label[ny * width + nx] !== id) {
        edge = true;
        break;
      }
    }
    if (edge) points.push({ x, y });
  }
  return points.length
    ? points
    : pixels.map((index) => ({
        x: index % width,
        y: (index - (index % width)) / width,
      }));
}

function minAreaRect(
  points: Point[],
): { corners: Point[]; width: number; height: number } | null {
  const hull = convexHull(points);
  if (hull.length < 3) return null;
  let bestArea = Infinity;
  let best: {
    cos: number;
    sin: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  } | null = null;
  for (let index = 0; index < hull.length; index++) {
    const a = hull[index];
    const b = hull[(index + 1) % hull.length];
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const point of hull) {
      const x = point.x * cos + point.y * sin;
      const y = -point.x * sin + point.y * cos;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const area = (maxX - minX) * (maxY - minY);
    if (area < bestArea) {
      bestArea = area;
      best = { cos, sin, minX, maxX, minY, maxY };
    }
  }
  if (!best) return null;
  const corners = [
    [best.minX, best.minY],
    [best.maxX, best.minY],
    [best.maxX, best.maxY],
    [best.minX, best.maxY],
  ].map(([x, y]) => ({
    x: x * best.cos - y * best.sin,
    y: x * best.sin + y * best.cos,
  }));
  return {
    corners,
    width: best.maxX - best.minX,
    height: best.maxY - best.minY,
  };
}

function convexHull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const unique: Point[] = [];
  for (const point of sorted) {
    const last = unique[unique.length - 1];
    if (!last || last.x !== point.x || last.y !== point.y) unique.push(point);
  }
  if (unique.length <= 2) return unique;
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const point of unique) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper: Point[] = [];
  for (let index = unique.length - 1; index >= 0; index--) {
    const point = unique[index];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0
    ) {
      upper.pop();
    }
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

export function orderQuad(points: Point[]): Quad {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const left = [sorted[0], sorted[1]].sort((a, b) => a.y - b.y);
  const right = [sorted[2], sorted[3]].sort((a, b) => a.y - b.y);
  return [left[0], right[0], right[1], left[1]];
}

function expandRect(quad: Quad, ratio: number): Quad {
  if (!ratio) return quad;
  const width = distance(quad[0], quad[1]);
  const height = distance(quad[1], quad[2]);
  if (width < 1e-3 || height < 1e-3) return quad;
  const distanceOut = (width * height * ratio) / (2 * (width + height));
  const ux = (quad[1].x - quad[0].x) / width;
  const uy = (quad[1].y - quad[0].y) / width;
  const vx = (quad[2].x - quad[1].x) / height;
  const vy = (quad[2].y - quad[1].y) / height;
  const cx = (quad[0].x + quad[2].x) / 2;
  const cy = (quad[0].y + quad[2].y) / 2;
  const hw = width / 2 + distanceOut;
  const hh = height / 2 + distanceOut;
  return [
    { x: cx - ux * hw - vx * hh, y: cy - uy * hw - vy * hh },
    { x: cx + ux * hw - vx * hh, y: cy + uy * hw - vy * hh },
    { x: cx + ux * hw + vx * hh, y: cy + uy * hw + vy * hh },
    { x: cx - ux * hw + vx * hh, y: cy - uy * hw + vy * hh },
  ];
}

function meanScore(score: Float32Array, pixels: number[]): number {
  let sum = 0;
  for (const index of pixels) sum += score[index];
  return pixels.length ? sum / pixels.length : 0;
}

function homography(src: Point[], dst: Point[]): number[] | null {
  const rows: number[][] = [];
  const values: number[] = [];
  for (let index = 0; index < 4; index++) {
    const { x, y } = src[index];
    const u = dst[index].x;
    const v = dst[index].y;
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    values.push(u);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    values.push(v);
  }
  const solved = solve(rows, values);
  return solved ? [...solved, 1] : null;
}

function solve(matrix: number[][], values: number[]): number[] | null {
  const size = values.length;
  const rows = matrix.map((row, index) => [...row, values[index]]);
  for (let col = 0; col < size; col++) {
    let pivot = col;
    for (let row = col + 1; row < size; row++) {
      if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row;
    }
    if (Math.abs(rows[pivot][col]) < 1e-8) return null;
    if (pivot !== col) {
      const swap = rows[col];
      rows[col] = rows[pivot];
      rows[pivot] = swap;
    }
    const scale = rows[col][col];
    for (let colIndex = col; colIndex <= size; colIndex++) {
      rows[col][colIndex] /= scale;
    }
    for (let row = 0; row < size; row++) {
      if (row === col) continue;
      const factor = rows[row][col];
      for (let colIndex = col; colIndex <= size; colIndex++) {
        rows[row][colIndex] -= factor * rows[col][colIndex];
      }
    }
  }
  return rows.map((row) => row[size]);
}

function applyHomography(h: number[], point: Point): Point {
  const x = h[0] * point.x + h[1] * point.y + h[2];
  const y = h[3] * point.x + h[4] * point.y + h[5];
  const w = h[6] * point.x + h[7] * point.y + h[8];
  return { x: x / w, y: y / w };
}

function sample(image: Raster, x: number, y: number): [number, number, number] {
  const x0 = clamp(Math.floor(x), 0, image.width - 1);
  const y0 = clamp(Math.floor(y), 0, image.height - 1);
  const x1 = clamp(x0 + 1, 0, image.width - 1);
  const y1 = clamp(y0 + 1, 0, image.height - 1);
  const tx = x0 === x1 ? 0 : x - x0;
  const ty = y0 === y1 ? 0 : y - y0;
  const pixel = (px: number, py: number) => (py * image.width + px) * 4;
  const out: [number, number, number] = [0, 0, 0];
  for (let channel = 0; channel < 3; channel++) {
    const p00 = image.data[pixel(x0, y0) + channel];
    const p10 = image.data[pixel(x1, y0) + channel];
    const p01 = image.data[pixel(x0, y1) + channel];
    const p11 = image.data[pixel(x1, y1) + channel];
    out[channel] =
      p00 +
      (p10 - p00) * tx +
      (p01 + (p11 - p01) * tx - (p00 + (p10 - p00) * tx)) * ty;
  }
  return out;
}

function bounds(points: Point[]): {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
} {
  return {
    x0: Math.min(...points.map((point) => point.x)),
    y0: Math.min(...points.map((point) => point.y)),
    x1: Math.max(...points.map((point) => point.x)),
    y1: Math.max(...points.map((point) => point.y)),
  };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
