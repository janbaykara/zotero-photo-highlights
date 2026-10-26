import { config, version } from "../../package.json";
import {
  parseNativePayload,
  wordsFromNativePayload,
  type NativeSpace,
} from "./boxes";
import { formatNativeFailure, recordOcrDebug } from "./debugLog";
import { languageSpec } from "./languages";
import type { OcrWord } from "../photo/types";

const NATIVE_TIMEOUT_MS = 45_000;

type NativeProcess = {
  stdout: Pipe;
  stderr: Pipe;
  wait: () => Promise<{ exitCode?: number } | number>;
  kill: () => Promise<void> | void;
};

type Pipe = {
  /** One call returns the first available chunk, or an empty buffer at EOF. */
  read: () => Promise<ArrayBuffer>;
};

/** A null-length read stops at the first chunk. A page of boxes does not fit in it. */
export async function readPipeString(pipe: Pipe): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const buffer = await pipe.read();
    if (buffer.byteLength === 0) {
      break;
    }
    text += decoder.decode(buffer, { stream: true });
  }
  return text + decoder.decode();
}

export type NativeRecognition =
  | { outcome: "ready"; words: OcrWord[]; engine: NativeSpace }
  | { outcome: "fallback"; reason: string };

export async function recognizeNative(image: {
  path: string;
  lang: string;
  width: number;
  height: number;
}): Promise<NativeRecognition> {
  const spec = languageSpec(image.lang);
  if (!spec) {
    recordOcrDebug("Native OCR skipped", {
      reason: "unknown-language",
      lang: image.lang,
    });
    return { outcome: "fallback", reason: "unknown-language" };
  }
  const os = hostOS();
  let command: { command: string; args: string[]; space: NativeSpace } | null;
  try {
    command = await helperCommand(os, image.path, spec);
  } catch (error) {
    recordOcrDebug(
      formatNativeFailure({
        space: os === "Darwin" ? "vision" : os === "WINNT" ? "windows" : os,
        error,
      }),
    );
    return { outcome: "fallback", reason: "failed" };
  }
  if (!command) {
    recordOcrDebug("Native OCR skipped", { reason: "platform", os });
    return { outcome: "fallback", reason: "platform" };
  }
  const first = await runHelper(
    command.command,
    command.args,
    command.space,
    image,
  );
  if (first.outcome === "ready" || !shouldRetry(first.reason)) {
    return first;
  }
  recordOcrDebug("Native OCR retry", { reason: first.reason });
  return runHelper(command.command, command.args, command.space, image);
}

async function helperCommand(
  os: string,
  imagePath: string,
  spec: { tags: string[]; prefix: string },
): Promise<{ command: string; args: string[]; space: NativeSpace } | null> {
  const payload = JSON.stringify(spec);
  if (os === "Darwin") {
    return {
      command: "/usr/bin/osascript",
      args: [
        "-l",
        "JavaScript",
        await addonFile("vision-ocr.js"),
        imagePath,
        payload,
      ],
      space: "vision",
    };
  }
  if (os === "WINNT") {
    return {
      command: powershellPath(),
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-STA",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        await addonFile("windows-ocr.ps1"),
        "-Image",
        imagePath,
        "-Spec",
        payload,
      ],
      space: "windows",
    };
  }
  return null;
}

function shouldRetry(reason: string): boolean {
  return (
    reason !== "no-text" &&
    reason !== "unsupported-language" &&
    reason !== "unknown-language" &&
    reason !== "platform"
  );
}

async function runHelper(
  command: string,
  args: string[],
  space: NativeSpace,
  image: { width: number; height: number },
): Promise<NativeRecognition> {
  try {
    const result = await runProcess(command, args);
    const payload = parseNativePayload(result.stdout);
    if (payload?.ok) {
      return {
        outcome: "ready",
        engine: space,
        words: wordsFromNativePayload(
          payload,
          space,
          image.width,
          image.height,
        ),
      };
    }
    if (
      payload?.reason === "no-text" ||
      payload?.reason === "unsupported-language" ||
      result.exitCode === 2
    ) {
      const reason = payload?.reason || "unsupported-language";
      recordOcrDebug(
        formatNativeFailure({
          space,
          exitCode: result.exitCode,
          reason,
          detail: payload?.detail,
          stderr: result.stderr,
        }),
      );
      return { outcome: "fallback", reason };
    }
    recordOcrDebug(
      formatNativeFailure({
        space,
        exitCode: result.exitCode,
        reason: payload?.reason,
        detail: payload?.detail,
        stderr: result.stderr,
        stdout: payload ? "" : result.stdout,
      }),
    );
    return { outcome: "fallback", reason: payload?.reason || "failed" };
  } catch (error) {
    recordOcrDebug(formatNativeFailure({ space, error }));
    return { outcome: "fallback", reason: "failed" };
  }
}

async function runProcess(
  command: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { Subprocess } = ChromeUtils.importESModule(
    "resource://gre/modules/Subprocess.sys.mjs",
  ) as {
    Subprocess: {
      call: (options: {
        command: string;
        arguments: string[];
        stdout: "pipe";
        stderr: "pipe";
      }) => Promise<NativeProcess>;
    };
  };
  const proc = await Subprocess.call({
    command,
    arguments: args,
    stdout: "pipe",
    stderr: "pipe",
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      void Promise.resolve(proc.kill()).catch(() => undefined);
      reject(new Error("native OCR timed out"));
    }, NATIVE_TIMEOUT_MS);
  });
  try {
    const finished = await Promise.race([
      Promise.all([
        readPipeString(proc.stdout),
        readPipeString(proc.stderr),
        proc.wait(),
      ]),
      timeout,
    ]);
    const [stdout, stderr, waited] = finished;
    return { stdout, stderr, exitCode: exitCodeOf(waited) };
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function exitCodeOf(waited: { exitCode?: number } | number): number {
  if (typeof waited === "number") {
    return waited;
  }
  return typeof waited.exitCode === "number" ? waited.exitCode : 1;
}

const helperFiles = new Map<string, Promise<string>>();

function addonFile(name: string): Promise<string> {
  let pending = helperFiles.get(name);
  if (!pending) {
    pending = materializeAddonFile(name);
    helperFiles.set(name, pending);
    pending.catch(() => {
      if (helperFiles.get(name) === pending) {
        helperFiles.delete(name);
      }
    });
  }
  return pending;
}

// A packed add-on maps chrome:// URLs into the XPI. osascript and PowerShell
// can only open a real file, so copy the helper out when it is not one.
async function materializeAddonFile(name: string): Promise<string> {
  const uri = Services.io.newURI(
    `chrome://${config.addonRef}/content/ocr/${name}`,
  );
  const classes = Components.classes as unknown as Record<
    string,
    { getService: (iface: unknown) => ChromeRegistry }
  >;
  const registry = classes["@mozilla.org/chrome/chrome-registry;1"].getService(
    (Components.interfaces as { nsIChromeRegistry?: unknown })
      .nsIChromeRegistry,
  );
  const resolved = registry.convertChromeURL(uri);
  const direct = filePath(resolved);
  if (direct && (await scriptFileReady(direct, name))) {
    return direct;
  }
  const dir = PathUtils.join(
    Zotero.getTempDirectory().path,
    "photo-highlights-ocr",
    version,
  );
  await IOUtils.makeDirectory(dir, {
    ignoreExisting: true,
    createAncestors: true,
  });
  const dest = PathUtils.join(dir, name);
  const bytes = await readChromeBytes(name);
  if (bytes.length < 50) {
    throw new Error(`OCR helper ${name} was empty`);
  }
  await IOUtils.write(dest, bytes, { tmpPath: `${dest}.partial` });
  return dest;
}

function filePath(uri: ChromeURL): string | null {
  try {
    return uri.QueryInterface(Ci.nsIFileURL).file.path;
  } catch {
    return null;
  }
}

async function scriptFileReady(path: string, name: string): Promise<boolean> {
  if (!path.endsWith(name) || path.includes(".xpi")) {
    return false;
  }
  try {
    const info = await IOUtils.stat(path);
    return info.size > 50;
  } catch {
    return false;
  }
}

async function readChromeBytes(name: string): Promise<Uint8Array> {
  const win = Zotero.getMainWindow();
  if (!win) {
    throw new Error("No window for OCR helper");
  }
  const response = await win.fetch(
    `chrome://${config.addonRef}/content/ocr/${name}`,
  );
  if (!response.ok) {
    throw new Error(`OCR helper ${name} missing (${response.status})`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

type ChromeURL = {
  QueryInterface: (iface: unknown) => { file: { path: string } };
};

type ChromeRegistry = {
  convertChromeURL: (uri: unknown) => ChromeURL;
};

function hostOS(): string {
  return (Services as { appinfo?: { OS?: string } }).appinfo?.OS || "";
}

function powershellPath(): string {
  const system = Services.dirsvc.get("SysD", Ci.nsIFile) as { path?: string };
  return PathUtils.join(
    system.path || "C:\\Windows\\System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
}
