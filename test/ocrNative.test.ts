import { assert } from "chai";
import {
  clusterTesseractWords,
  decodeNativeStdout,
  parseNativePayload,
  visionBoxToPixels,
  windowsRectToPixels,
  wordsFromNativePayload,
} from "../src/ocr/boxes";
import { pickRecognitionLanguage } from "../src/ocr/languages";

const VISION_LANGS = [
  "en-US",
  "fr-FR",
  "de-DE",
  "pt-BR",
  "zh-Hans",
  "zh-Hant",
  "vi-VT",
  "ar-SA",
];

describe("native OCR", function () {
  describe("language tags", function () {
    it("picks the preferred tag when the OS lists it", function () {
      assert.equal(pickRecognitionLanguage("eng", VISION_LANGS), "en-US");
      assert.equal(pickRecognitionLanguage("deu", VISION_LANGS), "de-DE");
      assert.equal(pickRecognitionLanguage("por", VISION_LANGS), "pt-BR");
    });

    it("matches Vietnamese by prefix and keeps the two Chinese scripts apart", function () {
      assert.equal(pickRecognitionLanguage("vie", VISION_LANGS), "vi-VT");
      assert.equal(pickRecognitionLanguage("chi_sim", VISION_LANGS), "zh-Hans");
      assert.equal(
        pickRecognitionLanguage("chi_tra", ["zh-Hans", "zh-Hant"]),
        "zh-Hant",
      );
      assert.isNull(pickRecognitionLanguage("chi_sim", ["zh-Hant", "zh"]));
    });

    it("skips a language the OS list does not contain", function () {
      assert.isNull(pickRecognitionLanguage("heb", VISION_LANGS));
      assert.isNull(pickRecognitionLanguage("eng", []));
    });
  });

  describe("boxes", function () {
    it("turns a Vision box into top-left pixels", function () {
      const box = visionBoxToPixels(
        { x: 0.25, y: 0.5, w: 0.25, h: 0.25 },
        1000,
        400,
      );
      assert.deepEqual(box, { x0: 250, y0: 100, x1: 500, y1: 200 });
    });

    it("scales a Vision box when the helper size differs from the photo", function () {
      const payload = parseNativePayload(
        JSON.stringify({
          ok: true,
          width: 1000,
          height: 400,
          lines: [
            {
              words: [
                {
                  text: "Hello",
                  confidence: 0.9,
                  x: 0.25,
                  y: 0.5,
                  w: 0.25,
                  h: 0.25,
                },
              ],
            },
          ],
        }),
      );
      assert.ok(payload);
      const words = wordsFromNativePayload(payload, "vision", 500, 200);
      assert.deepEqual(words, [
        { text: "Hello", line: 0, x0: 125, y0: 50, x1: 250, y1: 100 },
      ]);
    });

    it("scales a Windows pixel rect and accepts a single unwrapped word", function () {
      const payload = parseNativePayload(
        JSON.stringify({
          ok: true,
          width: 100,
          height: 50,
          lines: { words: { text: "Page", x: 10, y: 20, w: 30, h: 8 } },
        }),
      );
      assert.ok(payload);
      const words = wordsFromNativePayload(payload, "windows", 200, 100);
      assert.equal(
        windowsRectToPixels({ x: 10, y: 20, w: 30, h: 8 }, 2, 2).x0,
        20,
      );
      assert.deepEqual(words, [
        { text: "Page", line: 0, x0: 20, y0: 40, x1: 80, y1: 56 },
      ]);
    });

    it("drops a weak word without renumbering the next line", function () {
      const payload = parseNativePayload(
        JSON.stringify({
          ok: true,
          width: 100,
          height: 100,
          lines: [
            {
              words: [
                { text: "no", confidence: 0.2, x: 0, y: 0.8, w: 0.1, h: 0.1 },
              ],
            },
            {
              words: [
                { text: "yes", confidence: 0.99, x: 0, y: 0.5, w: 0.1, h: 0.1 },
              ],
            },
          ],
        }),
      );
      assert.ok(payload);
      const words = wordsFromNativePayload(payload, "vision", 100, 100);
      assert.deepEqual(
        words.map((word) => ({ text: word.text, line: word.line })),
        [{ text: "yes", line: 1 }],
      );
    });

    it("reads UTF-16LE stdout and rejects text that is not JSON", function () {
      const encoded = Array.from('{"ok":true,"lines":[]}').flatMap((char) => [
        char,
        "\u0000",
      ]);
      assert.equal(
        decodeNativeStdout(encoded.join("")),
        '{"ok":true,"lines":[]}',
      );
      assert.isNull(parseNativePayload("not json"));
      assert.equal(
        parseNativePayload('{"ok":true,"lines":[]}\nundefined')?.ok,
        true,
      );
      assert.equal(
        parseNativePayload('note\n{"ok":false,"reason":"no-text"}\n')?.reason,
        "no-text",
      );
    });
  });

  describe("tesseract lines", function () {
    it("keeps a short middle line whole between two longer lines", function () {
      const words = clusterTesseractWords([
        { text: "aaa", x0: 0, y0: 0, x1: 40, y1: 10 },
        { text: "bbb", x0: 50, y0: 0, x1: 90, y1: 10 },
        { text: "ccc", x0: 30, y0: 20, x1: 50, y1: 30 },
        { text: "ddd", x0: 0, y0: 40, x1: 20, y1: 50 },
        { text: "eee", x0: 60, y0: 40, x1: 90, y1: 50 },
      ]);
      assert.deepEqual(
        words.map((word) => `${word.line}:${word.text}`),
        ["0:aaa", "0:bbb", "1:ccc", "2:ddd", "2:eee"],
      );
    });
  });
});
