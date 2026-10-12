---
title: Workspace packages
description: In-tree chrome libraries used by Zotero Syllabus (pnpm workspace).
---

Zotero Syllabus ships shared chrome libraries under [`packages/`](https://github.com/janbaykara/zotero-syllabus/tree/main/packages). They are consumed with `workspace:*` — TypeScript source inlined by the plugin esbuild bundle. They are **not published to npm** yet.

Per-package READMEs and the index live in the repo: [`packages/README.md`](https://github.com/janbaykara/zotero-syllabus/blob/main/packages/README.md). Contributor architecture notes: [`doc/TECHNICAL.md`](https://github.com/janbaykara/zotero-syllabus/blob/main/doc/TECHNICAL.md#workspace-packages).

## Host wiring

Only **`@janbaykara/zotero-preact`** needs configure at startup (`configureZoteroPreact` via [`configurePackages.ts`](https://github.com/janbaykara/zotero-syllabus/blob/main/src/utils/configurePackages.ts)). Everything else uses the `Zotero` global or options at the call site.

## Packages

| Package | Role |
| ------- | ---- |
| [`@janbaykara/zotero-jotai-state`](https://github.com/janbaykara/zotero-syllabus/tree/main/packages/zotero-jotai-state) | Prefs/Notifier subscribe helpers + Jotai `atomFromExternal` / `atomFamilyFromExternal` |
| [`@janbaykara/zotero-cache`](https://github.com/janbaykara/zotero-syllabus/tree/main/packages/zotero-cache) | Notifier-invalidated item/collection/pref LRU |
| [`@janbaykara/zotero-annotations`](https://github.com/janbaykara/zotero-syllabus/tree/main/packages/zotero-annotations) | Annotation colors, tags, comments, batch ops, highlights (no UI) |
| [`@janbaykara/zotero-os-file-drop`](https://github.com/janbaykara/zotero-syllabus/tree/main/packages/zotero-os-file-drop) | OS file/URL drop into the library (core + `/preact`) |
| [`@janbaykara/zotero-chrome`](https://github.com/janbaykara/zotero-syllabus/tree/main/packages/zotero-chrome) | Typed chrome content/skin URLs, window features, XUL, tags-box |
| [`@janbaykara/zotero-csl`](https://github.com/janbaykara/zotero-syllabus/tree/main/packages/zotero-csl) | CSL style list + bibliography generation |
| [`@janbaykara/zotero-dnd`](https://github.com/janbaykara/zotero-syllabus/tree/main/packages/zotero-dnd) | Chrome-safe drag-and-drop (core + `/preact`) |
| [`@janbaykara/zotero-preact`](https://github.com/janbaykara/zotero-syllabus/tree/main/packages/zotero-preact) | Mount Preact into roots, tabs, and dialogs |
| [`@janbaykara/zotero-tailwind-theme`](https://github.com/janbaykara/zotero-syllabus/tree/main/packages/zotero-tailwind-theme) | Tailwind `@theme` → live Zotero CSS tokens |

Dependency edges: `jotai-state` → `cache` → `annotations`. Everything else is independent of that chain.

### jotai-state

Mirrors Zotero Prefs/Notifier into Jotai’s default store so multiple Preact roots share one store without `<Provider>`. Domain atoms (syllabus notes, personal reading order, pinned) stay in the plugin under `src/modules/react-zotero-sync/`.

### cache

LRU for items, collections, and prefs with Notifier invalidation. Call `zoteroCache.initialize()` once at plugin startup.

### annotations

Pure helpers for PDF annotation color/tag/comment/batch/highlight logic. UI (filter bars, streams) stays in the plugin.

### os-file-drop

Finder/Explorer (and URL) drops into the selected library/collection, with Gecko `application/x-moz-file` handling. Pass host MIME prefixes and optional custom-view element id as call-site options. This plugin wraps syllabus defaults in [`src/utils/nativeFileDrop.ts`](https://github.com/janbaykara/zotero-syllabus/blob/main/src/utils/nativeFileDrop.ts).

### chrome

Generated catalogs for `chrome://zotero/content/**/*.xhtml` (`ZoteroContentXhtml`) and `chrome://zotero/skin/**` (`ZoteroSkinPath`), plus `chromeContentUrl`, `chromeSkinUrl`, `openZoteroChromeDialog`, `ChromeWindowFeatures`, `createXULElement`, `openTagsBoxPopup`, and `pickLibraryItems`. Regenerate with `pnpm --filter @janbaykara/zotero-chrome generate` (local `ZOTERO_SRC` or GitHub). This plugin wraps Select Items in [`src/utils/itemPicker.ts`](https://github.com/janbaykara/zotero-syllabus/blob/main/src/utils/itemPicker.ts) and the tags-box filter in [`src/utils/annotationTagFilterPopup.ts`](https://github.com/janbaykara/zotero-syllabus/blob/main/src/utils/annotationTagFilterPopup.ts).

### csl

Thin facade over `Zotero.Styles` / `Zotero.QuickCopy` for style lists and bibliographic text/HTML.

### dnd

`@dnd-kit/abstract`-based DnD that does not assume a normal browser `document`. Core is framework-free; `/preact` exports `DndProvider`, `useSortable`, etc.

### preact

`renderComponent` / `unmountComponent`, `TabManager`, and `openPreactDialog` for Zotero chrome. Requires `configureZoteroPreact` once.

### tailwind-theme

`@theme` fragment mapping Tailwind color/shadow names to Zotero CSS variables so light/dark follow the host.

## Local development

Scaffold watches `packages/` alongside `src` and `addon`. After changing a package, rebuild/reload like any other plugin change (`pnpm start` / plugin reload).

See also [For developers](/zotero-syllabus/developers/) for clone, install, and docs-site commands.
