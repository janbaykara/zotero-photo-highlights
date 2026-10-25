import { getString, initLocale } from "./utils/locale";
import { getCSSUrl } from "./utils/css";
import { configureWorkspacePackages } from "./utils/configurePackages";
import { createZToolkit } from "./utils/ztoolkit";
import { registerPhotoMenus } from "./modules/photoMenus";

async function onStartup(rootURI: string) {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();
  configureWorkspacePackages();
  registerPrefs(rootURI);

  addon.data.initialized = true;

  await Promise.all(
    Zotero.getMainWindows().map((win) =>
      onMainWindowLoad(win).catch((error) => {
        ztoolkit.log("Error in onMainWindowLoad:", error);
      }),
    ),
  );
}

function registerPrefs(rootURI: string) {
  Zotero.PreferencePanes.register({
    pluginID: addon.data.config.addonID,
    src: `${rootURI}content/preferences.xhtml`,
    label: getString("app-name"),
    image: `chrome://${addon.data.config.addonRef}/content/icons/favicon.png`,
    stylesheets: [`${rootURI}content/preferences.css`],
  });
}

function registerStyleSheet(win: _ZoteroTypes.MainWindow) {
  const doc = win.document;
  const existing = doc.querySelectorAll('link[data-plugin-stylesheet="true"]');
  existing.forEach((link) => {
    link.remove();
  });

  const tailwind = ztoolkit.UI.createElement(doc, "link", {
    properties: {
      type: "text/css",
      rel: "stylesheet",
      href: getCSSUrl(),
    },
    attributes: {
      "data-plugin-stylesheet": "true",
    },
  });
  doc.documentElement?.appendChild(tailwind);

  const pane = ztoolkit.UI.createElement(doc, "link", {
    properties: {
      type: "text/css",
      rel: "stylesheet",
      href: `chrome://${addon.data.config.addonRef}/content/zoteroPane.css?t=${Date.now()}`,
    },
    attributes: {
      "data-plugin-stylesheet": "true",
    },
  });
  doc.documentElement?.appendChild(pane);
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  addon.data.ztoolkit = createZToolkit();

  try {
    registerStyleSheet(win);
  } catch (error) {
    ztoolkit.log("Error registering stylesheets:", error);
  }

  try {
    const mainWindowFtl = `${addon.data.config.addonRef}-mainWindow.ftl`;
    win.MozXULElement.insertFTLIfNeeded(mainWindowFtl);
    await win.document.l10n?.addResourceIds?.([mainWindowFtl]);
  } catch (error) {
    ztoolkit.log("Error loading mainWindow fluent:", error);
  }

  try {
    registerPhotoMenus();
  } catch (error) {
    ztoolkit.log("Error registering menus:", error);
  }
}

async function onMainWindowUnload(
  _win: _ZoteroTypes.MainWindow,
): Promise<void> {
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
}

function onShutdown(): void {
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

async function onNotify(
  event: string,
  type: string,
  ids: Array<string | number>,
  extraData: { [key: string]: any },
) {
  ztoolkit.log("onNotify", event, type, ids, extraData);
}

async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  switch (type) {
    case "load": {
      addon.data.prefs = {
        window: data.window,
        columns: [],
        rows: [],
      };
      break;
    }
    default:
      return;
  }
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onNotify,
  onPrefsEvent,
};
