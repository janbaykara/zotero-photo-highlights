# `@janbaykara/zotero-preact`

## What it does

Chrome host for Preact UIs inside Zotero:

- `renderComponent` / `unmountComponent` — per-window roots with `treeKey` remount
- `TabManager` — Preact content in `Zotero_Tabs`
- `openPreactDialog` / `openPreactDialogAsync` — DialogHelper + stylesheet inject

Call `configureZoteroPreact` once with log, tabs/window accessors, Dialog factory, stylesheet URL, test-env flag, and optional singleton dialog slot.

## Why it’s valuable

Zotero chrome sandboxes need `globalThis.window` / `ResizeObserver` wiring, careful remount vs update, and DialogHelper (not `window.open` SPA). This package is the reusable shell; product pages stay in the plugin.

## How to use

Peers: `preact`, `zotero-plugin-toolkit`.

### Configure once at startup

```ts
import { configureZoteroPreact } from "@janbaykara/zotero-preact";

configureZoteroPreact({
  log: (...args) => ztoolkit.log(...args),
  getMainWindow: () => Zotero.getMainWindow(),
  getTabs: () => Zotero_Tabs,
  createDialog: (rows, cols) => new ztoolkit.Dialog(rows, cols),
  getStylesheetUrl: () => "chrome://my-plugin/content/styles.css",
  isTestEnv: () => false,
  getSingletonDialog: () => addon.data.dialog,
  setSingletonDialog: (dialog) => {
    addon.data.dialog = dialog;
  },
  dialogRootIdPrefix: "my-plugin-dialog",
});
```

In this repo: [`src/utils/configurePackages.ts`](../../src/utils/configurePackages.ts).

### Mount into a DOM root

```tsx
import { renderComponent, unmountComponent } from "@janbaykara/zotero-preact";
import { h } from "preact";

const win = Zotero.getMainWindow();
const root = win.document.getElementById("my-custom-view")!;

// Same treeKey → update in place (no blank flash).
// Changed treeKey (e.g. collection id / view mode) → clean remount.
renderComponent(
  win,
  root,
  h(MyPage, { collectionId }),
  "my-custom-view",
  `collection:${collectionId}:syllabus`,
);

// Later, when tearing down the view:
unmountComponent(win, "my-custom-view");
```

### Tabs

```tsx
import { TabManager } from "@janbaykara/zotero-preact";
import { h } from "preact";

const readingTab = new TabManager<{ libraryID: number }>({
  type: "my-reading",
  title: () => "My reading",
  getTabId: (params) => `my-reading-${params?.libraryID ?? 0}`,
  rootElementIdFactory: (params) => `my-reading-root-${params?.libraryID ?? 0}`,
  data: () => ({ icon: "library" }), // optional Zotero_Tabs data
  componentFactory: (params) =>
    h(ReadingPage, { libraryID: params!.libraryID }),
});

const win = Zotero.getMainWindow();
readingTab.open(win, { libraryID: 1 }); // find/create, select, render
readingTab.ensureRendered(win, { libraryID: 1 }); // bind once; later opens only select
TabManager.selectTab("my-reading-1", win);
// Close via Zotero_Tabs.close(tabId) when you own the lifecycle
```

### Dialogs

```tsx
import {
  openPreactDialog,
  openPreactDialogAsync,
} from "@janbaykara/zotero-preact";
import { h } from "preact";

// Fire-and-forget (optional singleton focus):
openPreactDialog({
  title: "Settings",
  singleton: true,
  content: (handle) =>
    h(SettingsForm, {
      onDone: () => handle.close(),
    }),
  buttons: [{ id: "close", label: "Close" }],
  features: { width: 480, height: 360, centerscreen: true },
});

// Await the clicked button id:
const choice = await openPreactDialogAsync({
  title: "Confirm",
  content: () => h("p", null, "Delete this class?"),
  buttons: [
    { id: "cancel", label: "Cancel" },
    { id: "ok", label: "Delete" },
  ],
});
// choice === "ok" | "cancel" | undefined
```

Prefer component state over `handle.remount()` unless the whole tree must rebuild.

## Out of scope

Syllabus/Gallery pages, Fluent, Tailwind build, item-pane registration logic.
