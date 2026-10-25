import type { PrimitiveAtom } from "jotai";
import { atomFromExternal, type ExternalSource } from "./jotaiExternal";
import { subscribePref } from "./prefSubscribe";
import { subscribeNotifier } from "./subscribeNotifier";

/**
 * Prefs observer → atom. `prefKey` must be the full Zotero pref path.
 */
export function atomFromPref<T>(
  prefKey: string,
  getSnapshot: () => T,
  equal?: (a: T, b: T) => boolean,
): PrimitiveAtom<T> {
  return atomFromExternal({
    getSnapshot,
    equal,
    subscribe: (onStoreChange) => subscribePref(prefKey, onStoreChange),
  });
}

export type AtomFromNotifierOptions<T> = {
  types: _ZoteroTypes.Notifier.Type[];
  getSnapshot: () => T;
  equal?: (a: T, b: T) => boolean;
  initial?: T;
  /**
   * Optional filter — return true to notify subscribers for this event.
   * Default: notify on every matching type event.
   */
  shouldNotify?: (
    event: string,
    type: string,
    ids: (number | string)[],
    extraData: { [key: string]: any },
  ) => boolean;
};

/**
 * Notifier observer → atom.
 */
export function atomFromNotifier<T>(
  options: AtomFromNotifierOptions<T>,
): PrimitiveAtom<T> {
  const source: ExternalSource<T> = {
    getSnapshot: options.getSnapshot,
    equal: options.equal,
    initial: options.initial,
    subscribe: (onStoreChange) =>
      subscribeNotifier(options.types, (event, type, ids, extraData) => {
        if (
          options.shouldNotify &&
          !options.shouldNotify(event, type, ids, extraData)
        ) {
          return;
        }
        onStoreChange();
      }),
  };
  return atomFromExternal(source);
}
