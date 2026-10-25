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

Open the wizard from an item’s context menu or from Tools → Create highlights from photos. From an item, every photo stays on that book. From Tools, you choose the book for each photo. Each photo is turned upright from its camera orientation as soon as it is added, and text recognition starts then. Rotate a photo on that step if the page is still sideways; recognition runs again. You can remove a photo from the list before continuing. A photo kept on the book is stored in that orientation. Each photo shows when it was taken. On the mark step the photo fills the window, with the selected passage and highlight colour in a narrow column beside it. Drag through the words on each photo. Words around that selection are used to tell repeated sentences apart. If that text cannot be found, review shows which photo you are on and what happened, then you can save an unlocated highlight, skip, edit the quote, or choose the passage again. When several places match, they are shown two at a time. Choosing one does not save until you press Save, so you can add a comment first. The quote and comment stay hidden until you open them.

## What gets saved

- **Text found in the file.** A highlight on that PDF or EPUB. The photo is deleted and is not imported.
- **Text not found.** Save an unlocated highlight, or skip and annotate in Reader later. **Keep the photo on the book** (off by default) also imports the picture, including when you skip.
- **Duplicate of an existing highlight.** Skip or create anyway. The photo is not kept.
- **Several plausible hits.** Pick a page or chapter, then save. “None of these” treats it as unmatched. A comment can be added before saving.

## Develop

```bash
pnpm test
pnpm lint:check
pnpm build
```

Identity fields live in `package.json` `config` (`photo-highlights@janbaykara.com`). Architecture notes: [doc/TECHNICAL.md](doc/TECHNICAL.md).
