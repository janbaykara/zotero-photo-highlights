import { config } from "../../package.json";
import {
  coerceBooleanPref,
  getViewPref,
  saveViewPrefGlobally,
  setViewPref,
  useViewPref,
  type ViewPrefGlobalSetting,
  type ViewPrefSpec,
} from "../utils/viewPref";

const showGalleryNotesSpec: ViewPrefSpec<boolean> = {
  mapKey: `${config.prefsPrefix}.showGalleryNotes`,
  defaultKey: "galleryShowNotes",
  coerce: (value) => coerceBooleanPref(value, true),
};

export function getShowGalleryNotes(viewKey: string | number): boolean {
  return getViewPref(showGalleryNotesSpec, viewKey);
}

export function setShowGalleryNotes(
  viewKey: string | number,
  show: boolean,
): void {
  setViewPref(showGalleryNotesSpec, viewKey, show);
}

export function saveShowGalleryNotesGlobally(
  viewKey: string | number,
  show: boolean,
): void {
  saveViewPrefGlobally(showGalleryNotesSpec, viewKey, show);
}

export function useShowGalleryNotes(
  viewKey: string | number,
): [boolean, (show: boolean) => void, ViewPrefGlobalSetting<boolean>] {
  return useViewPref(showGalleryNotesSpec, viewKey);
}
