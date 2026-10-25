# Workspace packages

In-tree libraries for Zotero plugins. They are not published to npm. The plugin esbuild bundle inlines their TypeScript sources via `workspace:*`.

Only `@janbaykara/zotero-preact` needs host wiring (`src/utils/configurePackages.ts`). Other packages use `Zotero` or call-site options.

| Package                                           | Role                                                                  |
| ------------------------------------------------- | --------------------------------------------------------------------- |
| [zotero-jotai-state](./zotero-jotai-state/)       | Prefs and Notifier subscriptions, plus Jotai `atomFromExternal`       |
| [zotero-cache](./zotero-cache/)                   | Notifier-invalidated item, collection, and preference LRU             |
| [zotero-annotations](./zotero-annotations/)       | Annotation colors, tags, comments, batch edits, and highlight samples |
| [zotero-os-file-drop](./zotero-os-file-drop/)     | OS file and URL drop into the library (core and `/preact`)            |
| [zotero-chrome](./zotero-chrome/)                 | Typed chrome content and skin URLs, window features, XUL, tags box    |
| [zotero-csl](./zotero-csl/)                       | CSL style list and bibliography generation                            |
| [zotero-dnd](./zotero-dnd/)                       | Chrome-safe drag and drop (core and `/preact`)                        |
| [zotero-preact](./zotero-preact/)                 | Mount Preact into roots, tabs, and dialogs                            |
| [zotero-tailwind-theme](./zotero-tailwind-theme/) | Tailwind `@theme` mapped to live Zotero CSS tokens                    |

Dependency edges: `jotai-state` → `cache` → `annotations`. The other packages do not depend on that chain.

Call `zoteroCache.initialize()` at plugin startup before reading the cache, and `zoteroCache.shutdown()` on shutdown.
