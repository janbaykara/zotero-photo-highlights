import { createXULElement } from "./createXul";

/** Duck type for Zotero’s `<tags-box item=…>` (same shape as a tagged Zotero.Item). */
export type TagsBoxItem = {
  id: string | number;
  libraryID: number;
  isFeedItem: boolean;
  getTags: () => Array<{ tag: string; type?: number }>;
  addTag: (name: string) => void;
  removeTag: (name: string) => void;
  replaceTag: (oldName: string, newName: string) => void;
  setTags: (tags: Array<{ tag: string; type?: number } | string>) => void;
  saveTx: (options?: unknown) => Promise<void>;
};

export type OpenTagsBoxPopupOptions = {
  item: TagsBoxItem;
  anchor: Element;
  /** Popup anchor position (default `after_end`). */
  position?: string;
  /** Host `popupset` id (default `zotero-chrome-tags-box-popupset`). */
  popupSetId?: string;
  /**
   * Extra class on the panel (in addition to `tags-popup`).
   * Used to dismiss an existing host popup before opening another.
   */
  panelClass?: string;
  /** Called after the popup hides (before the panel is removed). */
  onHidden?: (item: TagsBoxItem) => void;
  /** Document to mount into (default: main window document). */
  document?: Document;
};

const DEFAULT_POPUPSET_ID = "zotero-chrome-tags-box-popupset";
const PANEL_MARKER = "zotero-chrome-tags-box-popup";

type TagsPanel = Element & {
  hidePopup?: () => void;
  openPopup?: (
    target: Element | null,
    position: string,
    x: number,
    y: number,
    isContextMenu?: boolean,
  ) => void;
};

type TagsBoxElement = HTMLElement & {
  editable: boolean;
  item: TagsBoxItem;
  render: () => void;
  open: boolean;
  collapsible: boolean;
  count: number;
  newTag: () => void;
};

function ensurePopupSet(doc: Document, popupSetId: string): Element {
  const existing = doc.getElementById(popupSetId);
  if (existing) {
    return existing;
  }
  const popupset = createXULElement(doc, "popupset", popupSetId);
  doc.documentElement.appendChild(popupset);
  return popupset;
}

function dismissExisting(doc: Document, panelClass?: string): void {
  const selectors = [`.${PANEL_MARKER}`];
  if (panelClass) {
    selectors.push(`.${CSS.escape(panelClass)}`);
  }
  for (const existing of Array.from(
    doc.querySelectorAll(selectors.join(", ")),
  )) {
    const panel = existing as TagsPanel;
    try {
      panel.hidePopup?.();
    } catch {
      // Ignore panels that are already closing.
    }
    panel.remove();
  }
}

/**
 * Open Zotero’s native `<tags-box>` in a popup panel (same UI as annotation
 * tags in the reader). Pass a duck-typed `item`; call sites own tag normalize /
 * live-update behavior.
 */
export function openTagsBoxPopup(options: OpenTagsBoxPopupOptions): void {
  const doc = options.document ?? Zotero.getMainWindow()?.document ?? undefined;
  if (!doc) {
    return;
  }

  const popupSetId = options.popupSetId ?? DEFAULT_POPUPSET_ID;
  dismissExisting(doc, options.panelClass);

  const popupset = ensurePopupSet(doc, popupSetId);
  const tagsPopup = createXULElement(doc, "panel") as TagsPanel;
  tagsPopup.className = ["tags-popup", PANEL_MARKER, options.panelClass]
    .filter(Boolean)
    .join(" ");

  const tagsbox = createXULElement(doc, "tags-box") as TagsBoxElement;
  tagsPopup.appendChild(tagsbox);
  tagsbox.setAttribute("flex", "1");
  popupset.appendChild(tagsPopup);

  tagsbox.editable = true;
  tagsbox.item = options.item;
  tagsbox.render();
  tagsbox.querySelector(".head")?.removeAttribute("tabindex");

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") {
      return;
    }
    const focusedTag = tagsPopup.querySelector("editable-text.focused") as {
      value?: string;
      initialValue?: string;
    } | null;
    if (focusedTag) {
      const row = (focusedTag as unknown as Element).closest?.("[isNew]");
      if (row) {
        row.remove();
      } else if (focusedTag.initialValue !== undefined) {
        focusedTag.value = focusedTag.initialValue;
      }
    }
    tagsPopup.hidePopup?.();
  };
  doc.addEventListener("keydown", handleKeyDown, true);

  tagsPopup.addEventListener("popupshown", () => {
    tagsbox.open = true;
    tagsbox.collapsible = false;
    if (tagsbox.count === 0) {
      tagsbox.newTag();
    }
  });

  tagsPopup.addEventListener("popuphidden", (event) => {
    if (event.target !== tagsPopup) {
      return;
    }
    doc.removeEventListener("keydown", handleKeyDown, true);
    options.onHidden?.(options.item);
    tagsPopup.remove();
  });

  tagsPopup.openPopup?.(
    options.anchor,
    options.position || "after_end",
    0,
    0,
    false,
  );
}
