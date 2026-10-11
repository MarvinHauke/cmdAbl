import { initialize, type ActivationContext } from "@ableton-extensions/sdk";
import { CommandRegistry } from "./commandRegistry.js";
import { createCommandProvider } from "./providers/commandProvider.js";
import { type Provider, type PaletteResult, type CommandResult, ExitCode, fail } from "./types.js";
import type { Module, ModuleApi, ResultHandler } from "./modules/types.js";
import { startTriggerServer } from "./httpTrigger.js";
import { isSetupDone, setKarabinerPaletteOpen } from "./setup.js";
import { registerBuiltins } from "./core/builtins.js";
import { presentResult } from "./core/present.js";
import { MODULES } from "./modules/index.js";
import interfaceTemplate from "../ui/interface.html";
import feedbackTemplate from "../ui/feedback.html";

const TRIGGER_PORT = 27184;

export function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");
  const registry = new CommandRegistry();
  const providers: { provider: Provider; priority: number }[] = [];
  const resultHandlers = new Map<string, ResultHandler>();
  const commandRunListeners: Array<(invocation: string) => void> = [];
  let isOpen = false;

  function showFeedback(message: string): void {
    const html = feedbackTemplate.replace("/*MESSAGE_PLACEHOLDER*/null", JSON.stringify(message));
    void context.ui.showModalDialog(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`, 500, 180);
  }

  // ── core: the only commands baked in (see src/core/builtins.ts) ───────────
  registerBuiltins(registry);

  // ── default modules ──────────────────────────────────────────────────────
  const moduleApi: ModuleApi = {
    context,
    registry,
    registerProvider: (provider, priority = 0) => providers.push({ provider, priority }),
    registerResultHandler: (action, handler) => resultHandlers.set(action, handler),
    onCommandRun: (listener) => commandRunListeners.push(listener),
    showFeedback,
  };
  // The command list itself is a provider (priority 0); modules add theirs.
  moduleApi.registerProvider(createCommandProvider(registry));
  for (const mod of MODULES) mod.activate(moduleApi);

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
  // Act on the structured payload the webview returns when an item is picked.
  async function dispatch(raw: string): Promise<void> {
    let result: PaletteResult;
    try {
      result = JSON.parse(raw) as PaletteResult;
    } catch {
      console.error(`cmdAbl: malformed palette result: ${raw}`);
      return;
    }
    if (result.type === "command") {
      const outcome = await registry.run(result.id, result.flags ?? []);
      present(outcome);
      // Report successful invocations that carry arguments to history
      // listeners — the webview already normalizes "canned" full-invocation
      // items (history entries) into this same {id, flags} shape, so this sees
      // fresh and re-run invocations identically. Failed runs aren't recorded.
      const invocation = [result.id, ...(result.flags ?? [])].join(" ");
      if (outcome.code === ExitCode.OK && invocation.includes(" ")) {
        for (const listener of commandRunListeners) listener(invocation);
      }
      return;
    }
    // Non-command items (Live objects) are routed by `action` — modules
    // declare what an item should *do*, independent of its `type`.
    const handler = result.action ? resultHandlers.get(result.action) : undefined;
    if (!handler) {
      present(fail(ExitCode.NOT_FOUND, `no handler for "${result.type}" action "${result.action}"`));
      return;
    }
    try {
      await handler(result);
    } catch (e: unknown) {
      present(fail(ExitCode.FAILURE, e instanceof Error ? e.message : String(e)));
    }
  }

  /** The single place results become user-visible (see src/core/present.ts). */
  function present(outcome: CommandResult): void {
    presentResult(outcome, showFeedback);
  }

  async function openPalette(): Promise<void> {
    if (isOpen) return;
    isOpen = true;
    setKarabinerPaletteOpen(true);
    try {
      // Snapshot every provider's items, then let the webview search them.
      // Stable sort by priority (lower first); ties keep registration order.
      const ordered = [...providers].sort((a, b) => a.priority - b.priority);
      const items = (await Promise.all(ordered.map((p) => p.provider.getItems()))).flat();
      const html = interfaceTemplate.replace(
        "/*ITEMS_PLACEHOLDER*/null",
        JSON.stringify(items),
      );
      const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
      const result = await context.ui.showModalDialog(url, 500, 260);
      if (result) await dispatch(result);
    } catch (e: unknown) {
      console.error(e instanceof Error ? e.message : String(e));
    } finally {
      isOpen = false;
      setKarabinerPaletteOpen(false);
    }
  }

  context.commands.registerCommand("cmdabl.open", () => {
    void openPalette();
  });

  const scopes = ["AudioClip", "MidiClip", "AudioTrack", "MidiTrack", "ClipSlot", "Scene"] as const;
  for (const scope of scopes) {
    void context.ui.registerContextMenuAction(scope, ": cmdAbl", "cmdabl.open");
  }
}
