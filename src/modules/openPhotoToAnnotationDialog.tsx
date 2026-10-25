// Classic JSX (`h`) is referenced by the compiler, not by an identifier.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { h } from "preact";
import {
  openPreactDialog,
  type PreactDialogHandle,
} from "@janbaykara/zotero-preact";
import { getString } from "../utils/locale";
import { isTestEnv } from "../utils/env";
import { PhotoWizard } from "./PhotoWizard";

let openHandle: PreactDialogHandle | null = null;

export function openPhotoToAnnotationDialog(
  prefillBookId: number | null,
  lockBook = false,
): void {
  if (isTestEnv()) {
    return;
  }
  if (openHandle?.window && !openHandle.window.closed) {
    openHandle.window.focus();
    return;
  }
  openHandle = openPreactDialog({
    title: getString("wizard-title"),
    rootId: "photo-highlights-root",
    singleton: false,
    content: () => (
      <PhotoWizard
        prefillBookId={prefillBookId}
        lockBook={lockBook && prefillBookId != null}
        onClose={() => {
          openHandle?.close();
          openHandle = null;
        }}
      />
    ),
    features: {
      width: 900,
      height: 640,
      noDialogMode: true,
      fitContent: false,
      resizable: true,
    },
    onUnload: () => {
      openHandle = null;
    },
  });
}
