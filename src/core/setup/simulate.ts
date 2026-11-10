import type { SetupFacts } from "./setupRows.js";

// `cmdabl setup --simulate <state>` (development builds only): the setup page for a state the machine is not in, for
// screenshots and hand checks. Only the facts fed into the rows change; nothing is written, and the opening rule
// (decideOpen) and the seen-state file never see a simulated page.

export const SIMULATE_STATES = ["no-karabiner", "no-rule", "rule-off", "no-script", "old-script"] as const;
export type SimulateState = (typeof SIMULATE_STATES)[number];

export function isSimulateState(value: unknown): value is SimulateState {
  return typeof value === "string" && (SIMULATE_STATES as readonly string[]).includes(value);
}

/** The facts with one state laid over them. The keyboard states show the macOS rows whatever the platform. */
export function simulateFacts(facts: SetupFacts, state: SimulateState): SetupFacts {
  switch (state) {
    case "no-karabiner":
      return { ...facts, platform: "darwin", trigger: { installed: false, ruleThere: false, enabled: null } };
    case "no-rule":
      return { ...facts, platform: "darwin", trigger: { installed: true, ruleThere: false, enabled: null } };
    case "rule-off":
      return { ...facts, platform: "darwin", trigger: { installed: true, ruleThere: true, enabled: false } };
    case "no-script":
      return { ...facts, script: { ...facts.script, installed: { status: "missing" }, copyFailed: null } };
    case "old-script":
      return { ...facts, script: { ...facts.script, installed: { status: "outdated", version: "0.0.1" }, copyFailed: null } };
  }
}
