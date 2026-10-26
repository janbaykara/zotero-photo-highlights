import { EpubCFI } from "epubjs";
import { buildPageIndex, type PageIndex } from "../match/pageIndex";
import {
  bandScores,
  contextAgreement,
  locateOnIndex,
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
import {
  loadPdfjs,
  type PdfjsDocument,
  type PdfjsModule,
  type PdfjsTextItem,
} from "../utils/pdfjs";

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
const loading = new Map<number, Promise<Slice[]>>();
const indexes = new Map<string, PageIndex>();
const READ_SLICE_MS = 12;

/** Share of one photo's bar spent reading the file, before the search. */
const READ_END = 0.72;
const SEARCH_END = 0.96;

export type MatchProgress = {
  activity:
    | "wizard-matching-opening"
    | "wizard-matching-reading-pdf"
    | "wizard-matching-reading-epub"
    | "wizard-matching-searching"
    | "wizard-matching-checking"
    | "wizard-matching-saving";
  args?: Record<string, string | number>;
  /** 0–1 for this photo. */
  ratio: number;
};

export type MatchProgressSink = (progress: MatchProgress) => void;

export function clearAttachmentTextCache(): void {
  cache.clear();
  loading.clear();
  indexes.clear();
}

function breathe(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Yield after a stretch of reading so the wizard can paint, not after every page. */
async function yieldIfDue(clock: { at: number }): Promise<void> {
  const now = Date.now();
  if (now - clock.at < READ_SLICE_MS) {
    return;
  }
  await breathe();
  clock.at = Date.now();
}

function indexKey(slices: Slice[]): string {
  const parts = [String(slices.length)];
  for (const slice of slices) {
    const text = slice.text;
    parts.push(
      `${slice.attachmentId}:${slice.pageIndex}:${text.length}:${text.slice(0, 24)}:${text.slice(-24)}`,
    );
  }
  return parts.join("|");
}

function indexFor(slices: Slice[]): PageIndex {
  const key = indexKey(slices);
  const cached = indexes.get(key);
  if (cached) {
    return cached;
  }
  const built = buildPageIndex(slices.map((slice) => slice.text));
  indexes.set(key, built);
  return built;
}

export async function attachmentSlices(
  book: Zotero.Item,
  sink?: MatchProgressSink,
): Promise<Slice[]> {
  const attachments = book.getAttachments?.() || [];
  const slots: Array<
    | { kind: "ready"; slices: Slice[] }
    | { kind: "pending"; promise: Promise<Slice[]> }
    | { kind: "load"; item: Zotero.Item }
  > = [];
  const loads: Zotero.Item[] = [];
  for (const id of attachments) {
    const item = await Zotero.Items.getAsync(id);
    if (!item || item.isAnnotation?.()) {
      continue;
    }
    const cached = cache.get(item.id);
    if (cached) {
      slots.push({ kind: "ready", slices: cached });
      continue;
    }
    const pending = loading.get(item.id);
    if (pending) {
      slots.push({ kind: "pending", promise: pending });
      continue;
    }
    if (!isPdf(item) && !isEpub(item)) {
      continue;
    }
    loads.push(item);
    slots.push({ kind: "load", item });
  }
  const share = loads.length ? READ_END / loads.length : 0;
  const slices: Slice[] = [];
  for (const slot of slots) {
    if (slot.kind === "ready") {
      slices.push(...slot.slices);
      continue;
    }
    if (slot.kind === "pending") {
      slices.push(...(await slot.promise));
      continue;
    }
    const index = loads.indexOf(slot.item);
    const base = share * Math.max(0, index);
    const scaled: MatchProgressSink | undefined = sink
      ? (progress) => {
          sink({
            ...progress,
            ratio: base + Math.min(1, Math.max(0, progress.ratio)) * share,
          });
        }
      : undefined;
    let pending = loading.get(slot.item.id);
    if (!pending) {
      pending = (async () => {
        try {
          const next = await slicesForAttachment(slot.item, scaled);
          cache.set(slot.item.id, next);
          return next;
        } finally {
          loading.delete(slot.item.id);
        }
      })();
      loading.set(slot.item.id, pending);
    }
    slices.push(...(await pending));
  }
  return slices;
}

async function slicesForAttachment(
  item: Zotero.Item,
  sink?: MatchProgressSink,
): Promise<Slice[]> {
  const path = await item.getFilePathAsync();
  if (!path) {
    return [];
  }
  if (isPdf(item)) {
    return pdfSlices(item.id, await IOUtils.read(path), sink);
  }
  if (isEpub(item)) {
    return epubSlices(item.id, path, sink);
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
  sink?: MatchProgressSink,
): Promise<Slice[]> {
  const pdfjs = await loadPdfjs();
  if (!pdfjs) {
    return [];
  }
  sink?.({ activity: "wizard-matching-opening", ratio: 0 });
  const doc = await openPdfDocument(pdfjs, bytes);
  const labels = (await readPdfPageLabels(bytes, doc.numPages)) || [];
  const slices: Slice[] = [];
  const clock = { at: Date.now() };
  for (let page = 1; page <= doc.numPages; page++) {
    sink?.({
      activity: "wizard-matching-reading-pdf",
      args: { page, pages: doc.numPages },
      ratio: page / doc.numPages,
    });
    await yieldIfDue(clock);
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

/**
 * pdf.js can parse off the main thread when its worker script loads.
 * A packed Zotero build sometimes rejects that worker; the same bytes then
 * open on the main thread.
 */
async function openPdfDocument(
  pdfjs: PdfjsModule,
  bytes: Uint8Array,
): Promise<PdfjsDocument> {
  let doc: PdfjsDocument | null = null;
  try {
    doc = await pdfjs.getDocument({
      data: bytes.slice(),
      disableWorker: false,
    }).promise;
    if (doc.numPages > 0) {
      await doc.getPage(1);
    }
    return doc;
  } catch {
    try {
      await doc?.destroy?.();
    } catch {
      // The worker document is unusable; the main-thread open replaces it.
    }
    return pdfjs.getDocument({ data: bytes, disableWorker: true }).promise;
  }
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
  sink?: MatchProgressSink,
): Promise<Slice[]> {
  useMainWindowRealm();
  sink?.({ activity: "wizard-matching-opening", ratio: 0 });
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
    const itemrefs = named(opf, "itemref");
    const clock = { at: Date.now() };
    for (let index = 0; index < itemrefs.length; index++) {
      const itemref = itemrefs[index];
      sink?.({
        activity: "wizard-matching-reading-epub",
        args: { section: index + 1, sections: itemrefs.length },
        ratio: (index + 1) / itemrefs.length,
      });
      await yieldIfDue(clock);
      const idref = itemref.getAttribute("idref") || "";
      const href = manifest.get(idref);
      const spineIndex = index;
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
  sink?: MatchProgressSink,
): Promise<MatchOutcome> {
  sink?.({ activity: "wizard-matching-opening", ratio: 0 });
  let sawReading = false;
  const slices = await attachmentSlices(book, (progress) => {
    if (
      progress.activity === "wizard-matching-reading-pdf" ||
      progress.activity === "wizard-matching-reading-epub"
    ) {
      sawReading = true;
    }
    sink?.(progress);
  });
  const needle = normalizePassage(quote);
  const before = context?.before || "";
  const after = context?.after || "";
  const candidates: { hit: PassageHit; slice: Slice; score: number }[] = [];
  const searchFrom = sawReading ? READ_END : 0;
  const span = slices.length ? (SEARCH_END - searchFrom) / slices.length : 0;
  if (slices.length) {
    sink?.({
      activity: "wizard-matching-searching",
      args: { label: slices[0].label, index: 1, count: slices.length },
      ratio: searchFrom,
    });
    await breathe();
  }
  const grouped = locateOnIndex(indexFor(slices), needle, 5);
  const clock = { at: Date.now() };
  for (let index = 0; index < slices.length; index++) {
    const hits = grouped[index];
    if (!hits?.length) {
      continue;
    }
    await yieldIfDue(clock);
    const slice = slices[index];
    sink?.({
      activity: "wizard-matching-searching",
      args: {
        label: slice.label,
        index: index + 1,
        count: slices.length,
      },
      ratio: searchFrom + span * (index + 1),
    });
    for (const hit of hits) {
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
  sink?.({ activity: "wizard-matching-checking", ratio: 0.98 });
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
