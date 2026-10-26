import { config } from "../../package.json";

/** The slice of OpenCV.js this plugin calls. The library itself is loaded at runtime. */
export type CvMat = {
  data: Uint8Array;
  delete: () => void;
};

export type CvMatVector = {
  get: (index: number) => CvMat;
  delete: () => void;
};

export type OpenCv = {
  CV_8UC1: number;
  CV_8UC4: number;
  COLOR_RGBA2RGB: number;
  COLOR_RGB2HSV: number;
  MORPH_RECT: number;
  MORPH_CLOSE: number;
  MORPH_OPEN: number;
  THRESH_BINARY: number;
  Mat: {
    new (): CvMat;
    new (rows: number, cols: number, type: number): CvMat;
  };
  matFromArray: (
    rows: number,
    cols: number,
    type: number,
    data: Uint8Array,
  ) => CvMat;
  MatVector: new () => CvMatVector;
  Size: new (width: number, height: number) => object;
  cvtColor: (src: CvMat, dst: CvMat, code: number) => void;
  split: (src: CvMat, channels: CvMatVector) => void;
  threshold: (
    src: CvMat,
    dst: CvMat,
    thresh: number,
    maxval: number,
    type: number,
  ) => void;
  bitwise_and: (src1: CvMat, src2: CvMat, dst: CvMat) => void;
  getStructuringElement: (shape: number, size: object) => CvMat;
  morphologyEx: (src: CvMat, dst: CvMat, op: number, kernel: CvMat) => void;
};

const loaded = new WeakMap<Window, Promise<OpenCv | null>>();

/**
 * Load OpenCV.js into this window the first time a photo is scanned.
 * The script is a chrome asset copied from `@techstark/opencv-js` at build
 * time, not part of the plugin bundle. A failure leaves pen underlines working.
 */
export function loadOpenCv(win: Window): Promise<OpenCv | null> {
  const existing = loaded.get(win);
  if (existing) {
    return existing;
  }
  const created = start(win).then((cv) => {
    if (!cv) {
      loaded.delete(win);
    }
    return cv;
  });
  loaded.set(win, created);
  return created;
}

async function start(win: Window): Promise<OpenCv | null> {
  const host = win as Window & { cv?: OpenCv | Promise<OpenCv> };
  const sandbox = globalThis as { cv?: OpenCv | Promise<OpenCv> };
  try {
    const url = `chrome://${config.addonRef}/content/opencv/opencv.js`;
    const previousDefine = (win as Window & { define?: unknown }).define;
    (win as Window & { define?: unknown }).define = undefined;
    try {
      Services.scriptloader.loadSubScript(url, win);
    } finally {
      if (previousDefine === undefined) {
        delete (win as Window & { define?: unknown }).define;
      } else {
        (win as Window & { define?: unknown }).define = previousDefine;
      }
    }
    const created = host.cv ?? sandbox.cv;
    if (!created) {
      ztoolkit.log("OpenCV did not load");
      return null;
    }
    const cv =
      typeof (created as Promise<OpenCv>).then === "function"
        ? await created
        : created;
    if (!isOpenCv(cv)) {
      ztoolkit.log("OpenCV did not initialize");
      return null;
    }
    return cv;
  } catch (error) {
    ztoolkit.log("OpenCV failed to load", error);
    return null;
  }
}

function isOpenCv(value: unknown): value is OpenCv {
  if (!value || typeof value !== "object") {
    return false;
  }
  const cv = value as Partial<OpenCv>;
  return (
    typeof cv.cvtColor === "function" && typeof cv.morphologyEx === "function"
  );
}
