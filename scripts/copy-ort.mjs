import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));
const sourceDir = dirname(require.resolve("onnxruntime-web"));
const destDir = join(root, "addon/content/ocr/ort");

await mkdir(destDir, { recursive: true });
for (const name of ["ort.wasm.min.js", "ort-wasm-simd.wasm"]) {
  await copyFile(join(sourceDir, name), join(destDir, name));
}
