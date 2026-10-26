const MAX_LINES = 400;
const MAX_FIELD = 2000;

const lines: string[] = [];

/** Readable text for an Error. `JSON.stringify` drops `message` and `stack`. */
export function describeDebug(value: unknown): string {
  if (value instanceof Error) {
    const head = `${value.name}: ${value.message}`;
    return value.stack ? `${head}\n${value.stack}` : head;
  }
  if (typeof value === "string") {
    return value;
  }
  if (value == null || typeof value !== "object") {
    return String(value);
  }
  try {
    return JSON.stringify(value, (_key, item: unknown) => {
      if (item instanceof Error) {
        return { name: item.name, message: item.message, stack: item.stack };
      }
      return item;
    });
  } catch {
    return String(value);
  }
}

export function formatNativeFailure(info: {
  space: string;
  exitCode?: number;
  reason?: string;
  detail?: string;
  stderr?: string;
  stdout?: string;
  error?: unknown;
}): string {
  const parts = [`Native OCR failed`, `space=${info.space}`];
  if (info.exitCode != null) {
    parts.push(`exit=${info.exitCode}`);
  }
  if (info.reason) {
    parts.push(`reason=${info.reason}`);
  }
  if (info.detail) {
    parts.push(`detail=${clip(info.detail)}`);
  }
  if (info.error != null) {
    parts.push(describeDebug(info.error));
  }
  if (info.stderr?.trim()) {
    parts.push(`stderr:\n${clip(info.stderr)}`);
  }
  if (info.stdout?.trim()) {
    parts.push(`stdout:\n${clip(info.stdout)}`);
  }
  return parts.join(" ");
}

export function recordOcrDebug(...args: unknown[]): void {
  const text = `${new Date().toISOString()} ${args.map(describeDebug).join(" ")}`;
  lines.push(text);
  if (lines.length > MAX_LINES) {
    lines.splice(0, lines.length - MAX_LINES);
  }
  try {
    if (typeof ztoolkit !== "undefined") {
      ztoolkit.log(text);
    }
  } catch {
    // Logging must not hide the recognition error.
  }
}

export function ocrDebugMark(): number {
  return lines.length;
}

export function ocrDebugSince(mark: number): string {
  return lines.slice(Math.max(0, mark)).join("\n");
}

function clip(text: string): string {
  const clean = text.replaceAll("\u0000", "").trim();
  if (clean.length <= MAX_FIELD) {
    return clean;
  }
  return `${clean.slice(0, MAX_FIELD)}…`;
}
