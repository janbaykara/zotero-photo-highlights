import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));
const source = require.resolve("@techstark/opencv-js");
const dest = join(root, "addon/content/opencv/opencv.js");

await mkdir(dirname(dest), { recursive: true });
await copyFile(source, dest);
