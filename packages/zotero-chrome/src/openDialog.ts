import { chromeContentUrl } from "./chromeUrl";
import type { ZoteroContentXhtml } from "./chromeUrls.generated";
import {
  serializeChromeWindowFeatures,
  type ChromeWindowFeatures,
} from "./windowFeatures";

/**
 * Open a Zotero chrome content XHTML dialog on the main window.
 * `path` is typed against the generated content catalog.
 * `features` may be a typed object or a raw Mozilla features string.
 */
export function openZoteroChromeDialog(
  path: ZoteroContentXhtml,
  name: string,
  features: ChromeWindowFeatures | string,
  ...args: unknown[]
): Window | null {
  const win = Zotero.getMainWindow();
  if (!win) {
    return null;
  }
  const featureString =
    typeof features === "string"
      ? features
      : serializeChromeWindowFeatures(features);
  return win.openDialog(
    chromeContentUrl(path),
    name,
    featureString,
    ...(args as never[]),
  );
}
