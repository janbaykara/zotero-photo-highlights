import { openPhotoToAnnotationDialog } from "./modules/openPhotoToAnnotationDialog";
import { selectedBookId } from "./utils/itemPicker";

const api = {
  openPhotoToAnnotation(prefillBookId?: number | null) {
    openPhotoToAnnotationDialog(
      prefillBookId === undefined ? selectedBookId() : prefillBookId,
    );
  },
};

export default api;
