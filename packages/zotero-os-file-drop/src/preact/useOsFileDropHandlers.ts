import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import {
  allowOsFileDragEvent,
  customViewDropRoot,
  isLeavingDropTarget,
  isOsFileDrag,
  type OsFileDragOptions,
} from "../nativeFileDrop";

export type UseOsFileDropHandlersOptions = OsFileDragOptions & {
  onOsFileDrop: (event: DragEvent) => void | Promise<void>;
  acceptDrop?: () => boolean;
  onOsFileDragHover?: (event: DragEvent | null) => void;
  /** Optional items-pane overlay root (`#id`) that should also receive OS drops. */
  customViewElementId?: string | null;
};

export function useOsFileDropHandlers(options: UseOsFileDropHandlersOptions): {
  isDraggingFile: boolean;
  onDragEnter: (event: JSX.TargetedDragEvent<HTMLElement>) => void;
  onDragOver: (event: JSX.TargetedDragEvent<HTMLElement>) => void;
  onDragLeave: (event: JSX.TargetedDragEvent<HTMLElement>) => void;
  onDrop: (event: JSX.TargetedDragEvent<HTMLElement>) => void;
} {
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const onOsFileDropRef = useRef(options.onOsFileDrop);
  onOsFileDropRef.current = options.onOsFileDrop;
  const acceptDropRef = useRef(options.acceptDrop);
  acceptDropRef.current = options.acceptDrop;
  const onOsFileDragHoverRef = useRef(options.onOsFileDragHover);
  onOsFileDragHoverRef.current = options.onOsFileDragHover;
  const dragOptionsRef = useRef<OsFileDragOptions>({
    extraDragTypePrefixes: options.extraDragTypePrefixes,
  });
  dragOptionsRef.current = {
    extraDragTypePrefixes: options.extraDragTypePrefixes,
  };
  const customViewElementId = options.customViewElementId ?? null;

  const setDraggingFile = useCallback((next: boolean, event?: DragEvent) => {
    setIsDraggingFile(next);
    if (next && event) {
      onOsFileDragHoverRef.current?.(event);
      return;
    }
    if (!next) {
      onOsFileDragHoverRef.current?.(null);
    }
  }, []);

  const canHandle = useCallback(
    (dataTransfer: DataTransfer | null | undefined) => {
      if (!isOsFileDrag(dataTransfer, dragOptionsRef.current)) {
        return false;
      }
      if (acceptDropRef.current) {
        return acceptDropRef.current();
      }
      return true;
    },
    [],
  );

  const onDragEnter = useCallback(
    (event: JSX.TargetedDragEvent<HTMLElement>) => {
      if (!canHandle(event.dataTransfer)) {
        return;
      }
      allowOsFileDragEvent(event, dragOptionsRef.current);
      setDraggingFile(true, event);
    },
    [canHandle, setDraggingFile],
  );

  const onDragOver = useCallback(
    (event: JSX.TargetedDragEvent<HTMLElement>) => {
      if (!canHandle(event.dataTransfer)) {
        return;
      }
      allowOsFileDragEvent(event, dragOptionsRef.current);
      onOsFileDragHoverRef.current?.(event);
    },
    [canHandle],
  );

  const onDragLeave = useCallback(
    (event: JSX.TargetedDragEvent<HTMLElement>) => {
      if (!isOsFileDrag(event.dataTransfer, dragOptionsRef.current)) {
        return;
      }
      if (isLeavingDropTarget(event.currentTarget, event.relatedTarget)) {
        setDraggingFile(false);
      }
    },
    [setDraggingFile],
  );

  const onDrop = useCallback(
    (event: JSX.TargetedDragEvent<HTMLElement>) => {
      if (!canHandle(event.dataTransfer)) {
        return;
      }
      allowOsFileDragEvent(event, dragOptionsRef.current);
      setDraggingFile(false);
      void onOsFileDropRef.current(event);
    },
    [canHandle, setDraggingFile],
  );

  useEffect(() => {
    const root = customViewDropRoot(customViewElementId);
    if (!root) {
      return;
    }
    const handleEnter = (event: DragEvent) => {
      if (!canHandle(event.dataTransfer)) {
        return;
      }
      allowOsFileDragEvent(event, dragOptionsRef.current);
      setDraggingFile(true, event);
    };
    const handleOver = (event: DragEvent) => {
      if (!canHandle(event.dataTransfer)) {
        return;
      }
      allowOsFileDragEvent(event, dragOptionsRef.current);
      onOsFileDragHoverRef.current?.(event);
    };
    const handleLeave = (event: DragEvent) => {
      if (!isOsFileDrag(event.dataTransfer, dragOptionsRef.current)) {
        return;
      }
      if (isLeavingDropTarget(root, event.relatedTarget)) {
        setDraggingFile(false);
      }
    };
    const handleDrop = (event: DragEvent) => {
      if (!canHandle(event.dataTransfer)) {
        return;
      }
      allowOsFileDragEvent(event, dragOptionsRef.current);
      setDraggingFile(false);
      void onOsFileDropRef.current(event);
    };
    root.addEventListener("dragenter", handleEnter, true);
    root.addEventListener("dragover", handleOver, true);
    root.addEventListener("dragleave", handleLeave, true);
    root.addEventListener("drop", handleDrop, true);
    return () => {
      root.removeEventListener("dragenter", handleEnter, true);
      root.removeEventListener("dragover", handleOver, true);
      root.removeEventListener("dragleave", handleLeave, true);
      root.removeEventListener("drop", handleDrop, true);
    };
  }, [canHandle, customViewElementId, setDraggingFile]);

  useEffect(() => {
    const handleDragEnd = () => setDraggingFile(false);
    const doc = Zotero.getMainWindow()?.document ?? document;
    doc.addEventListener("dragend", handleDragEnd);
    return () => doc.removeEventListener("dragend", handleDragEnd);
  }, [setDraggingFile]);

  return { isDraggingFile, onDragEnter, onDragOver, onDragLeave, onDrop };
}
