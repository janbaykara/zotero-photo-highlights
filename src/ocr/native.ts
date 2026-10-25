import { config } from "../../package.json";
import {
  parseNativePayload,
  wordsFromNativePayload,
  type NativeSpace,
} from "./boxes";
import { languageSpec } from "./languages";
import type { OcrWord } from "../photo/types";

const NATIVE_TIMEOUT_MS = 45_000;

type NativeProcess = {
  stdout: { readString: () => Promise<string> };
  stderr: { readString: () => Promise<string> };
  wait: () => Promise<{ exitCode?: number } | number>;
  kill: () => Promise<void> | void;
};

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
    return { outcome: "fallback", reason: "unknown-language" };
  }
  const os = hostOS();
  const command = helperCommand(os, image.path, spec);
  if (!command) {
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
  ztoolkit.log("Native OCR retry", { reason: first.reason });
  return runHelper(command.command, command.args, command.space, image);
}

function helperCommand(
  os: string,
  imagePath: string,
  spec: { tags: string[]; prefix: string },
): { command: string; args: string[]; space: NativeSpace } | null {
  const payload = JSON.stringify(spec);
  if (os === "Darwin") {
    return {
      command: "/usr/bin/osascript",
      args: [
        "-l",
        "JavaScript",
        addonFile("vision-ocr.js"),
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
        addonFile("windows-ocr.ps1"),
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
      return {
        outcome: "fallback",
        reason: payload?.reason || "unsupported-language",
      };
    }
    ztoolkit.log("Native OCR failed", {
      space,
      exitCode: result.exitCode,
      reason: payload?.reason,
      detail: payload?.detail,
      stderr: result.stderr.trim(),
    });
    return { outcome: "fallback", reason: payload?.reason || "failed" };
  } catch (error) {
    ztoolkit.log("Native OCR failed", { space, error });
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
        proc.stdout.readString(),
        proc.stderr.readString(),
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

function addonFile(name: string): string {
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
  return registry.convertChromeURL(uri).QueryInterface(Ci.nsIFileURL).file.path;
}

type ChromeRegistry = {
  convertChromeURL: (uri: unknown) => {
    QueryInterface: (iface: unknown) => { file: { path: string } };
  };
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
