import { config } from "../../package.json";
import type { FluentMessageId } from "../../typings/i10n";
import { formatPublishBytes } from "../utils/formatPublishError";
import { getLocaleID } from "../utils/locale";
import {
  getPrefValue,
  PLUGIN_PREF_DEFAULTS,
  resetAllPluginPrefs,
  setPref,
} from "../utils/prefs";
import {
  fetchPublishMe,
  getPublishSession,
  isPublishApiConfigured,
} from "../utils/publishAuth";
import { confirmPrompt } from "../utils/window";
import { refreshOptionalFeatureChrome } from "./optionalFeatures";

type PrefKey = Parameters<typeof getPrefValue>[0];

type PrefsDocumentL10n = {
  formatValues: (ids: string[]) => Promise<(string | null)[]>;
};

const ISSUES_URL = "https://github.com/janbaykara/zotero-syllabus/issues";
const REDDIT_URL =
  "https://www.reddit.com/r/zotero/comments/1w3eu97/zotero_syllabus_a_plugin_for_students_to_organise/";

export async function registerPrefsScripts(_window: Window) {
  // This function is called when the prefs window is opened
  // See addon/content/preferences.xhtml onpaneload
  if (!addon.data.prefs) {
    addon.data.prefs = {
      window: _window,
      columns: [],
      rows: [],
    };
  } else {
    addon.data.prefs.window = _window;
  }
  updatePrefsUI();
  bindPrefEvents();
}

async function updatePrefsUI() {
  const win = addon.data.prefs?.window;
  if (!win) return;
  ztoolkit.log("Preference window loaded");
  syncWpmInput(win);
  void updatePublishStorageRow(win);
}

async function updatePublishStorageRow(win: Window) {
  const el = win.document.getElementById(
    `${config.addonRef}-pref-publish-storage`,
  );
  const meter = win.document.getElementById(
    `${config.addonRef}-pref-publish-meter`,
  );
  const bar = win.document.getElementById(
    `${config.addonRef}-pref-publish-bar`,
  );
  const fill = win.document.getElementById(
    `${config.addonRef}-pref-publish-bar-fill`,
  );
  if (!el) return;

  const hideMeter = () => {
    if (meter) meter.hidden = true;
    if (bar) {
      bar.classList.remove("is-warn", "is-full");
      bar.setAttribute("aria-valuenow", "0");
      bar.removeAttribute("aria-label");
    }
    if (fill) (fill as HTMLElement).style.width = "0%";
  };

  const showMeter = (usageBytes: number, quotaBytes: number, label: string) => {
    if (!meter || !bar || !fill) return;
    const pct =
      quotaBytes > 0
        ? Math.min(100, Math.round((usageBytes / quotaBytes) * 100))
        : 0;
    meter.hidden = false;
    (fill as HTMLElement).style.width = `${pct}%`;
    bar.setAttribute("aria-valuenow", String(pct));
    bar.setAttribute("aria-label", label);
    bar.classList.toggle("is-full", pct >= 100);
    bar.classList.toggle("is-warn", pct >= 85 && pct < 100);
  };

  const setL10n = async (
    id: FluentMessageId,
    args?: Record<string, string>,
  ): Promise<string> => {
    el.removeAttribute("data-l10n-args");
    el.setAttribute("data-l10n-id", getLocaleID(id));
    if (args) {
      el.setAttribute("data-l10n-args", JSON.stringify(args));
    }
    // Fallback when document.l10n does not retranslate in time
    const text = await formatPrefsL10nMessage(id, args);
    if (text) {
      el.textContent = text;
    }
    return text || "";
  };

  hideMeter();

  if (!isPublishApiConfigured()) {
    await setL10n("pref-publish-not-configured");
    return;
  }
  if (!getPublishSession()) {
    await setL10n("pref-publish-not-signed-in");
    return;
  }

  await setL10n("pref-publish-loading");
  try {
    const me = await fetchPublishMe();
    const label = await setL10n("pref-publish-storage", {
      usage: formatPublishBytes(me.usageBytes),
      quota: formatPublishBytes(me.quotaBytes),
    });
    showMeter(me.usageBytes, me.quotaBytes, label);
  } catch (error) {
    ztoolkit.log("Publish storage prefs fetch failed:", error);
    hideMeter();
    await setL10n("pref-publish-error");
  }
}

function syncWpmInput(win: Window) {
  const input = win.document.getElementById(
    `zotero-prefpane-${config.addonRef}-wpm`,
  ) as HTMLInputElement | null;
  if (!input) return;
  const wpm = Number(getPrefValue("wpm"));
  input.value = String(Number.isFinite(wpm) && wpm > 0 ? wpm : 220);
}

function bindPrefEvents() {
  const win = addon.data.prefs?.window;
  if (!win) return;
  const doc = win.document;

  const wpmInput = doc.getElementById(
    `zotero-prefpane-${config.addonRef}-wpm`,
  ) as HTMLInputElement | null;
  if (wpmInput && !wpmInput.dataset.syllabusBound) {
    wpmInput.dataset.syllabusBound = "1";
    const commit = () => {
      const raw = Number(wpmInput.value);
      if (!Number.isFinite(raw)) {
        syncWpmInput(win);
        return;
      }
      const clamped = Math.min(1000, Math.max(60, Math.round(raw)));
      wpmInput.value = String(clamped);
      setPref("wpm", clamped);
    };
    wpmInput.addEventListener("change", commit);
    wpmInput.addEventListener("blur", commit);
  }

  bindLaunchLink(
    doc.getElementById(`${config.addonRef}-pref-link-issues`),
    ISSUES_URL,
  );
  bindLaunchLink(
    doc.getElementById(`${config.addonRef}-pref-link-reddit`),
    REDDIT_URL,
  );

  const globalPrioritiesButton = doc.getElementById(
    `${config.addonRef}-pref-global-priorities`,
  );
  if (
    globalPrioritiesButton &&
    !(globalPrioritiesButton as HTMLElement).dataset.syllabusBound
  ) {
    (globalPrioritiesButton as HTMLElement).dataset.syllabusBound = "1";
    globalPrioritiesButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void import("./openGlobalPrioritiesDialog").then(
        ({ openGlobalPrioritiesDialog }) => {
          openGlobalPrioritiesDialog();
        },
      );
    });
  }

  const resetButton = doc.getElementById(`${config.addonRef}-pref-reset`);
  if (resetButton && !(resetButton as HTMLElement).dataset.syllabusBound) {
    (resetButton as HTMLElement).dataset.syllabusBound = "1";
    resetButton.addEventListener("click", (event) => {
      event.preventDefault();
      void handleResetPlugin();
    });
  }
}

function bindLaunchLink(el: Element | null, url: string) {
  if (!el || (el as HTMLElement).dataset.syllabusBound) return;
  (el as HTMLElement).dataset.syllabusBound = "1";
  el.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    Zotero.launchURL(url);
  });
}

async function handleResetPlugin() {
  const prefsWin = addon.data.prefs?.window;
  const [title, message] = await formatPrefsL10n([
    "pref-reset-confirm-title",
    "pref-reset-confirm-message",
  ]);
  const confirmed = confirmPrompt(title, message);
  if (!confirmed) {
    return;
  }

  const cleared = resetAllPluginPrefs();
  ztoolkit.log("Reset plugin prefs:", cleared);

  refreshOptionalFeatureChrome();

  if (prefsWin) {
    syncWpmInput(prefsWin);
    syncBoundControls(prefsWin);
  }

  const mainWin = Zotero.getMainWindow();
  if (mainWin) {
    try {
      const { showUserGuide } = await import("./userGuide");
      await showUserGuide(mainWin, false);
    } catch (error) {
      ztoolkit.log("Error showing user guide after reset:", error);
    }
  }
}

async function formatPrefsL10n(ids: FluentMessageId[]): Promise<string[]> {
  return Promise.all(ids.map((id) => formatPrefsL10nMessage(id)));
}

async function formatPrefsL10nMessage(
  id: FluentMessageId,
  args?: Record<string, string>,
): Promise<string> {
  const prefixed = getLocaleID(id);
  const win = addon.data.prefs?.window;
  const l10n = (win?.document as Document & { l10n?: PrefsDocumentL10n })?.l10n;
  if (l10n?.formatValues && !args) {
    try {
      const values = await l10n.formatValues([prefixed]);
      if (values[0]) {
        return values[0];
      }
    } catch (error) {
      ztoolkit.log("formatPrefsL10n failed:", error);
    }
  }

  // document.l10n can miss plugin FTLs; Localization() resolves them reliably
  try {
    const LocalizationCtor =
      typeof Localization === "undefined"
        ? ztoolkit.getGlobal("Localization")
        : Localization;
    const bundle = new LocalizationCtor(
      [`${config.addonRef}-preferences.ftl`],
      true,
    );
    const messages = bundle.formatMessagesSync([
      { id: prefixed, args: args || {} },
    ]) as Array<{ value: string | null } | null>;
    return messages[0]?.value || prefixed;
  } catch (error) {
    ztoolkit.log("formatPrefsL10n Localization fallback failed:", error);
    return prefixed;
  }
}

/** Refresh preference-bound controls after restoring defaults. */
function syncBoundControls(win: Window) {
  const checkboxes = Array.from(
    win.document.querySelectorAll("checkbox[preference]"),
  );
  for (const el of checkboxes) {
    const checkbox = el as XULElement & { checked: boolean };
    const prefName = checkbox.getAttribute("preference");
    if (!prefName) continue;
    try {
      const key = prefName as PrefKey;
      const value = getPrefValue(key) ?? PLUGIN_PREF_DEFAULTS[key];
      checkbox.checked = !!value;
    } catch {
      // Pref may not be in PluginPrefsMap
    }
  }

  const menulists = Array.from(
    win.document.querySelectorAll("menulist[preference]"),
  );
  for (const el of menulists) {
    const list = el as XULElement & { value: string };
    const prefName = list.getAttribute("preference");
    if (!prefName) continue;
    try {
      const key = prefName as PrefKey;
      const value = getPrefValue(key) ?? PLUGIN_PREF_DEFAULTS[key];
      if (value != null) {
        list.value = String(value);
      }
    } catch {
      // ignore
    }
  }
}
