# `@janbaykara/zotero-jotai-state`

## What it does

Framework helpers for mirroring Zotero chrome state into Jotai:

- `subscribePref` / `subscribePrefs` / `subscribeNotifier` — unsubscribe-friendly wrappers
- `ExternalSource`, `atomFromExternal`, `atomFamilyFromExternal` — mount external truth on Jotai’s default store
- `atomFromPref`, `atomFromNotifier` — thin factories on those primitives

## Why it’s valuable

Zotero’s Prefs/Notifier APIs return observer IDs and do not match React/Preact subscription models. This package standardizes `getSnapshot` + `subscribe` so multiple Preact roots can share one default store without `<Provider>` hacks or `useState` + Notifier boilerplate.

## How to use

Peers: `jotai`, `jotai-family`. Do **not** wrap Preact roots in `<Provider>` — use the default store so roots share state.

### Pref → atom

`prefKey` is the full Zotero pref path (e.g. `extensions.zotero.syllabus.foo`).

```ts
import { useAtomValue } from "jotai";
import { atomFromPref } from "@janbaykara/zotero-jotai-state";

const denseCardsAtom = atomFromPref(
  "extensions.zotero.syllabus.denseCards",
  () => Boolean(Zotero.Prefs.get("extensions.zotero.syllabus.denseCards")),
);

function DenseToggleLabel() {
  const dense = useAtomValue(denseCardsAtom);
  return dense ? "Dense" : "Comfortable";
}
```

Or subscribe without an atom:

```ts
import { subscribePref } from "@janbaykara/zotero-jotai-state";

const unsubscribe = subscribePref(
  "extensions.zotero.syllabus.denseCards",
  () => {
    /* re-read pref / invalidate UI */
  },
);
// later: unsubscribe();
```

### Notifier → atom

```ts
import { useAtomValue } from "jotai";
import { atomFromNotifier } from "@janbaykara/zotero-jotai-state";

const libraryItemCountAtom = atomFromNotifier({
  types: ["item"],
  getSnapshot: () => Zotero.Items.getAll().length,
  shouldNotify: (event) =>
    event === "add" || event === "delete" || event === "trash",
});

function LibraryCount() {
  return useAtomValue(libraryItemCountAtom);
}
```

### Custom external source

When the truth is not a single pref/notifier (pane selection, note caches, …), pass `getSnapshot` + `subscribe` yourself:

```ts
import { useAtomValue } from "jotai";
import {
  atomFromExternal,
  subscribeNotifier,
} from "@janbaykara/zotero-jotai-state";

export const selectedCollectionIdAtom = atomFromExternal({
  getSnapshot: () => ZoteroPane.getSelectedCollection()?.id ?? null,
  initial: null,
  subscribe: (onStoreChange) =>
    subscribeNotifier(["collection", "tab"], () => onStoreChange()),
});

export function useSelectedCollectionId(): number | null {
  return useAtomValue(selectedCollectionIdAtom);
}
```

### Per-entity family

```ts
import { useAtomValue } from "jotai";
import {
  atomFamilyFromExternal,
  subscribeNotifier,
} from "@janbaykara/zotero-jotai-state";
import { getCachedItem } from "@janbaykara/zotero-cache";

const itemTitleAtomFamily = atomFamilyFromExternal((itemId: number) => ({
  getSnapshot: () => getCachedItem(itemId)?.getDisplayTitle() ?? "",
  initial: "",
  subscribe: (onStoreChange) =>
    subscribeNotifier(["item"], (event, _type, ids) => {
      if (ids.includes(itemId)) onStoreChange();
    }),
}));

function ItemTitle({ itemId }: { itemId: number }) {
  return useAtomValue(itemTitleAtomFamily(itemId));
}
```

### In this repo

Domain atoms (syllabus notes, PRO, pinned, selection) live under `src/modules/react-zotero-sync/`. Prefer entity-keyed families at call sites over “void a generation counter then call `getX()`”.

## Out of scope

Syllabus-specific entity hooks, optimistic note patches, and prefs-prefix helpers (`subscribePluginPref` in the plugin).
