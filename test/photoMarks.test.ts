import { createRequire } from "node:module";
import { assert } from "chai";
import { detectMarkedPassages, type RgbaImage } from "../src/photo/marks";
import type { OpenCv } from "../src/photo/opencv";
import type { OcrWord } from "../src/photo/types";

type RGB = [number, number, number];

const WHITE: RGB = [255, 255, 255];
const INK: RGB = [20, 20, 20];
const PENCIL: RGB = [150, 150, 150];
const BIRO: RGB = [25, 40, 120];
const YELLOW: RGB = [255, 236, 40];
const BLUE: RGB = [70, 190, 245];
const CREAM: RGB = [248, 228, 190];

describe("marked passages", function () {
  it("selects a two-pixel underline under the letters", function () {
    const image = makeImage(220, 100, WHITE);
    const words = lineWords(0, 16, 24, 3);
    for (const word of words) {
      glyphs(image, word);
      fillRect(image, word.x0, word.y1, word.x1 - word.x0, 2, INK);
    }
    const found = detectMarkedPassages(image, words);
    assert.deepEqual(
      found.map((span) => span.words),
      [[0, 1, 2]],
    );
    assert.equal(found[0]?.color, "#ffd400");
  });

  it("selects an underline that runs under solid letter bodies", function () {
    const image = makeImage(220, 100, WHITE);
    const words = lineWords(0, 16, 24, 3);
    for (const word of words) {
      fillRect(
        image,
        word.x0,
        word.y0,
        word.x1 - word.x0,
        word.y1 - word.y0 - 4,
        INK,
      );
      fillRect(image, word.x0, word.y1, word.x1 - word.x0, 2, INK);
    }
    const found = detectMarkedPassages(image, words);
    assert.deepEqual(
      found.map((span) => span.words),
      [[0, 1, 2]],
    );
  });

  it("does not treat the bottoms of letters as an underline", function () {
    const image = makeImage(220, 100, WHITE);
    const words = lineWords(0, 16, 24, 3);
    for (const word of words) {
      fillRect(
        image,
        word.x0,
        word.y0,
        word.x1 - word.x0,
        word.y1 - word.y0,
        INK,
      );
    }
    assert.deepEqual(detectMarkedPassages(image, words), []);
  });

  it("ignores a highlighter wash", function () {
    const image = makeImage(280, 100, WHITE);
    const words = lineWords(0, 12, 20, 4);
    words.forEach((word, index) => {
      fillRect(
        image,
        word.x0,
        word.y0,
        word.x1 - word.x0,
        word.y1 - word.y0,
        index < 2 ? YELLOW : BLUE,
      );
      glyphs(image, word);
    });
    assert.deepEqual(detectMarkedPassages(image, words), []);
  });

  it("joins words when a short gap still belongs to one stroke", function () {
    const image = makeImage(240, 100, WHITE);
    const words = lineWords(0, 12, 24, 3);
    for (const word of words) {
      glyphs(image, word);
    }
    const [first, middle, last] = words;
    if (!first || !middle || !last) {
      assert.fail("words");
      return;
    }
    fillRect(image, first.x0, first.y1, first.x1 - first.x0, 2, INK);
    fillRect(image, first.x1, first.y1, middle.x0 - first.x1, 2, INK);
    fillRect(
      image,
      middle.x0,
      middle.y1,
      (middle.x1 - middle.x0) * 0.33,
      2,
      INK,
    );
    fillRect(image, middle.x1, middle.y1, last.x0 - middle.x1, 2, INK);
    fillRect(image, last.x0, last.y1, last.x1 - last.x0, 2, INK);
    const found = detectMarkedPassages(image, words);
    assert.deepEqual(
      found.map((span) => span.words),
      [[0, 1, 2]],
    );
  });

  it("keeps two strokes on one line as two passages", function () {
    const image = makeImage(320, 100, WHITE);
    const words = lineWords(0, 12, 24, 5);
    for (const word of words) {
      glyphs(image, word);
    }
    for (const word of [words[0], words[1], words[3], words[4]]) {
      if (!word) {
        continue;
      }
      fillRect(image, word.x0, word.y1, word.x1 - word.x0, 2, INK);
    }
    const found = detectMarkedPassages(image, words);
    assert.deepEqual(
      found.map((span) => span.words),
      [
        [0, 1],
        [3, 4],
      ],
    );
  });

  it("selects a pencil line and ignores a wash on cream paper", function () {
    const image = makeImage(300, 180, WHITE);
    fillRect(image, 8, 24, 284, 130, CREAM);
    const words = lineWords(0, 24, 70, 4);
    words.forEach((word, index) => {
      fillRect(
        image,
        word.x0,
        word.y0,
        word.x1 - word.x0,
        word.y1 - word.y0,
        index < 2 ? CREAM : YELLOW,
      );
      glyphs(image, word);
    });
    for (const word of words.slice(0, 2)) {
      fillRect(image, word.x0, word.y1, word.x1 - word.x0, 2, PENCIL);
    }
    const found = detectMarkedPassages(image, words);
    assert.deepEqual(
      found.map((span) => span.words),
      [[0, 1]],
    );
    assert.equal(found[0]?.color, "#ffd400");
  });

  it("selects a dark biro stroke", function () {
    const image = makeImage(220, 100, WHITE);
    const words = lineWords(0, 16, 24, 3);
    for (const word of words) {
      glyphs(image, word);
      fillRect(image, word.x0, word.y1, word.x1 - word.x0, 2, BIRO);
    }
    assert.deepEqual(
      detectMarkedPassages(image, words).map((span) => span.words),
      [[0, 1, 2]],
    );
  });

  it("joins a dashed stroke whose pieces are shorter than a word", function () {
    const image = makeImage(220, 100, WHITE);
    const words = lineWords(0, 16, 24, 3);
    for (const word of words) {
      glyphs(image, word);
      for (let x = word.x0; x < word.x1; x += 14) {
        fillRect(image, x, word.y1, Math.min(8, word.x1 - x), 2, PENCIL);
      }
    }
    assert.deepEqual(
      detectMarkedPassages(image, words).map((span) => span.words),
      [[0, 1, 2]],
    );
  });

  it("selects a pencil in a bright patch when the rest of the line is in shadow", function () {
    const image = makeImage(360, 120, [150, 150, 150]);
    const words = lineWords(0, 16, 40, 3);
    fillRect(image, 0, 30, 130, 50, WHITE);
    for (const word of words) {
      glyphs(image, word);
    }
    for (const word of words.slice(0, 2)) {
      fillRect(
        image,
        word.x0,
        word.y0,
        word.x1 - word.x0,
        word.y1 - word.y0,
        WHITE,
      );
      glyphs(image, word);
      fillRect(image, word.x0, word.y1, word.x1 - word.x0, 2, [200, 200, 200]);
    }
    assert.deepEqual(
      detectMarkedPassages(image, words).map((span) => span.words),
      [[0, 1]],
    );
  });

  it("ignores a short speck under a word", function () {
    const image = makeImage(220, 100, WHITE);
    const words = lineWords(0, 16, 24, 3);
    for (const word of words) {
      glyphs(image, word);
    }
    const word = words[1];
    if (!word) {
      assert.fail("word");
      return;
    }
    fillRect(image, word.x0, word.y1, 4, 2, INK);
    assert.deepEqual(detectMarkedPassages(image, words), []);
  });

  describe("highlighter with OpenCV", function () {
    let cv: OpenCv;

    before(async function () {
      this.timeout(20000);
      const nodeRequire = createRequire(`${process.cwd()}/package.json`);
      const loaded = nodeRequire("@techstark/opencv-js") as Promise<OpenCv>;
      cv = typeof loaded.then === "function" ? await loaded : loaded;
    });

    it("splits yellow and blue washes into two passages", function () {
      const image = makeImage(280, 100, WHITE);
      const words = lineWords(0, 12, 20, 4);
      words.forEach((word, index) => {
        fillRect(
          image,
          word.x0,
          word.y0,
          word.x1 - word.x0,
          word.y1 - word.y0,
          index < 2 ? YELLOW : BLUE,
        );
        glyphs(image, word);
      });
      const found = detectMarkedPassages(image, words, cv);
      assert.deepEqual(
        found.map((span) => span.words),
        [
          [0, 1],
          [2, 3],
        ],
      );
      assert.deepEqual(
        found.map((span) => span.color),
        ["#ffd400", "#2ea8e5"],
      );
    });

    it("leaves cream paper and a fully yellow page unmarked", function () {
      const cream = makeImage(280, 100, CREAM);
      const creamWords = lineWords(0, 12, 20, 4);
      for (const word of creamWords) {
        glyphs(cream, word);
      }
      assert.deepEqual(detectMarkedPassages(cream, creamWords, cv), []);

      const yellow = makeImage(280, 100, YELLOW);
      const yellowWords = lineWords(0, 12, 20, 3);
      for (const word of yellowWords) {
        glyphs(yellow, word);
      }
      assert.deepEqual(detectMarkedPassages(yellow, yellowWords, cv), []);
    });

    it("selects a yellow wash on cream paper", function () {
      const image = makeImage(280, 100, CREAM);
      const words = lineWords(0, 12, 20, 3);
      words.forEach((word, index) => {
        if (index > 0) {
          fillRect(
            image,
            word.x0,
            word.y0,
            word.x1 - word.x0,
            word.y1 - word.y0,
            YELLOW,
          );
        }
        glyphs(image, word);
      });
      const found = detectMarkedPassages(image, words, cv);
      assert.deepEqual(
        found.map((span) => span.words),
        [[1, 2]],
      );
      assert.equal(found[0]?.color, "#ffd400");
    });

    it("keeps an underline and a wash on the same line", function () {
      const image = makeImage(280, 100, WHITE);
      const words = lineWords(0, 12, 20, 4);
      words.forEach((word, index) => {
        glyphs(image, word);
        if (index < 2) {
          fillRect(image, word.x0, word.y1, word.x1 - word.x0, 2, INK);
        } else {
          fillRect(
            image,
            word.x0,
            word.y0,
            word.x1 - word.x0,
            word.y1 - word.y0,
            BLUE,
          );
          glyphs(image, word);
        }
      });
      const found = detectMarkedPassages(image, words, cv);
      assert.deepEqual(
        found.map((span) => span.words),
        [
          [0, 1],
          [2, 3],
        ],
      );
      assert.deepEqual(
        found.map((span) => span.color),
        ["#ffd400", "#2ea8e5"],
      );
    });

    it("keeps the wash when the same words are also underlined", function () {
      const image = makeImage(220, 100, WHITE);
      const words = lineWords(0, 16, 24, 3);
      for (const word of words) {
        fillRect(
          image,
          word.x0,
          word.y0,
          word.x1 - word.x0,
          word.y1 - word.y0,
          BLUE,
        );
        glyphs(image, word);
        fillRect(image, word.x0, word.y1, word.x1 - word.x0, 2, INK);
      }
      const found = detectMarkedPassages(image, words, cv);
      assert.deepEqual(
        found.map((span) => span.words),
        [[0, 1, 2]],
      );
      assert.equal(found[0]?.color, "#2ea8e5");
    });
  });
});

function lineWords(
  line: number,
  x: number,
  y: number,
  count: number,
): OcrWord[] {
  const words: OcrWord[] = [];
  for (let index = 0; index < count; index++) {
    const x0 = x + index * 48;
    words.push({
      text: `w${line}${index}`,
      line,
      x0,
      y0: y,
      x1: x0 + 36,
      y1: y + 18,
    });
  }
  return words;
}

function makeImage(width: number, height: number, fill: RGB): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = fill[0];
    data[offset + 1] = fill[1];
    data[offset + 2] = fill[2];
    data[offset + 3] = 255;
  }
  return { width, height, data };
}

function fillRect(
  image: RgbaImage,
  x: number,
  y: number,
  width: number,
  height: number,
  color: RGB,
): void {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(image.width, Math.ceil(x + width));
  const y1 = Math.min(image.height, Math.ceil(y + height));
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const offset = (yy * image.width + xx) * 4;
      image.data[offset] = color[0];
      image.data[offset + 1] = color[1];
      image.data[offset + 2] = color[2];
      image.data[offset + 3] = 255;
    }
  }
}

function glyphs(image: RgbaImage, word: OcrWord): void {
  const height = word.y1 - word.y0;
  for (let index = 0; index < 3; index++) {
    fillRect(image, word.x0 + 4 + index * 8, word.y0 + 2, 2, height - 6, INK);
  }
}
