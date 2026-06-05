import { initialize, type ActivationContext } from "@ableton-extensions/sdk";
import { CommandRegistry } from "./commandRegistry.js";
import { startTriggerServer } from "./httpTrigger.js";
import { runSetup, isSetupDone, setKarabinerPaletteOpen } from "./setup.js";
import interfaceTemplate from "../ui/interface.html";
import { spawn } from "node:child_process";

const TRIGGER_PORT = 27184;

export function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");
  const registry = new CommandRegistry();

  function showFeedback(message: string): void {
    const escaped = message
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const html = `<!DOCTYPE html><html><body style="font-family:monospace;padding:16px;background:#1e1e1e;color:#d4d4d4;margin:0">` +
      `<pre style="white-space:pre-wrap;font-size:13px;margin:0 0 12px">${escaped}</pre>` +
      `<button onclick="const m={method:'close_and_send',params:['']};` +
      `if(window.webkit?.messageHandlers?.live)window.webkit.messageHandlers.live.postMessage(m);` +
      `else if(window.chrome?.webview)window.chrome.webview.postMessage(m)" ` +
      `style="padding:4px 14px;cursor:pointer">Close</button>` +
      `</body></html>`;
    void context.ui.showModalDialog(`data:text/html,${encodeURIComponent(html)}`, 500, 180);
  }

  // ── built-in commands ────────────────────────────────────────────────────
  registry.register("help", "open the Ableton Live manual", () => {
    spawn("open", ["https://www.ableton.com/en/manual/"], { detached: true, stdio: "ignore" }).unref();
  });

  registry.register(
    "cmdabl",
    "configure cmdAbl",
    [{ name: "--setup", description: "install keyboard trigger rule (Karabiner on macOS, AutoHotkey on Windows)" }],
    (flags) => {
      if (flags.includes("--setup")) {
        showFeedback(runSetup());
      } else {
        showFeedback("cmdAbl: no recognised flag. Try: cmdabl --setup");
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
  }, () => isOpen);

  // ── startup hint ─────────────────────────────────────────────────────────
  if (!isSetupDone()) {
    console.log("cmdAbl: keyboard trigger not configured. Open the palette and run: cmdabl --setup");
  }

  // ── open command mode ────────────────────────────────────────────────────
  let isOpen = false;

  context.commands.registerCommand("cmdabl.open", () => {
    if (isOpen) return;
    isOpen = true;
    setKarabinerPaletteOpen(true);

    const html = interfaceTemplate.replace(
      "/*COMMANDS_PLACEHOLDER*/null",
      JSON.stringify(registry.list()),
    );
    const url = `data:text/html,${encodeURIComponent(html)}`;

    context.ui.showModalDialog(url, 500, 260).then((result) => {
      isOpen = false;
      setKarabinerPaletteOpen(false);
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
