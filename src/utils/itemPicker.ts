import { getCachedItem } from "@janbaykara/zotero-cache";
import { pickLibraryItems as pickLibraryItemsCore } from "@janbaykara/zotero-chrome";
import { isTestEnv } from "./env";

/**
 * Open Zotero’s Select Items dialog (library tree + search).
 * Returns [] on cancel, in tests, or if the window cannot open.
 *
 * The dialog’s collection tree opens on `lastViewedFolder`. Pass
 * `initialFolder` (e.g. `L1` for a library root) to override for this
 * open only; the previous folder pref is restored when the dialog closes.
 */
export async function pickLibraryItems(options?: {
  libraryID?: number;
  /** Collection-tree id to select initially (e.g. `L1`). */
  initialFolder?: string;
}): Promise<Zotero.Item[]> {
  return pickLibraryItemsCore({
    ...options,
    isEnabled: () => !isTestEnv(),
    getItem: (id) => getCachedItem(id) || Zotero.Items.get(id),
    itemTreeID: "zotero-syllabus-select-items",
    log: (message, error) => ztoolkit.log(message, error),
  });
}
