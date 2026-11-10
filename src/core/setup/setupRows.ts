import { TEXT_NOT_RUNNING, type BridgeResult, type HelloInfo } from "../../ableton/bridgeProtocol.js";
import type { InstalledScript } from "../../ableton/installedScript.js";
import type { ResultSection, StatusItem } from "../types.js";
import { KARABINER_SETTINGS_URL } from "./openUrl.js";

// The rows of the setup page (plan 0021 §2), built from facts. Pure: the facts come in, sections and a
// signature per row go out. Gathering the facts (files, bridge, Karabiner) is setupFacts.ts; showing the page and
// running its buttons is setupFlow.ts.

export const KARABINER_HOME_URL = "https://karabiner-elements.pqrs.org/";
/** What the controls of the page run: the flow looks these up in the sections it sent, so they are the only commands a page can trigger. */
export const SCRIPT_COMMAND = "cmdabl setup script";
export const KEYBOARD_COMMAND = "cmdabl setup karabiner";

/** The route Karabiner fetches the rule from (httpTrigger.ts) and the import link that makes it fetch it. */
export const KARABINER_RULE_ROUTE = "/karabiner/cmdabl.json";
export function karabinerImportUrl(port: number): string {
  return `karabiner://karabiner/assets/complex_modifications/import?url=${encodeURIComponent(`http://127.0.0.1:${port}${KARABINER_RULE_ROUTE}`)}`;
}

export interface SetupFacts {
  platform: NodeJS.Platform;
  /**
   * The keyboard trigger. macOS: Karabiner (`installed`), the rule file there (`ruleThere`), the rule enabled in karabiner.json
   * (`enabled`, null = could not be read). Windows: `installed` is AutoHotkey, `ruleThere` the startup script.
   */
  trigger: { installed: boolean; ruleThere: boolean; enabled: boolean | null };
  script: {
    shipped: string;
    installed: InstalledScript;
    /** A fresh `hello` to the running script; null = not asked. */
    running: BridgeResult<HelloInfo> | null;
    /** The installed copy's file time is later than the extension host's start: Live has not loaded it. null = unknown. */
    copyNewerThanHost: boolean | null;
    /** The last copy by the page failed: why. */
    copyFailed: string | null;
  };
  dataFolderWritable: boolean;
  /** `karabiner://…` link (karabinerImportUrl). */
  importUrl: string;
  /** Where "How" leads (docs). */
  controlSurfaceUrl: string;
}

export interface SetupRow {
  /** Stable id of the row ("karabiner", "script", "restart", "surface", "data"). */
  id: string;
  /** What changes the user would have to act on again: the id with its status and the versions it is about. Empty for ✓. */
  signature: string;
  status: NonNullable<StatusItem["status"]>;
}

export interface SetupRows {
  sections: ResultSection[];
  rows: SetupRow[];
}

export function buildSetupRows(facts: SetupFacts): SetupRows {
  const sections: ResultSection[] = [];
  const rows: SetupRow[] = [];
  const add = (heading: string, id: string, item: StatusItem & { status: NonNullable<StatusItem["status"]> }, key = "") => {
    let section = sections.find((s) => s.heading === heading);
    if (!section) sections.push((section = { heading, items: [] }));
    section.items.push(item);
    rows.push({ id, status: item.status, signature: item.status === "ok" ? "" : `${id}:${item.status}${key ? `:${key}` : ""}` });
  };

  // ── keyboard trigger ──
  if (facts.platform === "darwin") {
    const t = facts.trigger;
    const heading = "Keyboard trigger";
    if (!t.installed) {
      add(heading, "karabiner", {
        text: "Karabiner-Elements is not installed. Without it the : key doesn't open cmdAbl; only the right-click menu does. Strongly recommended.",
        status: "warn",
        action: { label: "Get Karabiner", help: "Open the Karabiner-Elements download page in your browser.", url: KARABINER_HOME_URL },
      });
    } else if (!t.ruleThere) {
      add(heading, "karabiner", {
        text: "The cmdAbl rule is not added to Karabiner yet.",
        status: "warn",
        action: { label: "Add rule", help: "Karabiner asks to import the cmdAbl rule; then enable it there.", url: facts.importUrl },
      });
    } else if (t.enabled === false) {
      add(heading, "karabiner", { text: "The cmdAbl rule is added but not enabled. Enable it in Karabiner → Complex Modifications.", status: "warn",
        action: { label: "Open Karabiner", help: "Open Karabiner-Elements Settings; enable the cmdAbl rule under Complex Modifications.", url: KARABINER_SETTINGS_URL },
      });
    } else if (t.enabled === true) {
      add(heading, "karabiner", { text: "The : key opens cmdAbl.", status: "ok" });
    } else {
      add(heading, "karabiner", { text: "The cmdAbl rule is added. If the : key doesn't open cmdAbl, enable it in Karabiner.", status: "ok" });
    }
    // Always a quiet link to the Karabiner website in the heading; rows keep one button each.
    const keyboard = sections.find((s) => s.heading === heading);
    if (keyboard) keyboard.link = { label: "Karabiner-Elements ↗", help: "Open the Karabiner-Elements website in your browser.", url: KARABINER_HOME_URL };
  } else if (facts.platform === "win32") {
    const t = facts.trigger;
    add("Keyboard trigger", "karabiner", t.ruleThere
      ? { text: "The : key opens cmdAbl (the AutoHotkey script is in the startup folder).", status: "ok" }
      : t.installed
        ? { text: "The AutoHotkey script is not installed yet.", status: "warn", action: { label: "Install", command: KEYBOARD_COMMAND } }
        : { text: "AutoHotkey v2 is not installed. Without it the : key doesn't open cmdAbl; only the right-click menu does.", status: "warn" });
  }

  // ── Remote Script ──
  const { shipped, installed, running, copyNewerThanHost, copyFailed } = facts.script;
  const live = running?.ok ? running.value.script : null;
  const heading = "Remote Script";
  const copy = (label: "Copy" | "Update") => ({ label, help: "Copy the Remote Script into Live's User Library.", command: SCRIPT_COMMAND });
  let scriptReady = false; // the installed copy is the one this cmdAbl ships
  if (copyFailed) {
    add(heading, "script", { text: `Copying the Remote Script failed: ${copyFailed}`, status: "fail", action: copy("Copy") }, copyFailed);
  } else if (installed.status === "missing") {
    add(heading, "script", { text: "The Remote Script is not installed. It lets cmdAbl select tracks and read Live.", status: "warn", action: copy("Copy") }, `missing:${shipped}`);
  } else if (installed.status === "outdated") {
    const was = installed.version ? `Installed ${installed.version}` : "An unversioned copy is installed";
    add(heading, "script", { text: `${was}, this cmdAbl brings ${shipped}.`, status: "warn", action: copy("Update") }, `${installed.version ?? "none"}>${shipped}`);
  } else if (installed.status === "current") {
    scriptReady = true;
    add(heading, "script", { text: `Remote Script ${shipped} is installed.`, status: "ok" });
  } else if (live === shipped) {
    // The folder can't be read from here (sandbox); the running script is the answer.
    scriptReady = true;
    add(heading, "script", { text: `Remote Script ${shipped} is installed.`, status: "ok" });
  } else if (live !== null) {
    add(heading, "script", { text: `Live runs ${live}, this cmdAbl brings ${shipped}.`, status: "warn", action: copy("Update") }, `${live}>${shipped}`);
  } else {
    add(heading, "script", { text: "The Remote Script is not running, and its folder can't be checked from here.", status: "warn", action: copy("Copy") }, `unknown:${shipped}`);
  }

  if (scriptReady || (installed.status === "unknown" && live !== null)) {
    const answering = running?.ok === true && live === shipped;
    const stale = live !== null && live !== shipped; // Live runs another version than the one on disk
    if (stale || (copyNewerThanHost === true && !answering)) {
      add(heading, "restart", { text: `Restart Live once to load Remote Script ${shipped}.`, status: "warn" }, shipped);
    } else if (copyNewerThanHost === true && answering) {
      // Same version, newer files (an update during a development line): the version can't tell, the file time does.
      add(heading, "restart", { text: "The Remote Script files changed after Live started. Restart Live once to load them.", status: "warn" }, `files:${shipped}`);
    }
    if (answering) {
      add(heading, "surface", { text: "cmdAbl answers in Live.", status: "ok" });
    } else if (!stale) {
      // Not answering and not waiting for a restart: either Live started after the copy (choose it) or we can't tell.
      const unsure = copyNewerThanHost === null;
      const why = running && !running.ok && running.text !== TEXT_NOT_RUNNING ? ` (${running.text})` : "";
      if (copyNewerThanHost !== true) {
        add(heading, "surface", {
          text: `${unsure ? "Restart Live if you haven't since the copy, then choose" : "Choose"} cmdAbl in Live's Settings → Tempo & MIDI → Control Surface.${why}`,
          status: "warn",
          action: { label: "How", help: "Open the setup guide on the docs site.", url: facts.controlSurfaceUrl },
        }, shipped);
      }
    }
  }

  // ── data folder ──
  add(
    "Data folder",
    "data",
    facts.dataFolderWritable
      ? { text: "Settings and tags can be saved.", status: "ok" }
      : { text: "cmdAbl can't write to its data folder: settings and tags won't be saved.", status: "fail" },
  );

  return { sections, rows };
}

/** The rows as text lines for a headless run: a mark, the text, and the button as `[label: command or url]`. */
export function setupLines(sections: ResultSection[]): string {
  const mark = { ok: "✓", warn: "!", fail: "✗" } as const;
  const out: string[] = [];
  for (const section of sections) {
    out.push(section.heading);
    for (const item of section.items) {
      if (typeof item === "string") {
        out.push(`  ${item}`);
        continue;
      }
      const action = item.action ? ` [${item.action.label}: ${"command" in item.action ? item.action.command : item.action.url}]` : "";
      out.push(`  ${mark[item.status ?? "ok"]} ${item.text}${action}`);
    }
  }
  return out.join("\n");
}

/** What was shown before (`shown`) against the rows now: do they hold a yellow or red row the user has not seen yet? */
export function hasNewTrouble(rows: SetupRow[], shown: readonly string[]): boolean {
  return rows.some((r) => r.signature !== "" && !shown.includes(r.signature));
}
