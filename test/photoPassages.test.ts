import { assert } from "chai";
import {
  addEmptyPassage,
  applyPassageDrag,
  dropDetectedPassages,
  mergeDetectedPassages,
  pendingPassages,
} from "../src/photo/passages";
import type { OcrWord, Passage, PhotoDraft } from "../src/photo/types";

const words: OcrWord[] = [
  { text: "one", line: 0, x0: 0, y0: 0, x1: 10, y1: 10 },
  { text: "two", line: 0, x0: 12, y0: 0, x1: 22, y1: 10 },
  { text: "three", line: 0, x0: 24, y0: 0, x1: 40, y1: 10 },
  { text: "four", line: 0, x0: 42, y0: 0, x1: 56, y1: 10 },
];

describe("passage edits", function () {
  it("adds a drag on unmarked words and keeps a second drag", function () {
    const first = applyPassageDrag([], words, 0, 1, "p1", true);
    const next = applyPassageDrag(first, words, 3, 3, "p2", true);
    assert.deepEqual(
      next.map((passage) => passage.quote),
      ["one two", "four"],
    );
  });

  it("adjusts the passage under the pointer and releases its old words", function () {
    const start: Passage[] = [
      {
        id: "p1",
        quote: "one two three",
        selected: [0, 1, 2],
        comment: "",
        color: "#ffd400",
      },
    ];
    const next = applyPassageDrag(start, words, 0, 0, "p1", false);
    assert.deepEqual(
      next.map((passage) => passage.selected),
      [[0]],
    );
    assert.equal(next[0]?.quote, "one");
  });

  it("moves claimed words out of the other passage", function () {
    const start: Passage[] = [
      {
        id: "p1",
        quote: "one two",
        selected: [0, 1],
        comment: "",
        color: "#ffd400",
      },
    ];
    const next = applyPassageDrag(start, words, 1, 3, "p2", true);
    assert.deepEqual(
      next.map((passage) => [passage.id, passage.quote]),
      [
        ["p1", "one"],
        ["p2", "two three four"],
      ],
    );
  });

  it("drops a passage whose words were all claimed", function () {
    const start: Passage[] = [
      {
        id: "p1",
        quote: "two",
        selected: [1],
        comment: "",
        color: "#ffd400",
      },
    ];
    const next = applyPassageDrag(start, words, 0, 2, "p2", true);
    assert.deepEqual(
      next.map((passage) => passage.id),
      ["p2"],
    );
  });

  it("keeps a typed passage that has no word boxes", function () {
    const start: Passage[] = [
      {
        id: "typed",
        quote: "from the keyboard",
        selected: [],
        comment: "",
        color: "#ffd400",
      },
    ];
    const next = applyPassageDrag(start, words, 0, 0, "p2", true);
    assert.equal(next[0]?.quote, "from the keyboard");
    assert.equal(next[1]?.quote, "one");
  });

  it("ignores an empty quote and a committed passage", function () {
    const { passages } = addEmptyPassage([]);
    const photo = {
      skipped: false,
      passages: [
        ...passages,
        {
          id: "done",
          quote: "saved",
          selected: [0],
          comment: "",
          color: "#ffd400",
          committed: true,
        },
        {
          id: "open",
          quote: "still open",
          selected: [1],
          comment: "",
          color: "#ff6666",
        },
      ],
    } as PhotoDraft;
    assert.deepEqual(
      pendingPassages(photo).map((passage) => passage.id),
      ["open"],
    );
  });

  it("drops a detected passage and keeps one you dragged", function () {
    const detected: Passage = {
      id: "p1",
      quote: "one two",
      selected: [0, 1],
      comment: "",
      color: "#ffd400",
      detected: "underline",
    };
    const typed: Passage = {
      id: "p2",
      quote: "four",
      selected: [3],
      comment: "",
      color: "#ff6666",
    };
    assert.deepEqual(
      dropDetectedPassages([detected, typed]).map((passage) => passage.id),
      ["p2"],
    );
    const dragged = applyPassageDrag([detected], words, 0, 0, "p1", false);
    assert.equal(dragged[0]?.detected, false);
    assert.deepEqual(
      dropDetectedPassages(dragged).map((passage) => passage.selected),
      [[0]],
    );
  });

  it("scans again without taking words from a passage you typed", function () {
    const next = mergeDetectedPassages(
      [
        {
          id: "hand",
          quote: "one",
          selected: [0],
          comment: "",
          color: "#ff6666",
        },
      ],
      words,
      [
        { words: [0, 1], color: "#ffd400", kind: "underline" },
        { words: [2, 3], color: "#2ea8e5", kind: "highlight" },
      ],
    );
    assert.deepEqual(
      next.map((passage) => passage.selected),
      [[0], [1], [2, 3]],
    );
    assert.equal(next[1]?.detected, "underline");
    assert.equal(next[1]?.quote, "two");
    assert.equal(next[2]?.detected, "highlight");
    assert.equal(next[2]?.quote, "three four");
  });
});
