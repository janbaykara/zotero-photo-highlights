import type { DialogHelper } from "zotero-plugin-toolkit";

export type ZoteroPreactLogFn = (...args: unknown[]) => void;

/** Opaque chrome tabs API; plugin supplies `Zotero_Tabs` via configure. */
export type ZoteroTabsApi = any;

export type ZoteroPreactDeps = {
  log?: ZoteroPreactLogFn;
  getMainWindow?: () => _ZoteroTypes.MainWindow;
  getTabs?: () => ZoteroTabsApi;
  createDialog?: (rows: number, cols: number) => DialogHelper;
  getStylesheetUrl?: () => string;
  isTestEnv?: () => boolean;
  getSingletonDialog?: () => DialogHelper | undefined;
  setSingletonDialog?: (dialog: DialogHelper | undefined) => void;
  dialogRootIdPrefix?: string;
  randomId?: () => string;
};

let deps: ZoteroPreactDeps = {};

export function configureZoteroPreact(next: ZoteroPreactDeps): void {
  deps = { ...deps, ...next };
}

export function getPreactDeps(): Required<
  Pick<
    ZoteroPreactDeps,
    | "log"
    | "getMainWindow"
    | "getTabs"
    | "createDialog"
    | "getStylesheetUrl"
    | "isTestEnv"
    | "getSingletonDialog"
    | "setSingletonDialog"
    | "dialogRootIdPrefix"
    | "randomId"
  >
> &
  ZoteroPreactDeps {
  return {
    log: deps.log ?? (() => {}),
    getMainWindow:
      deps.getMainWindow ??
      (() => Zotero.getMainWindow() as _ZoteroTypes.MainWindow),
    getTabs:
      deps.getTabs ??
      (() => (Zotero.getMainWindow() as any).Zotero_Tabs as ZoteroTabsApi),
    createDialog:
      deps.createDialog ??
      (() => {
        throw new Error(
          "configureZoteroPreact({ createDialog }) required before openPreactDialog",
        );
      }),
    getStylesheetUrl: deps.getStylesheetUrl ?? (() => ""),
    isTestEnv: deps.isTestEnv ?? (() => false),
    getSingletonDialog: deps.getSingletonDialog ?? (() => undefined),
    setSingletonDialog: deps.setSingletonDialog ?? (() => {}),
    dialogRootIdPrefix: deps.dialogRootIdPrefix ?? "zotero-preact-dialog",
    randomId:
      deps.randomId ??
      (() =>
        typeof Zotero?.Utilities?.randomString === "function"
          ? Zotero.Utilities.randomString()
          : Math.random().toString(36).slice(2)),
    ...deps,
  };
}
