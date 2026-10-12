// The body of the command-reference generator (run through
// scripts/gen-command-reference.ts, which bundles it so the dialog pages
// (`.html`) the modules import load).
//
// The bundled modules are activated against a stub ModuleApi: activation only
// declares commands (no Live, no SDK call at registration time). Note: scripts/
// is outside tsconfig's `include`, so the stub below is not type-checked by
// `npm run build`; a missing ModuleApi member fails loudly when this runs.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { CommandRegistry } from "../src/commandRegistry.js";
import { registerBuiltins } from "../src/core/builtins.js";
import { renderCommandReference } from "../src/core/referenceDoc.js";
import { MODULES } from "../src/modules/index.js";
import type { ModuleApi } from "../src/modules/types.js";

const OUT = path.resolve(process.cwd(), "docs/reference/commands.md");

const registry = new CommandRegistry();
registerBuiltins(registry);

const stub: ModuleApi = {
  // Touching the Live context at activation would be a module bug: fail loudly.
  get context(): never {
    throw new Error("a module used api.context while being activated; declare commands only");
  },
  commands: { add: (command) => void registry.add(command) },
  pick: async () => null,
  onPick: () => {},
  registerProvider: () => {},
  onCommandRun: () => {},
  showFeedback: () => {},
};
for (const mod of MODULES) mod.activate(stub);

const text = renderCommandReference(registry.roots());

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(OUT, "utf8");
  } catch {
    // missing page: differs
  }
  if (current !== text) {
    console.error("docs/reference/commands.md is out of date: run `npm run docs:reference` and commit the result.");
    process.exit(1);
  }
  console.log("docs/reference/commands.md is up to date");
} else {
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, text);
  console.log(`wrote ${path.relative(process.cwd(), OUT)}`);
}
