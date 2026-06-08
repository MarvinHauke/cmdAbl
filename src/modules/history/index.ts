import type { ModuleApi } from "../types.js";

const MAX_ENTRIES = 20;

/**
 * Remembers recent full command invocations (e.g. "mute /vermona/kick, /vermona/snare")
 * and re-offers them as their own re-runnable palette entries, most-recent-first —
 * so a complex command can be run again without retyping its arguments.
 *
 * In-memory only: resets on extension reload, by design (no durable storage).
 */
export function activate(api: ModuleApi): void {
  const entries: string[] = []; // most-recent-first, deduped

  api.onCommandRun((invocation) => {
    const i = entries.indexOf(invocation);
    if (i !== -1) entries.splice(i, 1);
    entries.unshift(invocation);
    entries.length = Math.min(entries.length, MAX_ENTRIES);
  });

  api.registerProvider({
    getItems: () =>
      entries.map((invocation) => ({
        // `id` is the full invocation string ("mute /a, /b"), not a bare
        // command name — the webview splits any multi-word command id into
        // {name, flags} the same way it parses raw typed input, so this
        // re-runs through the exact same path a fresh invocation would.
        id: invocation,
        type: "command",
        title: invocation,
        subtitle: "(history)",
      })),
  });
}
