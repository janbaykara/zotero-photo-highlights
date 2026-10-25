import { parse as readExif } from "exifr";

/**
 * Rewrites a session JPEG so its pixels are upright and the EXIF orientation
 * tag is gone. Runs before scaling and OCR. Firefox applies that tag while
 * decoding, so the stored pixel size is compared with the bitmap: the tag is
 * applied here only when the bitmap is still the raw camera image.
 */
export async function bakeExifOrientation(
  win: Window,
  path: string,
): Promise<void> {
  const bytes = await IOUtils.read(path);
  const orientation = await readOrientation(bytes);
  if (orientation === 1) {
    return;
  }
  const rawSize = jpegPixelSize(bytes);
  if (!rawSize) {
    return;
  }
  const stripped = stripJpegExif(bytes);
  const image = await loadJpeg(win, stripped ?? bytes);
  const decodedIsRaw =
    image.naturalWidth === rawSize.width &&
    image.naturalHeight === rawSize.height;
  const applied = decodedIsRaw ? orientation : 1;
  await writeCanvasJpeg(win, image, applied, path);
}

/** Clockwise quarter-turns from an already upright image, mapped to EXIF values. */
export function quarterTurnsToOrientation(clockwiseQuarters: number): number {
  const quarters = ((clockwiseQuarters % 4) + 4) % 4;
  return [1, 6, 3, 8][quarters];
}

/**
 * Writes `sourcePath` rotated by clockwise quarter-turns into `destPath`.
 * The source is the EXIF-upright image, so this does not read the camera tag.
 */
export async function writeQuarterTurns(
  win: Window,
  sourcePath: string,
  destPath: string,
  clockwiseQuarters: number,
): Promise<void> {
  const orientation = quarterTurnsToOrientation(clockwiseQuarters);
  if (orientation === 1) {
    return;
  }
  const bytes = await IOUtils.read(sourcePath);
  const image = await loadJpeg(win, bytes);
  await writeCanvasJpeg(win, image, orientation, destPath);
}

export function orientedSize(
  width: number,
  height: number,
  orientation: number,
): { width: number; height: number } {
  if (orientation >= 5 && orientation <= 8) {
    return { width: height, height: width };
  }
  return { width, height };
}

export function jpegPixelSize(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  let offset = 2;
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      return null;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xd9) {
      return null;
    }
    if (
      marker === 0x01 ||
      marker === 0xd8 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      offset += 2;
      continue;
    }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2 || offset + 2 + length > bytes.length) {
      return null;
    }
    const sof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (sof) {
      return {
        height: (bytes[offset + 5] << 8) | bytes[offset + 6],
        width: (bytes[offset + 7] << 8) | bytes[offset + 8],
      };
    }
    if (marker === 0xda) {
      return null;
    }
    offset += 2 + length;
  }
  return null;
}

/** Drops every APP1 segment so a decoder cannot apply the orientation tag. */
export function stripJpegExif(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let offset = 2;
  let removed = false;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      return null;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) {
      parts.push(bytes.subarray(offset));
      break;
    }
    if (
      marker === 0x01 ||
      marker === 0xd8 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      parts.push(bytes.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2 || offset + 2 + length > bytes.length) {
      return null;
    }
    const end = offset + 2 + length;
    if (marker === 0xe1) {
      removed = true;
    } else {
      parts.push(bytes.subarray(offset, end));
    }
    offset = end;
  }
  if (!removed) {
    return bytes;
  }
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

async function readOrientation(bytes: Uint8Array): Promise<number> {
  try {
    const tags = (await readExif(bytes, {
      pick: ["Orientation"],
      translateValues: false,
    })) as { Orientation?: unknown } | undefined;
    const value = Number(tags?.Orientation);
    if (value >= 2 && value <= 8) {
      return value;
    }
  } catch (error) {
    ztoolkit.log("Could not read photo orientation", error);
  }
  return 1;
}

async function writeCanvasJpeg(
  win: Window,
  image: HTMLImageElement,
  orientation: number,
  destPath: string,
): Promise<void> {
  const size = orientedSize(
    image.naturalWidth,
    image.naturalHeight,
    orientation,
  );
  const canvas = win.document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("canvas");
  }
  drawOriented(context, image, orientation);
  const jpeg = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (next) => (next ? resolve(next) : reject(new Error("jpeg"))),
      "image/jpeg",
      0.92,
    );
  });
  await IOUtils.write(destPath, new Uint8Array(await jpeg.arrayBuffer()));
}

function drawOriented(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  orientation: number,
): void {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  switch (orientation) {
    case 2:
      context.setTransform(-1, 0, 0, 1, width, 0);
      break;
    case 3:
      context.setTransform(-1, 0, 0, -1, width, height);
      break;
    case 4:
      context.setTransform(1, 0, 0, -1, 0, height);
      break;
    case 5:
      context.setTransform(0, 1, 1, 0, 0, 0);
      break;
    case 6:
      context.setTransform(0, 1, -1, 0, height, 0);
      break;
    case 7:
      context.setTransform(0, -1, -1, 0, height, width);
      break;
    case 8:
      context.setTransform(0, -1, 1, 0, 0, width);
      break;
    default:
      context.setTransform(1, 0, 0, 1, 0, 0);
  }
  context.drawImage(image, 0, 0);
}

function loadJpeg(win: Window, bytes: Uint8Array): Promise<HTMLImageElement> {
  const blob = new win.Blob([bytes], { type: "image/jpeg" });
  const url = win.URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const image = new win.Image();
    const finish = (error?: Error) => {
      win.URL.revokeObjectURL(url);
      if (error) {
        reject(error);
      } else {
        resolve(image);
      }
    };
    image.onload = () => finish();
    image.onerror = () => finish(new Error("image"));
    image.src = url;
  });
}
