import { config } from "../../package.json";
import { clusterTesseractWords, keepOcrWord } from "./boxes";
import { recognizeNative } from "./native";
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

const scriptBlobs = new Map<string, Promise<string>>();

function engineBlob(win: Window, name: string): Promise<string> {
  let pending = scriptBlobs.get(name);
  if (!pending) {
    pending = fetchEngineBlob(win, name);
    scriptBlobs.set(name, pending);
    pending.catch(() => {
      if (scriptBlobs.get(name) === pending) {
        scriptBlobs.delete(name);
      }
    });
  }
  return pending;
}

// A DOM Worker cannot importScripts a chrome URL inside a packed XPI.
// Hand it blob URLs of the script bytes instead.
async function fetchEngineBlob(win: Window, name: string): Promise<string> {
  const response = await win.fetch(ocrChrome(name));
  if (!response.ok) {
    throw new Error(`${name} missing (${response.status})`);
  }
  const blob = new win.Blob([await response.arrayBuffer()], {
    type: "text/javascript",
  });
  return win.URL.createObjectURL(blob);
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
): Promise<{ words: OcrWord[]; engine: OcrEngine }> {
  const native = await recognizeNative({
    path: image.path,
    lang,
    width: image.width,
    height: image.height,
  });
  if (native.outcome === "ready") {
    ztoolkit.log("OCR engine", native.engine);
    return { words: native.words, engine: native.engine };
  }
  ztoolkit.log("OCR engine", { engine: "tesseract", reason: native.reason });
  const langPath = await ensureOcrLanguage(lang, win);
  const errors: unknown[] = [];
  const attempts: Array<{
    workerPath: string;
    corePath: string;
    workerBlobURL: boolean;
  }> = [];
  try {
    attempts.push({
      workerPath: await engineBlob(win, "worker.min.js"),
      corePath: await engineBlob(win, "tesseract-core.wasm.js"),
      workerBlobURL: false,
    });
  } catch (error) {
    errors.push(error);
    ztoolkit.log("OCR scripts unavailable", error);
  }
  const chromeWorker = ocrChrome("worker.min.js");
  const chromeCore = ocrChrome("tesseract-core.wasm.js");
  attempts.push(
    {
      workerPath: chromeWorker,
      corePath: chromeCore,
      workerBlobURL: false,
    },
    {
      workerPath: chromeWorker,
      corePath: chromeCore,
      workerBlobURL: true,
    },
  );
  for (const attempt of attempts) {
    try {
      return {
        words: await recognizeOnce(image.url, lang, langPath, win, attempt),
        engine: "tesseract",
      };
    } catch (error) {
      errors.push(error);
      ztoolkit.log("OCR attempt failed", { ...attempt, error });
    }
  }
  throw errors[errors.length - 1] || new Error("OCR failed");
}

async function recognizeOnce(
  imageUrl: string,
  lang: string,
  langPath: string,
  win: Window,
  scripts: { workerPath: string; corePath: string; workerBlobURL: boolean },
): Promise<OcrWord[]> {
  const api = loadTesseract(win);
  const worker = await api.createWorker(lang, 1, {
    workerPath: scripts.workerPath,
    corePath: scripts.corePath,
    langPath,
    workerBlobURL: scripts.workerBlobURL,
    cacheMethod: "none",
    gzip: false,
  });
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
