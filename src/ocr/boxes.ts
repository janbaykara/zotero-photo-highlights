import type { OcrWord } from "../photo/types";

export type NativeSpace = "vision" | "windows";

export type NativeWordBox = {
  text?: unknown;
  confidence?: unknown;
  x?: unknown;
  y?: unknown;
  w?: unknown;
  h?: unknown;
};

export type NativeLine = {
  words?: NativeWordBox | NativeWordBox[];
};

export type NativePayload = {
  ok?: boolean;
  reason?: string;
  detail?: string;
  width?: unknown;
  height?: unknown;
  lines?: NativeLine | NativeLine[];
};

type Box = { x: number; y: number; w: number; h: number };

export function keepOcrWord(text: string, confidence?: number): boolean {
  if (!text) {
    return false;
  }
  if (typeof confidence === "number" && confidence < 45) {
    return false;
  }
  const letters = text.replace(/[^\p{L}\p{N}]/gu, "");
  if (!letters) {
    return false;
  }
  return letters.length / text.length >= 0.5;
}

/** PowerShell 5.1 writes UTF-16LE into a pipe unless the host forces UTF-8. */
export function decodeNativeStdout(raw: string): string {
  const text = raw.includes("\u0000") ? decodeUtf16Le(raw) : raw;
  return text.replace(/^\uFEFF/, "");
}

export function parseNativePayload(raw: string): NativePayload | null {
  const text = decodeNativeStdout(raw).trim();
  if (!text) {
    return null;
  }
  const direct = parsePayloadObject(text);
  if (direct) {
    return direct;
  }
  const lines = text.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index--) {
    const parsed = parsePayloadObject(lines[index].trim());
    if (parsed) {
      return parsed;
    }
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return parsePayloadObject(text.slice(start, end + 1));
  }
  return null;
}

function parsePayloadObject(text: string): NativePayload | null {
  if (!text) {
    return null;
  }
  try {
    const value = JSON.parse(text) as NativePayload;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

export function wordsFromNativePayload(
  payload: NativePayload,
  space: NativeSpace,
  targetWidth: number,
  targetHeight: number,
): OcrWord[] {
  const sourceWidth = positive(payload.width) ?? positive(targetWidth) ?? 1;
  const sourceHeight = positive(payload.height) ?? positive(targetHeight) ?? 1;
  const scaleX = (positive(targetWidth) ?? sourceWidth) / sourceWidth;
  const scaleY = (positive(targetHeight) ?? sourceHeight) / sourceHeight;
  const words: OcrWord[] = [];
  asList(payload.lines).forEach((line, lineIndex) => {
    for (const box of asList(line?.words)) {
      const text = typeof box.text === "string" ? box.text.trim() : "";
      const confidence =
        space === "vision" ? visionConfidence(box.confidence) : undefined;
      if (!keepOcrWord(text, confidence)) {
        continue;
      }
      const rect = readBox(box);
      const pixels =
        space === "vision"
          ? visionBoxToPixels(rect, sourceWidth, sourceHeight, scaleX, scaleY)
          : windowsRectToPixels(rect, scaleX, scaleY);
      words.push({ text, line: lineIndex, ...pixels });
    }
  });
  return words;
}

export function visionBoxToPixels(
  box: Box,
  sourceWidth: number,
  sourceHeight: number,
  scaleX = 1,
  scaleY = 1,
): Pick<OcrWord, "x0" | "y0" | "x1" | "y1"> {
  const x0 = box.x * sourceWidth * scaleX;
  const x1 = (box.x + box.w) * sourceWidth * scaleX;
  const y0 = (1 - box.y - box.h) * sourceHeight * scaleY;
  const y1 = (1 - box.y) * sourceHeight * scaleY;
  return { x0, y0, x1, y1 };
}

export function windowsRectToPixels(
  box: Box,
  scaleX = 1,
  scaleY = 1,
): Pick<OcrWord, "x0" | "y0" | "x1" | "y1"> {
  return {
    x0: box.x * scaleX,
    y0: box.y * scaleY,
    x1: (box.x + box.w) * scaleX,
    y1: (box.y + box.h) * scaleY,
  };
}

/**
 * Group a flat Tesseract word list into lines. A word joins the current line
 * when its vertical midpoint sits inside that line's boxes. Within a line,
 * words run left to right. Line numbers stay in that order.
 */
export function clusterTesseractWords(
  words: Array<Omit<OcrWord, "line">>,
): OcrWord[] {
  const items = words.map((word, index) => ({ word, index }));
  items.sort((a, b) => a.word.y0 - b.word.y0 || a.word.x0 - b.word.x0);
  const lines: { word: Omit<OcrWord, "line">; index: number }[][] = [];
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
  const ordered: OcrWord[] = [];
  lines.forEach((line, lineIndex) => {
    line.sort((a, b) => a.word.x0 - b.word.x0);
    for (const entry of line) {
      ordered.push({ ...entry.word, line: lineIndex });
    }
  });
  return ordered;
}

function visionConfidence(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return value * 100;
}

function readBox(box: NativeWordBox): Box {
  return {
    x: numberOrZero(box.x),
    y: numberOrZero(box.y),
    w: numberOrZero(box.w),
    h: numberOrZero(box.h),
  };
}

function numberOrZero(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

function positive(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return undefined;
  }
  return number;
}

function asList<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function decodeUtf16Le(raw: string): string {
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index++) {
    bytes[index] = raw.charCodeAt(index) & 0xff;
  }
  return new TextDecoder("utf-16le").decode(bytes);
}
