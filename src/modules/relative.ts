// A relative step on a group of levels (fader dB values, say), with a rule for what happens at the ends.
// Pure and free of any command: the module that links levels later reuses it (plan 0015).

export type RelativeRule =
  /** Shrink the step so that no member crosses an end; every member moves by the same amount. */
  | "stop"
  /** Every member moves by the step; those past an end are clamped (past the bottom: `-Infinity`). */
  | "clip";

export interface Bounds {
  /** The lowest finite level; below it a clipped member goes to -Infinity. */
  min: number;
  /** The highest level. */
  max: number;
}

export interface RelativeResult {
  /** The new level of each member, in the order given. */
  newLevels: number[];
  /** The step every member moved by (`stop`: possibly shorter than asked; `clip`: as asked). */
  applied: number;
  /** Indexes of members that reached an end: `stop` only when the step was shortened; `clip` those clamped or stuck at -Infinity. */
  limited: number[];
}

const SAME = 1e-9;

/**
 * `stop` (the default rule): members at -Infinity are left out of the calculation and stay where they are; the
 * step is cut to what the member nearest an end allows, so the spacing between the others stays. `clip`: each
 * member alone follows the step.
 */
export function applyRelative(levels: readonly number[], delta: number, rule: RelativeRule, bounds: Bounds): RelativeResult {
  if (rule === "clip") {
    const limited: number[] = [];
    const newLevels = levels.map((level, i) => {
      if (delta === 0) return level;
      if (level === -Infinity) {
        limited.push(i);
        return level;
      }
      const target = level + delta;
      if (target > bounds.max) {
        limited.push(i);
        return bounds.max;
      }
      if (target < bounds.min) {
        limited.push(i);
        return -Infinity;
      }
      return target;
    });
    return { newLevels, applied: delta, limited };
  }

  const finite = levels.map((l, i) => (Number.isFinite(l) ? i : -1)).filter((i) => i >= 0);
  let applied = 0;
  if (finite.length > 0 && delta > 0) applied = Math.min(delta, Math.min(...finite.map((i) => bounds.max - levels[i]!)));
  else if (finite.length > 0 && delta < 0) applied = -Math.min(-delta, Math.min(...finite.map((i) => levels[i]! - bounds.min)));
  if (applied === 0) applied = 0; // no -0
  const newLevels = levels.map((l) => (Number.isFinite(l) ? Math.min(bounds.max, Math.max(bounds.min, l + applied)) : l));
  const shortened = Math.abs(applied - delta) > SAME;
  const edge = delta > 0 ? bounds.max : bounds.min;
  const limited = shortened ? finite.filter((i) => Math.abs(newLevels[i]! - edge) <= SAME) : [];
  return { newLevels, applied, limited };
}
