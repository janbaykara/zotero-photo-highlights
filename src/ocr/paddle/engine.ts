import { config } from "../../../package.json";
import { readImagePixels } from "../../photo/files";
import type { OcrWord } from "../../photo/types";
import { characterTable, wordsFromCtc } from "./ctc";
import {
  assignLines,
  cropSize,
  detSize,
  detTensor,
  quadsFromScoreMap,
  recMatrix,
  recTensor,
  resizeRgba,
  rotateCrop,
  scaleQuad,
  scoreMapSize,
  shouldRotateCrop,
  warpQuad,
  wordsOnQuad,
  type Raster,
} from "./geometry";
import {
  ensurePaddleFiles,
  paddleModelForLanguage,
  type PaddleSplit,
} from "./models";

const TIMEOUT_MS = 60_000;
const REC_HEIGHT = 48;
const FIXED_REC_WIDTH = 320;

type OrtTensor = { data: ArrayLike<number>; dims: readonly number[] };

type OrtSession = {
  inputNames: readonly string[];
  outputNames: readonly string[];
  run: (feeds: Record<string, unknown>) => Promise<Record<string, OrtTensor>>;
  release?: () => Promise<void>;
};

type OrtApi = {
  env: {
    wasm: {
      wasmPaths?: string;
      numThreads?: number;
      simd?: boolean;
      proxy?: boolean;
    };
  };
  InferenceSession: {
    create: (
      data: Uint8Array,
      options?: { executionProviders?: string[] },
    ) => Promise<OrtSession>;
  };
  Tensor: new (type: "float32", data: Float32Array, dims: number[]) => unknown;
};

type Held = {
  det: OrtSession | null;
  rec: OrtSession | null;
  recId: string | null;
  dict: string[] | null;
  split: PaddleSplit;
  fixedWidth: number | null;
};

const sessions = new WeakMap<Window, Held>();
const tails = new WeakMap<Window, Promise<void>>();

export async function recognizePaddle(
  image: { url: string; width: number; height: number },
  lang: string,
  win: Window,
): Promise<OcrWord[]> {
  return withTimeout(
    win,
    enqueue(win, () => runPaddle(image, lang, win)),
    TIMEOUT_MS,
  );
}

async function runPaddle(
  image: { url: string; width: number; height: number },
  lang: string,
  win: Window,
): Promise<OcrWord[]> {
  const model = paddleModelForLanguage(lang);
  if (!model) return [];
  const pixels = await readImagePixels(
    win,
    image.url,
    image.width,
    image.height,
  );
  if (!pixels) return [];
  const ort = loadOrt(win);
  const existing = sessions.get(win);
  let held: Held;
  if (existing?.det && existing.rec && existing.recId === model.id) {
    held = existing;
  } else {
    const files = await ensurePaddleFiles(lang, win);
    if (!files) return [];
    held = await hold(win, ort, files);
  }
  const sized = detSize(pixels.width, pixels.height);
  const resized = resizeRgba(
    pixels.data,
    pixels.width,
    pixels.height,
    sized.width,
    sized.height,
  );
  const detected = await runSession(
    win,
    held.det as OrtSession,
    ort,
    detTensor(resized, sized.width, sized.height),
    [1, 3, sized.height, sized.width],
  );
  const map = scoreMapSize(detected.dims);
  if (!map) throw new Error("Paddle detector returned an unexpected shape");
  const quads = quadsFromScoreMap(
    floatData(detected),
    map.width,
    map.height,
  ).map((quad) =>
    scaleQuad(quad, map.width, map.height, pixels.width, pixels.height),
  );
  const words: OcrWord[] = [];
  for (const line of assignLines(quads)) {
    const crop = warpQuad(pixels, line.quad);
    if (!crop) continue;
    const size = cropSize(line.quad);
    const rotated = shouldRotateCrop(size.width, size.height);
    const view = rotated ? rotateCrop(crop) : crop;
    const recognized = await recognizeCrop(win, held, ort, view);
    const table = characterTable(held.dict || [], recognized.classes);
    if (!table) {
      throw new Error("Paddle dictionary does not match the recognition model");
    }
    const pieces = wordsFromCtc({
      data: recognized.data,
      time: recognized.time,
      classes: recognized.classes,
      characters: table,
      split: held.split,
      cropWidth: view.width,
      tensorWidth: recognized.tensorWidth,
      contentWidth: recognized.contentWidth,
    });
    words.push(
      ...wordsOnQuad({
        quad: line.quad,
        cropWidth: size.width,
        cropHeight: size.height,
        rotated,
        words: pieces,
        line: line.line,
        imageWidth: pixels.width,
        imageHeight: pixels.height,
      }),
    );
    await new Promise((resolve) => win.setTimeout(resolve, 0));
  }
  return words;
}

async function recognizeCrop(
  win: Window,
  held: Held,
  ort: OrtApi,
  view: Raster,
): Promise<{
  data: Float32Array;
  time: number;
  classes: number;
  tensorWidth: number;
  contentWidth: number;
}> {
  const first = recTensor(
    view.data,
    view.width,
    view.height,
    REC_HEIGHT,
    held.fixedWidth ?? undefined,
  );
  try {
    const output = await runSession(
      win,
      held.rec as OrtSession,
      ort,
      first.data,
      [1, 3, REC_HEIGHT, first.width],
    );
    return decoded(output, first.width, first.contentWidth);
  } catch (error) {
    if (held.fixedWidth) throw error;
    const fixed = recTensor(
      view.data,
      view.width,
      view.height,
      REC_HEIGHT,
      FIXED_REC_WIDTH,
    );
    const output = await runSession(
      win,
      held.rec as OrtSession,
      ort,
      fixed.data,
      [1, 3, REC_HEIGHT, FIXED_REC_WIDTH],
    );
    held.fixedWidth = FIXED_REC_WIDTH;
    return decoded(output, fixed.width, fixed.contentWidth);
  }
}

function decoded(
  output: OrtTensor,
  tensorWidth: number,
  contentWidth: number,
): {
  data: Float32Array;
  time: number;
  classes: number;
  tensorWidth: number;
  contentWidth: number;
} {
  const matrix = recMatrix(output.dims);
  if (!matrix)
    throw new Error("Paddle recognizer returned an unexpected shape");
  return {
    data: floatData(output),
    time: matrix.time,
    classes: matrix.classes,
    tensorWidth,
    contentWidth,
  };
}

async function hold(
  win: Window,
  ort: OrtApi,
  files: {
    model: { id: string; split: PaddleSplit };
    det: Uint8Array;
    rec: Uint8Array;
    dict: string[];
  },
): Promise<Held> {
  let held = sessions.get(win);
  if (!held) {
    held = {
      det: null,
      rec: null,
      recId: null,
      dict: null,
      split: files.model.split,
      fixedWidth: null,
    };
    sessions.set(win, held);
  }
  if (!held.det) {
    held.det = await createSession(win, ort, files.det);
  }
  if (held.recId !== files.model.id) {
    await held.rec?.release?.();
    held.rec = await createSession(win, ort, files.rec);
    held.recId = files.model.id;
    held.dict = files.dict;
    held.split = files.model.split;
    held.fixedWidth = null;
  }
  return held;
}

function createSession(
  win: Window,
  ort: OrtApi,
  model: Uint8Array,
): Promise<OrtSession> {
  // ORT was loaded into the wizard window, so its `instanceof Uint8Array`
  // check does not see a typed array created in the plugin sandbox.
  return ort.InferenceSession.create(new win.Uint8Array(model), {
    executionProviders: ["wasm"],
  });
}

async function runSession(
  win: Window,
  session: OrtSession,
  ort: OrtApi,
  data: Float32Array,
  dims: number[],
): Promise<OrtTensor> {
  const input = session.inputNames[0];
  const output = session.outputNames[0];
  const feeds = {
    [input]: new ort.Tensor("float32", new win.Float32Array(data), dims),
  };
  const result = await session.run(feeds);
  const tensor = result[output];
  if (!tensor?.data || !tensor.dims) {
    throw new Error("Paddle model returned no output");
  }
  return tensor;
}

function floatData(tensor: OrtTensor): Float32Array {
  if (tensor.data instanceof Float32Array) return tensor.data;
  return Float32Array.from(tensor.data);
}

function loadOrt(win: Window): OrtApi {
  const host = win as Window & { ort?: OrtApi };
  const sandbox = globalThis as { ort?: OrtApi };
  const existing = host.ort?.InferenceSession ? host.ort : sandbox.ort;
  if (existing?.InferenceSession) {
    configure(existing);
    return existing;
  }
  const scoped = win as Window & { define?: unknown };
  const previousDefine = scoped.define;
  scoped.define = undefined;
  try {
    Services.scriptloader.loadSubScript(chrome("ort/ort.wasm.min.js"), win);
  } finally {
    if (previousDefine === undefined) {
      delete scoped.define;
    } else {
      scoped.define = previousDefine;
    }
  }
  const loaded = host.ort?.InferenceSession ? host.ort : sandbox.ort;
  if (!loaded?.InferenceSession) {
    throw new Error("ONNX Runtime did not load");
  }
  configure(loaded);
  return loaded;
}

function configure(ort: OrtApi) {
  // One thread, SIMD. The threaded build needs SharedArrayBuffer, which this
  // dialog does not have, so the runtime must stay on ort-wasm-simd.wasm.
  ort.env.wasm.wasmPaths = chrome("ort/");
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.simd = true;
  ort.env.wasm.proxy = false;
}

function chrome(name: string): string {
  return `chrome://${config.addonRef}/content/ocr/${name}`;
}

function enqueue<T>(win: Window, fn: () => Promise<T>): Promise<T> {
  const previous = tails.get(win) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  tails.set(
    win,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

function withTimeout<T>(
  win: Window,
  promise: Promise<T>,
  ms: number,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = win.setTimeout(
      () => reject(new Error("PaddleOCR timed out")),
      ms,
    );
    promise.then(
      (value) => {
        win.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        win.clearTimeout(timer);
        reject(error);
      },
    );
  });
}
