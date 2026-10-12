# `@janbaykara/zotero-tailwind-theme`

## What it does

Tailwind CSS v4 `@theme` fragment that maps utility color/shadow names to **live Zotero chrome tokens** (`var(--accent-blue)`, `var(--fill-primary)`, `var(--material-background)`, …) so light/dark follow the host.

## Why it’s valuable

Hardcoding Zotero hex values in a plugin theme drifts from the app and breaks dark mode. Bridging to CSS variables keeps `bg-background`, `text-primary`, `bg-accent-blue`, etc. aligned with Zotero itself.

### Token map (summary)

| Tailwind theme key                   | Zotero token                       |
| ------------------------------------ | ---------------------------------- |
| `--color-background`                 | `--material-background`            |
| `--color-background-sidepane`        | `--material-sidepane`              |
| `--color-accent-*`                   | `--accent-*`                       |
| `--color-primary` … `--color-senary` | `--fill-primary` … `--fill-senary` |
| `--color-icon`                       | `--icon-color`                     |
| `--box-shadow-level-*`               | host token or Zotero-like fallback |

Full list: [`theme.css`](./theme.css).

## How to use

Peer: `tailwindcss` ^4.

### Import in your entry CSS

Import **after** Tailwind’s theme/utilities so utilities resolve the bridged names:

```css
@layer theme, base, components, utilities;
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities);
@import "@janbaykara/zotero-tailwind-theme/theme.css";

/* Optional: product-only tokens that are not Zotero chrome */
@theme {
  --color-publish: light-dark(oklch(97.7% 0.014 308), oklch(28% 0.06 305));
}
```

Point Tailwind `@source` at your TSX (and exclude giant generated CSS strings). In this repo: [`src/tailwind.css`](../../src/tailwind.css).

### Use utilities in components

```tsx
export function Panel({ children }: { children: preact.ComponentChildren }) {
  return (
    <section className="bg-background text-primary border border-border shadow-level-1">
      <header className="bg-background-toolbar text-secondary">…</header>
      <button type="button" className="bg-accent-blue text-accent-white">
        …
      </button>
      {children}
    </section>
  );
}
```

Because values are `var(--material-*)` / `var(--accent-*)`, switching Zotero light/dark updates the UI without rebuilding CSS.

### Adding a new bridged token

1. Confirm the host CSS variable exists in Zotero chrome (with a fallback if older builds omit it).
2. Add `--color-…: var(--host-token, fallback);` (or `--box-shadow-…`) under `@theme` in `theme.css`.
3. Prefer the Tailwind name that matches how you want to write utilities (`bg-*`, `text-*`, `shadow-*`).

## Out of scope

`@source` scanning, chrome:// stylesheet injection / hash busting, publish-cover CSS generation, Syllabus component utilities.
