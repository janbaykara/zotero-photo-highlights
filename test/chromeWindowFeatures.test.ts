import { assert } from "chai";
import { serializeChromeWindowFeatures } from "@janbaykara/zotero-chrome";

describe("serializeChromeWindowFeatures", function () {
  it("emits bare tokens for true and name=no for false", function () {
    assert.equal(
      serializeChromeWindowFeatures({
        chrome: true,
        dialog: false,
        centerscreen: true,
        resizable: true,
      }),
      "chrome,dialog=no,centerscreen,resizable",
    );
  });

  it("serializes numeric size and position", function () {
    assert.equal(
      serializeChromeWindowFeatures({
        chrome: true,
        width: 480.7,
        height: 360,
        left: 10,
      }),
      "chrome,width=481,height=360,left=10",
    );
  });

  it("skips undefined keys", function () {
    assert.equal(
      serializeChromeWindowFeatures({ titlebar: true, toolbar: undefined }),
      "titlebar",
    );
  });
});
