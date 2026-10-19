import type { ModuleApi } from "../types.js";
import { ok, type CommandResult } from "../../core/types.js";
import { HistoryStore } from "./store.js";
import { historyCommand, type HistoryHandlers } from "./command.js";

/**
 * Remembers recent full command invocations (e.g. "mute --set 0 bass, lead")
 * and re-offers them as their own re-runnable palette entries, most-recent-first —
 * so a complex command can be run again without retyping its arguments.
 * `history clear`, `history forget` and `history restore` manage the list.
 *
 * In-memory only: resets on extension reload, by design (no durable storage).
 */
export function activate(api: ModuleApi): void {
  const store = new HistoryStore();

  api.onCommandRun((invocation) => {
    // Managing the history is not history.
    if (invocation === "history" || invocation.startsWith("history ")) return;
    store.record(invocation);
  });

  const plural = (n: number) => (n === 1 ? "entry" : "entries");

  const handlers: HistoryHandlers = {
    async clear(force): Promise<CommandResult> {
      const n = store.size;
      if (n === 0) return ok("history is empty");
      if (force) {
        store.wipe();
        return ok(`history cleared (${n} ${plural(n)}, nothing to restore)`);
      }
      const yes = await api.confirm(
        `Clear all ${n} history ${plural(n)}? They can be restored with history restore until cmdAbl restarts.`,
        "Clear",
      );
      if (!yes) return ok("history kept");
      store.forget();
      return ok(`history cleared (${n} ${plural(n)}); history restore brings ${n === 1 ? "it" : "them"} back`);
    },
    async forget(count): Promise<CommandResult> {
      if (store.size === 0) return ok("history is empty");
      const n = store.forget(count);
      return ok(`forgot ${n} ${plural(n)}; history restore brings ${n === 1 ? "it" : "them"} back`);
    },
    async restore(count): Promise<CommandResult> {
      if (store.removedSize === 0) return ok("nothing to restore");
      const n = store.restore(count);
      return ok(n === 0 ? "nothing to restore (already in the history again)" : `restored ${n} ${plural(n)}`);
    },
  };
  api.commands.add(historyCommand(handlers));

  // Negative priority: the most recent invocation is the first row of the
  // empty-query palette, ahead of the static command list.
  api.registerProvider(
    {
      getItems: () =>
        store.list().map((invocation) => ({
          // `id` is the full invocation string ("mute /a, /b"), not a bare
          // command name — the webview splits any multi-word command id into
          // {name, flags} the same way it parses raw typed input, so this
          // re-runs through the exact same path a fresh invocation would.
          id: invocation,
          type: "command" as const,
          title: invocation,
          subtitle: "(history)",
        })),
    },
    -10,
  );
}
