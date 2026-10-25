import type { LocatedPlace } from "./corpus";

export type SavedHighlight = {
  item: Zotero.Item;
};

export async function saveHighlight(options: {
  attachmentId: number;
  quote: string;
  comment: string;
  color: string;
  place?: LocatedPlace | null;
  takenAt?: number | null;
}): Promise<SavedHighlight> {
  const attachment = await Zotero.Items.getAsync(options.attachmentId);
  if (!attachment) {
    throw new Error("Attachment missing");
  }
  const annotation = new Zotero.Item("annotation");
  annotation.libraryID = attachment.libraryID;
  annotation.parentItemID = attachment.id;
  annotation.annotationType = "highlight";
  annotation.annotationText = options.quote;
  annotation.annotationComment = options.comment;
  annotation.annotationColor = options.color;
  if (options.place) {
    annotation.annotationPageLabel = options.place.pageLabel;
    annotation.annotationSortIndex = options.place.sortIndex;
    annotation.annotationPosition = options.place.positionJSON;
  } else {
    annotation.annotationPageLabel = "";
    annotation.annotationSortIndex = "00000|000000|00000";
    annotation.annotationPosition = "{}";
  }
  if (options.takenAt != null && Number.isFinite(options.takenAt)) {
    annotation.dateAdded = new Date(options.takenAt).toISOString();
  }
  await annotation.saveTx();
  return { item: annotation };
}

export async function importPhoto(bookId: number, path: string): Promise<void> {
  await Zotero.Attachments.importFromFile({
    file: path,
    parentItemID: bookId,
  });
}

export async function deleteFile(path: string): Promise<void> {
  try {
    await IOUtils.remove(path, { ignoreAbsent: true });
  } catch (error) {
    ztoolkit.log("Could not delete temp photo", error);
  }
}
