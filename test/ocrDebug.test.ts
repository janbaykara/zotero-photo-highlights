import { assert } from "chai";
import {
  describeDebug,
  formatNativeFailure,
  ocrDebugMark,
  ocrDebugSince,
  recordOcrDebug,
} from "../src/ocr/debugLog";

describe("ocr debug log", function () {
  it("keeps an Error message that JSON would drop", function () {
    const text = describeDebug(new Error("osascript exited 1"));
    assert.match(text, /Error: osascript exited 1/);
  });

  it("includes the helper stderr and exit code", function () {
    const text = formatNativeFailure({
      space: "vision",
      exitCode: 1,
      reason: "recognize-failed",
      detail: "The file isn’t readable.",
      stderr: "execution error: Vision is unavailable",
      error: new Error("native OCR timed out"),
    });
    assert.match(text, /space=vision/);
    assert.match(text, /exit=1/);
    assert.match(text, /reason=recognize-failed/);
    assert.match(text, /The file isn’t readable/);
    assert.match(text, /execution error: Vision is unavailable/);
    assert.match(text, /native OCR timed out/);
  });

  it("returns only the lines recorded after a mark", function () {
    const mark = ocrDebugMark();
    recordOcrDebug("OCR start", { choice: "vision" });
    recordOcrDebug("OCR failed", new Error("did not read the photo"));
    const slice = ocrDebugSince(mark);
    assert.match(slice, /OCR start/);
    assert.match(slice, /choice":"vision"|choice": "vision"/);
    assert.match(slice, /did not read the photo/);
    assert.equal(ocrDebugSince(ocrDebugMark()), "");
  });
});
