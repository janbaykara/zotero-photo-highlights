export type LanguageSpec = {
  tags: string[];
  /** Match this tag, or a tag that continues with a hyphen. */
  prefix: string;
};

/** Tesseract codes to the BCP-47 tags Apple Vision and Windows OCR use. */
export const LANGUAGE_SPECS: Record<string, LanguageSpec> = {
  eng: { tags: ["en-US", "en-GB"], prefix: "en" },
  deu: { tags: ["de-DE", "de-AT"], prefix: "de" },
  fra: { tags: ["fr-FR", "fr-CA"], prefix: "fr" },
  spa: { tags: ["es-ES", "es-MX"], prefix: "es" },
  ita: { tags: ["it-IT"], prefix: "it" },
  por: { tags: ["pt-BR", "pt-PT"], prefix: "pt" },
  nld: { tags: ["nl-NL"], prefix: "nl" },
  pol: { tags: ["pl-PL"], prefix: "pl" },
  rus: { tags: ["ru-RU"], prefix: "ru" },
  ukr: { tags: ["uk-UA"], prefix: "uk" },
  tur: { tags: ["tr-TR"], prefix: "tr" },
  ara: { tags: ["ar-SA"], prefix: "ar" },
  heb: { tags: ["he-IL", "he"], prefix: "he" },
  chi_sim: { tags: ["zh-Hans", "zh-CN"], prefix: "zh-Hans" },
  chi_tra: { tags: ["zh-Hant", "zh-TW", "zh-HK"], prefix: "zh-Hant" },
  jpn: { tags: ["ja-JP"], prefix: "ja" },
  kor: { tags: ["ko-KR"], prefix: "ko" },
  vie: { tags: ["vi-VN", "vi-VT"], prefix: "vi" },
};

export function languageSpec(code: string): LanguageSpec | null {
  return LANGUAGE_SPECS[code] ?? null;
}

export function pickRecognitionLanguage(
  code: string,
  supported: readonly string[],
): string | null {
  const spec = languageSpec(code);
  if (!spec) {
    return null;
  }
  return pickFromSpec(spec, supported);
}

export function pickFromSpec(
  spec: LanguageSpec,
  supported: readonly string[],
): string | null {
  const folded = supported.map((tag) => ({
    raw: tag,
    key: tag.toLowerCase(),
  }));
  for (const tag of spec.tags) {
    const hit = folded.find((item) => item.key === tag.toLowerCase());
    if (hit) {
      return hit.raw;
    }
  }
  const prefix = spec.prefix.toLowerCase();
  if (!prefix) {
    return null;
  }
  const hit = folded.find(
    (item) => item.key === prefix || item.key.startsWith(`${prefix}-`),
  );
  return hit?.raw ?? null;
}
