/**
 * @janbaykara/zotero-dnd — chrome-safe @dnd-kit/abstract layer (no Preact).
 *
 * Preact bindings: `@janbaykara/zotero-dnd/preact`
 */

export { createZoteroDndManager } from "./createManager";
export type { CreateZoteroDndManagerOptions } from "./createManager";
export type { ZoteroDndManager } from "./types";
export { ChromePointerSensor } from "./pointerSensor";
export type { ChromePointerSensorOptions } from "./pointerSensor";
export { ChromeFeedbackPlugin } from "./feedbackPlugin";
export {
  setCoDragElements,
  clearCoDragElements,
  getCoDragElements,
} from "./coDrag";
export { OptimisticSortingPlugin } from "./optimisticSortingPlugin";
export { SortableTransitionPlugin } from "./sortableTransitionPlugin";
export { DropIndicatorPlugin, getDropIndicator } from "./dropIndicatorPlugin";
export {
  applyDropIndicatorMove,
  applyMultiDropIndicatorMove,
  moveToContainerEnd,
  moveMultipleToContainerEnd,
  resolveDragIds,
  idsInContainerOrder,
  dropEdgeForPointer,
  DROP_INDICATOR_BEFORE_CLASS,
  DROP_INDICATOR_AFTER_CLASS,
  DEFAULT_DND_ROOT_SELECTOR,
} from "./dropIndicator";
export type {
  DropEdge,
  DropIndicatorAxis,
  DropIndicatorOptions,
  DropIndicatorState,
} from "./dropIndicator";
export {
  RestrictToVerticalAxis,
  RestrictToHorizontalAxis,
  SnapModifier,
  AxisModifier,
} from "@dnd-kit/abstract/modifiers";
export { move, arrayMove, swap, arraySwap } from "@dnd-kit/helpers";
export {
  ChromeDraggable,
  ChromeDroppable,
  ChromeSortable,
  isChromeSortable,
  defaultSortableTransition,
} from "./entities";
export type {
  ChromeDraggableInput,
  ChromeDroppableInput,
  ChromeSortableInput,
  SortableTransition,
} from "./entities";
export { rectangleFromElement } from "./shape";
