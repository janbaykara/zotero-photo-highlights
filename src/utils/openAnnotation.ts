export async function openAnnotationInReader(
  annotation: Zotero.Item,
): Promise<void> {
  const key = String(annotation.key || "").trim();
  const attachmentID = Number(annotation.parentItemID || 0);
  if (!attachmentID || !key) {
    ztoolkit.log("openAnnotationInReader: missing attachment or key", {
      id: annotation.id,
      attachmentID,
      key,
    });
    return;
  }
  const location = { annotationID: key, annotationKey: key };
  try {
    const attachment = await Zotero.Items.getAsync(attachmentID);
    if (attachment) {
      const opened = await Zotero.FileHandlers.open(attachment, { location });
      if (opened) {
        return;
      }
    }
  } catch (error) {
    ztoolkit.log("openAnnotationInReader: FileHandlers.open failed", error);
  }
  try {
    await Zotero.Reader.open(attachmentID, location);
  } catch (error) {
    ztoolkit.log("openAnnotationInReader: Reader.open failed", error);
  }
}
