import { assert } from "chai";
import { detectMarkedPassages, type RgbaImage } from "../src/photo/marks";
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
