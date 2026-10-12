# `@janbaykara/zotero-os-file-drop`

## What it does

Chrome-safe OS file and URL drop into the current Zotero library/collection.

- **`.`** — `isOsFileDrag`, `collectDroppedOsItems`, `importDroppedOsFilesIntoCurrentView`, destination helpers
- **`./preact`** — `useOsFileDropHandlers`

Pass host-specific options at the call site (no `configure()`):

- `extraDragTypePrefixes` — treat extra MIME prefixes as in-app drags (not OS)
- `skipFileName` on import — ignore files by name
- `customViewElementId` on the Preact hook — also listen on a custom items-pane root

## Why it’s valuable

Finder/Explorer drops in Zotero chrome need `application/x-moz-file` / `mozGetDataAt` handling and must not steal Zotero item drags. Browser DnD recipes miss those details.

## How to use

### Detect vs import (imperative)

```ts
import {
  isOsFileDrag,
  canAcceptOsFileDrop,
  importDroppedOsFilesIntoCurrentView,
  collectDroppedOsItems,
} from "@janbaykara/zotero-os-file-drop";

const dragOpts = { extraDragTypePrefixes: ["application/x-myplugin-"] };

function onDragOver(e: DragEvent) {
  if (!isOsFileDrag(e.dataTransfer, dragOpts)) return;
  e.preventDefault();
}

async function onDrop(e: DragEvent) {
  if (!isOsFileDrag(e.dataTransfer, dragOpts) || !canAcceptOsFileDrop()) {
    return;
  }
  e.preventDefault();
  const added = await importDroppedOsFilesIntoCurrentView(e, {
    skipFileName: (name) => name.toLowerCase().endsWith(".tmp"),
  });
  // `added` are newly created Zotero.Item attachments / URL items
}
```

`importDroppedOsFilesIntoCurrentView` resolves the selected collection/library via the active Zotero pane, respects copy/link/move modifiers, and does **not** call `itemsView.onDrop` (avoids false read-only alerts when the items tree is hidden).

### Preact zone

```tsx
import {
  canAcceptOsFileDrop,
  importDroppedOsFilesIntoCurrentView,
} from "@janbaykara/zotero-os-file-drop";
import { useOsFileDropHandlers } from "@janbaykara/zotero-os-file-drop/preact";

function DropSurface() {
  const fileDrop = useOsFileDropHandlers({
    extraDragTypePrefixes: ["application/x-myplugin-"],
    customViewElementId: "my-custom-view", // optional #id overlay root
    acceptDrop: () => canAcceptOsFileDrop(),
    onOsFileDragHover: (event) => {
      // null when leave; use for drop-target highlighting
    },
    onOsFileDrop: async (event) => {
      await importDroppedOsFilesIntoCurrentView(event, {
        skipFileName: (name) => name.endsWith(".ignore"),
      });
    },
  });

  return (
    <div
      className={fileDrop.isDraggingFile ? "is-os-file-drag" : undefined}
      onDragEnter={fileDrop.onDragEnter}
      onDragOver={fileDrop.onDragOver}
      onDragLeave={fileDrop.onDragLeave}
      onDrop={fileDrop.onDrop}
    >
      …
    </div>
  );
}
```

### In this repo

Syllabus MIME prefixes (`application/x-syllabus-`), `#syllabus-custom-view`, and `.syllabus` skip helpers are wrapped in [`src/utils/nativeFileDrop.ts`](../../src/utils/nativeFileDrop.ts). Pages import that facade so call sites stay short.

## Out of scope

Drop overlay UI (`OsFileDropOverlay`), Fluent copy, syllabus assignment after import.
