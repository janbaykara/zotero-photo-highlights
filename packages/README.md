# Workspace packages

In-tree libraries used by **Zotero Syllabus** via `workspace:*`. They are **not published to npm** yet; the plugin esbuild bundle inlines their TypeScript sources.

Docs site overview: [Workspace packages](https://janbaykara.github.io/zotero-syllabus/developers/packages/). Contributor notes: [doc/TECHNICAL.md](../doc/TECHNICAL.md#workspace-packages).

Only `@janbaykara/zotero-preact` needs host wiring (`src/utils/configurePackages.ts`). Other packages use `Zotero` / call-site options.

| Package                                           | Role                                                           |
| ------------------------------------------------- | -------------------------------------------------------------- |
| [zotero-jotai-state](./zotero-jotai-state/)       | Prefs/Notifier subscribe helpers + Jotai `atomFromExternal`    |
| [zotero-cache](./zotero-cache/)                   | Notifier-invalidated item/collection/pref LRU                  |
| [zotero-annotations](./zotero-annotations/)       | Annotation colors, tags, comments, batch ops, highlights       |
| [zotero-os-file-drop](./zotero-os-file-drop/)     | OS file/URL drop into the library (core + `/preact`)           |
| [zotero-chrome](./zotero-chrome/)                 | Typed chrome content/skin URLs, window features, XUL, tags-box |
| [zotero-csl](./zotero-csl/)                       | CSL style list + bibliography generation                       |
| [zotero-dnd](./zotero-dnd/)                       | Chrome-safe DnD (core + `/preact`)                             |
| [zotero-preact](./zotero-preact/)                 | Mount Preact into roots, tabs, dialogs                         |
| [zotero-tailwind-theme](./zotero-tailwind-theme/) | Tailwind `@theme` → live Zotero CSS tokens                     |

Dependency edges: `jotai-state` → `cache` → `annotations`. Everything else is independent of that chain.
