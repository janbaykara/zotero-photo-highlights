export type OcrWord = {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Reading-order line from the recognizer, or from clustering Tesseract words. */
  line: number;
};

export type OcrState = "pending" | "running" | "done" | "error";

export type OcrEngine = "vision" | "windows" | "tesseract";

export type Passage = {
  id: string;
  quote: string;
  /** Word indexes chosen by dragging on the photo, in reading order. */
  selected: number[];
  comment: string;
  color: string;
  /** Already saved. Hidden on the mark step and not searched again. */
  committed?: boolean;
};

export type PhotoDraft = {
  id: string;
  name: string;
  /** Capture time from EXIF, or the file time when EXIF has none. */
  takenAt: number | null;
  sourcePath: string;
  /** EXIF-upright master plus the user's extra quarter-turns, when those are not zero. */
  turnedPath: string | null;
  /** Extra clockwise quarter-turns after the camera orientation. */
  turns: number;
  /** Bumps whenever the orientation to recognize changes, so a stale OCR result is ignored. */
  orientToken: number;
  scaledPath: string;
  ocr: OcrState;
  /** Set when recognition finishes. Cleared while a new pass is running. */
  ocrEngine: OcrEngine | null;
  words: OcrWord[];
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  passages: Passage[];
  bookId: number | null;
  bookTitle: string;
  kept: boolean;
  /** Left out on the mark step. Not matched and not imported. */
  skipped?: boolean;
};

export const OCR_LANGUAGES: { code: string; key: string }[] = [
  { code: "eng", key: "ocr-lang-eng" },
  { code: "deu", key: "ocr-lang-deu" },
  { code: "fra", key: "ocr-lang-fra" },
  { code: "spa", key: "ocr-lang-spa" },
  { code: "ita", key: "ocr-lang-ita" },
  { code: "por", key: "ocr-lang-por" },
  { code: "nld", key: "ocr-lang-nld" },
  { code: "pol", key: "ocr-lang-pol" },
  { code: "rus", key: "ocr-lang-rus" },
  { code: "ukr", key: "ocr-lang-ukr" },
  { code: "tur", key: "ocr-lang-tur" },
  { code: "ara", key: "ocr-lang-ara" },
  { code: "heb", key: "ocr-lang-heb" },
  { code: "chi_sim", key: "ocr-lang-chi-sim" },
  { code: "chi_tra", key: "ocr-lang-chi-tra" },
  { code: "jpn", key: "ocr-lang-jpn" },
  { code: "kor", key: "ocr-lang-kor" },
  { code: "vie", key: "ocr-lang-vie" },
];
