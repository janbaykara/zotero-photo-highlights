/**
 * Typed window features for `openDialog` / `window.open`.
 * Serializes to Mozilla’s comma-separated feature string
 * (`chrome,dialog=no,centerscreen,resizable=yes,width=400`).
 *
 * - `true` → bare token (`centerscreen`)
 * - `false` → `name=no` (`dialog=no`)
 * - number → `name=N` (`width=400`)
 * - omitted → not emitted
 */
export type ChromeWindowFeatures = {
  chrome?: boolean;
  dialog?: boolean;
  modal?: boolean;
  centerscreen?: boolean;
  resizable?: boolean;
  dependent?: boolean;
  titlebar?: boolean;
  toolbar?: boolean;
  menubar?: boolean;
  status?: boolean;
  scrollbars?: boolean;
  alwaysRaised?: boolean;
  alwaysLowered?: boolean;
  width?: number;
  height?: number;
  left?: number;
  top?: number;
  outerWidth?: number;
  outerHeight?: number;
  screenX?: number;
  screenY?: number;
};

/** Feature keys emitted in a stable, readable order. */
const FEATURE_ORDER = [
  "chrome",
  "dialog",
  "modal",
  "centerscreen",
  "resizable",
  "dependent",
  "titlebar",
  "toolbar",
  "menubar",
  "status",
  "scrollbars",
  "alwaysRaised",
  "alwaysLowered",
  "width",
  "height",
  "left",
  "top",
  "outerWidth",
  "outerHeight",
  "screenX",
  "screenY",
] as const satisfies ReadonlyArray<keyof ChromeWindowFeatures>;

/**
 * Serialize typed window features to a Mozilla features string.
 * Unknown / undefined keys are skipped.
 */
export function serializeChromeWindowFeatures(
  features: ChromeWindowFeatures,
): string {
  const parts: string[] = [];
  for (const key of FEATURE_ORDER) {
    const value = features[key];
    if (value === undefined) {
      continue;
    }
    if (typeof value === "boolean") {
      parts.push(value ? key : `${key}=no`);
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      parts.push(`${key}=${Math.round(value)}`);
    }
  }
  return parts.join(",");
}
