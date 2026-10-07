// Regenerates pakabl/index.json (approved sources) and pakabl/candidates.json (review queue).
//
//   GITHUB_TOKEN=... npx tsx scripts/pakabl-crawl.ts
//
// - pakabl/sources.json  → hand-curated allowlist of GitHub repos (the trust mechanism).
// - pakabl/index.json    → generated: newest .ablx per extension id from those repos.
// - pakabl/candidates.json → generated: repos found by topic search that ship a .ablx but
//   are not in sources.json yet. Approve one by adding its repo to sources.json.
//
// Each .ablx is downloaded and its manifest.json read, so name/version/id are authoritative
// rather than guessed from file names. The id mirrors the folder name Live installs under:
// `<slug(author)>.<slug(name)>` (e.g. "Federico Pepe"/"Track Creator" → federico-pepe.track-creator).

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SOURCES_PATH = path.join(ROOT, "pakabl/sources.json");
const INDEX_PATH = path.join(ROOT, "pakabl/index.json");
const CANDIDATES_PATH = path.join(ROOT, "pakabl/candidates.json");
const TOPICS = ["ableton-extension", "ableton-extensions"];
const SUPPORTED_API = "1.";

interface Source {
  repo: string; // "owner/name"
  exclude?: string[]; // extension ids to skip
}
interface IndexEntry {
  id: string;
  name: string;
  version: string;
  url: string;
}
interface Candidate {
  repo: string;
  description: string;
  stars: number;
  pushed: string;
  ablx: string[];
}
interface Asset {
  name: string;
  url: string;
}

const token = process.env.GITHUB_TOKEN;
const headers: Record<string, string> = {
  Accept: "application/vnd.github+json",
  "User-Agent": "cmdabl-pakabl-crawler",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

async function api<T>(url: string): Promise<T | undefined> {
  const res = await fetch(url.startsWith("http") ? url : `https://api.github.com${url}`, { headers });
  if (res.status === 404 || res.status === 409) return undefined; // missing / empty repo
  if (res.status === 401) {
    throw new Error(
      `401 Unauthorized for ${url} — GITHUB_TOKEN is invalid. If your shell exports a stale ` +
        `GITHUB_TOKEN, run: GITHUB_TOKEN=$(env -u GITHUB_TOKEN gh auth token) npx tsx scripts/pakabl-crawl.ts`,
    );
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return (await res.json()) as T;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((p) => parseInt(p, 10) || 0);
  const pb = b.split(/[.-]/).map((p) => parseInt(p, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

const rawUrl = (repo: string, filePath: string) =>
  `https://raw.githubusercontent.com/${repo}/HEAD/${filePath.split("/").map(encodeURIComponent).join("/")}`;

/** Every .ablx a repo publishes: latest release assets plus any committed .ablx files. */
async function findAblx(repo: string): Promise<Asset[]> {
  const found = new Map<string, Asset>();

  const release = await api<{ assets: { name: string; browser_download_url: string }[] }>(
    `/repos/${repo}/releases/latest`,
  );
  for (const a of release?.assets ?? []) {
    if (a.name.endsWith(".ablx")) found.set(a.browser_download_url, { name: a.name, url: a.browser_download_url });
  }

  const tree = await api<{ tree: { path: string; type: string }[] }>(`/repos/${repo}/git/trees/HEAD?recursive=1`);
  for (const f of tree?.tree ?? []) {
    if (f.type === "blob" && f.path.endsWith(".ablx")) {
      const url = rawUrl(repo, f.path);
      found.set(url, { name: path.basename(f.path), url });
    }
  }
  return [...found.values()];
}

/** Download an .ablx (a zip) and read its manifest.json. Returns undefined if unusable. */
async function readManifest(asset: Asset): Promise<{ name: string; author: string; version: string; api: string } | undefined> {
  const res = await fetch(asset.url, { headers: { "User-Agent": headers["User-Agent"] } });
  if (!res.ok) {
    console.warn(`  skip ${asset.name}: HTTP ${res.status}`);
    return undefined;
  }
  const dir = mkdtempSync(path.join(tmpdir(), "pakabl-"));
  try {
    const file = path.join(dir, "x.ablx");
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    const m = JSON.parse(execFileSync("unzip", ["-p", file, "manifest.json"], { encoding: "utf8" }));
    if (!m.name || !m.author || !m.version) throw new Error("manifest missing name/author/version");
    return { name: m.name, author: m.author, version: m.version, api: String(m.minimumApiVersion ?? "") };
  } catch (e) {
    console.warn(`  skip ${asset.name}: ${(e as Error).message.split("\n")[0]}`);
    return undefined;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function buildIndex(sources: Source[]): Promise<IndexEntry[]> {
  const best = new Map<string, IndexEntry>();
  for (const src of sources) {
    console.log(`source ${src.repo}`);
    for (const asset of await findAblx(src.repo)) {
      const m = await readManifest(asset);
      if (!m) continue;
      if (!m.api.startsWith(SUPPORTED_API)) {
        console.warn(`  skip ${asset.name}: unsupported minimumApiVersion "${m.api}"`);
        continue;
      }
      const id = `${slug(m.author)}.${slug(m.name)}`;
      if (src.exclude?.includes(id)) continue;
      const prev = best.get(id);
      if (!prev || compareVersions(m.version, prev.version) > 0) {
        best.set(id, { id, name: m.name, version: m.version, url: asset.url });
      }
    }
  }
  return [...best.values()].sort((a, b) => a.id.localeCompare(b.id));
}

async function findCandidates(approved: Set<string>): Promise<Candidate[]> {
  const repos = new Map<string, { description: string; stars: number; pushed: string }>();
  for (const topic of TOPICS) {
    const res = await api<{ items: any[] }>(`/search/repositories?q=topic:${topic}&per_page=100`);
    for (const r of res?.items ?? []) {
      if (r.archived || r.fork || approved.has(r.full_name.toLowerCase())) continue;
      repos.set(r.full_name, {
        description: r.description ?? "",
        stars: r.stargazers_count,
        pushed: String(r.pushed_at).slice(0, 10),
      });
    }
  }

  const out: Candidate[] = [];
  for (const [repo, meta] of repos) {
    const ablx = await findAblx(repo);
    if (ablx.length) out.push({ repo, ...meta, ablx: ablx.map((a) => a.name).sort() });
  }
  return out.sort((a, b) => b.stars - a.stars || a.repo.localeCompare(b.repo));
}

const writeJson = (file: string, data: unknown) => writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);

const sources: Source[] = JSON.parse(readFileSync(SOURCES_PATH, "utf8"));
const index = await buildIndex(sources);
if (index.length === 0) throw new Error("crawler produced an empty index — refusing to overwrite");
writeJson(INDEX_PATH, index);

const candidates = await findCandidates(new Set(sources.map((s) => s.repo.toLowerCase())));
writeJson(CANDIDATES_PATH, candidates);

console.log(`\nindex: ${index.length} extensions, candidates: ${candidates.length} repos`);
