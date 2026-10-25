# `@janbaykara/zotero-chrome`

## What it does

Typed access to Zotero chrome UI primitives:

- Generated catalogs for `chrome://zotero/content/**/*.xhtml` and `chrome://zotero/skin/**`
- `chromeContentUrl(path)` / `chromeSkinUrl(path)` / `openZoteroChromeDialog` / `ChromeWindowFeatures`
- `createXULElement(doc, tag, id?)` (+ `XUL_NS` fallback)
- `openTagsBoxPopup` — native `<tags-box>` panel (duck-typed item)
- `pickLibraryItems` — Select Items dialog helper

## Why it’s valuable

Hardcoded `chrome://zotero/content/…` strings typo silently. A generated union from the Zotero tree catches bad paths at compile time and documents which dialogs exist.

## How to use

### Typed chrome URLs

```ts
import {
  chromeContentUrl,
  openZoteroChromeDialog,
  type ZoteroContentXhtml,
} from "@janbaykara/zotero-chrome";

const url = chromeContentUrl("selectItemsDialog");
// chrome://zotero/content/selectItemsDialog.xhtml

const icon = chromeSkinUrl("16/universal/book.svg");
// chrome://zotero/skin/16/universal/book.svg

openZoteroChromeDialog("preferences/preferences", "zotero-preferences", {
  chrome: true,
  titlebar: true,
  toolbar: true,
  centerscreen: true,
});
// → features "chrome,titlebar,toolbar,centerscreen"
```

Content paths omit `.xhtml` (`chromeContentUrl` appends it). Skin paths keep their extension. Window features are a typed object (`ChromeWindowFeatures`): `true` → bare token, `false` → `name=no`, numbers → `name=N`. Pass a raw string if you need an escape hatch.

Invalid paths fail TypeScript:

```ts
chromeContentUrl("selectItemDialog"); // error — typo
chromeSkinUrl("16/universal/buk.svg"); // error — typo
```

### Create XUL elements

```ts
import { createXULElement, XUL_NS } from "@janbaykara/zotero-chrome";

const panel = createXULElement(doc, "panel");
const group = createXULElement(doc, "hbox", "my-toolbar-group");
// Uses Document.createXULElement when present, else createElementNS(XUL_NS).
```

### Native tags-box popup

```ts
import { openTagsBoxPopup, type TagsBoxItem } from "@janbaykara/zotero-chrome";

const item: TagsBoxItem = {
  /* duck-typed getTags / addTag / removeTag / setTags / saveTx … */
};

openTagsBoxPopup({
  item,
  anchor: buttonEl,
  position: "after_end",
  panelClass: "my-plugin-tags-popup",
  onHidden: (closed) => {
    // read tags from closed.getTags()
  },
});
```

This plugin’s annotation tag filter wraps it in [`src/utils/annotationTagFilterPopup.ts`](../../src/utils/annotationTagFilterPopup.ts) (normalize via `@janbaykara/zotero-annotations`).

### Select Items dialog

```ts
import { pickLibraryItems } from "@janbaykara/zotero-chrome";

const items = await pickLibraryItems({
  libraryID: 1,
  initialFolder: "L1",
  getItem: (id) => Zotero.Items.get(id),
  isEnabled: () => true,
});
```

Host concerns stay at the call site (`getItem`, `isEnabled`, `log`, `itemTreeID`). This plugin wraps them in [`src/utils/itemPicker.ts`](../../src/utils/itemPicker.ts).

## Regenerating the catalog

Committed file: [`src/chromeUrls.generated.ts`](./src/chromeUrls.generated.ts). Normal builds do **not** need network or a Zotero checkout.

```bash
# From a local Zotero clone (preferred when developing against a branch)
ZOTERO_SRC=/path/to/zotero pnpm --filter @janbaykara/zotero-chrome generate

# Or from GitHub zotero/zotero (default ref: main)
pnpm --filter @janbaykara/zotero-chrome generate
ZOTERO_CHROME_REF=some-tag-or-sha pnpm --filter @janbaykara/zotero-chrome generate
```

The script walks `chrome/content/zotero/**/*.xhtml` and `chrome/skin/default/zotero/**` (jar roots for `chrome://zotero/content/` and `chrome://zotero/skin/`).
