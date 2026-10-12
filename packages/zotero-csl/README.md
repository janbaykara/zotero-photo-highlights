# `@janbaykara/zotero-csl`

## What it does

CSL helpers on top of `Zotero.Styles` / `Zotero.QuickCopy`:

- List visible styles, resolve style names, read quick-copy style
- Generate bibliographic references (text) and print bibliographies (HTML/text)
- Fallback author–date formatting when styles fail

Uses `Zotero.debug`, `item.getDisplayTitle` / field accessors, and `Intl.Collator` — no host `configure()`.

## Why it’s valuable

Style initialization and QuickCopy edge cases are easy to get wrong. A small facade keeps bibliography generation consistent across settings, share, and print surfaces.

## How to use

### Style pickers

```ts
import {
  getAvailableStyles,
  getStyleName,
  getQuickCopyStyle,
} from "@janbaykara/zotero-csl";

const styles = getAvailableStyles(); // [{ name, url }, …] sorted for UI
const label = getStyleName("http://www.zotero.org/styles/apa"); // "American Psychological Association…"
const quick = getQuickCopyStyle(); // current export Quick Copy style URL, or null
```

### Card / settings citation (plain text)

```ts
import { generateBibliographicReference } from "@janbaykara/zotero-csl";

const text = await generateBibliographicReference(item);
// or force a style, disable author–date fallback:
const apa = await generateBibliographicReference(item, false, styleUrl);
const many = await generateBibliographicReference([itemA, itemB], true, styleUrl);
```

Tries (in order): optional `styleUrl` → Quick Copy style → last visible style → optional fallback formatter.

### Print / PDF bibliography (HTML preferred)

```ts
import { generateBibliographyForPrint } from "@janbaykara/zotero-csl";

const result = await generateBibliographyForPrint(items, styleUrl);
if (result) {
  // result.isHtml ? inject as HTML : escape as text
  container.innerHTML = result.isHtml ? result.content : escapeHtml(result.content);
}
```

### Offline / failure fallback

```ts
import {
  generateFallbackBibliographicReference,
  buildFallbackBibliographicReference,
} from "@janbaykara/zotero-csl";

const one = buildFallbackBibliographicReference(item); // sync author–date-ish
const many = generateFallbackBibliographicReference([itemA, itemB]);
```

### In this repo

Used from settings (style list), item cards, share/print pipelines. Citation keys and DOCX/PDF export stay in the plugin.

## Out of scope

Citation keys (`citeKey.ts`), export formats (DOCX/PDF pipelines), publish HTML assembly.
