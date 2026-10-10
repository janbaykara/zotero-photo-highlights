import { getCachedItem } from "./cache";
import { isTestEnv } from "./env";

type SelectItemsDialogIO = {
  singleSelection: boolean;
  multiSelect: boolean;
  dataIn: unknown;
  dataOut: unknown;
  deferred: _ZoteroTypes.Promise.DeferredPromise<void>;
  filterLibraryIDs?: number[];
  itemTreeID?: string;
};

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
  if (isTestEnv()) {
    return [];
  }
  const win = Zotero.getMainWindow();
  if (!win) {
    return [];
  }

  const io: SelectItemsDialogIO = {
    singleSelection: false,
    multiSelect: true,
    dataIn: null,
    dataOut: null,
    deferred: Zotero.Promise.defer(),
    itemTreeID: "zotero-syllabus-select-items",
  };
  if (options?.libraryID != null) {
    io.filterLibraryIDs = [options.libraryID];
  }

  const folderPref = "lastViewedFolder";
  const previousFolder =
    options?.initialFolder != null ? Zotero.Prefs.get(folderPref) : undefined;
  if (options?.initialFolder != null) {
    Zotero.Prefs.set(folderPref, options.initialFolder);
  }

  try {
    win.openDialog(
      "chrome://zotero/content/selectItemsDialog.xhtml",
      "",
      "chrome,dialog=no,centerscreen,resizable=yes",
      io,
    );
    await io.deferred.promise;
  } catch (error) {
    ztoolkit.log("Error opening item picker:", error);
    return [];
  } finally {
    if (previousFolder !== undefined) {
      Zotero.Prefs.set(folderPref, previousFolder);
    }
  }

  const ids = Array.isArray(io.dataOut)
    ? io.dataOut.filter((id): id is number => typeof id === "number")
    : [];
  if (ids.length === 0) {
    return [];
  }

  return ids
    .map((id) => getCachedItem(id) || Zotero.Items.get(id))
    .filter((item): item is Zotero.Item => Boolean(item));
}
