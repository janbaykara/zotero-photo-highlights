import { ZoteroToolkit } from "zotero-plugin-toolkit/ztoolkit";
import { config } from "../../package.json";
import { MenuManager } from "./menuManager";

export { createZToolkit };

function createZToolkit() {
  const toolkit = new ZoteroToolkit() as ZoteroToolkit & { Menu: MenuManager };
  toolkit.Menu = new MenuManager(toolkit);
  const baseUnregisterAll = toolkit.unregisterAll.bind(toolkit);
  toolkit.unregisterAll = () => {
    toolkit.Menu.unregisterAll();
    baseUnregisterAll();
  };
  initZToolkit(toolkit);
  return toolkit;
}

function initZToolkit(toolkit: ZoteroToolkit) {
  const env = __env__;
  toolkit.basicOptions.log.prefix = `[${config.addonName}]`;
  toolkit.basicOptions.log.disableConsole = env === "production";
  toolkit.UI.basicOptions.ui.enableElementJSONLog = env === "development";
  toolkit.UI.basicOptions.ui.enableElementDOMLog = env === "development";
  toolkit.basicOptions.api.pluginID = config.addonID;
  toolkit.ProgressWindow.setIconURI(
    "default",
    `chrome://${config.addonRef}/content/icons/favicon.png`,
  );
}
