/**
 * Plugin-owned top-level collection notes that are infrastructure, not
 * readings / class notes. Use {@link isPluginManagedCollectionNote} wherever
 * these should be hidden (item columns, Syllabus/Gallery lists via
 * {@link isClassNoteItem}, publish, etc.).
 *
 * Tag strings are stored identifiers — do not localize. Keep module re-exports
 * (`SYLLABUS_NOTE_TAG`, …) pointing here so there is one source of truth.
 */

/** Collection Syllabus document note. */
export const SYLLABUS_NOTE_TAG = "zotero-syllabus";

/** Personal reading order / Gallery description note. */
export const PERSONAL_READING_ORDER_NOTE_TAG =
  "zotero-syllabus-personal-reading-order";

/** Pin marker for a non-syllabus collection (no syllabus document note). */
export const PINNED_COLLECTION_NOTE_TAG = "zotero-syllabus-pinned-collection";

/** Exact tags that mark a top-level note as plugin-managed collection chrome. */
export const PLUGIN_MANAGED_COLLECTION_NOTE_TAGS = [
  SYLLABUS_NOTE_TAG,
  PERSONAL_READING_ORDER_NOTE_TAG,
  PINNED_COLLECTION_NOTE_TAG,
] as const;

export type PluginManagedCollectionNoteTag =
  (typeof PLUGIN_MANAGED_COLLECTION_NOTE_TAGS)[number];

const PLUGIN_MANAGED_COLLECTION_NOTE_TAG_SET = new Set<string>(
  PLUGIN_MANAGED_COLLECTION_NOTE_TAGS,
);

export function isPluginManagedCollectionNoteTag(tag: string): boolean {
  return PLUGIN_MANAGED_COLLECTION_NOTE_TAG_SET.has(tag);
}

/**
 * Top-level note owned by the plugin for collection bookkeeping (syllabus
 * document, personal reading order, or pin-only collection marker).
 */
export function isPluginManagedCollectionNote(
  item: Zotero.Item | false | null | undefined,
): boolean {
  if (!item) {
    return false;
  }
  try {
    if (typeof item.isNote !== "function" || !item.isNote()) {
      return false;
    }
    const topLevel =
      typeof item.isTopLevelItem === "function"
        ? item.isTopLevelItem()
        : !item.parentItemID;
    if (!topLevel) {
      return false;
    }
    if (typeof item.hasTag !== "function") {
      return false;
    }
    for (const tag of PLUGIN_MANAGED_COLLECTION_NOTE_TAGS) {
      if (item.hasTag(tag)) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}
