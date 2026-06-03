import { initialize, type ActivationContext } from "@ableton-extensions/sdk";
import { CommandRegistry } from "./commandRegistry.js";
import { startTriggerServer } from "./httpTrigger.js";
import { runKarabinerSetup, isKarabinerSetupDone } from "./setup.js";
import interfaceTemplate from "../ui/interface.html";
import { spawn } from "node:child_process";

const TRIGGER_PORT = 27184;

export function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");
  const registry = new CommandRegistry();

  // ── built-in commands ────────────────────────────────────────────────────
  registry.register("help", "open the Ableton Live manual", () => {
    spawn("open", ["https://www.ableton.com/en/manual/"], { detached: true, stdio: "ignore" }).unref();
  });

  registry.register(
    "cmdabl",
    "configure cmdAbl",
    [{ name: "--setup", description: "symlink Karabiner rule and print enable instructions" }],
    (flags) => {
      if (flags.includes("--setup")) {
        runKarabinerSetup();
      } else {
        console.log("cmdAbl: no recognised flag. Try: cmdabl --setup");
      }
    },
  );

  // placeholder domain commands — will be implemented in later steps
  registry.register("suggest", "generate ghost-note suggestions for selected clip", () => {
    console.log("suggest: not yet implemented");
  });

  registry.register("accept", "accept all ghost-note suggestions", () => {
    console.log("accept: not yet implemented");
  });

  registry.register("clear", "remove all ghost-note suggestions", () => {
    console.log("clear: not yet implemented");
  });

  // ── HTTP trigger server ──────────────────────────────────────────────────
  // Karabiner (or any external tool) can POST/GET http://127.0.0.1:27184/open
  // to open the command palette without a context menu.
  startTriggerServer(TRIGGER_PORT, () => {
    context.commands.executeCommand("cmdabl.open");
  });

  // ── startup hint ─────────────────────────────────────────────────────────
  if (!isKarabinerSetupDone()) {
    console.log("cmdAbl: Karabiner rule not found. Open the palette and run: cmdabl --setup");
  }

  // ── open command mode ────────────────────────────────────────────────────
  context.commands.registerCommand("cmdabl.open", () => {
    const html = interfaceTemplate.replace(
      "/*COMMANDS_PLACEHOLDER*/null",
      JSON.stringify(registry.list()),
    );
    const url = `data:text/html,${encodeURIComponent(html)}`;

    context.ui.showModalDialog(url, 500, 260).then((result) => {
      if (!result) return;
      registry.execute(result).catch((e: unknown) => {
        console.error(e instanceof Error ? e.message : String(e));
      });
    });
  });

  const scopes = [
    "AudioClip",
    "MidiClip",
    "AudioTrack",
    "MidiTrack",
    "ClipSlot",
    "Scene",
  ] as const;

  for (const scope of scopes) {
    void context.ui.registerContextMenuAction(scope, ": cmdAbl", "cmdabl.open");
  }
}
