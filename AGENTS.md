# Agent notes

This repository is a blank Zotero plugin shell plus the shared packages in `packages/`. It has no product views. Rename `package.json` `config` before shipping a plugin. See [README.md](README.md).

## Localization (required)

Do not add hardcoded user-visible text in TS, TSX, XHTML, or progress windows.

1. Add a kebab-case key to `addon/locale/en-US/addon.ftl` (or `preferences.ftl` / `mainWindow.ftl` for those bundles). Do not start ids with the `addonRef` value (the build already prefixes them).
2. Copy the same key into **every** folder under `addon/locale/` (`de`, `pt-BR`, `es-ES`, `fr-FR`, `zh-CN`, …). German is `de`, not `de-DE`. Arabic is `ar`.
3. Look it up with `getString("the-key")` or `getString("the-key", { args: { name } })` from `src/utils/locale.ts`. Safe in Preact JSX.
4. Call `getString` at render/use time, never at module scope (`initLocale` runs at startup).
5. Keep the product name in `package.json` `config.addonName` untranslated.

## Packages

Cross-root live state can use Jotai’s default store (no `<Provider>` on Preact roots). External mirrors go through `atomFromExternal` / `atomFamilyFromExternal` from `@janbaykara/zotero-jotai-state`.

Reusable chrome libraries live under [`packages/`](packages/README.md) (pnpm workspace; `workspace:*`). Only Preact needs host wiring via `src/utils/configurePackages.ts`.

If the plugin uses `@janbaykara/zotero-cache`, call `zoteroCache.initialize()` from startup and `zoteroCache.shutdown()` from shutdown.

## Lint / package manager

Use **pnpm** only (`pnpm-lock.yaml`). CI runs `pnpm run lint:check` with a fresh install from that lockfile. After pulling dependency changes, run `pnpm install` before linting. Prefer `pnpm lint:fix` locally, then confirm with `pnpm lint:check`. Do not introduce `package-lock.json`.

## Zotero Dev MCP

Prefer the Zotero Dev MCP (`user-@introfini/mcp-server-zotero-dev`) for live verification: plugin reload, prefs, DB, logs, UI/DOM/screenshots, and scaffold serve/build. Do not guess Zotero runtime behavior when a ping/reload/screenshot/log check would settle it. Details: `.cursor/rules/zotero-mcp.mdc`.
