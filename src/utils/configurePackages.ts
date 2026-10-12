/**
 * Wire workspace packages that need host chrome globals once at startup.
 * Only `@janbaykara/zotero-preact` requires configure; other packages use
 * `Zotero` / call-site options.
 */

import { configureZoteroPreact } from "@janbaykara/zotero-preact";
import { getCSSUrl } from "./css";
import { isTestEnv } from "./env";

export function configureWorkspacePackages(): void {
  const log = (...args: unknown[]) => {
    try {
      ztoolkit.log(...args);
    } catch {
      // tests / early boot
    }
  };

  configureZoteroPreact({
    log,
    getMainWindow: () => ztoolkit.getGlobal("Zotero").getMainWindow(),
    getTabs: () => ztoolkit.getGlobal("Zotero_Tabs"),
    createDialog: (rows, cols) => new ztoolkit.Dialog(rows, cols),
    getStylesheetUrl: getCSSUrl,
    isTestEnv,
    getSingletonDialog: () => addon.data.dialog,
    setSingletonDialog: (dialog) => {
      addon.data.dialog = dialog;
    },
    dialogRootIdPrefix: "zotero-preact-dialog",
  });
}
