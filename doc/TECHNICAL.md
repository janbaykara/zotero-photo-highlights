# Zotero Photo Highlights

The plugin turns photos of physical pages into Zotero highlight annotations. User steps are in [README.md](../README.md).

## Wizard

`openPhotoToAnnotationDialog` mounts a Preact dialog (`openPreactDialog`, about 900×640) with internal steps: add photos, link each photo to a book, mark the passage, review decisions, summary.

Entry points are the item context menu and the Tools menu. The item menu locks every photo to that book and skips the link step. The Tools menu still asks which book each photo belongs to. An attachment selection resolves to its parent.

Cancel before review writes nothing and deletes temp files. Highlights already created during review stay. Review walks the photos that still need a decision, with the photo’s place in the batch and a status for a duplicate, several locations, or text that was not found. Several locations are a two-column list. Each option shows the words before and after the passage and, for a PDF, whether the hit is near the top, middle, or bottom of the page. A click selects one. Save, beside the photo count, writes the highlight. Editing the quote or returning to the photo is a separate optional step. The quote editor and comment field stay closed until opened.

## Temp files and OCR

Photos are copied under Zotero’s temp directory (`photo-highlights/<session>/`). On upload that copy is rewritten so its pixels are upright: the EXIF orientation tag is applied once and removed. The add step shows a preview of that image with rotate-left, rotate-right, and remove controls. Removing a photo deletes its temp files. Extra quarter-turns are written to a sibling JPEG from the upright copy, then scaled and recognized again. OCR uses a JPEG whose longest side is at most 2400px. A kept photo is the oriented file, including any extra turns, not the camera original. The time shown beside each photo comes from exifr (`DateTimeOriginal`, then `CreateDate`, then `ModifyDate`). If the file has no EXIF date, the file’s own creation time is used. That time is only shown in the wizard. It is not written onto the highlight.

Tesseract.js is the fallback, and the only engine on Linux. On macOS, `addon/content/ocr/vision-ocr.js` runs under `/usr/bin/osascript` and calls `VNRecognizeTextRequest` (accurate, language correction on). It tries the preferred language tag even when that tag is absent from Vision’s supported list, then tries again with automatic language detection. A word whose box cannot be read is skipped. A line that has text but no word boxes is split across that line’s rectangle. The JSON is written to stdout, and a parsed success is kept even if the process exit code is non-zero. A failed helper is started once more. Tesseract runs when both Vision passes fail or both return no text. On Windows, `addon/content/ocr/windows-ocr.ps1` runs under `powershell.exe -STA` and calls `Windows.Media.Ocr.OcrEngine`. Both are started with Firefox `Subprocess`, because `Zotero.Utilities.Internal.exec` does not capture stdout. The helper receives the Tesseract language’s BCP-47 candidates (`zh-Hans` and `zh-Hant` stay distinct; `vie` can match `vi-VT`). An unreadable result or a 45 second timeout falls through to Tesseract after the one retry. The Windows helper exits 2 when that language pack is not installed, and that result is not retried. When recognition finishes, the add step names the engine under the photo: Apple Vision, Windows OCR, or Tesseract.

Each word keeps a `line` index. Vision and Windows lines come from the recognizer, in its reading order. Tesseract words are clustered by vertical overlap, then ordered left to right within a line. The mark step follows those line indexes. Vision boxes are normalized from the bottom left and converted to top-left pixels of the scaled JPEG. Windows boxes are already top-left pixels. If the helper’s pixel size differs from the photo, the boxes are scaled to the photo.

Tesseract.js runs in the wizard window when the system engine is not used. `addon/content/ocr/` ships `tesseract.min.js`, `worker.min.js`, `tesseract-core.wasm.js` (SIMD LSTM build), and English `tessdata_best` (`eng.traineddata`). The worker is loaded with `workerBlobURL: false` from those chrome URLs. If that worker fails, recognition is retried with a blob worker URL. Words below a confidence of 45, and tokens that are mostly punctuation, are dropped. The passage is the run of OCR words from the word under the pointer press to the word under the pointer, in reading order. Those words highlight in the annotation colour while the pointer moves. The photo itself is not draggable, and it fills the mark step. The selected passage and highlight colour sit in a narrow column beside it.

Other languages are downloaded from `tesseract-ocr/tessdata_best` into `<profile>/photo-highlights-tessdata-best/` the first time they are selected. The language pref is `photoAnnotationOcrLang` (default `eng`).

## Matching

Pure functions in `src/match/` normalize case, quotes, dashes, and line-break hyphenation, then score windows with length-normalized edit distance.

- Auto-locate when the best score is at least 0.84 and the runner-up is at least 0.08 worse.
- Ask when two or more candidates are at least 0.72.
- Otherwise the photo is unmatched.

The words OCR read just before and after the selection are compared with the book text beside each hit. A repeated sentence is located when one copy’s surroundings agree and the others do not. The highlight itself stays the selected words. With no surrounding words, the quote score is unchanged.

The search corpus is the full text of every PDF and EPUB attachment, read when the book is linked and cached for the session. It does not use `.zotero-ft-cache`.

Duplicate detection treats a quote as already highlighted when the normalized strings contain each other and both are at least 8 characters.

## Positions

PDF highlights store `annotationPosition` as `{ pageIndex, rects }` in PDF space (bottom-left origin). `annotationSortIndex` is `page|charOffset|yFromTop`, zero-padded `5|6|5`, matching Zotero Reader. Page labels come from the PDF catalog when it has `/PageLabels`.

EPUB highlights store a FragmentSelector whose `conformsTo` is `http://www.idpf.org/epub/linking/cfi/epub-cfi.html`. The sort index is `sectionIndex|charOffset`, zero-padded `5|8`. Chapter text is read from the EPUB zip. The CFI is epubjs `EpubCFI` for that character range, with spine step `/6/{2*(index+1)}`. If that range cannot be built, the fallback for a plain chapter body is `epubcfi(/6/{spine}!/4/2,/1:start,/1:end)`.

An unlocated highlight is still an annotation on the PDF or EPUB. Its position JSON is `{}`, so Reader does not draw a box. Highlights set `libraryID` from the attachment before save. If the text cannot be found, review can edit the quote and search again, or return to the photo to drag a new passage. Ambiguous hits that land on the same page with the same text are collapsed to one choice.

## Photos

`retainUnmatchedPhotos` (default `false`) imports the original temp copy onto the book with `Zotero.Attachments.importFromFile` when a photo is unmatched or skipped from the unmatched step. Matched photos and duplicate-skipped photos are deleted and not imported.

## Prefs

| Key                      | Type    | Default |
| ------------------------ | ------- | ------- |
| `retainUnmatchedPhotos`  | boolean | `false` |
| `photoAnnotationOcrLang` | string  | `eng`   |

Branch: `extensions.zotero.photoHighlights`.
