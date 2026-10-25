/** XUL namespace used when `Document.createXULElement` is unavailable. */
export const XUL_NS =
  "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

type DocumentWithXul = Document & {
  createXULElement?: (tag: string) => Element;
};

/**
 * Create a XUL element in `doc`.
 * Prefers `Document.createXULElement`; falls back to `createElementNS(XUL_NS)`.
 * Optional `id` sets `element.id`.
 */
export function createXULElement(
  doc: Document,
  tag: string,
  id?: string,
): Element {
  const xulDoc = doc as DocumentWithXul;
  const el =
    typeof xulDoc.createXULElement === "function"
      ? xulDoc.createXULElement(tag)
      : doc.createElementNS(XUL_NS, tag);
  if (id != null && id !== "") {
    el.id = id;
  }
  return el;
}
