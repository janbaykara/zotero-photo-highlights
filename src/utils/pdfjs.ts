const PDFJS_CANDIDATES = [
  "resource://zotero/reader/pdf/build/pdf.mjs",
  "resource://zotero/reader/pdfjs/build/pdf.mjs",
  "resource://zotero/reader/pdf/pdf.mjs",
];

const PDFJS_WORKER_CANDIDATES = [
  "resource://zotero/reader/pdf/build/pdf.worker.mjs",
  "resource://zotero/reader/pdfjs/build/pdf.worker.mjs",
  "resource://zotero/reader/pdf/pdf.worker.mjs",
];

export type PdfjsModule = {
  getDocument: (src: Record<string, unknown>) => {
    promise: Promise<PdfjsDocument>;
  };
  GlobalWorkerOptions?: { workerSrc: string };
};

export type PdfjsDocument = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfjsPage>;
  destroy?: () => Promise<void>;
};

export type PdfjsPage = {
  getTextContent: () => Promise<{ items: PdfjsTextItem[] }>;
  getViewport: (params: { scale: number }) => { height: number };
};

export type PdfjsTextItem = {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
};

let pdfjsModule: PdfjsModule | null | undefined;
let pdfjsLoad: Promise<PdfjsModule | null> | null = null;

export function loadPdfjs(): Promise<PdfjsModule | null> {
  if (pdfjsModule !== undefined) {
    return Promise.resolve(pdfjsModule);
  }
  if (!pdfjsLoad) {
    pdfjsLoad = importPdfjs();
  }
  return pdfjsLoad;
}

async function importPdfjs(): Promise<PdfjsModule | null> {
  const win = Zotero.getMainWindow() as Window & {
    ChromeUtils?: typeof ChromeUtils;
  };
  const loader = win?.ChromeUtils || ChromeUtils;
  if (!loader?.importESModule) {
    pdfjsModule = null;
    return null;
  }
  for (const path of PDFJS_CANDIDATES) {
    try {
      const imported = loader.importESModule(path, { global: "current" });
      const mod = unwrapPdfjs(imported);
      if (!mod?.getDocument) {
        continue;
      }
      if (mod.GlobalWorkerOptions) {
        for (const workerSrc of PDFJS_WORKER_CANDIDATES) {
          try {
            mod.GlobalWorkerOptions.workerSrc = workerSrc;
            break;
          } catch {
            continue;
          }
        }
      }
      pdfjsModule = mod;
      return mod;
    } catch {
      continue;
    }
  }
  ztoolkit.log("Could not import Zotero PDF.js");
  pdfjsModule = null;
  return null;
}

function unwrapPdfjs(mod: Record<string, unknown>): PdfjsModule | null {
  if (typeof mod.getDocument === "function") {
    return mod as PdfjsModule;
  }
  const nested = mod.default;
  if (
    nested &&
    typeof nested === "object" &&
    typeof (nested as PdfjsModule).getDocument === "function"
  ) {
    return nested as PdfjsModule;
  }
  return null;
}
