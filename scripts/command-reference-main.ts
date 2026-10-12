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
import {
  checkExamples,
  renderCommandReference,
  renderLiveApiReference,
  renderRemoteScriptReference,
} from "../src/core/referenceDoc.js";
import { lomPath, lomReferenceUrl } from "../src/ableton/lomPath.js";
import { PORT_MAPPING, lomUrl } from "../src/modules/portMapping.js";
import { REMOTE_SCRIPT_OPS, REMOTE_SCRIPT_ROUTE_LOM } from "../src/ableton/remoteScriptOps.js";
import { PROTOCOL_VERSION, SCRIPT_VERSION } from "../src/ableton/bridgeProtocol.js";
import { MODULES } from "../src/modules/index.js";
import type { ModuleApi } from "../src/modules/types.js";

const PAGES = {
  commands: path.resolve(process.cwd(), "docs/reference/commands.md"),
  remoteScript: path.resolve(process.cwd(), "docs/reference/remote-script.md"),
  liveApi: path.resolve(process.cwd(), "docs/reference/live-api.md"),
};

const registry = new CommandRegistry();
registerBuiltins(registry);

const stub: ModuleApi = {
  // Touching a port at activation would be a module bug: the getters below fail loudly.
  get bridge(): never {
    throw new Error("a module used api.bridge while being activated; declare commands only");
  },
  get liveSet(): never {
    throw new Error("a module used api.liveSet while being activated; declare commands only");
  },
  get tracks(): never {
    throw new Error("a module used api.tracks while being activated; declare commands only");
  },
  log: () => {
    throw new Error("a module logged while being activated; declare commands only");
  },
  dialog: async () => {
    throw new Error("a module opened a dialog while being activated; declare commands only");
  },
  commands: { add: (command) => void registry.add(command) },
  pick: async () => null,
  onPick: () => {},
  registerProvider: () => {},
  onCommandRun: () => {},
  showFeedback: () => {},
};
for (const mod of MODULES) mod.activate(stub);

const problems = checkExamples(registry.roots());
if (problems.length) {
  console.error("Command documentation is incomplete:\n  " + problems.join("\n  "));
  process.exit(1);
}

// One example per kind of object: a cmdAbl path and the LOM path `lomPath` builds from its position.
const example = (kind: string, scope: "regular" | "return" | "master", cmdablPath: string, route: number[]) => ({
  kind,
  scope,
  cmdablPath,
  lomPath: lomPath({ scope, route }),
});
const pathExamples = [
  example("track", "regular", "/Bass", [2]),
  example("return track", "return", "/A-Reverb", [0]),
  example("main track", "master", "/Main", [0]),
  example("device", "regular", "/Bass/Operator", [2, 0]),
  example("rack chain", "regular", "/Bass/Drum Rack/Kick Chain", [2, 1, 0]),
  example("device in a chain", "regular", "/Bass/Drum Rack/Kick Chain/Simpler", [2, 1, 0, 0]),
];

const pages: Array<[string, string]> = [
  [PAGES.commands, renderCommandReference(registry.roots())],
  [PAGES.remoteScript, renderRemoteScriptReference(REMOTE_SCRIPT_OPS, { script: SCRIPT_VERSION, protocol: PROTOCOL_VERSION })],
  [
    PAGES.liveApi,
    renderLiveApiReference({
      ports: PORT_MAPPING,
      ops: REMOTE_SCRIPT_OPS,
      routeLom: REMOTE_SCRIPT_ROUTE_LOM,
      pathExamples,
      lomUrl,
      pageUrl: lomReferenceUrl,
    }),
  ],
];

if (process.argv.includes("--check")) {
  let stale = false;
  for (const [file, text] of pages) {
    let current = "";
    try {
      current = readFileSync(file, "utf8");
    } catch {
      // missing page: differs
    }
    if (current !== text) {
      console.error(`${path.relative(process.cwd(), file)} is out of date: run \`npm run docs:reference\` and commit the result.`);
      stale = true;
    }
  }
  if (stale) process.exit(1);
  console.log("docs/reference is up to date");
} else {
  for (const [file, text] of pages) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
    console.log(`wrote ${path.relative(process.cwd(), file)}`);
  }
}
