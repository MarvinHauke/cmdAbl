/** What the id completers need of an index entry. */
export interface IdEntry {
  id: string;
  name: string;
  version: string;
}

export interface IdRow {
  label: string;
  description: string;
}

/**
 * The parsed index kept in memory for the completers (they run on every palette open and must stay
 * cheap): `load` runs only when `stamp` (the index file's mtime, one stat) changed since the last
 * read, or after `invalidate()` (`pakabl update`). A file that is not there gives
 * no rows. `installed` is a cheap in-process check per entry (an existence test, not a parse).
 */
export function createIdRows(deps: {
  stamp: () => number | undefined;
  load: () => IdEntry[] | undefined;
  installed: (id: string) => boolean;
}): { rows(installedOnly: boolean): IdRow[]; invalidate(): void } {
  let seen: number | undefined;
  let all: IdRow[] = [];
  let ids: string[] = [];
  let fresh = false;
  const refresh = (): void => {
    const stamp = deps.stamp();
    if (fresh && stamp === seen) return;
    const entries = stamp === undefined ? undefined : deps.load();
    seen = stamp;
    fresh = true;
    ids = (entries ?? []).map((e) => e.id);
    all = (entries ?? []).map((e) => ({ label: e.id, description: `${e.name} v${e.version}` }));
  };
  return {
    rows(installedOnly) {
      refresh();
      return installedOnly ? all.filter((_, i) => deps.installed(ids[i]!)) : all;
    },
    invalidate() {
      fresh = false;
    },
  };
}
