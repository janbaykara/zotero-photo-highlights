import { openZoteroChromeDialog } from "./openDialog";

type SelectItemsDialogIO = {
  singleSelection: boolean;
  multiSelect: boolean;
  dataIn: unknown;
  dataOut: unknown;
  deferred: _ZoteroTypes.Promise.DeferredPromise<void>;
  filterLibraryIDs?: number[];
  itemTreeID?: string;
};

export type PickLibraryItemsOptions = {
  libraryID?: number;
  /** Collection-tree id to select initially (e.g. `L1`). */
  initialFolder?: string;
  /** Resolve selected ids (e.g. cache-aware). Defaults to `Zotero.Items.get`. */
  getItem?: (id: number) => Zotero.Item | false | null | undefined;
  /** When false, returns [] without opening (e.g. unit-test env). Default true. */
  isEnabled?: () => boolean;
  /** Passed through to the dialog `io.itemTreeID`. */
  itemTreeID?: string;
  log?: (message: string, error?: unknown) => void;
};

/**
 * Open Zotero’s Select Items dialog (library tree + search).
 * Returns [] on cancel, when disabled, or if the window cannot open.
 *
 * The dialog’s collection tree opens on `lastViewedFolder`. Pass
 * `initialFolder` (e.g. `L1` for a library root) to override for this
 * open only; the previous folder pref is restored when the dialog closes.
 */
export async function pickLibraryItems(
  options?: PickLibraryItemsOptions,
): Promise<Zotero.Item[]> {
  if (options?.isEnabled && !options.isEnabled()) {
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
    itemTreeID: options?.itemTreeID ?? "zotero-select-items",
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
    const opened = openZoteroChromeDialog(
      "selectItemsDialog",
      "",
      {
        chrome: true,
        dialog: false,
        centerscreen: true,
        resizable: true,
      },
      io,
    );
    if (!opened) {
      return [];
    }
    await io.deferred.promise;
  } catch (error) {
    options?.log?.("Error opening item picker:", error);
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

  const getItem =
    options?.getItem ?? ((id: number) => Zotero.Items.get(id) || false);
  return ids
    .map((id) => getItem(id))
    .filter((item): item is Zotero.Item => Boolean(item));
}
