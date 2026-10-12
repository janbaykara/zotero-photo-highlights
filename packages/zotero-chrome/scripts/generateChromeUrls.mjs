/**
 * Regenerate src/chromeUrls.generated.ts from Zotero chrome content + skin.
 *
 * Prefer a local checkout:
 *   ZOTERO_SRC=/path/to/zotero pnpm --filter @janbaykara/zotero-chrome generate
 *
 * Otherwise list files from GitHub zotero/zotero @ ZOTERO_CHROME_REF (default below).
 */

import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, "..");
const outFile = path.join(pkgRoot, "src", "chromeUrls.generated.ts");

/** Bump intentionally when refreshing from upstream. */
const DEFAULT_GITHUB_REF = "main";

/** Repo path → chrome://zotero/content/… (jar maps content/zotero → content/). */
const CONTENT_REPO_PREFIX = "chrome/content/zotero/";
/** Repo path → chrome://zotero/skin/… */
const SKIN_REPO_PREFIX = "chrome/skin/default/zotero/";

async function walkFiles(rootDir, predicate) {
  const found = [];

  async function walk(dir, relBase) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Cannot read ${dir}: ${message}`, { cause: err });
    }
    for (const entry of entries) {
      const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, rel);
      } else if (entry.isFile() && predicate(entry.name, rel)) {
        found.push(rel.split(path.sep).join("/"));
      }
    }
  }

  await walk(rootDir, "");
  return found;
}

async function collectFromLocal(srcRoot) {
  const contentRoot = path.join(srcRoot, "chrome", "content", "zotero");
  const skinRoot = path.join(srcRoot, "chrome", "skin", "default", "zotero");

  const content = (
    await walkFiles(contentRoot, (name) => name.endsWith(".xhtml"))
  ).map((p) => p.replace(/\.xhtml$/i, ""));

  const skin = await walkFiles(skinRoot, () => true);

  return { content, skin };
}

async function collectFromGitHub(ref) {
  const commitRes = await fetch(
    `https://api.github.com/repos/zotero/zotero/commits/${encodeURIComponent(ref)}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "zotero-syllabus-zotero-chrome-generate",
      },
    },
  );
  if (!commitRes.ok) {
    throw new Error(
      `GitHub commit lookup failed (${commitRes.status}): ${await commitRes.text()}`,
    );
  }
  const commit = await commitRes.json();
  const sha = commit.sha;
  const treeSha = commit.commit?.tree?.sha;
  if (!treeSha) {
    throw new Error("GitHub commit response missing tree sha");
  }

  const treeRes = await fetch(
    `https://api.github.com/repos/zotero/zotero/git/trees/${treeSha}?recursive=1`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "zotero-syllabus-zotero-chrome-generate",
      },
    },
  );
  if (!treeRes.ok) {
    throw new Error(
      `GitHub tree lookup failed (${treeRes.status}): ${await treeRes.text()}`,
    );
  }
  const tree = await treeRes.json();
  const content = [];
  const skin = [];
  for (const item of tree.tree ?? []) {
    if (item.type !== "blob" || typeof item.path !== "string") {
      continue;
    }
    if (
      item.path.startsWith(CONTENT_REPO_PREFIX) &&
      item.path.endsWith(".xhtml")
    ) {
      content.push(
        item.path.slice(CONTENT_REPO_PREFIX.length).replace(/\.xhtml$/i, ""),
      );
    } else if (item.path.startsWith(SKIN_REPO_PREFIX)) {
      skin.push(item.path.slice(SKIN_REPO_PREFIX.length));
    }
  }
  return {
    content,
    skin,
    resolvedRef: `${ref}@${sha.slice(0, 12)}`,
  };
}

function sortedUnique(paths) {
  return [...new Set(paths)].sort((a, b) => a.localeCompare(b));
}

function constArrayBlock(name, paths) {
  const lines = paths.map((p) => `  ${JSON.stringify(p)},`);
  return `export const ${name} = [
${lines.join("\n")}
] as const;
`;
}

function renderSource(contentPaths, skinPaths, sourceLabel) {
  const content = sortedUnique(contentPaths);
  const skin = sortedUnique(skinPaths);
  if (content.length === 0) {
    throw new Error("No chrome/content XHTML paths found");
  }
  if (skin.length === 0) {
    throw new Error("No chrome/skin paths found");
  }
  if (!content.includes("selectItemsDialog")) {
    throw new Error(
      "Expected selectItemsDialog in content catalog (missing from source)",
    );
  }
  if (!skin.includes("16/universal/book.svg")) {
    throw new Error(
      "Expected 16/universal/book.svg in skin catalog (missing from source)",
    );
  }

  const generatedAt = new Date().toISOString().slice(0, 10);

  return `/**
 * AUTO-GENERATED — do not edit by hand.
 * Content paths omit .xhtml (chromeContentUrl appends it).
 * Skin paths keep their file extension (chromeSkinUrl).
 * Source: ${sourceLabel}
 * Generated: ${generatedAt}
 * Regenerate: pnpm --filter @janbaykara/zotero-chrome generate
 */

${constArrayBlock("ZOTERO_CONTENT_XHTML", content)}
export type ZoteroContentXhtml = (typeof ZOTERO_CONTENT_XHTML)[number];

export function isZoteroContentXhtml(
  path: string,
): path is ZoteroContentXhtml {
  return (ZOTERO_CONTENT_XHTML as readonly string[]).includes(path);
}

${constArrayBlock("ZOTERO_SKIN", skin)}
export type ZoteroSkinPath = (typeof ZOTERO_SKIN)[number];

export function isZoteroSkinPath(path: string): path is ZoteroSkinPath {
  return (ZOTERO_SKIN as readonly string[]).includes(path);
}
`;
}

async function main() {
  const localSrc = process.env.ZOTERO_SRC?.trim();
  const ref = process.env.ZOTERO_CHROME_REF?.trim() || DEFAULT_GITHUB_REF;

  let content;
  let skin;
  let sourceLabel;

  if (localSrc) {
    ({ content, skin } = await collectFromLocal(localSrc));
    sourceLabel = `local ZOTERO_SRC=${localSrc}`;
    console.log(
      `Collected ${content.length} content + ${skin.length} skin from ${localSrc}`,
    );
  } else {
    console.log(`Fetching chrome content+skin from zotero/zotero@${ref}…`);
    const remote = await collectFromGitHub(ref);
    content = remote.content;
    skin = remote.skin;
    sourceLabel = `github.com/zotero/zotero ${remote.resolvedRef}`;
    console.log(
      `Collected ${content.length} content + ${skin.length} skin (${remote.resolvedRef})`,
    );
  }

  const body = renderSource(content, skin, sourceLabel);
  await writeFile(outFile, body, "utf8");
  console.log(`Wrote ${outFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
