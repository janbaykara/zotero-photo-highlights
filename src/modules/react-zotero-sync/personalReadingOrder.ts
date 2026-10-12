import { useAtomValue } from "jotai";
import {
  getPersonalReadingOrderDescription,
  getPersonalReadingOrderGeneration,
  getPersonalReadingOrderKeys,
  hasPersonalReadingOrder,
  isClassReadingDone,
  subscribePersonalReadingOrderChanges,
} from "../personalReadingOrder";
import {
  getCollectionDocument,
  subscribeToSyllabusDocumentChanges,
} from "../syllabusNote";
import { findClassIdByNumber } from "../../utils/schemas";
import { getCachedCollectionById } from "@janbaykara/zotero-cache";
import {
  atomFamilyFromExternal,
  atomFromExternal,
} from "@janbaykara/zotero-jotai-state";

const personalReadingOrderGenerationAtom = atomFromExternal({
  getSnapshot: () => getPersonalReadingOrderGeneration(),
  subscribe: subscribePersonalReadingOrderChanges,
  initial: 0,
});

export function usePersonalReadingOrderGeneration(): number {
  return useAtomValue(personalReadingOrderGenerationAtom) ?? 0;
}

/** Reactive ordered keys for a collection (empty when unset). */
export function usePersonalReadingOrderKeys(
  collectionId: number | null | undefined,
): string[] {
  const generation = usePersonalReadingOrderGeneration();
  if (!collectionId) {
    return [];
  }
  // generation is a dependency for re-render; read is from cache.
  void generation;
  const collection =
    getCachedCollectionById(collectionId) ||
    Zotero.Collections.get(collectionId) ||
    null;
  if (!collection) {
    return [];
  }
  return getPersonalReadingOrderKeys(collection);
}

export function useHasPersonalReadingOrder(
  collectionId: number | null | undefined,
): boolean {
  const keys = usePersonalReadingOrderKeys(collectionId);
  return keys.length > 0;
}

/** Reactive gallery / reading-list description for a collection. */
export function usePersonalReadingOrderDescription(
  collectionId: number | null | undefined,
): string {
  const generation = usePersonalReadingOrderGeneration();
  if (!collectionId) {
    return "";
  }
  void generation;
  return getPersonalReadingOrderDescription(collectionId);
}

export type ClassReadingDoneKey = {
  collectionId: number;
  classNumber: number;
};

function classReadingDoneKeyString(key: ClassReadingDoneKey): string {
  return `${key.collectionId}:${key.classNumber}`;
}

/** PRO classDone (+ legacy syllabus `classes[].status`) for a display class number. */
function readClassReadingDone(key: ClassReadingDoneKey): boolean {
  const document = getCollectionDocument(key.collectionId);
  const classId = findClassIdByNumber(
    document.classes,
    key.classNumber,
    document.classOrder,
  );
  if (!classId) {
    return false;
  }
  if (isClassReadingDone(key.collectionId, classId)) {
    return true;
  }
  return document.classes?.[classId]?.status === "done";
}

function subscribeClassReadingDoneSources(
  onStoreChange: () => void,
): () => void {
  const unsubPro = subscribePersonalReadingOrderChanges(onStoreChange);
  const unsubDoc = subscribeToSyllabusDocumentChanges(onStoreChange);
  return () => {
    unsubPro();
    unsubDoc();
  };
}

const classReadingDoneAtomFamily = atomFamilyFromExternal(
  (key: ClassReadingDoneKey) => ({
    getSnapshot: () => readClassReadingDone(key),
    subscribe: subscribeClassReadingDoneSources,
    initial: false,
  }),
  (a, b) => classReadingDoneKeyString(a) === classReadingDoneKeyString(b),
);

const CLASS_READING_DONE_SENTINEL: ClassReadingDoneKey = {
  collectionId: -1,
  classNumber: -1,
};

/**
 * Reactive class-level done (Personal Reading Order `classDone`).
 * Prefer this over `usePersonalReadingOrderGeneration` + `getClassStatus`.
 */
export function useClassReadingDone(
  collectionId: number | null | undefined,
  classNumber: number | null | undefined,
): boolean {
  const key =
    collectionId != null && classNumber != null
      ? { collectionId, classNumber }
      : CLASS_READING_DONE_SENTINEL;
  const done = useAtomValue(classReadingDoneAtomFamily(key)) ?? false;
  if (collectionId == null || classNumber == null) {
    return false;
  }
  return done;
}

export {
  hasPersonalReadingOrder,
  getPersonalReadingOrderKeys,
  getPersonalReadingOrderDescription,
};
