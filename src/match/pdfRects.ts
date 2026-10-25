export type PdfTextItem = {
  str: string;
  /** pdf.js transform: [a, b, c, d, x, y]. y is the baseline. */
  transform: number[];
  width: number;
  height: number;
};

export type PdfLineRect = number[];

type MappedItem = PdfTextItem & {
  start: number;
  end: number;
  x: number;
  y: number;
};

/** Concatenate glyph items into a page string, inserting spaces between gaps. */
export function pageTextFromItems(items: PdfTextItem[]): {
  text: string;
  items: MappedItem[];
} {
  const mapped: MappedItem[] = [];
  let text = "";
  let last: MappedItem | null = null;
  for (const item of items) {
    if (!item.str) {
      continue;
    }
    const x = item.transform[4] || 0;
    const y = item.transform[5] || 0;
    if (last) {
      const gap = x - (last.x + last.width);
      const sameLine =
        Math.abs(y - last.y) < Math.max(last.height, item.height, 1) * 0.6;
      if (!sameLine || gap > Math.max(2, last.height * 0.3)) {
        text += " ";
      }
    }
    const start = text.length;
    text += item.str;
    const next: MappedItem = { ...item, start, end: text.length, x, y };
    mapped.push(next);
    last = next;
  }
  return { text, items: mapped };
}

/**
 * Line rectangles in PDF space (bottom-left origin) covering [start, end)
 * in the string from `pageTextFromItems`.
 */
export function lineRectsForRange(
  mapped: MappedItem[],
  start: number,
  end: number,
): PdfLineRect[] {
  const chosen = mapped.filter((item) => item.end > start && item.start < end);
  if (!chosen.length) {
    return [];
  }
  const lines: MappedItem[][] = [];
  for (const item of chosen) {
    const line = lines.find(
      (group) =>
        Math.abs(group[0].y - item.y) <
        Math.max(group[0].height, item.height, 1) * 0.6,
    );
    if (line) {
      line.push(item);
    } else {
      lines.push([item]);
    }
  }
  return lines.map((line) => {
    const x1 = Math.min(...line.map((item) => item.x));
    const y1 = Math.min(...line.map((item) => item.y));
    const x2 = Math.max(...line.map((item) => item.x + item.width));
    const y2 = Math.max(...line.map((item) => item.y + item.height));
    return [round(x1), round(y1), round(x2), round(y2)];
  });
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Reader sort index: page | char offset | y from the top of the page. */
export function pdfSortIndex(
  pageIndex: number,
  textOffset: number,
  yFromTop: number,
): string {
  const part = (value: number, width: number) =>
    String(Math.max(0, Math.floor(value)))
      .slice(0, width)
      .padStart(width, "0");
  return [part(pageIndex, 5), part(textOffset, 6), part(yFromTop, 5)].join("|");
}

export function yFromTop(pageHeight: number, rects: PdfLineRect[]): number {
  if (!rects.length) {
    return 0;
  }
  const top = Math.max(...rects.map((rect) => rect[3]));
  return Math.max(0, pageHeight - top);
}
