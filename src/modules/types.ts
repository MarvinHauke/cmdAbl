// The surface cmdAbl's bundled default modules (goto, mute, solo, pakabl, …)
// register through — a thin facade over the same CommandRegistry/Provider
// platform third-party `cmdabl`-declaring extensions will eventually reach
// through executeCommand (see docs/feature-plans/0003-pakabl-extension-system.md).

import type { ExtensionContext } from "@ableton-extensions/sdk";
import type { CommandRegistry } from "../commandRegistry.js";
import type { PaletteResult, Provider } from "../types.js";

export type ResultHandler = (result: PaletteResult) => void | Promise<void>;

export interface ModuleApi {
  context: ExtensionContext<"1.0.0">;
  registry: CommandRegistry;
  /**
   * Contribute searchable items to the palette snapshot. Lower `priority` sorts
   * earlier in the empty-query list (default 0; commands are 0, history is
   * negative so recent invocations come first). Ties keep registration order.
   */
  registerProvider(provider: Provider, priority?: number): void;
  /**
   * Handle palette results for non-"command" items, keyed by `PaletteItem.action`
   * ("select", "toggleMute", …) — the actual discriminator for what a Live-object
   * item should *do*, independent of its `type` ("track"/"device"/…).
   */
  registerResultHandler(action: string, handler: ResultHandler): void;
  /**
   * Notified after any command finishes with code 0 — fresh or re-run — with its
   * full canonical invocation string (e.g. "mute /vermona/kick, /vermona/snare").
   * Failed runs are not reported, and neither are bare invocations with no
   * arguments. The only window a module gets into *every* command run
   * regardless of who registered it.
   */
    onCommandRun(listener: (invocation: string) => void): void;
  /** Show a small modal with a message and a "Close" button. */
  showFeedback(message: string): void;
}

export interface Module {
  activate(api: ModuleApi): void;
}
