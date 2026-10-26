import { assert } from "chai";
import { wordsFromCtc, characterTable } from "../src/ocr/paddle/ctc";
import {
  detSize,
  mapSpanToPhoto,
  quadsFromScoreMap,
  wordsOnQuad,
  type Quad,
} from "../src/ocr/paddle/geometry";
import { paddleModelForLanguage } from "../src/ocr/paddle/models";
import { recognizeWithFallback } from "../src/ocr/recognize";
import type { OcrWord } from "../src/photo/types";

describe("PaddleOCR", function () {
  describe("languages", function () {
    it("picks the recognition model for each script", function () {
      assert.equal(paddleModelForLanguage("eng")?.id, "en_PP-OCRv4_rec_mobile");
      assert.equal(paddleModelForLanguage("eng")?.split, "space");
      assert.equal(
        paddleModelForLanguage("deu")?.id,
        "latin_PP-OCRv3_rec_mobile",
      );
      assert.equal(
        paddleModelForLanguage("vie")?.id,
        "latin_PP-OCRv3_rec_mobile",
      );
      assert.equal(
        paddleModelForLanguage("rus")?.id,
        "cyrillic_PP-OCRv3_rec_mobile",
      );
      assert.equal(
        paddleModelForLanguage("chi_sim")?.id,
        "ch_PP-OCRv4_rec_mobile",
      );
      assert.equal(paddleModelForLanguage("chi_sim")?.split, "char");
      assert.equal(
        paddleModelForLanguage("chi_tra")?.id,
        "chinese_cht_PP-OCRv3_rec_mobile",
      );
      assert.equal(
        paddleModelForLanguage("jpn")?.id,
        "japan_PP-OCRv4_rec_mobile",
      );
      assert.equal(
        paddleModelForLanguage("kor")?.id,
        "korean_PP-OCRv4_rec_mobile",
      );
    });

    it("skips Hebrew", function () {
      assert.isNull(paddleModelForLanguage("heb"));
      assert.isNull(paddleModelForLanguage(""));
    });
  });

  describe("CTC", function () {
    it("collapses repeats and splits words on spaces", function () {
      const characters = characterTable(["H", "i"], 4);
      assert.deepEqual(characters, ["", "H", "i", " "]);
      const time = 8;
      const classes = 4;
      const picks = [0, 1, 1, 2, 3, 1, 2, 0];
      const scores = [0.99, 0.9, 0.8, 0.7, 0.95, 0.6, 0.85, 0.99];
      const data = new Float32Array(time * classes);
      picks.forEach((klass, step) => {
        data[step * classes + klass] = scores[step];
      });
      const words = wordsFromCtc({
        data,
        time,
        classes,
        characters: characters || [],
        split: "space",
        cropWidth: 80,
        tensorWidth: 80,
        contentWidth: 80,
      });
      assert.equal(words.length, 2);
      assert.equal(words[0].text, "Hi");
      assert.closeTo(words[0].x0, 10, 0.001);
      assert.closeTo(words[0].x1, 40, 0.001);
      assert.closeTo(words[0].confidence, 77.5, 0.001);
      assert.equal(words[1].text, "Hi");
      assert.closeTo(words[1].x0, 50, 0.001);
      assert.closeTo(words[1].x1, 70, 0.001);
      assert.closeTo(words[1].confidence, 72.5, 0.001);
    });

    it("gives each character its own box for Chinese", function () {
      const characters = characterTable(["你", "好"], 3);
      assert.deepEqual(characters, ["", "你", "好"]);
      const data = new Float32Array(2 * 3);
      data[1] = 0.8;
      data[3 + 2] = 0.6;
      const words = wordsFromCtc({
        data,
        time: 2,
        classes: 3,
        characters: characters || [],
        split: "char",
        cropWidth: 20,
        tensorWidth: 20,
        contentWidth: 20,
      });
      assert.deepEqual(
        words.map((word) => word.text),
        ["你", "好"],
      );
      assert.closeTo(words[0].x0, 0, 0.001);
      assert.closeTo(words[0].x1, 10, 0.001);
      assert.closeTo(words[1].x0, 10, 0.001);
      assert.closeTo(words[1].x1, 20, 0.001);
    });
  });

  describe("boxes", function () {
    const horizontal: Quad = [
      { x: 10, y: 20 },
      { x: 110, y: 20 },
      { x: 110, y: 40 },
      { x: 10, y: 40 },
    ];

    it("maps a span on a horizontal line back onto the photo", function () {
      const box = mapSpanToPhoto(horizontal, 100, 20, false, 25, 40);
      assert.ok(box);
      assert.closeTo(box.x0, 35, 0.01);
      assert.closeTo(box.y0, 20, 0.01);
      assert.closeTo(box.x1, 50, 0.01);
      assert.closeTo(box.y1, 40, 0.01);
    });

    it("maps a span on a tall line after the crop is rotated", function () {
      const vertical: Quad = [
        { x: 20, y: 10 },
        { x: 40, y: 10 },
        { x: 40, y: 110 },
        { x: 20, y: 110 },
      ];
      const box = mapSpanToPhoto(vertical, 20, 100, true, 10, 30);
      assert.ok(box);
      assert.closeTo(box.x0, 20, 0.01);
      assert.closeTo(box.y0, 20, 0.01);
      assert.closeTo(box.x1, 40, 0.01);
      assert.closeTo(box.y1, 40, 0.01);
    });

    it("keeps the line index on the photo word", function () {
      const words = wordsOnQuad({
        quad: horizontal,
        cropWidth: 100,
        cropHeight: 20,
        rotated: false,
        words: [{ text: "Hello", x0: 25, x1: 40, confidence: 90 }],
        line: 2,
        imageWidth: 200,
        imageHeight: 80,
      });
      assert.equal(words.length, 1);
      assert.equal(words[0].line, 2);
      assert.equal(words[0].text, "Hello");
      assert.closeTo(words[0].x0, 35, 0.01);
      assert.closeTo(words[0].y0, 20, 0.01);
    });

    it("finds one text quad in a score map", function () {
      const width = 32;
      const height = 32;
      const score = new Float32Array(width * height);
      for (let y = 10; y < 16; y++) {
        for (let x = 4; x < 20; x++) score[y * width + x] = 1;
      }
      const quads = quadsFromScoreMap(score, width, height, {
        thresh: 0.3,
        boxThresh: 0.5,
        unclipRatio: 0,
        minSize: 1,
      });
      assert.equal(quads.length, 1);
      const xs = quads[0].map((point) => point.x);
      const ys = quads[0].map((point) => point.y);
      assert.closeTo(Math.min(...xs), 4, 1.5);
      assert.closeTo(Math.max(...xs), 19, 1.5);
      assert.closeTo(Math.min(...ys), 10, 1.5);
      assert.closeTo(Math.max(...ys), 15, 1.5);
    });

    it("sizes the detector input to a multiple of 32", function () {
      assert.deepEqual(detSize(2400, 1800), { width: 960, height: 736 });
    });
  });

  describe("fallback", function () {
    const nativeWords: OcrWord[] = [
      { text: "Native", x0: 0, y0: 0, x1: 10, y1: 10, line: 0 },
    ];
    const paddleWords: OcrWord[] = [
      { text: "Paddle", x0: 0, y0: 0, x1: 10, y1: 10, line: 0 },
    ];
    const tesseractWords: OcrWord[] = [
      { text: "Tesseract", x0: 0, y0: 0, x1: 10, y1: 10, line: 0 },
    ];

    it("keeps a native result", async function () {
      let paddle = 0;
      let tesseract = 0;
      const result = await recognizeWithFallback({
        native: async () => ({
          outcome: "ready",
          engine: "vision",
          words: nativeWords,
        }),
        paddle: async () => {
          paddle += 1;
          return paddleWords;
        },
        tesseract: async () => {
          tesseract += 1;
          return tesseractWords;
        },
      });
      assert.equal(result.engine, "vision");
      assert.equal(result.words[0].text, "Native");
      assert.equal(paddle, 0);
      assert.equal(tesseract, 0);
    });

    it("uses Paddle when the system engine returns nothing", async function () {
      let tesseract = 0;
      const result = await recognizeWithFallback({
        native: async () => ({ outcome: "fallback", reason: "no-text" }),
        paddle: async () => paddleWords,
        tesseract: async () => {
          tesseract += 1;
          return tesseractWords;
        },
      });
      assert.equal(result.engine, "paddle");
      assert.equal(result.words[0].text, "Paddle");
      assert.equal(tesseract, 0);
    });

    it("falls through when Paddle finds nothing or throws", async function () {
      const empty = await recognizeWithFallback({
        native: async () => ({ outcome: "fallback", reason: "platform" }),
        paddle: async () => [],
        tesseract: async () => tesseractWords,
      });
      assert.equal(empty.engine, "tesseract");
      const thrown = await recognizeWithFallback({
        native: async () => ({ outcome: "fallback", reason: "failed" }),
        paddle: async () => {
          throw new Error("download");
        },
        tesseract: async () => tesseractWords,
      });
      assert.equal(thrown.engine, "tesseract");
      assert.equal(thrown.words[0].text, "Tesseract");
    });

    it("reads only the engine that was chosen", async function () {
      let native = 0;
      let paddle = 0;
      let tesseract = 0;
      const steps = {
        native: async () => {
          native += 1;
          return {
            outcome: "ready" as const,
            engine: "vision" as const,
            words: nativeWords,
          };
        },
        paddle: async () => {
          paddle += 1;
          return paddleWords;
        },
        tesseract: async () => {
          tesseract += 1;
          return tesseractWords;
        },
      };
      const forced = await recognizeWithFallback(steps, "tesseract");
      assert.equal(forced.engine, "tesseract");
      assert.equal(forced.words[0].text, "Tesseract");
      assert.equal(native, 0);
      assert.equal(paddle, 0);
      assert.equal(tesseract, 1);
      const chosen = await recognizeWithFallback(steps, "paddle");
      assert.equal(chosen.engine, "paddle");
      assert.equal(chosen.words, paddleWords);
      assert.equal(native, 0);
    });

    it("rejects a system engine that is not the one chosen", async function () {
      try {
        await recognizeWithFallback(
          {
            native: async () => ({ outcome: "fallback", reason: "platform" }),
            paddle: async () => paddleWords,
            tesseract: async () => tesseractWords,
          },
          "vision",
        );
        assert.fail("vision");
      } catch (error) {
        assert.include(String(error), "vision");
      }
    });
  });
});
