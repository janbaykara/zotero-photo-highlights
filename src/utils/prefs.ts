import { subscribePref } from "@janbaykara/zotero-jotai-state";
import { config } from "../../package.json";

type PluginPrefsMap = _ZoteroTypes.Prefs["PluginPrefsMap"];

export const PLUGIN_PREF_DEFAULTS: {
  [K in keyof PluginPrefsMap]: PluginPrefsMap[K];
} = {
  retainUnmatchedPhotos: false,
  photoAnnotationOcrLang: "eng",
};

export function getPref<K extends keyof PluginPrefsMap>(
  key: K,
): PluginPrefsMap[K] {
  const value = Zotero.Prefs.get(getPrefKey(key), true) as
    PluginPrefsMap[K] | undefined;
  if (value === undefined) {
    return PLUGIN_PREF_DEFAULTS[key];
  }
  return value;
}

export function setPref<K extends keyof PluginPrefsMap>(
  key: K,
  value: PluginPrefsMap[K],
): void {
  Zotero.Prefs.set(getPrefKey(key), value, true);
}

export function getPrefKey<K extends keyof PluginPrefsMap>(key: K): string {
  return `${config.prefsPrefix}.${key}`;
}

export function subscribePluginPref<K extends keyof PluginPrefsMap>(
  key: K,
  onChange: () => void,
): () => void {
  return subscribePref(getPrefKey(key), onChange);
}
