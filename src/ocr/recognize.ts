import { config } from "../../package.json";
import type { OcrWord } from "../photo/types";

type TesseractWord = {
  text?: string;
  confidence?: number;
  bbox?: { x0: number; y0: number; x1: number; y1: number };
};

type TesseractWorker = {
  recognize: (image: string) => Promise<{ data?: { words?: TesseractWord[] } }>;
  setParameters: (params: Record<string, string>) => Promise<void>;
  terminate: () => Promise<void>;
};

type TesseractApi = {
  createWorker: (
    lang: string,
    oem: number,
    options: Record<string, unknown>,
  ) => Promise<TesseractWorker>;
};

const TESSDATA_BEST = "https://github.com/tesseract-ocr/tessdata_best/raw/main";

function ocrChrome(name: string): string {
  return `chrome://${config.addonRef}/content/ocr/${name}`;
}

function tessdataDir(): string {
  const profile = (Zotero as { Profile?: { dir?: string } }).Profile?.dir;
  const root = profile || Zotero.getProfileDirectory().path;
  return PathUtils.join(root, "photo-highlights-tessdata-best");
}

export async function ensureOcrLanguage(
  lang: string,
  win: Window,
): Promise<string> {
  const dir = tessdataDir();
  await IOUtils.makeDirectory(dir, {
    createAncestors: true,
    ignoreExisting: true,
  });
  const dest = PathUtils.join(dir, `${lang}.traineddata`);
  if (!(await IOUtils.exists(dest))) {
    const bytes = await readLanguageBytes(lang, win);
    await IOUtils.write(dest, bytes);
  }
  const file = Zotero.File.pathToFile(dir);
  let spec = Services.io.newFileURI(file).spec;
  if (!spec.endsWith("/")) {
    spec += "/";
  }
  return spec;
}

async function readLanguageBytes(
  lang: string,
  win: Window,
): Promise<Uint8Array> {
  if (lang === "eng") {
    const response = await win.fetch(ocrChrome("eng.traineddata"));
    if (!response.ok) {
      throw new Error(`English OCR data missing (${response.status})`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }
  const response = await win.fetch(
    `${TESSDATA_BEST}/${encodeURIComponent(lang)}.traineddata`,
  );
  if (!response.ok) {
    throw new Error(
      `OCR language ${lang} download failed (${response.status})`,
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}

function loadTesseract(win: Window): TesseractApi {
  const host = win as Window & { Tesseract?: TesseractApi };
  if (host.Tesseract?.createWorker) {
    return host.Tesseract;
  }
  Services.scriptloader.loadSubScript(ocrChrome("tesseract.min.js"), win);
  if (!host.Tesseract?.createWorker) {
    throw new Error("Tesseract did not load");
  }
  return host.Tesseract;
}

export async function recognizeImage(
  imageUrl: string,
  lang: string,
  win: Window,
): Promise<OcrWord[]> {
  const langPath = await ensureOcrLanguage(lang, win);
  const errors: unknown[] = [];
  for (const workerBlobURL of [false, true]) {
    try {
      return await recognizeOnce(imageUrl, lang, langPath, win, workerBlobURL);
    } catch (error) {
      errors.push(error);
      ztoolkit.log("OCR attempt failed", { workerBlobURL, error });
    }
  }
  throw errors[errors.length - 1] || new Error("OCR failed");
}

function keepOcrWord(text: string, confidence?: number): boolean {
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

async function recognizeOnce(
  imageUrl: string,
  lang: string,
  langPath: string,
  win: Window,
  workerBlobURL: boolean,
): Promise<OcrWord[]> {
  const api = loadTesseract(win);
  const worker = await api.createWorker(lang, 1, {
    workerPath: ocrChrome("worker.min.js"),
    corePath: ocrChrome("tesseract-core.wasm.js"),
    langPath,
    workerBlobURL,
    cacheMethod: "none",
    gzip: false,
  });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: "3" });
    const result = await worker.recognize(imageUrl);
    return (result.data?.words || [])
      .map((word) => ({
        text: String(word.text || "").trim(),
        confidence: word.confidence,
        x0: word.bbox?.x0 ?? 0,
        y0: word.bbox?.y0 ?? 0,
        x1: word.bbox?.x1 ?? 0,
        y1: word.bbox?.y1 ?? 0,
      }))
      .filter((word) => keepOcrWord(word.text, word.confidence))
      .map(({ text, x0, y0, x1, y1 }) => ({ text, x0, y0, x1, y1 }));
  } finally {
    await worker.terminate().catch(() => undefined);
  }
}
