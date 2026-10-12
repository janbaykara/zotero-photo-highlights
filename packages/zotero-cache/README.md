# `@janbaykara/zotero-cache`

## What it does

Notifier-invalidated LRU cache for Zotero items, collections, and prefs (`getCachedItem`, `getCachedCollection*`, typed JSON pref helpers). Call `zoteroCache.initialize()` once at plugin startup. Logs via `Zotero.debug` when available.

## Why it’s valuable

`Zotero.Items.get` / collection lookups are common hot paths. Without a shared cache, plugins re-fetch and race Notifier events. This package centralizes invalidation for lifecycle events and pref observers.

## How to use

Depends on `@janbaykara/zotero-jotai-state` for `subscribePref`. Peers: `zod`, `verzod` for JSON pref validation.

### Startup

```ts
import { zoteroCache } from "@janbaykara/zotero-cache";

// Once during addon startup (after Zotero is ready):
zoteroCache.initialize();
```

Registers a Notifier observer for item/collection lifecycle events and starts pref observers lazily when prefs are first read.

### Items and collections

```ts
import {
  getCachedItem,
  getCachedCollectionById,
  getCachedCollectionByKey,
  isObjectLifecycleEvent,
  isItemRemovalEvent,
} from "@janbaykara/zotero-cache";

const item = getCachedItem(itemId); // Zotero.Item | undefined
const collection = getCachedCollectionById(collectionId);
const byKey = getCachedCollectionByKey(libraryID, key);

// In your own Notifier handlers:
if (isObjectLifecycleEvent(event)) {
  /* cached objects for these ids may be stale — cache already cleared them */
}
if (isItemRemovalEvent(event)) {
  /* trash or permanent delete */
}
```

Misses call through to `Zotero.Items.get` / `Zotero.Collections.get*` and store the result. Lifecycle events (`add` / `modify` / `trash` / `delete` / `restore`) drop the entry.

### Prefs (plain or JSON)

```ts
import { getCachedPref } from "@janbaykara/zotero-cache";
import { z } from "zod";

// Plain pref (cached + auto-invalidated via subscribePref):
const styleUrl = getCachedPref<string>(
  "extensions.zotero.export.quickCopy.setting",
);

// JSON pref with Zod:
const LayoutSchema = z.object({ columns: z.number() });
const layout = getCachedPref(
  "extensions.zotero.syllabus.galleryLayout",
  LayoutSchema,
);

// Versioned JSON (verzod VersionedEntity) — pass as third arg when you use verzod entities.
```

### In this repo

Initialized from plugin startup alongside other chrome setup. Hot paths (item cards, gallery, explorer) prefer `getCachedItem` / `getCachedCollection*` over raw `Zotero.Items.get`.

## Out of scope

Plugin prefs prefix / `PluginPrefsMap`, syllabus note document caches.
