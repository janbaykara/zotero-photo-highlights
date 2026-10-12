import type {
  ZoteroContentXhtml,
  ZoteroSkinPath,
} from "./chromeUrls.generated";

/** Full `chrome://zotero/content/….xhtml` URL (path omits the `.xhtml` suffix). */
export function chromeContentUrl(
  path: ZoteroContentXhtml,
): `chrome://zotero/content/${ZoteroContentXhtml}.xhtml` {
  return `chrome://zotero/content/${path}.xhtml`;
}

/** Full `chrome://zotero/skin/…` URL (path includes the file extension). */
export function chromeSkinUrl(
  path: ZoteroSkinPath,
): `chrome://zotero/skin/${ZoteroSkinPath}` {
  return `chrome://zotero/skin/${path}`;
}
