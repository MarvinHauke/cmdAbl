import { initialize, type ActivationContext } from "@ableton-extensions/sdk";
import { CommandRegistry } from "./commandRegistry.js";
import interfaceTemplate from "../ui/interface.html";

export function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");
  const registry = new CommandRegistry();

  // ── register commands ────────────────────────────────────────────────────
  registry.register("help", "list all registered commands", () => {
    const lines = registry.list().map(c => `  ${c.name.padEnd(12)} ${c.description}`);
    console.log("cmdAbl commands:\n" + lines.join("\n"));
  });

  registry.register("suggest", "generate ghost-note suggestions for selected clip", () => {
    console.log("suggest: not yet implemented");
  });

  registry.register("accept", "accept all ghost-note suggestions", () => {
    console.log("accept: not yet implemented");
  });

  registry.register("clear", "remove all ghost-note suggestions", () => {
    console.log("clear: not yet implemented");
  });

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
