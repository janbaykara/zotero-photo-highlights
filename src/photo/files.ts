import { collectDroppedOsItems } from "@janbaykara/zotero-os-file-drop";

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|tiff?|heic|bmp)$/i;

export async function makeSessionDir(): Promise<string> {
  const root = Zotero.getTempDirectory();
  root.append("photo-highlights");
  root.append(String(Date.now()));
  await IOUtils.makeDirectory(root.path, {
    createAncestors: true,
    ignoreExisting: true,
  });
  return root.path;
}

export async function copyIntoSession(
  sessionDir: string,
  sourcePath: string,
  index: number,
): Promise<string> {
  const base = sourcePath.split(/[/\\]/).pop() || `photo-${index}.jpg`;
  const dest = PathUtils.join(sessionDir, `${index}-${base}`);
  await IOUtils.copy(sourcePath, dest);
  return dest;
}

export async function chooseImagePaths(
  win: Window,
  title: string,
): Promise<string[]> {
  const { picker, iface } = createImagePicker(win, title);
  picker.appendFilters(iface.filterImages);
  const result = await new Promise<number>((resolve) => {
    picker.open(resolve);
  });
  if (result !== iface.returnOK && result !== iface.returnReplace) {
    return [];
  }
  const paths: string[] = [];
  const files = picker.files;
  while (files.hasMoreElements()) {
    const file = files.getNext().QueryInterface(Components.interfaces.nsIFile);
    if (file?.path && IMAGE_EXT.test(file.path)) {
      paths.push(file.path);
    }
  }
  return paths;
}

function createImagePicker(win: Window, title: string) {
  const iface = Components.interfaces.nsIFilePicker;
  const browsingContext = (win as Window & { browsingContext?: unknown })
    .browsingContext;
  if (browsingContext) {
    try {
      const picker = newFilePicker();
      picker.init(browsingContext, title, iface.modeOpenMultiple);
      return { picker, iface };
    } catch (error) {
      ztoolkit.log("File picker did not accept a browsing context", error);
    }
  }
  const picker = newFilePicker();
  picker.init(win, title, iface.modeOpenMultiple);
  return { picker, iface };
}

function newFilePicker() {
  return Components.classes["@mozilla.org/filepicker;1"].createInstance(
    Components.interfaces.nsIFilePicker,
  );
}

export async function scaleLongestSide(
  win: Window,
  sourcePath: string,
  destPath: string,
): Promise<{ url: string; width: number; height: number }> {
  const bytes = await IOUtils.read(sourcePath);
  const blob = new win.Blob([bytes]);
  const objectUrl = win.URL.createObjectURL(blob);
  try {
    const image = await loadImage(win, objectUrl);
    const longest = Math.max(image.width, image.height, 1);
    const scale = Math.min(1, 2400 / longest);
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = win.document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("canvas");
    }
    context.drawImage(image, 0, 0, width, height);
    const jpeg = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (next) => (next ? resolve(next) : reject(new Error("jpeg"))),
        "image/jpeg",
        0.92,
      );
    });
    await IOUtils.write(destPath, new Uint8Array(await jpeg.arrayBuffer()));
    return {
      url: win.URL.createObjectURL(jpeg),
      width,
      height,
    };
  } finally {
    win.URL.revokeObjectURL(objectUrl);
  }
}

export async function readImagePixels(
  win: Window,
  url: string,
  width: number,
  height: number,
): Promise<{ width: number; height: number; data: Uint8ClampedArray } | null> {
  if (!width || !height) {
    return null;
  }
  try {
    const image = await loadImage(win, url);
    const canvas = win.document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      return null;
    }
    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height);
    return { width, height, data: pixels.data };
  } catch (error) {
    ztoolkit.log("Could not read photo pixels", error);
    return null;
  }
}

function loadImage(win: Window, url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new win.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image"));
    image.src = url;
  });
}

export function imagePathsFromDrop(
  dataTransfer: DataTransfer | null,
): string[] {
  return collectDroppedOsItems(dataTransfer).flatMap((item) => {
    if (
      item.kind !== "file" ||
      item.isDirectory ||
      !IMAGE_EXT.test(item.path)
    ) {
      return [];
    }
    return [item.path];
  });
}
