const RAPID =
  "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0";

export type PaddleSplit = "space" | "char";

export type PaddleRecModel = {
  id: string;
  file: string;
  url: string;
  sha256: string;
  dictFile: string;
  dictUrl: string;
  split: PaddleSplit;
};

export const PADDLE_DET = {
  file: "multi_PP-OCRv3_det_mobile.onnx",
  url: `${RAPID}/onnx/PP-OCRv4/det/multi_PP-OCRv3_det_mobile.onnx`,
  sha256: "5582933662898cd2b4c2eae8a7e5e4fbdff84773711f29db00a1cbd185059001",
};

const REC: Record<string, PaddleRecModel> = {
  en: rec(
    "en_PP-OCRv4_rec_mobile",
    "e8770c967605983d1570cdf5352041dfb68fa0c21664f49f47b155abd3e0e318",
    "en_dict.txt",
    "space",
  ),
  latin: rec(
    "latin_PP-OCRv3_rec_mobile",
    "e9d7a33667e8aaa702862975186adf2012e3f390cc0f9422865957125f8071cf",
    "latin_dict.txt",
    "space",
  ),
  cyrillic: rec(
    "cyrillic_PP-OCRv3_rec_mobile",
    "1efb65bdc460af1c0e8733d005b20952b17ca5aac10ddb56c968333791c5eaa3",
    "cyrillic_dict.txt",
    "space",
  ),
  arabic: rec(
    "arabic_PP-OCRv4_rec_mobile",
    "4a9011bef71687bb84288dc86ad2471bd5d37b717ddf672dd156f9e7a5601bac",
    "arabic_dict.txt",
    "space",
  ),
  ch: rec(
    "ch_PP-OCRv4_rec_mobile",
    "48fc40f24f6d2a207a2b1091d3437eb3cc3eb6b676dc3ef9c37384005483683b",
    "ppocr_keys_v1.txt",
    "char",
  ),
  cht: rec(
    "chinese_cht_PP-OCRv3_rec_mobile",
    "779656d044ce388045e02ea9244724616194e63928606436cdfc6dc3c9528cc6",
    "chinese_cht_dict.txt",
    "char",
  ),
  japan: rec(
    "japan_PP-OCRv4_rec_mobile",
    "e1075a67dba758ecfc7ebc78a10ae61c95ac8fb66a9c86fab5541e33f085cb7a",
    "japan_dict.txt",
    "char",
  ),
  korean: rec(
    "korean_PP-OCRv4_rec_mobile",
    "ab151ba9065eccd98f884cf4d927db091be86137276392072edd4f9d43ad7426",
    "korean_dict.txt",
    "char",
  ),
};

const LANGUAGE_GROUP: Record<string, keyof typeof REC> = {
  eng: "en",
  deu: "latin",
  fra: "latin",
  spa: "latin",
  ita: "latin",
  por: "latin",
  nld: "latin",
  pol: "latin",
  tur: "latin",
  vie: "latin",
  rus: "cyrillic",
  ukr: "cyrillic",
  ara: "arabic",
  chi_sim: "ch",
  chi_tra: "cht",
  jpn: "japan",
  kor: "korean",
};

export function paddleModelForLanguage(lang: string): PaddleRecModel | null {
  const group = LANGUAGE_GROUP[lang];
  return group ? REC[group] : null;
}

export type PaddleFiles = {
  model: PaddleRecModel;
  det: Uint8Array;
  rec: Uint8Array;
  dict: string[];
};

const inflight = new Map<string, Promise<Uint8Array>>();

export async function ensurePaddleFiles(
  lang: string,
  win: Window,
): Promise<PaddleFiles | null> {
  const model = paddleModelForLanguage(lang);
  if (!model) {
    return null;
  }
  const [det, rec, dictBytes] = await Promise.all([
    cachedFile(win, PADDLE_DET.file, PADDLE_DET.url, PADDLE_DET.sha256),
    cachedFile(win, model.file, model.url, model.sha256),
    cachedFile(win, model.dictFile, model.dictUrl, null),
  ]);
  return { model, det, rec, dict: dictLines(dictBytes) };
}

export function dictLines(bytes: Uint8Array): string[] {
  const text = new TextDecoder().decode(bytes).replace(/^\uFEFF/, "");
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function rec(
  id: string,
  sha256: string,
  dictFile: string,
  split: PaddleSplit,
): PaddleRecModel {
  return {
    id,
    file: `${id}.onnx`,
    url: `${RAPID}/onnx/PP-OCRv4/rec/${id}.onnx`,
    sha256,
    dictFile,
    dictUrl: `${RAPID}/paddle/PP-OCRv4/rec/${id}/${dictFile}`,
    split,
  };
}

function paddleDir(): string {
  const profile = (Zotero as { Profile?: { dir?: string } }).Profile?.dir;
  const root = profile || Zotero.getProfileDirectory().path;
  return PathUtils.join(root, "photo-highlights-paddle");
}

async function cachedFile(
  win: Window,
  name: string,
  url: string,
  sha256: string | null,
): Promise<Uint8Array> {
  const dir = paddleDir();
  await IOUtils.makeDirectory(dir, {
    createAncestors: true,
    ignoreExisting: true,
  });
  const dest = PathUtils.join(dir, name);
  if (await IOUtils.exists(dest)) {
    const stored = new Uint8Array(await IOUtils.read(dest));
    if (!sha256 || (await sha256Hex(win, stored)) === sha256) {
      return stored;
    }
    await IOUtils.remove(dest);
  }
  const pending = inflight.get(dest);
  if (pending) {
    return pending;
  }
  const created = download(win, dest, url, sha256);
  inflight.set(dest, created);
  try {
    return await created;
  } catch (error) {
    inflight.delete(dest);
    throw error;
  }
}

async function download(
  win: Window,
  dest: string,
  url: string,
  sha256: string | null,
): Promise<Uint8Array> {
  const response = await win.fetch(url);
  if (!response.ok) {
    throw new Error(`Paddle model download failed (${response.status})`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (sha256 && (await sha256Hex(win, bytes)) !== sha256) {
    throw new Error("Paddle model hash mismatch");
  }
  if (!sha256 && bytes.byteLength < 16) {
    throw new Error("Paddle dictionary download was empty");
  }
  await IOUtils.write(dest, bytes);
  return bytes;
}

async function sha256Hex(win: Window, bytes: Uint8Array): Promise<string> {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const digest = await win.crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
