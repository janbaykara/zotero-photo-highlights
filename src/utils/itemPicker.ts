import { pickLibraryItems as pickLibraryItemsCore } from "@janbaykara/zotero-chrome";
import { isTestEnv } from "./env";

export async function pickOneBook(): Promise<Zotero.Item | null> {
  const items = await pickLibraryItemsCore({
    singleSelection: true,
    isEnabled: () => !isTestEnv(),
    itemTreeID: "zotero-photo-highlights-select-item",
    log: (message, error) => ztoolkit.log(message, error),
  });
  const item = items[0];
  if (!item) {
    return null;
  }
  return bookForSelectedItem(item);
}

/** A selected attachment or annotation resolves to its parent book. */
export function bookForSelectedItem(item: Zotero.Item): Zotero.Item | null {
  try {
    if (item.isRegularItem()) {
      return item;
    }
    const parent = item.parentItem;
    if (parent?.isRegularItem()) {
      return parent;
    }
  } catch (error) {
    ztoolkit.log("bookForSelectedItem failed", error);
  }
  return null;
}

export function selectedBookId(): number | null {
  try {
    const pane = Zotero.getActiveZoteroPane?.();
    const items = pane?.getSelectedItems?.() || [];
    if (items.length !== 1) {
      return null;
    }
    return bookForSelectedItem(items[0])?.id ?? null;
  } catch {
    return null;
  }
}
