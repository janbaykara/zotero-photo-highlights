import { EpubCFI } from "epubjs";
import {
  bandScores,
  contextAgreement,
  findPassageHits,
  normalizePassage,
  normalizeWithMap,
  quotesOverlap,
  scoreWithContext,
  wordsAround,
  type PassageHit,
} from "../match/passage";
import {
  lineRectsForRange,
  pageTextFromItems,
  pdfSortIndex,
  verticalBand,
  yFromTop,
  type PageBand,
  type PdfTextItem,
} from "../match/pdfRects";
import {
  cfiForSpineTextRange,
  epubFragmentSelector,
  epubSortIndex,
} from "../match/epubCfi";
import { readPdfPageLabels } from "../utils/pdfPageLabels";
import { loadPdfjs, type PdfjsTextItem } from "../utils/pdfjs";

export type LocatedPlace = {
  attachmentId: number;
  label: string;
  preview: string;
  /** Original-cased match, shortened for the location card. */
  excerpt: string;
  /** Words in the book immediately before the match. */
  lead: string;
  /** Words in the book immediately after the match. */
  trail: string;
  /** Empty for an EPUB section, which has no page height. */
  band: PageBand | "";
  positionJSON: string;
  sortIndex: string;
  pageLabel: string;
};

type Slice = {
  attachmentId: number;
  label: string;
  text: string;
  /** Text before normalization, so a location card can show real casing. */
  source: string;
  map: number[];
  kind: "pdf" | "epub";
  pageIndex: number;
  pdfItems?: ReturnType<typeof pageTextFromItems>["items"];
  pageHeight?: number;
  cfiFromRaw?: (start: number, end: number) => string | null;
};

const cache = new Map<number, Slice[]>();

export function clearAttachmentTextCache(): void {
  cache.clear();
}

export async function attachmentSlices(book: Zotero.Item): Promise<Slice[]> {
  const attachments = book.getAttachments?.() || [];
  const slices: Slice[] = [];
  for (const id of attachments) {
    const item = await Zotero.Items.getAsync(id);
    if (!item || item.isAnnotation?.()) {
      continue;
    }
    const cached = cache.get(item.id);
    if (cached) {
      slices.push(...cached);
      continue;
    }
    const next = await slicesForAttachment(item);
    cache.set(item.id, next);
    slices.push(...next);
  }
  return slices;
}

async function slicesForAttachment(item: Zotero.Item): Promise<Slice[]> {
  const path = await item.getFilePathAsync();
  if (!path) {
    return [];
  }
  if (isPdf(item)) {
    return pdfSlices(item.id, await IOUtils.read(path));
  }
  if (isEpub(item)) {
    return epubSlices(item.id, path);
  }
  return [];
}

function isPdf(item: Zotero.Item): boolean {
  return (
    item.isPDFAttachment?.() === true ||
    item.attachmentContentType === "application/pdf"
  );
}

function isEpub(item: Zotero.Item): boolean {
  const type = item.attachmentContentType || "";
  const name = item.attachmentFilename || "";
  return type === "application/epub+zip" || /\.epub$/i.test(name);
}

async function pdfSlices(
  attachmentId: number,
  bytes: Uint8Array,
): Promise<Slice[]> {
  const pdfjs = await loadPdfjs();
  if (!pdfjs) {
    return [];
  }
  const doc = await pdfjs.getDocument({ data: bytes, disableWorker: true })
    .promise;
  const labels = (await readPdfPageLabels(bytes, doc.numPages)) || [];
  const slices: Slice[] = [];
  for (let page = 1; page <= doc.numPages; page++) {
    const pdfPage = await doc.getPage(page);
    const content = await pdfPage.getTextContent();
    const items = (content.items || [])
      .filter((item): item is PdfjsTextItem & { str: string } => !!item.str)
      .map((item): PdfTextItem => ({
        str: item.str,
        transform: item.transform || [1, 0, 0, 1, 0, 0],
        width: item.width || 0,
        height: item.height || 0,
      }));
    const built = pageTextFromItems(items);
    const normalized = normalizeWithMap(built.text);
    if (!normalized.text) {
      continue;
    }
    const viewport = pdfPage.getViewport({ scale: 1 });
    slices.push({
      attachmentId,
      label: labels[page - 1] || String(page),
      text: normalized.text,
      source: built.text,
      map: normalized.map,
      kind: "pdf",
      pageIndex: page - 1,
      pdfItems: built.items,
      pageHeight: viewport.height,
    });
  }
  await doc.destroy?.();
  return slices;
}

function useMainWindowRealm(): void {
  const win = Zotero.getMainWindow();
  if (!win) {
    return;
  }
  const scope = globalThis as { window?: unknown; document?: Document };
  scope.window = win;
  if (!scope.document) {
    scope.document = win.document;
  }
}

async function epubSlices(
  attachmentId: number,
  path: string,
): Promise<Slice[]> {
  useMainWindowRealm();
  const reader = openZip(path);
  try {
    const container = parseXml(readZipEntry(reader, "META-INF/container.xml"));
    const opfPath = attr(container, "rootfile", "full-path");
    if (!opfPath) {
      return [];
    }
    const opf = parseXml(readZipEntry(reader, opfPath));
    const manifest = new Map<string, string>();
    for (const item of named(opf, "item")) {
      const id = item.getAttribute("id");
      const href = item.getAttribute("href");
      if (id && href) {
        manifest.set(id, href);
      }
    }
    const slices: Slice[] = [];
    let index = 0;
    for (const itemref of named(opf, "itemref")) {
      const idref = itemref.getAttribute("idref") || "";
      const href = manifest.get(idref);
      const spineIndex = index;
      index += 1;
      if (!href) {
        continue;
      }
      const entry = zipPath(opfPath, href);
      let raw = "";
      let label = "";
      try {
        const chapter = parseXml(readZipEntry(reader, entry));
        raw =
          chapter.body?.textContent ||
          chapter.documentElement?.textContent ||
          "";
        label =
          (
            named(chapter, "h1")[0] || named(chapter, "title")[0]
          )?.textContent?.trim() || "";
      } catch (error) {
        const thrown = error as { message?: string };
        ztoolkit.log(
          "EPUB section load failed",
          thrown?.message || String(error),
        );
        continue;
      }
      const normalized = normalizeWithMap(raw);
      if (!normalized.text) {
        continue;
      }
      slices.push({
        attachmentId,
        label: label || `§${spineIndex + 1}`,
        text: normalized.text,
        source: raw,
        map: normalized.map,
        kind: "epub",
        pageIndex: spineIndex,
        cfiFromRaw: (start, end) =>
          cfiForEntry(path, entry, spineIndex, start, end),
      });
    }
    return slices;
  } finally {
    reader.close();
  }
}

function cfiForEntry(
  path: string,
  entry: string,
  spineIndex: number,
  start: number,
  end: number,
): string | null {
  useMainWindowRealm();
  const reader = openZip(path);
  try {
    const chapter = parseXml(readZipEntry(reader, entry));
    const range = textRange(chapter, start, end);
    if (!range) {
      return null;
    }
    const value = new EpubCFI(range, `/6/${2 * (spineIndex + 1)}`).toString();
    return value.startsWith("epubcfi(") ? value : `epubcfi(${value})`;
  } catch (error) {
    const thrown = error as { message?: string };
    ztoolkit.log("EPUB CFI failed", thrown?.message || String(error));
    return null;
  } finally {
    reader.close();
  }
}

type ZipReader = {
  open: (file: unknown) => void;
  close: () => void;
  getInputStream: (entry: string) => unknown;
};

function openZip(path: string): ZipReader {
  const reader = Components.classes[
    "@mozilla.org/libjar/zip-reader;1"
  ].createInstance(Components.interfaces.nsIZipReader) as unknown as ZipReader;
  reader.open(Zotero.File.pathToFile(path));
  return reader;
}

function readZipEntry(reader: ZipReader, name: string): string {
  const scriptable = Components.classes[
    "@mozilla.org/scriptableinputstream;1"
  ].createInstance(
    Components.interfaces.nsIScriptableInputStream,
  ) as unknown as {
    init: (stream: unknown) => void;
    available: () => number;
    read: (count: number) => string;
    close: () => void;
  };
  scriptable.init(reader.getInputStream(name));
  const parts: string[] = [];
  let left = scriptable.available();
  while (left > 0) {
    parts.push(scriptable.read(Math.min(left, 65536)));
    left = scriptable.available();
  }
  scriptable.close();
  const binary = parts.join("");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i) & 0xff;
  }
  return new TextDecoder("utf-8").decode(bytes);
}

function parseXml(source: string): Document {
  const win = Zotero.getMainWindow();
  if (!win) {
    throw new Error("No window");
  }
  return new win.DOMParser().parseFromString(source, "application/xhtml+xml");
}

function named(doc: Document, name: string): Element[] {
  return [...doc.getElementsByTagName("*")].filter(
    (element) => element.localName === name,
  );
}

function attr(doc: Document, name: string, attribute: string): string {
  return named(doc, name)[0]?.getAttribute(attribute) || "";
}

function zipPath(baseFile: string, href: string): string {
  const decoded = decodeURIComponent(href.split("#")[0] || "");
  const parts = baseFile.split("/").slice(0, -1);
  for (const part of decoded.split("/")) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
}

function textRange(doc: Document, start: number, end: number): Range | null {
  const root = doc.body || doc.documentElement;
  if (
    !root ||
    typeof doc.createTreeWalker !== "function" ||
    typeof doc.createRange !== "function"
  ) {
    return null;
  }
  const showText =
    (globalThis as { NodeFilter?: { SHOW_TEXT: number } }).NodeFilter
      ?.SHOW_TEXT ?? 4;
  const walker = doc.createTreeWalker(root, showText);
  let seen = 0;
  let startNode: Node | null = null;
  let startOffset = 0;
  let endNode: Node | null = null;
  let endOffset = 0;
  let node = walker.nextNode();
  while (node) {
    const length = node.textContent?.length || 0;
    if (!startNode && seen + length > start) {
      startNode = node;
      startOffset = start - seen;
    }
    if (startNode && seen + length >= end) {
      endNode = node;
      endOffset = end - seen;
      break;
    }
    seen += length;
    node = walker.nextNode();
  }
  if (!startNode) {
    return null;
  }
  if (!endNode) {
    endNode = startNode;
    endOffset = startNode.textContent?.length || startOffset;
  }
  const range = doc.createRange();
  const startLimit = startNode.textContent?.length || 0;
  const endLimit = endNode.textContent?.length || 0;
  range.setStart(startNode, Math.min(startOffset, startLimit));
  range.setEnd(endNode, Math.min(Math.max(endOffset, 0), endLimit));
  return range;
}

export type MatchOutcome =
  | { kind: "located"; place: LocatedPlace }
  | { kind: "ambiguous"; places: LocatedPlace[] }
  | { kind: "unmatched" }
  | { kind: "duplicate"; place: LocatedPlace; existingQuote: string };

export type PassageContext = {
  before?: string;
  after?: string;
};

export async function matchQuote(
  book: Zotero.Item,
  quote: string,
  context?: PassageContext,
): Promise<MatchOutcome> {
  const slices = await attachmentSlices(book);
  const needle = normalizePassage(quote);
  const before = context?.before || "";
  const after = context?.after || "";
  const candidates: { hit: PassageHit; slice: Slice; score: number }[] = [];
  for (let index = 0; index < slices.length; index++) {
    if (index % 2 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const slice = slices[index];
    for (const hit of findPassageHits(needle, slice.text)) {
      candidates.push({
        hit,
        slice,
        score: scoreWithContext(
          hit.score,
          contextAgreement(slice.text, hit, before, after),
        ),
      });
    }
  }
  const band = bandScores(candidates);
  if (band.kind === "unmatched") {
    return { kind: "unmatched" };
  }
  if (band.kind === "located") {
    const place = await placeFor(band.hit.slice, band.hit.hit, quote);
    if (!place) {
      return { kind: "unmatched" };
    }
    const duplicate = await duplicateQuote(place.attachmentId, quote);
    if (duplicate) {
      return { kind: "duplicate", place, existingQuote: duplicate };
    }
    return { kind: "located", place };
  }
  const places: LocatedPlace[] = [];
  for (const candidate of band.hits) {
    const place = await placeFor(candidate.slice, candidate.hit, quote);
    if (!place || places.some((existing) => sameSpot(existing, place))) {
      continue;
    }
    places.push(place);
  }
  if (places.length === 1) {
    const duplicate = await duplicateQuote(places[0].attachmentId, quote);
    if (duplicate) {
      return {
        kind: "duplicate",
        place: places[0],
        existingQuote: duplicate,
      };
    }
    return { kind: "located", place: places[0] };
  }
  if (places.length < 2) {
    return { kind: "unmatched" };
  }
  return { kind: "ambiguous", places };
}

function sameSpot(left: LocatedPlace, right: LocatedPlace): boolean {
  if (left.attachmentId !== right.attachmentId || left.label !== right.label) {
    return false;
  }
  if (left.positionJSON === right.positionJSON) {
    return true;
  }
  const a = normalizePassage(left.preview);
  const b = normalizePassage(right.preview);
  if (!a || !b) {
    return false;
  }
  return a.includes(b) || b.includes(a);
}

async function placeFor(
  slice: Slice,
  hit: PassageHit,
  quote: string,
): Promise<LocatedPlace | null> {
  const start = slice.map[hit.start] ?? 0;
  const endIndex = Math.max(hit.start, hit.end - 1);
  const end = (slice.map[endIndex] ?? start) + 1;
  const snippet = placeSnippet(slice, hit, start, end);
  if (slice.kind === "pdf" && slice.pdfItems) {
    const rects = lineRectsForRange(slice.pdfItems, start, end);
    if (!rects.length) {
      return null;
    }
    const position = { pageIndex: slice.pageIndex, rects };
    const fromTop = yFromTop(slice.pageHeight || 0, rects);
    return {
      attachmentId: slice.attachmentId,
      label: slice.label,
      preview: hit.matched.slice(0, 180),
      ...snippet,
      band: verticalBand(slice.pageHeight || 0, fromTop),
      positionJSON: JSON.stringify(position),
      sortIndex: pdfSortIndex(slice.pageIndex, hit.start, fromTop),
      pageLabel: slice.label,
    };
  }
  const cfi = await epubCfiFor(slice, start, end);
  return {
    attachmentId: slice.attachmentId,
    label: slice.label,
    preview: quote.slice(0, 180),
    ...snippet,
    band: "",
    positionJSON: JSON.stringify(epubFragmentSelector(cfi)),
    sortIndex: epubSortIndex(slice.pageIndex, hit.start),
    pageLabel: slice.label,
  };
}

function placeSnippet(
  slice: Slice,
  hit: PassageHit,
  rawStart: number,
  rawEnd: number,
): { excerpt: string; lead: string; trail: string } {
  const source = slice.source || slice.text;
  const around = wordsAround(source, rawStart, rawEnd);
  const match = source.slice(rawStart, rawEnd).replace(/\s+/g, " ").trim();
  const excerpt = match.length > 180 ? `${match.slice(0, 177).trim()}…` : match;
  return {
    excerpt: excerpt || hit.matched.slice(0, 180),
    lead: around.lead,
    trail: around.trail,
  };
}

async function epubCfiFor(
  slice: Slice,
  start: number,
  end: number,
): Promise<string> {
  return (
    slice.cfiFromRaw?.(start, end) ||
    cfiForSpineTextRange(slice.pageIndex, start, end)
  );
}

async function duplicateQuote(
  attachmentId: number,
  quote: string,
): Promise<string | null> {
  const attachment = await Zotero.Items.getAsync(attachmentId);
  if (!attachment) {
    return null;
  }
  const annotations = attachment.getAnnotations?.(false) || [];
  for (const annotation of annotations) {
    const text = annotation.annotationText || "";
    if (quotesOverlap(text, quote)) {
      return text;
    }
  }
  return null;
}

export async function fileAttachments(
  book: Zotero.Item,
): Promise<Zotero.Item[]> {
  const ids = book.getAttachments?.() || [];
  const items: Zotero.Item[] = [];
  for (const id of ids) {
    const item = await Zotero.Items.getAsync(id);
    if (item && (isPdf(item) || isEpub(item))) {
      items.push(item);
    }
  }
  return items;
}
