import { assert } from "chai";
import {
  jpegPixelSize,
  orientedSize,
  quarterTurnsToOrientation,
  stripJpegExif,
} from "../src/photo/orient";

describe("photo orientation", function () {
  it("reads the stored pixel size, ignoring the orientation tag", function () {
    assert.deepEqual(jpegPixelSize(syntheticJpeg()), {
      width: 200,
      height: 80,
    });
  });

  it("drops the EXIF segment and leaves the stored size unchanged", function () {
    const stripped = stripJpegExif(syntheticJpeg());
    assert.ok(stripped);
    assert.equal(stripped.includes(0xe1), false);
    assert.deepEqual(jpegPixelSize(stripped), { width: 200, height: 80 });
  });

  it("maps extra quarter-turns onto upright pixels", function () {
    assert.equal(quarterTurnsToOrientation(0), 1);
    assert.equal(quarterTurnsToOrientation(1), 6);
    assert.equal(quarterTurnsToOrientation(2), 3);
    assert.equal(quarterTurnsToOrientation(3), 8);
    assert.equal(quarterTurnsToOrientation(4), 1);
    assert.equal(quarterTurnsToOrientation(-1), 8);
  });

  it("swaps the canvas only for quarter-turns", function () {
    assert.deepEqual(orientedSize(4032, 3024, 1), {
      width: 4032,
      height: 3024,
    });
    assert.deepEqual(orientedSize(4032, 3024, 3), {
      width: 4032,
      height: 3024,
    });
    assert.deepEqual(orientedSize(4032, 3024, 6), {
      width: 3024,
      height: 4032,
    });
    assert.deepEqual(orientedSize(4032, 3024, 8), {
      width: 3024,
      height: 4032,
    });
  });
});

function syntheticJpeg(): Uint8Array {
  const app1 = segment(0xe1, [0x45, 0x78, 0x69, 0x66, 0, 0, 6]);
  const sof = segment(0xc0, [8, 0, 80, 0, 200, 3]);
  return new Uint8Array([
    0xff,
    0xd8,
    ...app1,
    ...sof,
    0xff,
    0xda,
    0,
    2,
    0,
    0xff,
    0xd9,
  ]);
}

function segment(marker: number, payload: number[]): number[] {
  const length = payload.length + 2;
  return [0xff, marker, (length >> 8) & 0xff, length & 0xff, ...payload];
}
