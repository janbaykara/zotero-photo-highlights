# Zotero Photo Highlights

Turn photos of physical pages into highlights on the book’s PDF or EPUB in [Zotero](https://www.zotero.org/).

The book file needs selectable text. A scanned PDF with no text layer cannot be located. Matched photos are discarded. When text cannot be found, you choose an unlocated highlight or skip, and a preference (off by default) decides whether that photo is kept on the book.

## Install

Requirements: Zotero 7 or later, Node 22, and pnpm 10 for development.

```bash
pnpm install
pnpm start
```

`pnpm start` serves the plugin into the Zotero profile named in `.env`. See `.env.example`.

Open the wizard from an item’s context menu or from Tools → Create highlights from photos. From an item, every photo stays on that book. From Tools, you choose the book for each photo. Each photo is turned upright from its camera orientation as soon as it is added, and text recognition starts then. On macOS that uses Apple Vision. If the selected language returns nothing, Vision tries once more with automatic language detection before Tesseract. On Windows it uses Windows OCR when that language pack is installed. Otherwise recognition uses the bundled Tesseract engine, which downloads extra languages the first time they are needed. The photo list shows which of those engines read each photo. Rotate a photo on that step if the page is still sideways; recognition runs again. You can remove a photo from the list before continuing. A photo kept on the book is stored in that orientation. Each photo shows when it was taken. On the mark step the photo fills the window, with the selected passage and highlight colour in a narrow column beside it. Drag through the words on each photo. The highlight follows the lines between the two ends of the drag and uses the annotation colour. Words around that selection are used to tell repeated sentences apart. If that text cannot be found, review shows which photo you are on and what happened, then you can save an unlocated highlight, skip, edit the quote, or choose the passage again. When several places match, they are shown two at a time. Save sits beside the photo count and stays unavailable until a place is chosen. Editing the quote or choosing the passage again is a separate optional step.

## What gets saved

- **Text found in the file.** A highlight on that PDF or EPUB. The photo is deleted and is not imported.
- **Text not found.** Save an unlocated highlight, or skip and annotate in Reader later. **Keep the photo on the book** (off by default) also imports the picture, including when you skip.
- **Duplicate of an existing highlight.** Skip or create anyway. The photo is not kept.
- **Several plausible hits.** Each choice shows the words before and after that passage and, in a PDF, whether it sits near the top, middle, or bottom of the page. Pick one, then save. “None of these” treats it as unmatched.

## Develop

```bash
pnpm test
pnpm lint:check
pnpm build
```

Identity fields live in `package.json` `config` (`photo-highlights@janbaykara.com`). Architecture notes: [doc/TECHNICAL.md](doc/TECHNICAL.md).
