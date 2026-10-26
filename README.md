# Zotero Photo Highlights

Turn photos of physical pages into highlights on an item's PDF or EPUB in [Zotero](https://www.zotero.org/).

## Install

1. [Download the extension file (.xpi)](https://github.com/janbaykara/zotero-photo-highlights/releases/latest/download/zotero-photo-highlights.xpi).
2. In the Zotero menu bar, go to `Tools` → `Plugins` (or `Add-ons`)
3. Click the gear icon in the top right corner and select `Install Plugin From File...`
4. Select the downloaded `.xpi` file
5. (Ensure auto-updating is enabled for this add-on too!)
6. Restart Zotero!

![Screenshot of plugin at work](doc/screenshot.gif)

## What gets saved

- **Text found in the file.** A highlight on that PDF or EPUB, dated when the photo was taken. The photo is deleted once every passage from it is finished, and a matched passage does not import it.
- **Text not found.** Save an unlocated highlight, or skip and annotate in Reader later. **Keep the photo on the book** (off by default) imports the picture once for that photo, including when you skip a passage.
- **Duplicate of an existing highlight.** Skip or create anyway. The photo is not kept.
- **Several plausible hits.** Each choice shows the words before and after that passage and, in a PDF, whether it sits near the top, middle, or bottom of the page. Pick one, then save. “None of these” treats it as unmatched.

Open the wizard from an item’s context menu or from Tools → Create highlights from photos. From an item, every photo stays on that book. From Tools, you choose the book for each photo. Each photo is turned upright from its camera orientation as soon as it is added, and text recognition starts then. On macOS that uses Apple Vision. If the selected language returns nothing, Vision tries once more with automatic language detection. On Windows it uses Windows OCR when that language pack is installed. When those return no text, and on Linux, recognition uses PaddleOCR. Its models download the first time that language is needed and are stored in the Zotero profile. Hebrew has no PaddleOCR model, so it uses Tesseract directly. If PaddleOCR fails or finds no words, recognition uses the bundled Tesseract engine, which downloads extra languages the first time they are needed. The photo list shows a spinner while recognition runs, then which of those engines read each photo, and the mark step offers that engine as auto, and a dropdown can read the photo with Apple Vision, Windows OCR, PaddleOCR, or Tesseract instead. Rotate a photo on that step if the page is still sideways; recognition runs again. You can remove a photo from the list before continuing. A photo kept on the book is stored in that orientation. Each photo shows when it was taken, and the saved highlight uses that date. Each photo has Detect underlines and Detect highlights, both off by default. On the mark step the photo fills the window. The column beside it has an OCR heading and a Passages heading. Under OCR, Recognize again sits above a smaller engine list. While recognition runs, that button is disabled and shows a spinner with Recognizing text…. The engine can still be changed then, and that pass is replaced. If it fails, Copy debug logs copies the helper output, including the Windows error when Windows OCR fails. Detect underlines and Detect highlights sit under the button, smaller, in two columns. The marks those checkboxes find are already selected, each as its own passage. Drag through unmarked words to add a passage, or drag an existing one to change it. Click a passage to type it when the recognized words are wrong. That column can rotate the photo. Rotate and Recognize again clear the passages and read the page again. Detection fills them again for each checkbox that is on. A photo you leave without a passage is skipped. Leaving a photo starts a search for each passage while you mark the next one. If it is still running, Matching up highlights puts the book title first, then the passage and its place among the highlights, with a bar for how many highlights are done, and under that a short note of the page it is scanning. Each passage is its own highlight. Words around that selection are used to tell repeated sentences apart. If that text cannot be found, review shows the photo, when it was taken, and the start of the passage in its highlight colour, then what happened. You can save an unlocated highlight, skip that passage, edit the quote, or choose the passage again. The photo stays until every passage from it is finished, and it is kept on the book at most once. When several places match, review asks you to choose where to locate the passage, and each place is shown in full, two at a time. Save stays unavailable until a place is chosen. Edit quote, add a comment, and choose the passage again sit under the highlighted passage.

## Development

Requirements: Zotero 7 or later, Node 22, and pnpm 10 for development.

```bash
pnpm install
pnpm start
pnpm test
pnpm lint:check
pnpm build
```

Identity fields live in `package.json` `config` (`photo-highlights@janbaykara.com`). Architecture notes: [doc/TECHNICAL.md](doc/TECHNICAL.md).
