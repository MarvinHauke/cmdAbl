import * as path from "node:path";
import type { ModuleApi } from "../types.js";
import { EXTENSIONS_DIR, downloadFile, unzipInto, readJsonFile, openUrl, removeDir } from "./platform.js";
import { buildListPage } from "./listPage.js";
import { pakablCommand } from "./command.js";
import { extensionDir, filterValidEntries, isValidId, repoUrl } from "./guards.js";
import { ExitCode, fail, ok, type CommandResult } from "../../types.js";
import pakablListTemplate from "../../../ui/pakabl-list.html";

// `context.environment.storageDirectory` is `string | undefined` in the SDK
// and comes back undefined in practice — so pakabl keeps its own cache/tmp
// data in a sibling folder of EXTENSIONS_DIR, which it already proved it can
// write to (that's where installs land). A leading dot keeps Live from
// mistaking it for an installed extension (no manifest.json inside).
const DATA_DIR = path.join(EXTENSIONS_DIR, ".pakabl");
const INDEX_CACHE_PATH = path.join(DATA_DIR, "index.json");

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

// Entries with an id that is not `<author-slug>.<name-slug>` are dropped here —
// the id becomes a path that is unzipped into and deleted — and counted so the
// commands can say so.
function loadIndex(): { entries: IndexEntry[]; dropped: number } | undefined {
  const raw = readJsonFile<unknown>(INDEX_CACHE_PATH);
  if (!Array.isArray(raw)) return undefined;
  const { valid, dropped } = filterValidEntries(raw as IndexEntry[]);
  return { entries: valid, dropped };
}

const droppedText = (n: number): string =>
  n > 0 ? `${n} index entr${n === 1 ? "y" : "ies"} with an invalid id or URL ignored` : "";

const badIdResult = (id: string): CommandResult =>
  fail(ExitCode.USAGE, `pakabl: "${id}" is not a valid extension id (expected <author>.<name>, e.g. federico-pepe.snake)`);

function installedManifest(id: string): InstalledManifest | undefined {
  const dir = extensionDir(EXTENSIONS_DIR, id);
  return dir ? readJsonFile<InstalledManifest>(path.join(dir, "manifest.json")) : undefined;
}

// Shared by install/upgrade — download the entry's `.ablx` and unzip it into
// place, overwriting any existing install (unzipInto is idempotent: -o/-Force).
function downloadAndUnpack(entry: IndexEntry): CommandResult | undefined {
  const target = extensionDir(EXTENSIONS_DIR, entry.id);
  if (!target) return fail(ExitCode.FAILURE, `pakabl: "${entry.id}" does not resolve inside the Extensions folder`);
  const tmpPath = path.join(DATA_DIR, "tmp", `${entry.id}.ablx`);

  const dl = downloadFile(entry.url, tmpPath);
  if (!dl.ok) {
    return fail(ExitCode.FAILURE, `pakabl: failed to download ${entry.name} v${entry.version}\n${dl.output}`);
  }

  const unpack = unzipInto(tmpPath, target);
  if (!unpack.ok) {
    return fail(ExitCode.FAILURE, `pakabl: failed to unpack ${entry.name} v${entry.version}\n${unpack.output}`);
  }

  return undefined;
}

async function install(api: ModuleApi, id: string | undefined): Promise<CommandResult | void> {
  if (!id) return fail(ExitCode.USAGE, "pakabl: usage: pakabl install <id>");
  if (!isValidId(id)) return badIdResult(id);

  const loaded = loadIndex();
  if (!loaded) return fail(ExitCode.FAILURE, "pakabl: no index cached — run \"pakabl update\" first");

  const entry = loaded.entries.find((e) => e.id === id);
  if (!entry) return fail(ExitCode.NOT_FOUND, `pakabl: "${id}" is not in the curated list`);

  const installed = installedManifest(id);
  if (installed) {
    if (installed.version === entry.version) {
      return ok(`pakabl: ${entry.name} v${installed.version} is already installed`);
    }
    return ok(
      `pakabl: ${entry.name} v${installed.version} is installed; index has v${entry.version} — ` +
        `run "pakabl upgrade ${id}" to switch`,
    );
  }

  const failed = downloadAndUnpack(entry);
  if (failed) return failed;
  return ok(`pakabl: installed ${entry.name} v${entry.version} — restart Live to load it`);
}

async function uninstall(api: ModuleApi, id: string | undefined): Promise<CommandResult | void> {
  if (!id) return fail(ExitCode.USAGE, "pakabl: usage: pakabl uninstall <id>");
  if (!isValidId(id)) return badIdResult(id);
  const dir = extensionDir(EXTENSIONS_DIR, id);
  if (!dir) return fail(ExitCode.FAILURE, `pakabl: "${id}" does not resolve inside the Extensions folder`);

  const installed = installedManifest(id);
  if (!installed) return fail(ExitCode.NOT_FOUND, `pakabl: "${id}" is not installed`);

  const result = removeDir(dir);
  if (!result.ok) return fail(ExitCode.FAILURE, `pakabl: failed to uninstall ${installed.name}\n${result.output}`);

  return ok(`pakabl: uninstalled ${installed.name} v${installed.version} — restart Live to unload it`);
}

interface ListEntry {
  id: string;
  name: string;
  version: string;
  installedVersion: string | null;
  repoUrl: string | undefined;
}

// Browse the cached index — each row's primary button reflects install status:
// not installed → Install, at index version → Uninstall, at different version → Update.
// Every action round-trips through the one `close_and_send` channel the SDK exposes
// (closing the dialog), then `list` dispatches to the existing install/uninstall/upgrade
// functions exactly as if the user had typed the equivalent `pakabl …` command.
async function list(api: ModuleApi): Promise<CommandResult | void> {
  const loaded = loadIndex();
  if (!loaded) return fail(ExitCode.FAILURE, "pakabl: no index cached — run \"pakabl update\" first");
  const index = loaded.entries;

  const entries: ListEntry[] = index.map((entry) => {
    const installed = installedManifest(entry.id);
    return {
      id: entry.id,
      name: entry.name,
      version: entry.version,
      installedVersion: installed?.version ?? null,
      repoUrl: repoUrl(entry.url),
    };
  });

  let html: string;
  try {
    html = buildListPage(pakablListTemplate, entries);
  } catch (e: unknown) {
    return fail(ExitCode.FAILURE, `pakabl: cannot build the list page — ${e instanceof Error ? e.message : String(e)}`);
  }

  const result = await api.context.ui.showModalDialog(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`, 560, 480);
  const note = droppedText(loaded.dropped);
  if (!result) return note ? ok(`pakabl: ${note}`) : undefined;

  let outcome: CommandResult | void = undefined;
  if (result.startsWith("install:")) {
    outcome = await install(api, result.slice("install:".length));
  } else if (result.startsWith("uninstall:")) {
    outcome = await uninstall(api, result.slice("uninstall:".length));
  } else if (result.startsWith("update:")) {
    const id = result.slice("update:".length);
    const entry = index.find((e) => e.id === id);
    if (entry) outcome = await upgrade(api, `${entry.id}@${entry.version}`);
  } else if (result.startsWith("repo:")) {
    // The page only names an extension; the host derives the URL itself and
    // opens it only when it is an https repo URL of an index entry.
    const id = result.slice("repo:".length);
    const entry = isValidId(id) ? index.find((e) => e.id === id) : undefined;
    const url = entry ? repoUrl(entry.url) : undefined;
    if (!url || !url.startsWith("https://")) {
      return fail(ExitCode.NOT_FOUND, `pakabl: no repository known for "${id}"`);
    }
    return openUrl(url);
  }
  return outcome;
}

async function update(api: ModuleApi): Promise<CommandResult | void> {
  const dl = downloadFile(CURATED_INDEX_URL, INDEX_CACHE_PATH);
  if (!dl.ok) return fail(ExitCode.FAILURE, `pakabl: failed to refresh the index\n${dl.output}`);

  const loaded = loadIndex();
  if (!loaded) return fail(ExitCode.FAILURE, "pakabl: refreshed file is not a valid index");

  const n = loaded.entries.length;
  return ok(`pakabl: index refreshed (${n} extension${n === 1 ? "" : "s"})${loaded.dropped > 0 ? ` (${droppedText(loaded.dropped)})` : ""}`);
}

async function upgrade(api: ModuleApi, ref: string | undefined): Promise<CommandResult | void> {
  if (!ref) return fail(ExitCode.USAGE, "pakabl: usage: pakabl upgrade <id>[@<version>]");

  // `<id>@<version>` states which version is expected (a guard against a stale
  // index); a bare `<id>` takes whatever the index lists.
  const at = ref.indexOf("@");
  const id = at === -1 ? ref : ref.slice(0, at);
  const version = at === -1 ? undefined : ref.slice(at + 1);
  if (!isValidId(id)) return badIdResult(id);

  const loaded = loadIndex();
  if (!loaded) return fail(ExitCode.FAILURE, "pakabl: no index cached — run \"pakabl update\" first");

  const entry = loaded.entries.find((e) => e.id === id);
  if (!entry) return fail(ExitCode.NOT_FOUND, `pakabl: "${id}" is not in the curated list`);

  if (version !== undefined && entry.version !== version) {
    return fail(
      ExitCode.FAILURE,
      `pakabl: index lists ${entry.name} v${entry.version}, not v${version} — ` +
        `run "pakabl update" or check the version string`,
    );
  }

  const failed = downloadAndUnpack(entry);
  if (failed) return failed;
  return ok(`pakabl: upgraded ${entry.name} to v${entry.version} — restart Live to reload it`);
}

export function activate(api: ModuleApi): void {
  api.commands.add(
    pakablCommand({
      install: (id) => install(api, id),
      uninstall: (id) => uninstall(api, id),
      update: () => update(api),
      upgrade: (ref) => upgrade(api, ref),
      list: () => list(api),
    }),
  );
}
