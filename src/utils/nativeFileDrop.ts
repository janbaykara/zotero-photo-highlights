/**
 * Syllabus wrappers around `@janbaykara/zotero-os-file-drop` with plugin
 * MIME prefixes and the custom items-pane root id.
 */

import {
  allowOsFileDragEvent as allowOsFileDragEventBase,
  isOsFileDrag as isOsFileDragBase,
  type OsFileDragOptions,
} from "@janbaykara/zotero-os-file-drop";
import { useOsFileDropHandlers as useOsFileDropHandlersBase } from "@janbaykara/zotero-os-file-drop/preact";
import type { UseOsFileDropHandlersOptions } from "@janbaykara/zotero-os-file-drop/preact";

export * from "@janbaykara/zotero-os-file-drop";

export const SYLLABUS_OS_FILE_DRAG_OPTIONS: OsFileDragOptions = {
  extraDragTypePrefixes: ["application/x-syllabus-"],
};

export const SYLLABUS_CUSTOM_VIEW_ELEMENT_ID = "syllabus-custom-view";

/** Syllabus plugin: ignore `.syllabus` note files on OS drop. */
export function isSyllabusNoteFileName(name: string): boolean {
  return name.toLowerCase().endsWith(".syllabus");
}

export function isOsFileDrag(
  dataTransfer: DataTransfer | null | undefined,
  options?: OsFileDragOptions,
): boolean {
  return isOsFileDragBase(dataTransfer, {
    ...SYLLABUS_OS_FILE_DRAG_OPTIONS,
    ...options,
    extraDragTypePrefixes: [
      ...(SYLLABUS_OS_FILE_DRAG_OPTIONS.extraDragTypePrefixes ?? []),
      ...(options?.extraDragTypePrefixes ?? []),
    ],
  });
}

export function allowOsFileDragEvent(
  event: DragEvent,
  options?: OsFileDragOptions,
): boolean {
  return allowOsFileDragEventBase(event, {
    ...SYLLABUS_OS_FILE_DRAG_OPTIONS,
    ...options,
    extraDragTypePrefixes: [
      ...(SYLLABUS_OS_FILE_DRAG_OPTIONS.extraDragTypePrefixes ?? []),
      ...(options?.extraDragTypePrefixes ?? []),
    ],
  });
}

export function useOsFileDropHandlers(
  options: Omit<
    UseOsFileDropHandlersOptions,
    "extraDragTypePrefixes" | "customViewElementId"
  > &
    Partial<
      Pick<
        UseOsFileDropHandlersOptions,
        "extraDragTypePrefixes" | "customViewElementId"
      >
    >,
) {
  return useOsFileDropHandlersBase({
    ...options,
    extraDragTypePrefixes: [
      ...(SYLLABUS_OS_FILE_DRAG_OPTIONS.extraDragTypePrefixes ?? []),
      ...(options.extraDragTypePrefixes ?? []),
    ],
    customViewElementId:
      options.customViewElementId ?? SYLLABUS_CUSTOM_VIEW_ELEMENT_ID,
  });
}
