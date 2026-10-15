import type { Env } from "./types";
import { userRootPrefix } from "./paths";

export function parseIntEnv(
  value: string | undefined,
  fallback: number,
): number {
  const n = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function getUsageBytes(env: Env, userId: string): Promise<number> {
  const raw = await env.KV.get(`usage:${userId}`);
  if (!raw) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export async function setUsageBytes(
  env: Env,
  userId: string,
  bytes: number,
): Promise<void> {
  await env.KV.put(`usage:${userId}`, String(Math.max(0, Math.floor(bytes))));
}

/** Global default from USER_QUOTA_BYTES (fallback 200 MB). */
export function getDefaultQuotaBytes(env: Env): number {
  return parseIntEnv(env.USER_QUOTA_BYTES, 209715200);
}

/**
 * Effective quota for a user: KV `quota:{userId}` override if set,
 * otherwise USER_QUOTA_BYTES.
 */
export async function getQuotaBytes(
  env: Env,
  userId: string,
): Promise<{ quotaBytes: number; override: boolean }> {
  const raw = await env.KV.get(`quota:${userId}`);
  if (raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) {
      return { quotaBytes: n, override: true };
    }
  }
  return { quotaBytes: getDefaultQuotaBytes(env), override: false };
}

export async function setQuotaBytes(
  env: Env,
  userId: string,
  bytes: number,
): Promise<number> {
  const n = Math.floor(bytes);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error("invalid_quota");
  }
  await env.KV.put(`quota:${userId}`, String(n));
  return n;
}

export async function clearQuotaBytes(
  env: Env,
  userId: string,
): Promise<void> {
  await env.KV.delete(`quota:${userId}`);
}

/** Sum object sizes under the user prefix (reconcile). */
export async function reconcileUsage(
  env: Env,
  userId: string,
): Promise<number> {
  const prefix = userRootPrefix(userId);
  let cursor: string | undefined;
  let total = 0;
  do {
    const listed = await env.BUCKET.list({ prefix, cursor, limit: 1000 });
    for (const obj of listed.objects) {
      total += obj.size;
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  await setUsageBytes(env, userId, total);
  return total;
}

export async function headSize(env: Env, key: string): Promise<number> {
  const obj = await env.BUCKET.head(key);
  return obj?.size ?? 0;
}
