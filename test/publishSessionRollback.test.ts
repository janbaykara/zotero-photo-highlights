import { assert } from "chai";
import {
  isPublishQuotaExceeded,
  publishRemotePathExisted,
} from "../src/utils/publishSessionRollback";

describe("publishSessionRollback helpers", function () {
  it("detects missing vs existing remote paths", function () {
    assert.isFalse(publishRemotePathExisted(null, "files/a.pdf"));
    assert.isFalse(publishRemotePathExisted({}, "files/a.pdf"));
    assert.isFalse(
      publishRemotePathExisted({ "files/a.pdf": { size: 0 } }, "files/a.pdf"),
    );
    assert.isTrue(
      publishRemotePathExisted({ "files/a.pdf": { size: 12 } }, "files/a.pdf"),
    );
  });

  it("detects quota_exceeded from Error message or data.error", function () {
    assert.isTrue(isPublishQuotaExceeded(new Error("quota_exceeded")));
    const wrapped = new Error("publish_http_413") as Error & {
      data: { error: string };
    };
    wrapped.data = { error: "quota_exceeded" };
    assert.isTrue(isPublishQuotaExceeded(wrapped));
    assert.isFalse(isPublishQuotaExceeded(new Error("object_too_large")));
    assert.isFalse(isPublishQuotaExceeded("nope"));
  });
});
