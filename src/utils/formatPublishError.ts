/** Map Worker / plugin publish errors to user-facing Fluent strings. */

import { getString } from "./locale";
import type { FluentMessageId } from "../../typings/i10n";

type PublishErrorData = {
  error?: string;
  message?: string;
  usageBytes?: number;
  quotaBytes?: number;
  projectedBytes?: number;
  maxObjectBytes?: number;
  raw?: string;
};

export type PublishErrorInfo = {
  code: string;
  status?: number;
  data?: PublishErrorData;
  message: string;
};

function asData(value: unknown): PublishErrorData | undefined {
  if (!value || typeof value !== "object") return undefined;
  return value as PublishErrorData;
}

/** Human-readable byte size for quota / size limit messages. */
export function formatPublishBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "?";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) {
    return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  }
  const kb = bytes / 1024;
  if (kb >= 1) return `${Math.round(kb)} KB`;
  return `${Math.round(bytes)} B`;
}

export function getPublishErrorInfo(err: unknown): PublishErrorInfo {
  if (!(err instanceof Error)) {
    return { code: "unknown", message: String(err ?? "unknown") };
  }
  const status =
    "status" in err && typeof (err as { status?: unknown }).status === "number"
      ? Number((err as { status: number }).status)
      : undefined;
  const data =
    "data" in err ? asData((err as { data?: unknown }).data) : undefined;
  const code = String(data?.error || err.message || "unknown");
  return { code, status, data, message: err.message || code };
}

/** Compact detail string safe to show in UI / bug reports. */
export function sanitizePublishErrorDetail(info: PublishErrorInfo): string {
  const parts: string[] = [];
  if (info.code && info.code !== "unknown") {
    parts.push(info.code);
  }
  if (info.status && info.status > 0) {
    parts.push(`HTTP ${info.status}`);
  }
  const serverMessage =
    typeof info.data?.message === "string" ? info.data.message.trim() : "";
  if (serverMessage && serverMessage !== info.code) {
    parts.push(serverMessage.slice(0, 120));
  } else if (
    info.message &&
    info.message !== info.code &&
    !info.message.startsWith("publish_http_")
  ) {
    parts.push(info.message.slice(0, 120));
  }
  const raw =
    typeof info.data?.raw === "string" ? info.data.raw.trim().slice(0, 80) : "";
  if (raw && parts.length === 0) {
    parts.push(raw);
  }
  const joined = parts.filter(Boolean).join(" · ");
  return joined.slice(0, 200);
}

function mapKnownPublishError(info: PublishErrorInfo): string | null {
  const code = info.code;
  const data = info.data;

  switch (code) {
    case "quota_exceeded": {
      const usage = formatPublishBytes(Number(data?.usageBytes ?? 0));
      const quota = formatPublishBytes(Number(data?.quotaBytes ?? 0));
      return getString("publish-error-quota", { args: { usage, quota } });
    }
    case "object_too_large": {
      const max = formatPublishBytes(
        Number(data?.maxObjectBytes ?? 50 * 1024 * 1024),
      );
      return getString("publish-error-object-too-large", { args: { max } });
    }
    case "invalid_token":
    case "missing_token":
    case "publish_auth_expired":
      return getString("publish-error-auth-expired");
    case "publish_auth_timeout":
      return getString("publish-error-auth-timeout");
    case "publish_oauth_not_configured":
    case "oauth_not_configured":
      return getString("progress-publish-oauth-unconfigured");
    case "publish_not_signed_in":
      return getString("publish-error-not-signed-in");
    case "publish_item_invalid":
      return getString("publish-error-item-invalid");
    case "publish_collection_missing":
      return getString("publish-error-collection-missing");
    case "publish_no_url":
      return getString("publish-error-no-url");
    case "publish_api_unconfigured":
      return getString("progress-publish-unconfigured");
    case "empty_body":
      return getString("publish-error-empty-body");
    case "server_misconfigured":
    case "oauth_request_failed":
      return getString("publish-error-server", {
        args: { detail: code },
      });
    default:
      break;
  }

  if (code.startsWith("publish_http_")) {
    const status =
      info.status || Number(code.replace("publish_http_", "")) || 0;
    if (status === 0) {
      return getString("publish-error-network");
    }
    return getString("publish-error-http", { args: { status } });
  }

  // Network / XHR failures often surface as generic Errors without our codes.
  const lower = info.message.toLowerCase();
  if (
    lower.includes("network") ||
    lower.includes("ns_error") ||
    lower.includes("offline") ||
    lower.includes("timed out") ||
    lower.includes("timeout")
  ) {
    return getString("publish-error-network");
  }

  return null;
}

/**
 * User-facing publish/share error text: a concrete explanation when known,
 * otherwise the summary plus a short raw detail for bug reports.
 */
export function formatPublishError(
  err: unknown,
  opts?: { fallback?: FluentMessageId },
): string {
  const info = getPublishErrorInfo(err);
  const mapped = mapKnownPublishError(info);
  if (mapped) return mapped;

  const summary = getString(opts?.fallback ?? "progress-publish-failed");
  const detail = sanitizePublishErrorDetail(info);
  if (!detail) return summary;
  return getString("publish-error-with-detail", {
    args: { summary, detail },
  });
}

/** Log structured publish failure info (code / status / data) for support. */
export function logPublishError(context: string, err: unknown): void {
  const info = getPublishErrorInfo(err);
  ztoolkit.log(`${context}:`, {
    code: info.code,
    status: info.status,
    data: info.data,
    message: info.message,
    err,
  });
}
