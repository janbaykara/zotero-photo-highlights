import { h } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { useAtom } from "jotai";
import { ZOTERO_ANNOTATION_COLOR_ORDER } from "@janbaykara/zotero-annotations";
import {
  allowOsFileDragEvent,
  isLeavingDropTarget,
} from "@janbaykara/zotero-os-file-drop";
import { getString } from "../utils/locale";
import type { FluentMessageId } from "../../typings/i10n";
import { booleanPrefAtomFamily, stringPrefAtomFamily } from "./prefAtoms";
import { pickOneBook } from "../utils/itemPicker";
import { openAnnotationInReader } from "../utils/openAnnotation";
import { recognizeImage } from "../ocr/recognize";
import {
  clearAttachmentTextCache,
  matchQuote,
  type LocatedPlace,
} from "../photo/corpus";
import {
  chooseImagePaths,
  copyIntoSession,
  imagePathsFromDrop,
  makeSessionDir,
  scaleLongestSide,
} from "../photo/files";
import { deleteFile, importPhoto, saveHighlight } from "../photo/save";
import { bakeExifOrientation, writeQuarterTurns } from "../photo/orient";
import { formatPhotoWhen, readPhotoTakenAt } from "../photo/takenAt";
import { OCR_LANGUAGES, type OcrWord, type PhotoDraft } from "../photo/types";

type Step = "add" | "link" | "mark" | "review" | "matching" | "summary";

type Decision =
  | {
      kind: "duplicate";
      photoId: string;
      place: LocatedPlace;
      existingQuote: string;
    }
  | { kind: "ambiguous"; photoId: string; places: LocatedPlace[] }
  | { kind: "unmatched"; photoId: string };

type Counts = {
  located: number;
  duplicatesSkipped: number;
  duplicatesCreated: number;
  unlocated: number;
  photosKept: number;
  skipped: number;
};

const EMPTY_COUNTS: Counts = {
  located: 0,
  duplicatesSkipped: 0,
  duplicatesCreated: 0,
  unlocated: 0,
  photosKept: 0,
  skipped: 0,
};

let nextPhotoId = 1;

export function PhotoWizard(props: {
  prefillBookId: number | null;
  /** Item context menu: every photo stays on that book. */
  lockBook: boolean;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>("add");
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  const [markIndex, setMarkIndex] = useState(0);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [decisionIndex, setDecisionIndex] = useState(0);
  const [counts, setCounts] = useState<Counts>(EMPTY_COUNTS);
  const [created, setCreated] = useState<Zotero.Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [matchDetail, setMatchDetail] = useState("");
  const [matchWhen, setMatchWhen] = useState("");
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [keepPhotos, setKeepPhotos] = useAtom(
    booleanPrefAtomFamily("retainUnmatchedPhotos"),
  );
  const [lang, setLang] = useAtom(
    stringPrefAtomFamily("photoAnnotationOcrLang"),
  );
  const sessionRef = useRef<string | null>(null);
  const reviewedRef = useRef(false);
  const fromReviewRef = useRef(false);

  const photosRef = useRef(photos);
  photosRef.current = photos;
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    return () => {
      for (const photo of photosRef.current) {
        if (reviewedRef.current && photo.kept) {
          continue;
        }
        void deleteFile(photo.sourcePath);
        void deleteFile(photo.scaledPath);
        if (photo.turnedPath) {
          void deleteFile(photo.turnedPath);
        }
      }
      clearAttachmentTextCache();
    };
  }, []);

  const addPaths = async (paths: string[]) => {
    if (!paths.length) {
      return;
    }
    const win = Zotero.getMainWindow();
    if (!win) {
      return;
    }
    if (!sessionRef.current) {
      sessionRef.current = await makeSessionDir();
    }
    const session = sessionRef.current;
    const drafts: PhotoDraft[] = [];
    for (const source of paths) {
      const index = nextPhotoId++;
      const copied = await copyIntoSession(session, source, index);
      const takenAt = await readPhotoTakenAt(source);
      try {
        await bakeExifOrientation(win, copied);
      } catch (error) {
        ztoolkit.log("Could not rotate photo", error);
      }
      const scaledPath = `${copied}.ocr.jpg`;
      const scaled = await scaleLongestSide(win, copied, scaledPath);
      drafts.push({
        id: String(index),
        name: source.split(/[/\\]/).pop() || getString("wizard-photo"),
        takenAt,
        sourcePath: copied,
        turnedPath: null,
        turns: 0,
        orientToken: 0,
        scaledPath,
        ocr: "pending",
        words: [],
        imageUrl: scaled.url,
        imageWidth: scaled.width,
        imageHeight: scaled.height,
        quote: "",
        selected: [],
        comment: "",
        color: "#ffd400",
        bookId: null,
        bookTitle: "",
        kept: false,
      });
    }
    const book = await loadedItem(props.prefillBookId);
    if (book) {
      const title = itemTitle(book);
      for (const draft of drafts) {
        draft.bookId = book.id;
        draft.bookTitle = title;
      }
    }
    setPhotos((current) => [...current, ...drafts]);
    for (const draft of drafts) {
      void runOcr(draft, lang, draft.orientToken);
    }
  };

  const orientRef = useRef<Record<string, { turns: number; token: number }>>(
    {},
  );
  const turnChain = useRef<Record<string, Promise<void>>>({});

  const runOcr = async (draft: PhotoDraft, language: string, token: number) => {
    setPhotos((current) =>
      current.map((photo) =>
        photo.id === draft.id && photo.orientToken === token
          ? { ...photo, ocr: "running" }
          : photo,
      ),
    );
    const win = Zotero.getMainWindow();
    if (!win) {
      setPhotos((current) =>
        current.map((photo) =>
          photo.id === draft.id && photo.orientToken === token
            ? { ...photo, ocr: "error" }
            : photo,
        ),
      );
      return;
    }
    try {
      const words = await recognizeImage(draft.imageUrl, language, win);
      setPhotos((current) =>
        current.map((photo) =>
          photo.id === draft.id && photo.orientToken === token
            ? { ...photo, ocr: "done", words, quote: "", selected: [] }
            : photo,
        ),
      );
    } catch (error) {
      ztoolkit.log("OCR failed", error);
      setPhotos((current) =>
        current.map((photo) =>
          photo.id === draft.id && photo.orientToken === token
            ? { ...photo, ocr: "error" }
            : photo,
        ),
      );
    }
  };

  const rotatePhoto = (id: string, delta: number) => {
    const photo = photosRef.current.find((item) => item.id === id);
    if (!photo) {
      return;
    }
    const previous = orientRef.current[id] ?? {
      turns: photo.turns,
      token: photo.orientToken,
    };
    const turns = previous.turns + delta;
    const token = previous.token + 1;
    orientRef.current[id] = { turns, token };
    updatePhoto(id, {
      turns,
      orientToken: token,
      ocr: "running",
      words: [],
      selected: [],
      quote: "",
    });
    const prior = turnChain.current[id] ?? Promise.resolve();
    const job = prior
      .catch(() => undefined)
      .then(() => applyTurns(photo, turns, token));
    turnChain.current[id] = job;
  };

  const removePhoto = (id: string) => {
    const photo = photosRef.current.find((item) => item.id === id);
    if (!photo) {
      return;
    }
    const previous = orientRef.current[id] ?? {
      turns: photo.turns,
      token: photo.orientToken,
    };
    const token = previous.token + 1;
    orientRef.current[id] = { turns: previous.turns, token };
    setPhotos((current) => current.filter((item) => item.id !== id));
    const prior = turnChain.current[id] ?? Promise.resolve();
    turnChain.current[id] = prior
      .catch(() => undefined)
      .then(async () => {
        if (orientRef.current[id]?.token !== token) {
          return;
        }
        const win = Zotero.getMainWindow();
        if (win && photo.imageUrl) {
          win.URL.revokeObjectURL(photo.imageUrl);
        }
        await deleteFile(photo.sourcePath);
        await deleteFile(photo.scaledPath);
        await deleteFile(photo.turnedPath || `${photo.sourcePath}.turned.jpg`);
      });
  };

  const applyTurns = async (
    photo: PhotoDraft,
    turns: number,
    token: number,
  ) => {
    if (orientRef.current[photo.id]?.token !== token) {
      return;
    }
    const win = Zotero.getMainWindow();
    if (!win) {
      updatePhoto(photo.id, { ocr: "error" });
      return;
    }
    const quarters = ((turns % 4) + 4) % 4;
    const turnedPath = quarters === 0 ? null : `${photo.sourcePath}.turned.jpg`;
    try {
      if (turnedPath) {
        await writeQuarterTurns(win, photo.sourcePath, turnedPath, quarters);
      } else {
        await deleteFile(`${photo.sourcePath}.turned.jpg`);
      }
      if (orientRef.current[photo.id]?.token !== token) {
        return;
      }
      const scaled = await scaleLongestSide(
        win,
        turnedPath ?? photo.sourcePath,
        photo.scaledPath,
      );
      let applied = false;
      let previousUrl = "";
      setPhotos((current) =>
        current.map((item) => {
          if (item.id !== photo.id || item.orientToken !== token) {
            return item;
          }
          applied = true;
          previousUrl = item.imageUrl;
          return {
            ...item,
            turnedPath,
            imageUrl: scaled.url,
            imageWidth: scaled.width,
            imageHeight: scaled.height,
            words: [],
            selected: [],
            quote: "",
            ocr: "running",
          };
        }),
      );
      if (!applied) {
        win.URL.revokeObjectURL(scaled.url);
        return;
      }
      if (previousUrl && previousUrl !== scaled.url) {
        win.URL.revokeObjectURL(previousUrl);
      }
      void runOcr(
        { ...photo, imageUrl: scaled.url, orientToken: token, turnedPath },
        lang,
        token,
      );
    } catch (error) {
      ztoolkit.log("Could not rotate photo", error);
      setPhotos((current) =>
        current.map((item) =>
          item.id === photo.id && item.orientToken === token
            ? { ...item, ocr: "error" }
            : item,
        ),
      );
    }
  };

  const updatePhoto = (id: string, patch: Partial<PhotoDraft>) => {
    setPhotos((current) =>
      current.map((photo) =>
        photo.id === id ? { ...photo, ...patch } : photo,
      ),
    );
  };

  const settlePhoto = async (
    photo: PhotoDraft,
  ): Promise<{ kind: "saved"; item: Zotero.Item } | Decision> => {
    if (!photo.bookId || !photo.quote.trim()) {
      return { kind: "unmatched", photoId: photo.id };
    }
    const book = await Zotero.Items.getAsync(photo.bookId);
    if (!book) {
      return { kind: "unmatched", photoId: photo.id };
    }
    let outcome;
    try {
      outcome = await matchQuote(book, photo.quote, selectionContext(photo));
    } catch (error) {
      const thrown = error as { message?: string };
      ztoolkit.log("Could not match photo", thrown?.message || String(error));
      return { kind: "unmatched", photoId: photo.id };
    }
    if (outcome.kind === "located") {
      try {
        const saved = await saveHighlight({
          attachmentId: outcome.place.attachmentId,
          quote: photo.quote,
          comment: photo.comment,
          color: photo.color,
          place: outcome.place,
        });
        await discardPhoto(photo);
        return { kind: "saved", item: saved.item };
      } catch (error) {
        const thrown = error as { message?: string };
        ztoolkit.log(
          "Could not save highlight",
          thrown?.message || String(error),
        );
        return { kind: "unmatched", photoId: photo.id };
      }
    }
    if (outcome.kind === "duplicate") {
      return {
        kind: "duplicate",
        photoId: photo.id,
        place: outcome.place,
        existingQuote: outcome.existingQuote,
      };
    }
    if (outcome.kind === "ambiguous") {
      return {
        kind: "ambiguous",
        photoId: photo.id,
        places: outcome.places,
      };
    }
    return { kind: "unmatched", photoId: photo.id };
  };

  const showMatching = async (
    photo: PhotoDraft,
    index: number,
    count: number,
  ) => {
    setMatchDetail(
      getString("wizard-matching-detail", {
        args: {
          title: photo.bookTitle || photo.name,
          index,
          count,
        },
      }),
    );
    setMatchWhen(photo.takenAt == null ? "" : formatPhotoWhen(photo.takenAt));
    const frame = globalThis.requestAnimationFrame?.bind(globalThis);
    await new Promise((resolve) => {
      if (frame) {
        frame(() => setTimeout(resolve, 32));
      } else {
        setTimeout(resolve, 32);
      }
    });
  };

  const goReview = async () => {
    setBusy(true);
    reviewedRef.current = true;
    fromReviewRef.current = false;
    setStep("matching");
    const nextDecisions: Decision[] = [];
    const nextCounts = { ...EMPTY_COUNTS };
    const nextCreated: Zotero.Item[] = [];
    try {
      for (let index = 0; index < photos.length; index++) {
        const photo = photos[index];
        await showMatching(photo, index + 1, photos.length);
        const result = await settlePhoto(photo);
        if (result.kind === "saved") {
          nextCreated.push(result.item);
          nextCounts.located += 1;
        } else {
          nextDecisions.push(result);
        }
      }
      setCounts(nextCounts);
      setCreated(nextCreated);
      setDecisions(nextDecisions);
      setDecisionIndex(0);
      setStep(nextDecisions.length ? "review" : "summary");
    } finally {
      setBusy(false);
    }
  };

  const rematchPhoto = async (photo: PhotoDraft) => {
    setBusy(true);
    setStep("matching");
    try {
      await showMatching(photo, 1, 1);
      const result = await settlePhoto(photo);
      if (result.kind === "saved") {
        setCreated((current) => [...current, result.item]);
        setCounts((current) => ({ ...current, located: current.located + 1 }));
        const rest = decisions.filter((item) => item.photoId !== photo.id);
        setDecisions(rest);
        setDecisionIndex((current) =>
          Math.min(current, Math.max(0, rest.length - 1)),
        );
        setStep(rest.length ? "review" : "summary");
      } else {
        setDecisions((current) =>
          current.map((item) => (item.photoId === photo.id ? result : item)),
        );
        setStep("review");
      }
    } finally {
      setBusy(false);
      fromReviewRef.current = false;
    }
  };

  const finishDecision = async (
    decision: Decision,
    action: "skip" | "create" | "unlocated" | "place",
    place?: LocatedPlace,
  ) => {
    const photo = photos.find((item) => item.id === decision.photoId);
    if (!photo) {
      return;
    }
    const next = { ...counts };
    if (action === "skip") {
      next.skipped += 1;
      if (decision.kind === "duplicate") {
        next.duplicatesSkipped += 1;
        await discardPhoto(photo);
      } else if (keepPhotos && photo.bookId) {
        photo.kept = true;
        await importPhoto(photo.bookId, photo.turnedPath || photo.sourcePath);
        next.photosKept += 1;
        await discardPhoto(photo);
      } else {
        await discardPhoto(photo);
      }
    } else if (action === "create" && decision.kind === "duplicate") {
      const saved = await saveHighlight({
        attachmentId: decision.place.attachmentId,
        quote: photo.quote,
        comment: photo.comment,
        color: photo.color,
        place: decision.place,
      });
      setCreated((current) => [...current, saved.item]);
      next.duplicatesCreated += 1;
      await discardPhoto(photo);
    } else if (action === "place" && place) {
      const saved = await saveHighlight({
        attachmentId: place.attachmentId,
        quote: photo.quote,
        comment: photo.comment,
        color: photo.color,
        place,
      });
      setCreated((current) => [...current, saved.item]);
      next.located += 1;
      await discardPhoto(photo);
    } else if (action === "unlocated" && photo.bookId) {
      const book = await Zotero.Items.getAsync(photo.bookId);
      const files = book ? await fileParent(book) : null;
      if (files) {
        const saved = await saveHighlight({
          attachmentId: files.id,
          quote: photo.quote,
          comment: photo.comment,
          color: photo.color,
          place: null,
        });
        setCreated((current) => [...current, saved.item]);
        next.unlocated += 1;
      }
      if (keepPhotos) {
        photo.kept = true;
        await importPhoto(photo.bookId, photo.turnedPath || photo.sourcePath);
        next.photosKept += 1;
        await discardPhoto(photo);
      } else {
        await discardPhoto(photo);
      }
    }
    setCounts(next);
    const following = decisionIndex + 1;
    if (following >= decisions.length) {
      setStep("summary");
    } else {
      setDecisionIndex(following);
    }
  };

  return (
    <div
      class="box-border flex h-full flex-col gap-5 px-8 py-6 text-sm text-primary"
      onDragEnter={(event) => {
        if (stepRef.current !== "add") return;
        allowPhotoDrop(event);
        setDraggingFiles(true);
      }}
      onDragOver={(event) => {
        if (stepRef.current !== "add") return;
        allowPhotoDrop(event);
      }}
      onDragLeave={(event) => {
        if (isLeavingDropTarget(event.currentTarget, event.relatedTarget)) {
          setDraggingFiles(false);
        }
      }}
      onDrop={(event) => {
        if (stepRef.current !== "add") return;
        allowPhotoDrop(event);
        setDraggingFiles(false);
        const paths = imagePathsFromDrop(event.dataTransfer);
        if (paths.length) void addPaths(paths);
      }}
    >
      <header class="flex flex-none items-center justify-between gap-6 border-b border-border pb-4">
        <h1 class="min-w-0 text-lg font-semibold tracking-tight">
          {titleFor(step)}
        </h1>
        <label class="flex shrink-0 items-center gap-2 text-xs text-secondary">
          <span>{getString("pref-ocr-lang")}</span>
          <select
            class="shrink-0"
            value={lang}
            onChange={(event) => {
              const next = (event.currentTarget as HTMLSelectElement).value;
              setLang(next);
              for (const photo of photosRef.current) {
                void runOcr(photo, next);
              }
            }}
          >
            {OCR_LANGUAGES.map((language) => (
              <option value={language.code}>
                {getString(language.key as FluentMessageId)}
              </option>
            ))}
          </select>
        </label>
      </header>
      <div
        class={`relative min-h-0 min-w-0 flex-1 ${
          step === "mark" ? "overflow-hidden" : "overflow-auto"
        }`}
      >
        {step === "add" ? (
          <AddStep
            photos={photos}
            dragging={draggingFiles}
            onRotate={rotatePhoto}
            onRemove={removePhoto}
            onChoose={async (win) => {
              try {
                await addPaths(
                  await chooseImagePaths(win, getString("wizard-add-choose")),
                );
              } catch (error) {
                ztoolkit.log("Could not open the photo picker", error);
              }
            }}
          />
        ) : null}
        {step === "link" ? (
          <LinkStep photos={photos} updatePhoto={updatePhoto} />
        ) : null}
        {step === "mark" ? (
          <div class="absolute inset-0">
            <MarkStep
              photo={photos[markIndex]}
              index={markIndex}
              count={photos.length}
              updatePhoto={updatePhoto}
            />
          </div>
        ) : null}
        {step === "matching" ? (
          <div class="flex h-full flex-col items-center justify-center gap-2 text-center">
            <p class="text-lg font-semibold tracking-tight">
              {getString("wizard-matching-title")}
            </p>
            <p class="text-sm text-secondary">{matchDetail}</p>
            {matchWhen ? <p class="text-sm font-medium">{matchWhen}</p> : null}
          </div>
        ) : null}
        {step === "review" ? (
          <ReviewStep
            decision={decisions[decisionIndex]}
            index={Math.max(
              0,
              photos.findIndex(
                (photo) => photo.id === decisions[decisionIndex]?.photoId,
              ),
            )}
            count={photos.length}
            photo={photos.find(
              (photo) => photo.id === decisions[decisionIndex]?.photoId,
            )}
            keepPhotos={keepPhotos}
            onKeep={(value) => {
              setKeepPhotos(value);
            }}
            onQuote={(quote) => {
              const photoId = decisions[decisionIndex]?.photoId;
              if (photoId) {
                updatePhoto(photoId, { quote });
              }
            }}
            onComment={(comment) => {
              const photoId = decisions[decisionIndex]?.photoId;
              if (photoId) {
                updatePhoto(photoId, { comment });
              }
            }}
            onRedo={() => {
              const photoId = decisions[decisionIndex]?.photoId;
              const index = photos.findIndex((photo) => photo.id === photoId);
              if (index >= 0) {
                setMarkIndex(index);
              }
              fromReviewRef.current = true;
              setStep("mark");
            }}
            onSearch={() => {
              const photo = photos.find(
                (item) => item.id === decisions[decisionIndex]?.photoId,
              );
              if (photo) {
                void rematchPhoto(photo);
              }
            }}
            onDecide={(action, place) =>
              void finishDecision(decisions[decisionIndex], action, place)
            }
          />
        ) : null}
        {step === "summary" ? (
          <SummaryStep
            counts={counts}
            created={created}
            onOpen={(item) => void openAnnotationInReader(item)}
          />
        ) : null}
      </div>
      <footer class="flex flex-none items-center justify-end gap-2 border-t border-border pt-4">
        {step === "link" || step === "mark" ? (
          <button
            type="button"
            class="px-3 py-1"
            onClick={() => {
              if (step === "mark" && fromReviewRef.current) {
                fromReviewRef.current = false;
                setStep("review");
                return;
              }
              if (step === "mark" && markIndex > 0) {
                setMarkIndex(markIndex - 1);
                return;
              }
              setStep(step === "mark" && !props.lockBook ? "link" : "add");
            }}
          >
            {getString("wizard-back")}
          </button>
        ) : null}
        {step === "add" || step === "link" || step === "mark" ? (
          <button
            type="button"
            class="px-3 py-1"
            disabled={
              busy ||
              (step === "add" && photos.length === 0) ||
              (step === "link" && photos.some((photo) => !photo.bookId))
            }
            onClick={() => {
              if (step === "add") {
                setMarkIndex(0);
                setStep(props.lockBook ? "mark" : "link");
              } else if (step === "link") {
                setMarkIndex(0);
                setStep("mark");
              } else if (fromReviewRef.current) {
                const photo = photos[markIndex];
                if (photo) {
                  void rematchPhoto(photo);
                }
              } else if (step === "mark" && markIndex < photos.length - 1) {
                setMarkIndex(markIndex + 1);
              } else {
                void goReview();
              }
            }}
          >
            {getString("wizard-next")}
          </button>
        ) : step === "matching" ? null : (
          <button type="button" class="px-3 py-1" onClick={props.onClose}>
            {getString("wizard-close")}
          </button>
        )}
      </footer>
    </div>
  );
}

function allowPhotoDrop(event: DragEvent): void {
  if (allowOsFileDragEvent(event)) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "copy";
  }
}

function titleFor(step: Step): string {
  if (step === "add") return getString("wizard-add-title");
  if (step === "link") return getString("wizard-link-title");
  if (step === "mark") return getString("wizard-mark-title");
  if (step === "review") return getString("wizard-review-title");
  if (step === "matching") return getString("wizard-matching-title");
  return getString("wizard-summary-title");
}

async function discardPhoto(photo: PhotoDraft): Promise<void> {
  await deleteFile(photo.sourcePath);
  await deleteFile(photo.scaledPath);
  if (photo.turnedPath) {
    await deleteFile(photo.turnedPath);
  }
}

async function fileParent(book: Zotero.Item): Promise<Zotero.Item | null> {
  const ids = book.getAttachments?.() || [];
  for (const id of ids) {
    const item = await Zotero.Items.getAsync(id);
    if (!item) {
      continue;
    }
    const type = item.attachmentContentType || "";
    const name = item.attachmentFilename || "";
    if (
      item.isPDFAttachment?.() ||
      type === "application/pdf" ||
      type === "application/epub+zip" ||
      /\.epub$/i.test(name)
    ) {
      return item;
    }
  }
  return null;
}

async function loadedItem(id: number | null): Promise<Zotero.Item | null> {
  if (!id) {
    return null;
  }
  const item = await Zotero.Items.getAsync(id);
  if (!item) {
    return null;
  }
  return item;
}

function itemTitle(item: Zotero.Item): string {
  try {
    return item.getDisplayTitle();
  } catch {
    return "";
  }
}

function RotateIcon(props: { direction: "left" | "right" }) {
  const right = props.direction === "right";
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        d={
          right
            ? "M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"
            : "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"
        }
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={right ? "M21 3v5h-5" : "M3 3v5h5"}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RemoveIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        d="M6 6l12 12M18 6L6 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function AddStep(props: {
  photos: PhotoDraft[];
  dragging: boolean;
  onChoose: (win: Window) => Promise<void>;
  onRotate: (id: string, delta: number) => void;
  onRemove: (id: string) => void;
}) {
  const empty = props.photos.length === 0;
  return (
    <div
      class={`box-border flex h-full min-h-full w-full min-w-0 flex-col gap-4 rounded-lg border border-dashed px-6 py-8 ${
        props.dragging
          ? "border-accent-blue bg-background-toolbar"
          : "border-border"
      } ${empty ? "items-center justify-center text-center" : ""}`}
    >
      <p class="max-w-md text-sm leading-relaxed text-secondary">
        {getString("wizard-add-help")}
      </p>
      <button
        type="button"
        class={`px-3 py-1 ${empty ? "" : "self-start"}`}
        onClick={(event) => {
          const view = event.currentTarget.ownerDocument.defaultView;
          if (!view) {
            return;
          }
          void props.onChoose(view);
        }}
      >
        {getString("wizard-add-choose")}
      </button>
      {empty ? null : (
        <ul class="mt-2 flex w-full min-w-0 max-w-full flex-col">
          {props.photos.map((photo) => (
            <li
              key={photo.id}
              class="flex items-center gap-3 border-t border-border py-2.5 text-left"
            >
              <img
                src={photo.imageUrl}
                alt={photo.name}
                draggable={false}
                class="shrink-0 rounded border border-border bg-background-toolbar object-contain"
                style="width:11rem;height:11rem"
              />
              <div class="min-w-0 flex-1">
                <div class="truncate font-medium">{photoLabel(photo)}</div>
                {photo.takenAt != null ? (
                  <div class="truncate text-xs text-secondary">
                    {photo.name}
                  </div>
                ) : null}
                <div
                  class={`text-xs ${photo.ocr === "done" ? "" : "text-secondary"}`}
                  style={
                    photo.ocr === "done"
                      ? "color:var(--accent-green)"
                      : undefined
                  }
                >
                  {ocrLabel(photo.ocr)}
                </div>
              </div>
              <div class="flex shrink-0 gap-1">
                <button
                  type="button"
                  class="px-2 py-1"
                  title={getString("wizard-rotate-left")}
                  aria-label={getString("wizard-rotate-left")}
                  onClick={() => props.onRotate(photo.id, -1)}
                >
                  <RotateIcon direction="left" />
                </button>
                <button
                  type="button"
                  class="px-2 py-1"
                  title={getString("wizard-rotate-right")}
                  aria-label={getString("wizard-rotate-right")}
                  onClick={() => props.onRotate(photo.id, 1)}
                >
                  <RotateIcon direction="right" />
                </button>
                <button
                  type="button"
                  class="px-2 py-1"
                  title={getString("wizard-add-remove")}
                  aria-label={getString("wizard-add-remove")}
                  onClick={() => props.onRemove(photo.id)}
                >
                  <RemoveIcon />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function photoLabel(photo: PhotoDraft): string {
  if (photo.takenAt == null) {
    return photo.name;
  }
  return formatPhotoWhen(photo.takenAt);
}

function ocrLabel(state: PhotoDraft["ocr"]): string {
  if (state === "running" || state === "pending")
    return getString("wizard-mark-ocr");
  if (state === "error") return getString("wizard-mark-ocr-failed");
  return getString("wizard-ocr-done");
}

function LinkStep(props: {
  photos: PhotoDraft[];
  updatePhoto: (id: string, patch: Partial<PhotoDraft>) => void;
}) {
  return (
    <ul class="flex flex-col">
      {props.photos.map((photo, index) => {
        const previous = index > 0 ? props.photos[index - 1] : null;
        return (
          <li
            key={photo.id}
            class="flex flex-col gap-2 border-b border-border py-4"
          >
            <div class="font-medium">{photoLabel(photo)}</div>
            {photo.takenAt != null ? (
              <div class="text-xs text-secondary">{photo.name}</div>
            ) : null}
            <div class="text-sm text-secondary">
              {photo.bookTitle || getString("wizard-link-missing")}
            </div>
            <div class="flex flex-wrap gap-2">
              {previous?.bookId ? (
                <button
                  type="button"
                  onClick={() =>
                    props.updatePhoto(photo.id, {
                      bookId: previous.bookId,
                      bookTitle: previous.bookTitle,
                    })
                  }
                >
                  {getString("wizard-link-also-from", {
                    args: { title: previous.bookTitle },
                  })}
                </button>
              ) : null}
              <button
                type="button"
                onClick={async () => {
                  const book = await pickOneBook();
                  if (!book) {
                    return;
                  }
                  props.updatePhoto(photo.id, {
                    bookId: book.id,
                    bookTitle: itemTitle(book),
                  });
                }}
              >
                {getString("wizard-link-search")}
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function MarkStep(props: {
  photo: PhotoDraft | undefined;
  index: number;
  count: number;
  updatePhoto: (id: string, patch: Partial<PhotoDraft>) => void;
}) {
  const photo = props.photo;
  const drag = useRef<{
    x: number;
    y: number;
    anchor: number | null;
  } | null>(null);
  if (!photo) {
    return null;
  }
  const applySelection = (anchor: number | null, end: number | null) => {
    const next = passageBetween(photo.words, anchor, end);
    if (
      sameIndexes(photo.selected, next.selected) &&
      photo.quote === next.quote
    ) {
      return;
    }
    props.updatePhoto(photo.id, next);
  };
  return (
    <div class="flex h-full min-h-0 min-w-0 items-stretch gap-4 overflow-hidden">
      <div
        class="flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden rounded-md border border-border bg-background-toolbar"
        style="container-type:size"
      >
        <div
          class="relative max-h-full max-w-full"
          style={photoFrameStyle(photo)}
          onDragStart={(event) => event.preventDefault()}
          onPointerDown={(event) => {
            event.preventDefault();
            const point = relativePoint(event);
            const anchor = wordIndexAt(photo.words, point.x, point.y, false);
            drag.current = { ...point, anchor };
            event.currentTarget.setPointerCapture(event.pointerId);
            applySelection(anchor, anchor);
          }}
          onPointerMove={(event) => {
            const start = drag.current;
            if (!start) {
              return;
            }
            event.preventDefault();
            const endPoint = relativePoint(event);
            let anchor = start.anchor;
            const end = wordIndexAt(photo.words, endPoint.x, endPoint.y, true);
            if (anchor == null && end != null) {
              anchor = end;
              start.anchor = end;
            }
            applySelection(anchor, end);
          }}
          onPointerUp={(event) => {
            const start = drag.current;
            drag.current = null;
            if (!start) {
              return;
            }
            const endPoint = relativePoint(event);
            const end = wordIndexAt(
              photo.words,
              endPoint.x,
              endPoint.y,
              start.x !== endPoint.x || start.y !== endPoint.y,
            );
            applySelection(start.anchor, end);
          }}
        >
          <img
            src={photo.imageUrl}
            draggable={false}
            alt=""
            class="pointer-events-none block h-full w-full"
            style="-moz-user-select:none;user-select:none;-webkit-user-drag:none"
          />
          <WordBoxes photo={photo} />
        </div>
      </div>
      <aside
        class="flex h-full min-h-0 shrink-0 flex-col gap-2 overflow-hidden"
        style="width:13rem"
      >
        <div class="flex flex-none flex-col gap-1">
          <p class="text-xs text-secondary">
            {getString("wizard-mark-count", {
              args: { index: props.index + 1, count: props.count },
            })}
          </p>
          {photo.takenAt != null ? (
            <p class="text-sm font-medium">{formatPhotoWhen(photo.takenAt)}</p>
          ) : null}
          <p class="text-xs text-secondary">{getString("wizard-mark-drag")}</p>
        </div>
        {photo.ocr === "running" || photo.ocr === "pending" ? (
          <p class="flex-none text-xs text-secondary">
            {getString("wizard-mark-ocr")}
          </p>
        ) : null}
        {photo.ocr === "error" ? (
          <p class="flex-none text-xs text-secondary">
            {getString("wizard-mark-ocr-failed")}
          </p>
        ) : null}
        <div class="flex min-h-0 flex-1 flex-col gap-1">
          <p class="text-xs text-secondary">
            {getString("wizard-mark-selected")}
          </p>
          <p class="min-h-0 flex-1 overflow-auto text-sm">{photo.quote}</p>
        </div>
        <div
          class="flex flex-none flex-wrap gap-1.5"
          role="listbox"
          aria-label={getString("wizard-mark-color")}
        >
          {ZOTERO_ANNOTATION_COLOR_ORDER.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={getString("wizard-color-swatch", {
                args: { color },
              })}
              class="h-5 w-5 rounded-full border border-border"
              style={{
                background: color,
                outline:
                  photo.color === color ? "2px solid currentColor" : "none",
              }}
              onClick={() => props.updatePhoto(photo.id, { color })}
            />
          ))}
        </div>
      </aside>
    </div>
  );
}

function photoFrameStyle(photo: PhotoDraft): string {
  const width = photo.imageWidth || 1;
  const height = photo.imageHeight || 1;
  return [
    "cursor:text",
    "user-select:none",
    "-moz-user-select:none",
    `aspect-ratio:${width}/${height}`,
    `width:min(100cqw, calc(100cqh * ${width} / ${height}))`,
    "max-width:100%",
    "max-height:100%",
  ].join(";");
}

function sameIndexes(current: number[] | undefined, next: number[]): boolean {
  if (!current || current.length !== next.length) {
    return false;
  }
  return current.every((index, place) => index === next[place]);
}

/** Words from the anchor through the word under the pointer, in reading order. */
function passageBetween(
  words: OcrWord[],
  anchor: number | null,
  end: number | null,
): { quote: string; selected: number[] } {
  if (anchor == null && end == null) {
    return { quote: "", selected: [] };
  }
  const from = anchor ?? end;
  const to = end ?? anchor;
  if (from == null || to == null) {
    return { quote: "", selected: [] };
  }
  const order = readingOrder(words);
  const startAt = order.indexOf(from);
  const endAt = order.indexOf(to);
  if (startAt < 0 || endAt < 0) {
    return { quote: "", selected: [] };
  }
  const selected = order.slice(
    Math.min(startAt, endAt),
    Math.max(startAt, endAt) + 1,
  );
  return {
    selected,
    quote: selected.map((index) => words[index]?.text || "").join(" "),
  };
}

function selectionContext(photo: PhotoDraft): {
  before: string;
  after: string;
} {
  const selected = new Set(photo.selected || []);
  if (!selected.size) {
    return { before: "", after: "" };
  }
  const order = readingOrder(photo.words);
  let first = -1;
  let last = -1;
  for (let place = 0; place < order.length; place++) {
    if (!selected.has(order[place])) {
      continue;
    }
    if (first < 0) {
      first = place;
    }
    last = place;
  }
  if (first < 0 || last < 0) {
    return { before: "", after: "" };
  }
  const textAt = (indexes: number[]) =>
    indexes
      .map((index) => photo.words[index]?.text || "")
      .filter(Boolean)
      .join(" ");
  const wing = 12;
  return {
    before: textAt(order.slice(Math.max(0, first - wing), first)),
    after: textAt(order.slice(last + 1, last + 1 + wing)),
  };
}

function readingOrder(words: OcrWord[]): number[] {
  const items = words.map((word, index) => ({ word, index }));
  items.sort((a, b) => a.word.y0 - b.word.y0 || a.word.x0 - b.word.x0);
  const lines: { word: OcrWord; index: number }[][] = [];
  for (const item of items) {
    const line = lines[lines.length - 1];
    const mid = (item.word.y0 + item.word.y1) / 2;
    if (
      line &&
      mid >= Math.min(...line.map((entry) => entry.word.y0)) &&
      mid <= Math.max(...line.map((entry) => entry.word.y1))
    ) {
      line.push(item);
    } else {
      lines.push([item]);
    }
  }
  return lines.flatMap((line) =>
    line.sort((a, b) => a.word.x0 - b.word.x0).map((entry) => entry.index),
  );
}

function wordIndexAt(
  words: OcrWord[],
  x: number,
  y: number,
  nearest: boolean,
): number | null {
  let containing = -1;
  let containingArea = Infinity;
  for (let index = 0; index < words.length; index++) {
    const word = words[index];
    if (!word || x < word.x0 || x > word.x1 || y < word.y0 || y > word.y1) {
      continue;
    }
    const area = (word.x1 - word.x0) * (word.y1 - word.y0);
    if (area < containingArea) {
      containing = index;
      containingArea = area;
    }
  }
  if (containing >= 0) {
    return containing;
  }
  let nearestIndex = -1;
  let nearestDist = Infinity;
  for (let index = 0; index < words.length; index++) {
    const word = words[index];
    if (!word) {
      continue;
    }
    const dx = x < word.x0 ? word.x0 - x : x > word.x1 ? x - word.x1 : 0;
    const dy = y < word.y0 ? word.y0 - y : y > word.y1 ? y - word.y1 : 0;
    const dist = Math.hypot(dx, dy);
    const pad = nearest ? Infinity : Math.max(8, (word.y1 - word.y0) * 0.45);
    if (dist <= pad && dist < nearestDist) {
      nearestIndex = index;
      nearestDist = dist;
    }
  }
  return nearestIndex >= 0 ? nearestIndex : null;
}

function relativePoint(event: h.JSX.TargetedPointerEvent<HTMLDivElement>): {
  x: number;
  y: number;
} {
  const bounds = event.currentTarget.getBoundingClientRect();
  const image = event.currentTarget.querySelector("img");
  const naturalWidth = image?.naturalWidth || bounds.width || 1;
  const naturalHeight = image?.naturalHeight || bounds.height || 1;
  const scaleX = naturalWidth / (bounds.width || 1);
  const scaleY = naturalHeight / (bounds.height || 1);
  return {
    x: (event.clientX - bounds.left) * scaleX,
    y: (event.clientY - bounds.top) * scaleY,
  };
}

function WordBoxes(props: { photo: PhotoDraft }) {
  const selected = new Set(props.photo.selected || []);
  return (
    <div class="pointer-events-none absolute inset-0">
      {props.photo.words.map((word, index) => (
        <span
          key={`${word.x0}-${word.y0}-${word.text}`}
          class="absolute"
          style={wordStyle(word, props.photo, selected.has(index))}
        />
      ))}
    </div>
  );
}

function wordStyle(
  word: OcrWord,
  photo: PhotoDraft,
  selected: boolean,
): string {
  const width = photo.imageWidth || 1;
  const height = photo.imageHeight || 1;
  const left = (word.x0 / width) * 100;
  const top = (word.y0 / height) * 100;
  const boxWidth = ((word.x1 - word.x0) / width) * 100;
  const boxHeight = ((word.y1 - word.y0) / height) * 100;
  const box = `left:${left}%;top:${top}%;width:${boxWidth}%;height:${boxHeight}%`;
  if (!selected) {
    return box;
  }
  return `${box};background:${colorWithAlpha(photo.color, 0.6)}`;
}

function colorWithAlpha(color: string, alpha: number): string {
  const hex = color.replace("#", "");
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((channel) => channel + channel)
          .join("")
      : hex;
  const red = Number.parseInt(full.slice(0, 2), 16);
  const green = Number.parseInt(full.slice(2, 4), 16);
  const blue = Number.parseInt(full.slice(4, 6), 16);
  if ([red, green, blue].some((channel) => Number.isNaN(channel))) {
    return color;
  }
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function reviewCopy(kind: Decision["kind"]): {
  title: FluentMessageId;
  help: FluentMessageId;
} {
  if (kind === "duplicate") {
    return {
      title: "wizard-review-duplicate",
      help: "wizard-review-duplicate-help",
    };
  }
  if (kind === "ambiguous") {
    return {
      title: "wizard-review-ambiguous",
      help: "wizard-review-ambiguous-help",
    };
  }
  return {
    title: "wizard-review-unmatched",
    help: "wizard-review-unmatched-help",
  };
}

type ReviewChoice = { kind: "place"; index: number } | { kind: "none" };

function choiceSignature(decision: Decision): string {
  if (decision.kind !== "ambiguous") {
    return `${decision.photoId}:${decision.kind}`;
  }
  return `${decision.photoId}:ambiguous:${decision.places
    .map((place) => place.positionJSON)
    .join("\n")}`;
}

function ReviewStep(props: {
  decision: Decision | undefined;
  photo: PhotoDraft | undefined;
  index: number;
  count: number;
  keepPhotos: boolean;
  onKeep: (value: boolean) => void;
  onQuote: (quote: string) => void;
  onComment: (comment: string) => void;
  onRedo: () => void;
  onSearch: () => void;
  onDecide: (
    action: "skip" | "create" | "unlocated" | "place",
    place?: LocatedPlace,
  ) => void;
}) {
  const decision = props.decision;
  const photo = props.photo;
  const [choice, setChoice] = useState<ReviewChoice | null>(null);
  const [editingQuote, setEditingQuote] = useState(false);
  const [addingComment, setAddingComment] = useState(
    () => (photo?.comment.trim().length ?? 0) > 0,
  );
  const quoteRef = useRef<HTMLTextAreaElement>(null);
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const quoteFocus = useRef(false);
  const commentFocus = useRef(false);
  const signature = decision ? choiceSignature(decision) : "";
  const commentAlreadySet = (photo?.comment.trim().length ?? 0) > 0;
  const commentAlreadySetRef = useRef(commentAlreadySet);
  commentAlreadySetRef.current = commentAlreadySet;
  useEffect(() => {
    setChoice(null);
    setEditingQuote(false);
    setAddingComment(commentAlreadySetRef.current);
  }, [signature]);
  useEffect(() => {
    if (editingQuote && quoteFocus.current) {
      quoteFocus.current = false;
      quoteRef.current?.focus();
    }
  }, [editingQuote]);
  useEffect(() => {
    if (addingComment && commentFocus.current) {
      commentFocus.current = false;
      commentRef.current?.focus();
    }
  }, [addingComment]);
  if (!decision || !photo) {
    return null;
  }
  const copy = reviewCopy(decision.kind);
  const saveChoice = () => {
    if (!choice || decision.kind !== "ambiguous") {
      return;
    }
    if (choice.kind === "none") {
      props.onDecide("unlocated");
      return;
    }
    const place = decision.places[choice.index];
    if (place) {
      props.onDecide("place", place);
    }
  };
  return (
    <div class="flex flex-col gap-4">
      <div class="flex items-start gap-4">
        <img
          src={photo.imageUrl}
          alt={photo.name}
          draggable={false}
          class="shrink-0 rounded-md border border-border bg-background-toolbar object-contain"
          style="width:8rem;height:8rem"
        />
        <div class="flex min-w-0 flex-1 flex-col gap-2">
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <p class="text-lg font-semibold">
              {getString("wizard-mark-count", {
                args: { index: props.index + 1, count: props.count },
              })}
            </p>
            <p class="text-sm text-secondary">
              {photo.takenAt != null
                ? formatPhotoWhen(photo.takenAt)
                : photo.name}
            </p>
          </div>
          <div class="flex flex-col gap-1 rounded-md border border-border bg-background-toolbar px-3 py-3">
            <p class="text-lg font-semibold">{getString(copy.title)}</p>
            <p class="text-sm text-secondary">{getString(copy.help)}</p>
          </div>
        </div>
      </div>
      {decision.kind === "duplicate" ? (
        <div class="flex flex-col gap-1">
          <p class="text-sm font-semibold">
            {getString("wizard-review-page", {
              args: { label: decision.place.label },
            })}
          </p>
          <p class="text-sm text-secondary">{decision.existingQuote}</p>
        </div>
      ) : null}
      {decision.kind === "ambiguous" ? (
        <div class="flex flex-col gap-2">
          <div
            class="min-w-0"
            style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;align-items:stretch;"
          >
            {decision.places.map((place, index) => {
              const selected =
                choice?.kind === "place" && choice.index === index;
              return (
                <button
                  key={`${index}:${place.positionJSON}`}
                  type="button"
                  aria-pressed={selected}
                  style={placeCardStyle(selected)}
                  onClick={() => setChoice({ kind: "place", index })}
                >
                  <span class="text-xs font-semibold">
                    {getString("wizard-review-page", {
                      args: { label: place.label },
                    })}
                  </span>
                  <span class="text-sm" style={placePreviewStyle}>
                    {place.preview}
                  </span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            aria-pressed={choice?.kind === "none"}
            style={placeCardStyle(choice?.kind === "none")}
            onClick={() => setChoice({ kind: "none" })}
          >
            <span class="text-sm font-semibold">
              {getString("wizard-review-none")}
            </span>
          </button>
        </div>
      ) : null}
      {editingQuote ? (
        <label class="flex flex-col gap-1 text-xs text-secondary">
          {getString("wizard-review-edit")}
          <textarea
            ref={quoteRef}
            class="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-primary"
            rows={3}
            value={photo.quote}
            onInput={(event) =>
              props.onQuote((event.currentTarget as HTMLTextAreaElement).value)
            }
          />
        </label>
      ) : (
        <div>
          <button
            type="button"
            onClick={() => {
              quoteFocus.current = true;
              setEditingQuote(true);
            }}
          >
            {getString("wizard-review-edit")}
          </button>
        </div>
      )}
      <div class="flex flex-wrap gap-2">
        {editingQuote ? (
          <button type="button" onClick={props.onSearch}>
            {getString("wizard-review-search-again")}
          </button>
        ) : null}
        <button type="button" onClick={props.onRedo}>
          {getString("wizard-review-redo")}
        </button>
      </div>
      {addingComment ? (
        <label class="flex flex-col gap-1 text-xs text-secondary">
          {getString("wizard-review-add-comment")}
          <textarea
            ref={commentRef}
            class="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-primary"
            rows={2}
            value={photo.comment}
            onInput={(event) =>
              props.onComment(
                (event.currentTarget as HTMLTextAreaElement).value,
              )
            }
          />
        </label>
      ) : (
        <div>
          <button
            type="button"
            onClick={() => {
              commentFocus.current = true;
              setAddingComment(true);
            }}
          >
            {getString("wizard-review-add-comment")}
          </button>
        </div>
      )}
      {decision.kind === "ambiguous" && choice?.kind === "none" ? (
        <KeepPhotoToggle checked={props.keepPhotos} onChange={props.onKeep} />
      ) : null}
      {decision.kind === "ambiguous" ? (
        <div>
          <button type="button" disabled={choice == null} onClick={saveChoice}>
            {getString("wizard-review-save")}
          </button>
        </div>
      ) : null}
      {decision.kind === "duplicate" ? (
        <div class="flex flex-wrap gap-2">
          <button type="button" onClick={() => props.onDecide("skip")}>
            {getString("wizard-review-skip")}
          </button>
          <button type="button" onClick={() => props.onDecide("create")}>
            {getString("wizard-review-create")}
          </button>
        </div>
      ) : null}
      {decision.kind === "unmatched" ? (
        <div class="flex flex-col gap-2">
          <KeepPhotoToggle checked={props.keepPhotos} onChange={props.onKeep} />
          <div class="flex flex-wrap gap-2">
            <button type="button" onClick={() => props.onDecide("unlocated")}>
              {getString("wizard-review-unlocated")}
            </button>
            <button type="button" onClick={() => props.onDecide("skip")}>
              {getString("wizard-review-skip-reader")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const placePreviewStyle =
  "display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden;";

function placeCardStyle(selected: boolean): string {
  const border = selected
    ? "2px solid var(--accent-blue, #2ea8e5)"
    : "1px solid var(--color-border, rgba(0, 0, 0, 0.18))";
  const background = selected
    ? "color-mix(in srgb, var(--accent-blue, #2ea8e5) 14%, transparent)"
    : "transparent";
  return [
    "appearance:none",
    "-moz-appearance:none",
    "display:flex",
    "flex-direction:column",
    "align-items:flex-start",
    "gap:0.25rem",
    "width:100%",
    "height:100%",
    "min-width:0",
    "margin:0",
    "box-sizing:border-box",
    "padding:0.6rem 0.75rem",
    "text-align:left",
    "white-space:normal",
    "border-radius:6px",
    `border:${border}`,
    `background:${background}`,
    "color:inherit",
    "cursor:pointer",
  ].join(";");
}

function KeepPhotoToggle(props: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label class="flex items-center gap-2">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(event) =>
          props.onChange((event.currentTarget as HTMLInputElement).checked)
        }
      />
      {getString("wizard-review-keep-photo")}
    </label>
  );
}

function SummaryStep(props: {
  counts: Counts;
  created: Zotero.Item[];
  onOpen: (item: Zotero.Item) => void;
}) {
  const rows: Array<[keyof Counts, FluentMessageId]> = [
    ["located", "wizard-summary-located"],
    ["duplicatesSkipped", "wizard-summary-duplicates-skipped"],
    ["duplicatesCreated", "wizard-summary-duplicates-created"],
    ["unlocated", "wizard-summary-unlocated"],
    ["photosKept", "wizard-summary-photos-kept"],
    ["skipped", "wizard-summary-skipped"],
  ];
  return (
    <div class="flex flex-col gap-5">
      <svg
        viewBox="0 0 24 24"
        width="36"
        height="36"
        aria-hidden="true"
        class="shrink-0"
      >
        <circle cx="12" cy="12" r="12" fill="#2f9e44" />
        <path
          d="M6.8 12.5l3.2 3.2 7.2-7.5"
          fill="none"
          stroke="#fff"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div style="display:grid;grid-template-columns:repeat(3, minmax(0, 1fr));gap:0.75rem">
        {rows.map(([key, message]) => (
          <div
            key={key}
            class="flex flex-col gap-1 rounded-md border border-border px-3 py-3"
          >
            <p
              class="font-semibold text-primary"
              style="font-size:28px;line-height:1.1"
            >
              {props.counts[key]}
            </p>
            <p class="text-xs text-secondary">{getString(message)}</p>
          </div>
        ))}
      </div>
      {props.created[0] ? (
        <div>
          <button type="button" onClick={() => props.onOpen(props.created[0])}>
            {getString("wizard-summary-open")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
