/**
 * Roll back objects created during an aborted publish so quota failures
 * (and other mid-flight errors) do not leave orphan item prefixes.
 *
 * Only deletes paths that did not exist remotely before this session.
 * Overwrites of existing objects are not restored (we no longer have the
 * previous bytes).
 */

import { deletePublishObject, patchPublishItemRefs } from "./publishAuth";
import type { PublishTarget } from "./publishTarget";

export type PublishSessionUpload = {
  target: PublishTarget;
  relPath: string;
};

export type PublishSessionSyllabusRef = {
  libraryId: string;
  itemKey: string;
  collectionKey: string;
};

export function isPublishQuotaExceeded(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.message === "quota_exceeded") return true;
  const data =
    "data" in err && err.data && typeof err.data === "object"
      ? (err.data as { error?: unknown })
      : null;
  return data?.error === "quota_exceeded";
}

/** True when the remote listing already had a non-empty object at relPath. */
export function publishRemotePathExisted(
  objects: Record<string, { size?: number } | undefined> | null | undefined,
  relPath: string,
): boolean {
  const remote = objects?.[relPath];
  return Number(remote?.size || 0) > 0;
}

/**
 * Best-effort cleanup after a failed publish. Errors during delete are logged
 * and do not mask the original failure.
 */
export async function rollbackPublishSession(opts: {
  token: string;
  uploads: PublishSessionUpload[];
  /** Syllabus refs added this session for items that were not previously linked. */
  newSyllabusRefs?: PublishSessionSyllabusRef[];
  /** Item-page refs (setPage:true) set this session when the item had no page before. */
  clearItemPage?: { libraryId: string; itemKey: string } | null;
}): Promise<void> {
  const uploads = [...opts.uploads].reverse();
  for (const upload of uploads) {
    try {
      await deletePublishObject({
        token: opts.token,
        target: upload.target,
        relPath: upload.relPath,
      });
    } catch (err) {
      ztoolkit.log(
        "publish rollback: delete failed",
        upload.target,
        upload.relPath,
        err,
      );
    }
  }

  for (const ref of opts.newSyllabusRefs || []) {
    try {
      await patchPublishItemRefs({
        token: opts.token,
        libraryId: ref.libraryId,
        itemKey: ref.itemKey,
        removeSyllabus: ref.collectionKey,
      });
    } catch (err) {
      ztoolkit.log(
        "publish rollback: removeSyllabus failed",
        ref.itemKey,
        err,
      );
    }
  }

  if (opts.clearItemPage) {
    try {
      await patchPublishItemRefs({
        token: opts.token,
        libraryId: opts.clearItemPage.libraryId,
        itemKey: opts.clearItemPage.itemKey,
        setPage: false,
      });
    } catch (err) {
      ztoolkit.log("publish rollback: clear item page failed", err);
    }
  }
}
