import { assert } from "chai";
import {
  formatPublishBytes,
  getPublishErrorInfo,
  sanitizePublishErrorDetail,
} from "../src/utils/formatPublishError";

describe("formatPublishError helpers", function () {
  it("formats byte sizes for quota messages", function () {
    assert.equal(formatPublishBytes(512), "512 B");
    assert.equal(formatPublishBytes(12 * 1024), "12 KB");
    assert.equal(formatPublishBytes(2.5 * 1024 * 1024), "2.5 MB");
    assert.equal(formatPublishBytes(25 * 1024 * 1024), "25 MB");
  });

  it("extracts Worker error codes from thrown HTTP errors", function () {
    const err = new Error("quota_exceeded") as Error & {
      status: number;
      data: { error: string; usageBytes: number; quotaBytes: number };
    };
    err.status = 413;
    err.data = {
      error: "quota_exceeded",
      usageBytes: 190_000_000,
      quotaBytes: 200_000_000,
    };
    const info = getPublishErrorInfo(err);
    assert.equal(info.code, "quota_exceeded");
    assert.equal(info.status, 413);
    assert.include(sanitizePublishErrorDetail(info), "quota_exceeded");
    assert.include(sanitizePublishErrorDetail(info), "HTTP 413");
  });

  it("falls back to publish_http_* when response has no error field", function () {
    const err = new Error("publish_http_502") as Error & { status: number };
    err.status = 502;
    const info = getPublishErrorInfo(err);
    assert.equal(info.code, "publish_http_502");
    assert.equal(
      sanitizePublishErrorDetail(info),
      "publish_http_502 · HTTP 502",
    );
  });
});
