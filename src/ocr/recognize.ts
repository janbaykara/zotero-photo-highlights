import { config } from "../../package.json";
import { clusterTesseractWords, keepOcrWord } from "./boxes";
import { recordOcrDebug } from "./debugLog";
import { recognizeNative, type NativeRecognition } from "./native";
import { recognizePaddle } from "./paddle/engine";
import type { OcrEngine, OcrWord } from "../photo/types";

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

type WorkerCtor = { new (url: string): Worker };

function chromeWorkerCtor(win: Window): WorkerCtor | null {
  const host = win as Window & { ChromeWorker?: WorkerCtor };
  if (host.ChromeWorker) {
    return host.ChromeWorker;
  }
  const globalCtor = (globalThis as { ChromeWorker?: WorkerCtor }).ChromeWorker;
  return globalCtor ?? null;
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
  image: { url: string; path: string; width: number; height: number },
  lang: string,
  win: Window,
  choice?: OcrEngine | null,
): Promise<{ words: OcrWord[]; engine: OcrEngine }> {
  return recognizeWithFallback(
    {
      native: () =>
        recognizeNative({
          path: image.path,
          lang,
          width: image.width,
          height: image.height,
        }),
      paddle: () =>
        recognizePaddle(
          { url: image.url, width: image.width, height: image.height },
          lang,
          win,
        ),
      tesseract: async () => {
        const langPath = await ensureOcrLanguage(lang, win);
        return recognizeOnce(image.url, lang, langPath, win);
      },
    },
    choice,
  );
}

export async function recognizeWithFallback(
  steps: {
    native: () => Promise<NativeRecognition>;
    paddle: () => Promise<OcrWord[]>;
    tesseract: () => Promise<OcrWord[]>;
  },
  engine?: OcrEngine | null,
): Promise<{ words: OcrWord[]; engine: OcrEngine }> {
  if (engine === "vision" || engine === "windows") {
    const native = await steps.native();
    if (native.outcome === "ready" && native.engine === engine) {
      log("OCR engine", native.engine);
      return { words: native.words, engine: native.engine };
    }
    const reason = native.outcome === "fallback" ? native.reason : "unexpected";
    log("OCR engine failed", { engine, reason });
    throw new Error(`OCR engine ${engine} did not read the photo (${reason})`);
  }
  if (engine === "paddle") {
    const words = await steps.paddle();
    log("OCR engine", "paddle");
    return { words, engine: "paddle" };
  }
  if (engine === "tesseract") {
    log("OCR engine", "tesseract");
    return { words: await steps.tesseract(), engine: "tesseract" };
  }
  const native = await steps.native();
  if (native.outcome === "ready") {
    log("OCR engine", native.engine);
    return { words: native.words, engine: native.engine };
  }
  log("OCR engine", { engine: "paddle", reason: native.reason });
  try {
    const words = await steps.paddle();
    if (words.length) {
      log("OCR engine", "paddle");
      return { words, engine: "paddle" };
    }
    log("OCR engine", { engine: "tesseract", reason: "no-text" });
  } catch (error) {
    log("OCR engine", { engine: "tesseract", reason: "paddle-failed", error });
  }
  return { words: await steps.tesseract(), engine: "tesseract" };
}

function log(...args: unknown[]) {
  recordOcrDebug(...args);
}

async function recognizeOnce(
  imageUrl: string,
  lang: string,
  langPath: string,
  win: Window,
): Promise<OcrWord[]> {
  const api = loadTesseract(win);
  // A blob URL does not end in ".js", so Tesseract treats it as a directory
  // and importScripts() asks for a core file that was never created. A
  // ChromeWorker can load the real chrome scripts from a packed add-on.
  const host = win as Window & { Worker: WorkerCtor };
  const chromeWorker = chromeWorkerCtor(win);
  const previous = host.Worker;
  if (chromeWorker) {
    host.Worker = chromeWorker;
  }
  let created: Promise<TesseractWorker>;
  try {
    created = api.createWorker(lang, 1, {
      workerPath: ocrChrome("worker.min.js"),
      corePath: ocrChrome("tesseract-core.wasm.js"),
      langPath,
      workerBlobURL: false,
      cacheMethod: "none",
      gzip: false,
    });
  } finally {
    host.Worker = previous;
  }
  const worker = await created;
  try {
    await worker.setParameters({ tessedit_pageseg_mode: "3" });
    const result = await worker.recognize(imageUrl);
    const words = (result.data?.words || [])
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
    return clusterTesseractWords(words);
  } finally {
    await worker.terminate().catch(() => undefined);
  }
}
