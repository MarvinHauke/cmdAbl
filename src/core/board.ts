// The `board` surface (plan 0010): an editor of sections whose items are on or off. The contract
// types live in ui.ts; what is pure — capping a request, validating the page's answer, sizing the
// dialog — lives here so it can be unit-tested without the HTML templates.

import { MAX_ITEMS, MAX_SECTIONS, MAX_TEXT } from "./present.js";
import { notifySize } from "./notifySize.js";
import type { BoardAnswer, BoardRequest, Ui } from "./ui.js";

const clip = (value: unknown): string => {
  const text = typeof value === "string" ? value : "";
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
};

/**
 * The request as the page gets it: at most MAX_SECTIONS sections of MAX_ITEMS items, every text
 * at most MAX_TEXT characters; sections without an id or heading and items without an id are
 * dropped, as are duplicate ids and ids longer than MAX_TEXT (an id is never shortened, so the answer
 * always names what the module sent); labels, headings and meta are shortened. `cut` says whether anything was left out or shortened.
 */
export function capBoard(request: BoardRequest): { request: BoardRequest; cut: boolean } {
  let cut = false;
  const sections: BoardRequest["sections"] = [];
  const seenSections = new Set<string>();
  for (const section of Array.isArray(request.sections) ? request.sections : []) {
    const id = typeof section?.id === "string" && section.id.length <= MAX_TEXT ? section.id : ""; // an id is never shortened: the answer must name what the module sent
    const heading = clip(section?.heading).trim();
    if (!id || !heading || seenSections.has(id)) {
      cut = true;
      continue;
    }
    if (sections.length >= MAX_SECTIONS) {
      cut = true;
      continue;
    }
    seenSections.add(id);
    const items: BoardRequest["sections"][number]["items"] = [];
    const seenItems = new Set<string>();
    for (const item of Array.isArray(section.items) ? section.items : []) {
      const itemId = typeof item?.id === "string" && item.id.length <= MAX_TEXT ? item.id : "";
      if (!itemId || seenItems.has(itemId)) {
        cut = true;
        continue;
      }
      if (items.length >= MAX_ITEMS) {
        cut = true;
        continue;
      }
      const label = clip(item.label) || itemId;
      if (label !== item.label) cut = true;
      seenItems.add(itemId);
      items.push({ id: itemId, label, on: item.on === true });
    }
    const meta = clip(section.meta).trim();
    if (heading !== section.heading) cut = true;
    sections.push({ id, heading, ...(meta ? { meta } : {}), items, ...(section.readonly === true ? { readonly: true } : {}) });
  }
  if ((request.sections?.length ?? 0) > MAX_SECTIONS) cut = true;
  return {
    request: {
      title: clip(request.title),
      sections,
      ...(request.create
        ? { create: { label: clip(request.create.label), ...(request.create.pattern ? { pattern: request.create.pattern } : {}) } }
        : {}),
      apply: { label: clip(request.apply?.label) || "Apply" },
    },
    cut,
  };
}

/**
 * The page's answer, checked against the request it was given. Returns null (and logs why) for
 * anything that is not an answer object; never throws. Kept: changes naming a section of the
 * request (or a created one) and an item of the request, that are not in a readonly section and
 * really change the item (a created section starts with nothing on); of two changes to the same
 * section and item the last wins. `created` entries must be non-empty, unique, not existing
 * section ids and match `create.pattern` completely (no `create` in the request: none are kept).
 */
export function parseBoardAnswer(raw: string | null | undefined, request: BoardRequest, log: (line: string) => void = console.error): BoardAnswer | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    log(`cmdAbl: malformed board answer: ${raw.slice(0, 80)}`);
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    log("cmdAbl: board answer is not an object");
    return null;
  }
  const { changes: rawChanges, created: rawCreated } = value as { changes?: unknown; created?: unknown };
  if ((rawChanges !== undefined && !Array.isArray(rawChanges)) || (rawCreated !== undefined && !Array.isArray(rawCreated))) {
    log("cmdAbl: board answer has changes or created that are not lists");
    return null;
  }

  const bySection = new Map(request.sections.map((s) => [s.id, s]));
  const allItems = new Map<string, boolean>(); // every item id of the request
  for (const s of request.sections) for (const i of s.items) allItems.set(i.id, true);

  let pattern: RegExp | null = null;
  if (request.create?.pattern) {
    try {
      pattern = new RegExp(`^(?:${request.create.pattern})$`);
    } catch {
      log("cmdAbl: board create.pattern is not a valid expression; no section can be created");
      pattern = null;
    }
  }
  const created: string[] = [];
  if (request.create && (request.create.pattern === undefined || pattern)) {
    for (const entry of (rawCreated ?? []) as unknown[]) {
      if (typeof entry !== "string") continue;
      const id = entry.trim();
      if (!id || id.length > MAX_TEXT || bySection.has(id) || created.includes(id)) continue;
      if (pattern && !pattern.test(id)) continue;
      created.push(id);
    }
  }

  // Last change per section and item wins; then only real differences stay.
  const last = new Map<string, { section: string; item: string; on: boolean }>();
  for (const entry of (rawChanges ?? []) as unknown[]) {
    if (!entry || typeof entry !== "object") continue;
    const { section, item, on } = entry as { section?: unknown; item?: unknown; on?: unknown };
    if (typeof section !== "string" || typeof item !== "string" || typeof on !== "boolean") continue;
    const existing = bySection.get(section);
    if (existing ? existing.readonly || !existing.items.some((i) => i.id === item) : !created.includes(section) || !allItems.has(item)) continue;
    const key = `${section}\0${item}`;
    last.delete(key); // re-insert: order follows the last mention
    last.set(key, { section, item, on });
  }
  const changes = [...last.values()].filter((c) => {
    const current = bySection.get(c.section)?.items.find((i) => i.id === c.item)?.on ?? false; // a created section starts off
    return c.on !== current;
  });
  return { changes, created };
}

/**
 * Dialog size for a board: the width and height the message sizing gives for the sections as
 * lines (heading, the on items, a blank line between), at least the minimum a board needs for a
 * header, a few rows and the footer. The page scrolls beyond the maximum.
 */
export function boardSize(request: BoardRequest): { width: number; height: number } {
  const lines = request.sections.map((s) => [s.meta ? `${s.heading}  ${s.meta}` : s.heading, `  ${s.items.filter((i) => i.on).map((i) => i.label).join("  ")}`].join("\n"));
  if (request.create) lines.push(request.create.label);
  const size = notifySize(lines.join("\n\n"));
  return { width: Math.max(size.width, 600), height: Math.min(Math.max(size.height + 60, 320), 560) };
}

/** What `api.ui.board` does: cap the request, show it, and say whether it had to be cut. */
export async function runBoard(ui: Pick<Ui, "board">, request: BoardRequest): Promise<{ answer: BoardAnswer | null; cut: boolean }> {
  const capped = capBoard(request);
  try {
    return { answer: await ui.board(capped.request), cut: capped.cut };
  } catch {
    return { answer: null, cut: capped.cut };
  }
}
