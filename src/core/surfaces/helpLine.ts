import type { Ui } from "./ui.js";

// The help line switch (plan 0019 §3): `ui.helpLine` goes into the request of every surface that has a
// help line, as `help: boolean`. One wrapper around the real Ui, so no request builder has to know
// about it and a module's page request cannot forget or fake it.
// Reading the setting never throws: a failure means the default (on).

/** Wrap `ui` so the settings, defaults, pick, note and palette requests carry `help` (the current `ui.helpLine`). */
export function withHelpLine(ui: Ui, helpLine: () => Promise<boolean>): Ui {
  const help = async (): Promise<boolean> => {
    try {
      return (await helpLine()) !== false;
    } catch {
      return true;
    }
  };
  return {
    ...ui,
    settings: async (request) => ui.settings({ ...request, help: await help() }),
    defaults: async (request, check) => ui.defaults({ ...request, help: await help() }, check),
    select: async (request) => ui.select({ ...request, help: await help() }),
    prompt: async (request) => ui.prompt({ ...request, help: await help() }),
    notifyAnswer: async (request) => ui.notifyAnswer({ ...request, help: await help() }),
  };
}
