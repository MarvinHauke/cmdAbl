// MIDI controls and operators (plan 0018, "The simple version"): pure helpers shared by the engine
// (midiEngine.ts) and the modules (`map`, `midi`). No host or Node APIs.
//
// A MESSAGE is what the Remote Script pushes: `{ type, channel (1-16), number, value }`. A CONTROL is
// what a binding names: `CC37`, `N36`, `PB`, with `/ch2` to limit the channel (omni without).
// An OPERATOR turns the messages of one control into runs of the bound line: when it fires and which
// value it hands to `{}`.

export type MessageType = "cc" | "note_on" | "note_off" | "pb";

/** One incoming MIDI message, channel 1-16; a pitch bend has number 0 and the 14-bit value. */
export interface MidiMessage {
  type: MessageType;
  channel: number;
  number: number;
  value: number;
}

export type ControlKind = "cc" | "note" | "pb";

/** A control a binding listens to. `number` is absent for pitch bend; `channel` absent means every channel. */
export interface MidiControl {
  kind: ControlKind;
  number?: number;
  channel?: number;
}

const CONTROL = /^(cc|n|pb)(\d{1,3})?(?:\/ch(\d{1,2}))?$/i;

/** `CC37`, `N36`, `PB`, `CC37/ch2` (case ignored) as a control, or null. CC and N need a number 0-127; PB has none. */
export function parseControl(text: string): MidiControl | null {
  const m = CONTROL.exec(text.trim());
  if (!m) return null;
  const kind = m[1]!.toLowerCase();
  const control: MidiControl = { kind: kind === "n" ? "note" : kind === "pb" ? "pb" : "cc" };
  if (kind === "pb") {
    if (m[2] !== undefined) return null;
  } else {
    if (m[2] === undefined) return null;
    const number = Number(m[2]);
    if (number > 127) return null;
    control.number = number;
  }
  if (m[3] !== undefined) {
    const channel = Number(m[3]);
    if (channel < 1 || channel > 16) return null;
    control.channel = channel;
  }
  return control;
}

/** The control as it is typed: `CC37`, `N36/ch2`, `PB`. */
export function formatControl(control: MidiControl): string {
  const name = control.kind === "cc" ? `CC${control.number}` : control.kind === "note" ? `N${control.number}` : "PB";
  return control.channel === undefined ? name : `${name}/ch${control.channel}`;
}

/** The control a message came from (with its channel), for learning and the monitor. */
export function controlOf(message: MidiMessage): MidiControl {
  return message.type === "pb"
    ? { kind: "pb", channel: message.channel }
    : { kind: message.type === "cc" ? "cc" : "note", number: message.number, channel: message.channel };
}

/** Does `message` come from `control` (a missing channel matches every channel)? */
export function controlMatches(control: MidiControl, message: MidiMessage): boolean {
  if (control.channel !== undefined && control.channel !== message.channel) return false;
  if (control.kind === "cc") return message.type === "cc" && message.number === control.number;
  if (control.kind === "note") return (message.type === "note_on" || message.type === "note_off") && message.number === control.number;
  return message.type === "pb";
}

/** The same control as the Remote Script's `midi_listen` takes it (`note` for notes, `pb` for pitch bend). */
export function listenControl(control: MidiControl): { type: ControlKind; channel?: number; number?: number } {
  return {
    type: control.kind,
    ...(control.channel !== undefined ? { channel: control.channel } : {}),
    ...(control.number !== undefined ? { number: control.number } : {}),
  };
}

// ── operators ─────────────────────────────────────────────────────────────────────────────────

export const OPERATORS = ["press", "release", "hold", "toggle"] as const;
export type OperatorName = (typeof OPERATORS)[number];

export const isOperator = (name: string): name is OperatorName => (OPERATORS as readonly string[]).includes(name);

/** What an operator remembers about one binding. */
export interface OperatorState {
  /** The control is down now (a CC above the threshold, or a note that is on): edge detection. */
  down: boolean;
  /** `toggle`: the value the NEXT press hands over is `on ? 0 : 1`, so this is the last value handed over (1 = on). */
  on: boolean;
}

export const initialState = (): OperatorState => ({ down: false, on: false });

export interface OperatorOptions {
  /** A CC (or pitch bend) is pressed above this value, released at or below it. Default 0: any value above 0 is a press. */
  threshold?: number;
}

export interface OperatorResult {
  /** Run the bound line now. */
  fire: boolean;
  /** The value for `{}`; absent for `press` and `release`. */
  value?: number;
  /** The state after this message. The caller keeps `down` always; it takes `on` only when a run really starts (a dropped firing must not advance a toggle). */
  next: OperatorState;
}

/** Does the operator hand a value to `{}`? `press` and `release` do not. */
export const operatorGivesValue = (operator: OperatorName): boolean => operator === "hold" || operator === "toggle";

/**
 * Pure: one message of the control in, whether the line runs and with which value out, plus the next state.
 * - press: a CC crossing above the threshold (from at or below it), or a note-on;
 * - release: a CC falling to the threshold or below (from above it), or a note-off;
 * - hold: press and release, handing 1 and 0;
 * - toggle: each press, handing 1, 0, 1, …
 * The UC4's buttons send 10 and 0: both count (any value above 0 is down).
 */
export function applyOperator(operator: OperatorName, message: MidiMessage, state: OperatorState, options: OperatorOptions = {}): OperatorResult {
  const threshold = options.threshold ?? 0;
  const isNote = message.type === "note_on" || message.type === "note_off";
  // Down or up? A note-on is down and a note-off is up whatever the velocity; a CC or pitch bend crosses the threshold.
  const down = message.type === "note_on" ? true : message.type === "note_off" ? false : message.value > threshold;
  // A note fires on every note-on and note-off; a CC fires only on the edge (10, then 20 is not a second press).
  const pressed = down && (isNote || !state.down);
  const released = !down && (isNote || state.down);
  const next: OperatorState = { down, on: state.on };
  switch (operator) {
    case "press":
      return { fire: pressed, next };
    case "release":
      return { fire: released, next };
    case "hold":
      if (pressed) return { fire: true, value: 1, next };
      if (released) return { fire: true, value: 0, next };
      return { fire: false, next };
    case "toggle":
      if (!pressed) return { fire: false, next };
      return { fire: true, value: state.on ? 0 : 1, next: { down, on: !state.on } };
  }
}

/** The usage error for `{}` with an operator that hands no value, or null when the combination is fine. */
export function validateBinding(operator: OperatorName, line: string): string | null {
  if (!operatorGivesValue(operator) && line.includes("{}")) return `${operator} gives no value; use hold or toggle`;
  return null;
}

/** The line with every `{}` replaced by the value. */
export const substituteValue = (line: string, value: number | undefined): string => (value === undefined ? line : line.split("{}").join(String(value)));
