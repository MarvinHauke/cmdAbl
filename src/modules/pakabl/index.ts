import * as path from "node:path";
import type { ModuleApi } from "../types.js";
import { EXTENSIONS_DIR, downloadFile, unzipInto, readJsonFile } from "./platform.js";

// Hosted alongside cmdAbl itself — one repo to maintain, versioned together,
// fetched via the raw-file URL pattern confirmed working during this project's
// research (raw.githubusercontent.com/<owner>/<repo>/<branch>/<path>).
const CURATED_INDEX_URL =
  "https://raw.githubusercontent.com/MarvinHauke/cmdAbl/main/pakabl/index.json";

interface IndexEntry {
  // The folder name Live installs the extension under — `<author-slug>.<name-slug>`
  // (confirmed on disk: "federico-pepe.arrangement-helper", "marvinhauke.cmdabl").
  // This, not the free-form `manifest.json` "name", is what `pakabl install`/
  // `upgrade` take as their argument and what's used to find an existing install.
  id: string;
  name: string;
  version: string;
  url: string;
}

interface InstalledManifest {
  name: string;
  version: string;
}

function indexCachePath(api: ModuleApi): string | undefined {
  const dir = api.context.environment.storageDirectory;
  return dir ? path.join(dir, "pakabl", "index.json") : undefined;
}

function loadIndex(api: ModuleApi): IndexEntry[] | undefined {
  const cachePath = indexCachePath(api);
  if (!cachePath) return undefined;
  return readJsonFile<IndexEntry[]>(cachePath);
}

function installedManifest(id: string): InstalledManifest | undefined {
  return readJsonFile<InstalledManifest>(path.join(EXTENSIONS_DIR, id, "manifest.json"));
}

// Shared by install/upgrade — download the entry's `.ablx` and unzip it into
// place, overwriting any existing install (unzipInto is idempotent: -o/-Force).
function downloadAndUnpack(api: ModuleApi, entry: IndexEntry): boolean {
  const cacheDir = api.context.environment.storageDirectory;
  const tmpPath = path.join(cacheDir ?? EXTENSIONS_DIR, "pakabl", "tmp", `${entry.id}.ablx`);

  const dl = downloadFile(entry.url, tmpPath);
  if (!dl.ok) {
    api.showFeedback(`pakabl: failed to download ${entry.name} v${entry.version}\n${dl.output}`);
    return false;
  }

  const unpack = unzipInto(tmpPath, path.join(EXTENSIONS_DIR, entry.id));
  if (!unpack.ok) {
    api.showFeedback(`pakabl: failed to unpack ${entry.name} v${entry.version}\n${unpack.output}`);
    return false;
  }

  return true;
}

async function install(api: ModuleApi, id: string | undefined): Promise<void> {
  if (!id) {
    api.showFeedback("pakabl: usage: pakabl install <id>");
    return;
  }

  const index = loadIndex(api);
  if (!index) {
    api.showFeedback("pakabl: no index cached — run \"pakabl update\" first");
    return;
  }

  const entry = index.find((e) => e.id === id);
  if (!entry) {
    api.showFeedback(`pakabl: "${id}" is not in the curated list`);
    return;
  }

  const installed = installedManifest(id);
  if (installed) {
    if (installed.version === entry.version) {
      api.showFeedback(`pakabl: ${entry.name} v${installed.version} is already installed`);
    } else {
      api.showFeedback(
        `pakabl: ${entry.name} v${installed.version} is installed; index has v${entry.version} — ` +
          `run "pakabl upgrade ${id}@${entry.version}" to switch`,
      );
    }
    return;
  }

  if (!downloadAndUnpack(api, entry)) return;
  api.showFeedback(`pakabl: installed ${entry.name} v${entry.version} — restart Live to load it`);
}

async function update(api: ModuleApi): Promise<void> {
  const cachePath = indexCachePath(api);
  if (!cachePath) {
    api.showFeedback("pakabl: no storage directory available to cache the index");
    return;
  }

  const dl = downloadFile(CURATED_INDEX_URL, cachePath);
  if (!dl.ok) {
    api.showFeedback(`pakabl: failed to refresh the index\n${dl.output}`);
    return;
  }

  const index = readJsonFile<IndexEntry[]>(cachePath);
  if (!index) {
    api.showFeedback("pakabl: refreshed file is not a valid index");
    return;
  }

  api.showFeedback(`pakabl: index refreshed (${index.length} extension${index.length === 1 ? "" : "s"})`);
}

async function upgrade(api: ModuleApi, idAtVersion: string | undefined): Promise<void> {
  if (!idAtVersion || !idAtVersion.includes("@")) {
    api.showFeedback("pakabl: usage: pakabl upgrade <id>@<version>");
    return;
  }

  const at = idAtVersion.indexOf("@");
  const id = idAtVersion.slice(0, at);
  const version = idAtVersion.slice(at + 1);

  const index = loadIndex(api);
  if (!index) {
    api.showFeedback("pakabl: no index cached — run \"pakabl update\" first");
    return;
  }

  const entry = index.find((e) => e.id === id);
  if (!entry) {
    api.showFeedback(`pakabl: "${id}" is not in the curated list`);
    return;
  }

  if (entry.version !== version) {
    api.showFeedback(
      `pakabl: index lists ${entry.name} v${entry.version}, not v${version} — ` +
        `run "pakabl update" or check the version string`,
    );
    return;
  }

  if (!downloadAndUnpack(api, entry)) return;
  api.showFeedback(`pakabl: upgraded ${entry.name} to v${version} — restart Live to reload it`);
}

/** `pakabl install <id>` / `pakabl update` / `pakabl upgrade <id>@<version>` — download
 *  confirmed `.ablx` extensions from a curated index and unpack them into Live's Extensions
 *  folder (the same place the user already drops hand-installed extensions). */
export function activate(api: ModuleApi): void {
  api.registry.register("pakabl", "install and manage cmdAbl extensions", async (flags) => {
    const [sub, arg] = flags;
    if (sub === "install") await install(api, arg);
    else if (sub === "update") await update(api);
    else if (sub === "upgrade") await upgrade(api, arg);
    else {
      api.showFeedback(
        "pakabl: usage\n  pakabl install <id>\n  pakabl update\n  pakabl upgrade <id>@<version>",
      );
    }
  });
}
