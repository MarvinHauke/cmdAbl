import { realpathSync } from "node:fs";

/**
 * True when both paths exist and resolve to the same real location (e.g. the
 * User Library's Remote Script folder is a symlink to the repository's).
 * Never throws: a path that cannot be resolved is simply "not the same".
 */
export function isSameDirectory(a: string, b: string, realpath: (p: string) => string = realpathSync): boolean {
  try {
    return realpath(a) === realpath(b);
  } catch {
    return false;
  }
}
