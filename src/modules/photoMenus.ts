import { getString } from "../utils/locale";
import { selectedBookId } from "../utils/itemPicker";
import { openPhotoToAnnotationDialog } from "./openPhotoToAnnotationDialog";

export function registerPhotoMenus(): void {
  ztoolkit.Menu.unregister("photo-highlights-item");
  ztoolkit.Menu.unregister("photo-highlights-tools");
  ztoolkit.Menu.register("item", {
    tag: "menuitem",
    id: "photo-highlights-item",
    label: getString("menu-photo-to-annotation"),
    commandListener: () => {
      const bookId = selectedBookId();
      openPhotoToAnnotationDialog(bookId, bookId != null);
    },
  });
  ztoolkit.Menu.register("menuTools", {
    tag: "menuitem",
    id: "photo-highlights-tools",
    label: getString("menu-photo-to-annotation"),
    commandListener: () => {
      openPhotoToAnnotationDialog(selectedBookId());
    },
  });
}
