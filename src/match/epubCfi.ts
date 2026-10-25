export const EPUB_CFI_NAMESPACE =
  "http://www.idpf.org/epub/linking/cfi/epub-cfi.html";

export type EpubFragmentSelector = {
  type: "FragmentSelector";
  conformsTo: typeof EPUB_CFI_NAMESPACE;
  value: string;
};

/** Reader sort index: section index (5 digits) and char offset (8 digits). */
export function epubSortIndex(
  sectionIndex: number,
  charOffset: number,
): string {
  const section = String(Math.max(0, Math.floor(sectionIndex)))
    .slice(0, 5)
    .padStart(5, "0");
  const offset = String(Math.max(0, Math.floor(charOffset)))
    .slice(0, 8)
    .padStart(8, "0");
  return `${section}|${offset}`;
}

export function epubFragmentSelector(cfi: string): EpubFragmentSelector {
  return {
    type: "FragmentSelector",
    conformsTo: EPUB_CFI_NAMESPACE,
    value: cfi,
  };
}

/**
 * CFI for a character range in a minimal chapter:
 * spine item `/6/{2*(index+1)}`, then `html/body` text at `/4/2`.
 * epubjs emits this shape for `<html><body>plain text</body></html>`.
 */
export function cfiForSpineTextRange(
  spineIndex: number,
  start: number,
  end: number,
): string {
  const spineStep = 2 * (Math.max(0, spineIndex) + 1);
  const from = Math.max(0, Math.floor(start));
  const to = Math.max(from, Math.floor(end));
  return `epubcfi(/6/${spineStep}!/4/2,/1:${from},/1:${to})`;
}
