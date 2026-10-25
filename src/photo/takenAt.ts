import { parse as readExif } from "exifr";
import { getAppLocale } from "../utils/locale";

const DATE_TAGS = ["DateTimeOriginal", "CreateDate", "ModifyDate"] as const;

export function formatPhotoWhen(instant: number): string {
  return new Intl.DateTimeFormat(getAppLocale(), {
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(instant);
}

export async function readPhotoTakenAt(path: string): Promise<number | null> {
  try {
    const bytes = await IOUtils.read(path);
    const tags = (await readExif(bytes, {
      pick: [...DATE_TAGS],
      reviveValues: true,
    })) as Partial<Record<(typeof DATE_TAGS)[number], unknown>> | undefined;
    for (const tag of DATE_TAGS) {
      const instant = instantFromExif(tags?.[tag]);
      if (instant != null) {
        return instant;
      }
    }
  } catch (error) {
    ztoolkit.log("Could not read photo date", error);
  }
  return fileTakenAt(path);
}

function instantFromExif(value: unknown): number | null {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return null;
  }
  return value.getTime();
}

async function fileTakenAt(path: string): Promise<number | null> {
  try {
    const info = (await IOUtils.stat(path)) as {
      creationTime?: number;
      lastModified?: number;
    };
    const instant = info.creationTime || info.lastModified;
    if (instant && instant > 0) {
      return instant;
    }
  } catch (error) {
    ztoolkit.log("Could not read photo file date", error);
  }
  return null;
}
