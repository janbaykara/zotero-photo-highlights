# `@janbaykara/zotero-annotations`

## What it does

Utilities for Zotero PDF annotations (no UI):

- Color parse/filter/swatches
- Tag filter normalize/match
- Comment → plain text / display HTML
- Batch recolor / tag / untag
- Highlight text cleanup and sample picking

## Why it’s valuable

Annotation chrome is fiddly (hex vs named colors, tag filters, batch mutations). Shipping these as pure helpers lets any plugin share the same rules.

## How to use

Depends on `@janbaykara/zotero-cache`. Unit tests: `packages/zotero-annotations/test/`.

### Colors

```ts
import {
  parseAnnotationColorHex,
  parseAnnotationColorFilter,
  serializeAnnotationColorFilter,
  toggleAnnotationColorFilter,
  annotationMatchesColorFilter,
  collectAnnotationColors,
  annotationSwatchUsesDarkMark,
  ZOTERO_ANNOTATION_COLOR_ORDER,
} from "@janbaykara/zotero-annotations";

const hex = parseAnnotationColorHex("#FFD400"); // normalized hex or null
const filter = parseAnnotationColorFilter(prefValue); // string[]
const next = toggleAnnotationColorFilter(filter, "#ffd400");
const visible = annotations.filter((a) =>
  annotationMatchesColorFilter(a.annotationColor, next),
);
const swatches = collectAnnotationColors(
  annotations.map((a) => a.annotationColor),
);
const darkMark = annotationSwatchUsesDarkMark(hex ?? "#ffd400");
```

### Tags

```ts
import {
  parseAnnotationTagFilter,
  serializeAnnotationTagFilter,
  normalizeAnnotationTagFilter,
  annotationMatchesTagFilter,
  readItemAnnotationTags,
} from "@janbaykara/zotero-annotations";

const tags = parseAnnotationTagFilter(prefValue);
const ok = annotationMatchesTagFilter(readItemAnnotationTags(annotation), tags);
Zotero.Prefs.set(prefKey, serializeAnnotationTagFilter(tags));
```

### Comments

```ts
import {
  annotationCommentToPlainText,
  annotationCommentToDisplayHtml,
} from "@janbaykara/zotero-annotations";

const plain = annotationCommentToPlainText(annotation.annotationComment);
const html = annotationCommentToDisplayHtml(annotation.annotationComment);
```

### Batch mutations

```ts
import {
  recolorAnnotations,
  tagAnnotations,
  untagAnnotations,
  collectTagsForAnnotations,
} from "@janbaykara/zotero-annotations";

const ids = selectedAnnotationIds;
await recolorAnnotations(ids, "#ff6666");
await tagAnnotations(ids, "todo");
await untagAnnotations(ids, "todo");
const unionTags = collectTagsForAnnotations(ids);
```

Returns the number of annotations actually saved.

### Highlight samples (covers / blurbs)

```ts
import {
  getItemHighlightSample,
  cleanHighlightText,
  pickHighlightSample,
} from "@janbaykara/zotero-annotations";

const sample = getItemHighlightSample(item); // cleaned text snippet or null
const cleaned = cleanHighlightText(rawAnnotationText);
```

### In this repo

Plugin UI (`AnnotationBatchBar`, color/tag filters, annotation stream) imports these helpers; Fluent labels stay in the plugin.

## Out of scope

Preact UI, Fluent labels, Highlight Descriptions integration chrome.
