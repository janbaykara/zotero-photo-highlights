import { atom } from "jotai";
import { atomFamily } from "jotai-family";
import { atomFromExternal } from "@janbaykara/zotero-jotai-state";
import {
  getPref,
  PLUGIN_PREF_DEFAULTS,
  setPref,
  subscribePluginPref,
} from "../utils/prefs";

type PluginPrefsMap = _ZoteroTypes.Prefs["PluginPrefsMap"];

export type BooleanPrefKey = {
  [K in keyof PluginPrefsMap]: PluginPrefsMap[K] extends boolean ? K : never;
}[keyof PluginPrefsMap];

export type StringPrefKey = {
  [K in keyof PluginPrefsMap]: PluginPrefsMap[K] extends string ? K : never;
}[keyof PluginPrefsMap];

function prefAtom<K extends keyof PluginPrefsMap>(key: K) {
  const source = atomFromExternal<PluginPrefsMap[K]>({
    getSnapshot: () => getPref(key),
    initial: PLUGIN_PREF_DEFAULTS[key],
    subscribe: (onStoreChange) => subscribePluginPref(key, onStoreChange),
  });
  return atom(
    (get) => get(source),
    (_get, set, next: PluginPrefsMap[K]) => {
      setPref(key, next);
      set(source, next);
    },
  );
}

export const booleanPrefAtomFamily = atomFamily((key: BooleanPrefKey) =>
  prefAtom(key),
);

export const stringPrefAtomFamily = atomFamily((key: StringPrefKey) =>
  prefAtom(key),
);
