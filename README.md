# Zotero Plugin

A blank [Zotero](https://www.zotero.org/) plugin you can copy for a new add-on. It boots, registers an empty preferences pane, and includes the shared workspace packages under `packages/`. It does not add library views or menus.

## Rename before you ship

Set these in `package.json` `config`, then rebuild. The scaffold substitutes them into the manifest, Fluent prefix, and preference branch.

| Field           | This shell                 | What it becomes                             |
| --------------- | -------------------------- | ------------------------------------------- |
| `name`          | `zotero-plugin`            | npm package name                            |
| `addonName`     | `Zotero Plugin`            | name shown in Zotero; leave it untranslated |
| `addonID`       | `plugin@janbaykara.com`    | extension id                                |
| `addonRef`      | `plugin`                   | chrome package and Fluent prefix            |
| `addonInstance` | `Plugin`                   | `Zotero.Plugin`                             |
| `prefsPrefix`   | `extensions.zotero.plugin` | preference branch                           |

Also change `description`, `repository`, `homepage`, and `bugs` in `package.json`. Do not start Fluent ids with the `addonRef` value. The build already prefixes them.

## Develop

Requirements: [Zotero 7+](https://www.zotero.org/support/dev/zotero_7_for_developers), Node 22, pnpm 10.

```bash
pnpm install
pnpm start
```

`pnpm start` serves the plugin into the Zotero profile from `.env` (`ZOTERO_PLUGIN_ZOTERO_BIN_PATH`, `ZOTERO_PLUGIN_PROFILE_PATH`, `ZOTERO_PLUGIN_DATA_DIR`). See `.env.example`.

```bash
pnpm test
pnpm lint:check
pnpm build
```

## Layout

- `src/hooks.ts` — startup, stylesheets, preferences pane
- `src/api.ts` — object exposed as `Zotero.Plugin.api`
- `addon/locale/` — Fluent strings; copy every new key into each locale folder
- `addon/prefs.js` — preference defaults
- `packages/` — shared libraries (Preact dialogs, chrome helpers, annotations, cache, drag-and-drop, CSL, file drop, Tailwind theme)

`src/utils/configurePackages.ts` wires `@janbaykara/zotero-preact` once at startup. Other packages use `Zotero` or options you pass at the call site. If you use `@janbaykara/zotero-cache`, call `zoteroCache.initialize()` from startup and `zoteroCache.shutdown()` from shutdown.
