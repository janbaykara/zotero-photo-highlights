import { assert } from "chai";
import {
  bandScores,
  contextAgreement,
  findPassageHits,
  findPassageHitsAsync,
  normalizePassage,
  quotesOverlap,
  scoreWithContext,
  wordsAround,
} from "../src/match/passage";
import {
  lineRectsForRange,
  pageTextFromItems,
  pdfSortIndex,
  verticalBand,
  yFromTop,
  type PdfTextItem,
} from "../src/match/pdfRects";
import {
  EPUB_CFI_NAMESPACE,
  cfiForSpineTextRange,
  epubFragmentSelector,
  epubSortIndex,
} from "../src/match/epubCfi";

describe("photo matching", function () {
  describe("passage matching", function () {
    it("normalizes case, quotes, dashes, and line-break hyphenation", function () {
      assert.equal(
        normalizePassage("The “behav-\nior” — extra   spaces"),
        'the "behavior" - extra spaces',
      );
    });

    it("finds an OCR-like quote with rn/m and a page number nearby", async function () {
      const page = "12\nThe rnodern method is simple.\n13";
      const quote = "The modern method is simple";
      const hits = findPassageHits(quote, page);
      assert.isAtLeast(hits[0].score, 0.84);
      assert.deepEqual(await findPassageHitsAsync(quote, page), hits);
    });

    it("reports how many comparisons a search has made", async function () {
      const quote = "The modern method is simple";
      const page = Array.from({ length: 45 }, (_, index) =>
        index === 20 ? "rnodern method is simple" : `note${index}`,
      ).join(" ");
      let last = { done: 0, total: 0 };
      let calls = 0;
      await findPassageHitsAsync(quote, page, 5, (done, total) => {
        calls += 1;
        assert.isAtLeast(done, last.done);
        assert.isAbove(total, 0);
        assert.isAtMost(done, total);
        last = { done, total };
      });
      assert.isAtLeast(calls, 1);
      assert.equal(last.done, last.total);
    });

    it("auto-locates a clear best hit and asks when two are close", function () {
      assert.equal(
        bandScores([
          { score: 0.91, id: "a" },
          { score: 0.7, id: "b" },
        ]).kind,
        "located",
      );
      assert.equal(
        bandScores([
          { score: 0.9, id: "a" },
          { score: 0.86, id: "b" },
        ]).kind,
        "ambiguous",
      );
      assert.equal(bandScores([{ score: 0.8, id: "a" }]).kind, "unmatched");
    });

    it("uses the surrounding text to choose among repeated sentences", function () {
      const quote = "The modern method is simple";
      const page = [
        "kept in the archive the modern method is simple and then stops.",
        "later the modern method is simple without that lead.",
      ].join(" ");
      const hits = findPassageHits(quote, page);
      assert.equal(hits.length, 2);
      const ranked = hits
        .map((hit) => ({
          hit,
          score: scoreWithContext(
            hit.score,
            contextAgreement(
              page,
              hit,
              "kept in the archive",
              "and then stops",
            ),
          ),
        }))
        .sort((a, b) => b.score - a.score);
      const band = bandScores(ranked);
      assert.equal(band.kind, "located");
      if (band.kind === "located") {
        assert.equal(band.hit.hit.start, hits[0].start);
      }
      const plain = bandScores(
        hits.map((hit) => ({
          hit,
          score: scoreWithContext(
            hit.score,
            contextAgreement(page, hit, "", ""),
          ),
        })),
      );
      assert.equal(plain.kind, "ambiguous");
    });

    it("keeps the words on either side of a hit", function () {
      const page = "Alpha beta the modern method is simple gamma delta";
      const start = page.indexOf("the modern");
      const end = start + "the modern method is simple".length;
      const around = wordsAround(page, start, end);
      assert.equal(around.lead, "Alpha beta");
      assert.equal(around.trail, "gamma delta");
      const cut = wordsAround(page, start, end, 1);
      assert.equal(cut.lead, "… beta");
      assert.equal(cut.trail, "gamma …");
    });

    it("treats a contained quote as a duplicate", function () {
      assert.isTrue(
        quotesOverlap(
          "The modern method is simple and short.",
          "modern method is simple",
        ),
      );
      assert.isFalse(quotesOverlap("no", "modern method is simple"));
    });
  });

  describe("pdf rects", function () {
    const items: PdfTextItem[] = [
      { str: "The", transform: [1, 0, 0, 1, 10, 100], width: 20, height: 10 },
      {
        str: "modern",
        transform: [1, 0, 0, 1, 34, 100],
        width: 40,
        height: 10,
      },
      { str: "method", transform: [1, 0, 0, 1, 10, 80], width: 40, height: 10 },
    ];

    it("groups a selection into one rect per line", function () {
      const page = pageTextFromItems(items);
      assert.equal(page.text, "The modern method");
      const start = page.text.indexOf("modern");
      const rects = lineRectsForRange(page.items, start, page.text.length);
      assert.lengthOf(rects, 2);
      assert.deepEqual(rects[0], [34, 100, 74, 110]);
      assert.deepEqual(rects[1], [10, 80, 50, 90]);
      assert.equal(
        pdfSortIndex(3, start, yFromTop(800, rects)),
        "00003|000004|00690",
      );
    });

    it("splits a page into top, middle, and bottom", function () {
      assert.equal(verticalBand(300, 20), "top");
      assert.equal(verticalBand(300, 150), "middle");
      assert.equal(verticalBand(300, 250), "bottom");
    });
  });

  describe("epub cfi", function () {
    it("builds a fragment selector and sort index for a tiny chapter", function () {
      const cfi = cfiForSpineTextRange(0, 4, 18);
      assert.equal(cfi, "epubcfi(/6/2!/4/2,/1:4,/1:18)");
      const selector = epubFragmentSelector(cfi);
      assert.equal(selector.conformsTo, EPUB_CFI_NAMESPACE);
      assert.equal(epubSortIndex(1, 42), "00001|00000042");
    });
  });
});
