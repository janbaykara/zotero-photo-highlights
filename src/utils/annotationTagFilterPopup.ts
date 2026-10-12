import {
  normalizeAnnotationTagFilter,
  readItemAnnotationTags,
} from "@janbaykara/zotero-annotations";
import { openTagsBoxPopup, type TagsBoxItem } from "@janbaykara/zotero-chrome";

type OpenAnnotationTagFilterPopupOptions = {
  libraryID: number;
  selected: readonly string[];
  anchor: Element;
  onChange: (tags: string[]) => void;
  /**
   * When false, `onChange` runs only when the popup closes (batch tag).
   * Default true matches the filter UI (update as tags are edited).
   */
  live?: boolean;
  /** Popup anchor position (default `after_end`). Use `before_start` above a bottom bar. */
  position?: string;
};

function createFilterItem(
  libraryID: number,
  selected: readonly string[],
  onChange: (tags: string[]) => void,
  live: boolean,
): TagsBoxItem {
  let tags = normalizeAnnotationTagFilter(selected).map((tag) => ({ tag }));
  const emit = () => {
    onChange(tags.map((entry) => entry.tag));
  };
  return {
    id: "",
    libraryID,
    isFeedItem: false,
    getTags() {
      return tags.map((entry) => ({ ...entry }));
    },
    addTag(name: string) {
      const tag = String(name || "").trim();
      if (
        !tag ||
        tags.some((entry) => entry.tag.toLowerCase() === tag.toLowerCase())
      ) {
        return;
      }
      tags = [...tags, { tag }];
    },
    removeTag(name: string) {
      const key = String(name || "")
        .trim()
        .toLowerCase();
      tags = tags.filter((entry) => entry.tag.toLowerCase() !== key);
    },
    replaceTag(oldName: string, newName: string) {
      this.removeTag(oldName);
      this.addTag(newName);
    },
    setTags(list) {
      tags = normalizeAnnotationTagFilter(
        (list || []).map((entry) =>
          typeof entry === "string" ? entry : String(entry?.tag ?? ""),
        ),
      ).map((tag) => ({ tag }));
    },
    async saveTx() {
      if (live) {
        emit();
      }
    },
  };
}

/** Open Zotero's native tags-box panel (same UI as annotation tags in the reader). */
export function openAnnotationTagFilterPopup(
  options: OpenAnnotationTagFilterPopupOptions,
): void {
  const live = options.live !== false;
  const item = createFilterItem(
    options.libraryID,
    options.selected,
    options.onChange,
    live,
  );
  openTagsBoxPopup({
    item,
    anchor: options.anchor,
    position: options.position,
    popupSetId: "syllabus-annotation-tag-popupset",
    panelClass: "syllabus-annotation-tag-filter-popup",
    onHidden: (closedItem) => {
      options.onChange(readItemAnnotationTags(closedItem));
    },
  });
}
