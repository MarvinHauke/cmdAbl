// Key tables of ui/listnav.js (plan 0019 §5). The file is a plain browser script, so it is evaluated here, not imported.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

type Ctx = Record<string, unknown>;
type Nav = { action(e: object, ctx: Ctx): string | null; native(a: string): boolean };
const mod = { exports: {} as { create(o?: object): Nav; chord(e: object): string } };
new Function("module", fs.readFileSync("ui/listnav.js", "utf8"))(mod);
const { create, chord } = mod.exports;

const k = (key: string, mods: Record<string, boolean> = {}) => ({ key, code: key === " " ? "Space" : "", ...mods });
const nav = create();
const a = (key: string, ctx: Ctx, mods: Record<string, boolean> = {}) => nav.action(k(key, mods), ctx);

test("chord names", () => {
  assert.equal(chord(k("ArrowDown")), "ArrowDown");
  assert.equal(chord(k("N", { shiftKey: true })), "n");
  assert.equal(chord(k("n", { ctrlKey: true })), "Ctrl+n");
  assert.equal(chord(k("Tab", { shiftKey: true })), "Shift+Tab");
  assert.equal(chord({ key: "Process", code: "Space" }), "Space");   // IME: only `code` says Space
  assert.equal(chord(k(" ")), "Space");
});

test("field: rows, take, Esc", () => {
  const f = { zone: "field" };
  assert.equal(a("ArrowDown", f), "next");
  assert.equal(a("p", f, { ctrlKey: true }), "prev");
  assert.equal(a("Enter", f), "take");
  assert.equal(a("Escape", f), "close");
  assert.equal(a("Escape", { ...f, hasText: true }), "close");
  assert.equal(a("Escape", { ...f, hasText: true, escClears: true }), "clear");
  assert.equal(a("Escape", { ...f, escClears: true }), "close");
  assert.equal(a(" ", f), null);   // a space types
  assert.equal(a("a", f), null);
});

test("field: → enters the list only from the end of the text", () => {
  assert.equal(a("ArrowRight", { zone: "field", caretAtEnd: true }), "enter-list");
  assert.equal(a("ArrowRight", { zone: "field", caretAtEnd: false }), null);
  assert.equal(a("ArrowLeft", { zone: "field", caretAtEnd: true }), null);
});

test("Space marks, Tab only completes", () => {
  const l = { zone: "list", multi: true };
  assert.equal(a(" ", l), "mark");
  assert.equal(a(" ", { zone: "list" }), "to-field");   // a single-select has nothing to mark
  assert.equal(a("Tab", l), "none");   // no longer marks
  assert.equal(a("Tab", { ...l, canComplete: true }), "complete");
  assert.equal(a("Tab", { zone: "field", canComplete: true }), "complete");
});

test("Tab and Shift+Tab reach the buttons", () => {
  assert.equal(a("Tab", { zone: "field", hasButtons: true }), "buttons");
  assert.equal(a("Tab", { zone: "field", hasButtons: true, canComplete: true }), "complete");
  assert.equal(a("Tab", { zone: "field", hasButtons: true }, { shiftKey: true }), "buttons");
  assert.equal(a("Tab", { zone: "field", canComplete: true }, { shiftKey: true }), "none");   // Shift+Tab never completes
  assert.equal(a("Tab", { zone: "list" }, { shiftKey: true }), "none");
});

test("buttons zone", () => {
  const b = { zone: "buttons" };
  assert.equal(a("Tab", b), "next-button");
  assert.equal(a("Tab", b, { shiftKey: true }), "prev-button");
  assert.equal(a("ArrowRight", b), "next-button");
  assert.equal(a("ArrowLeft", b), "prev-button");
  assert.equal(a("Enter", b), "press");
  assert.equal(a(" ", b), "press");
  assert.equal(a("Escape", b), "leave");
});

test("list: along a row and back to the field", () => {
  assert.equal(a("ArrowLeft", { zone: "list" }), "to-field");
  assert.equal(a("ArrowLeft", { zone: "list", col: 2, cols: 4 }), "left");
  assert.equal(a("ArrowRight", { zone: "list", col: 2, cols: 4 }), "right");
  assert.equal(a("ArrowRight", { zone: "list", col: 3, cols: 4 }), "none");
  assert.equal(a("ArrowRight", { zone: "list" }), "none");
  assert.equal(a("ArrowDown", { zone: "list" }), "next");
});

test("list: typing returns to the field and is not prevented", () => {
  for (const key of ["a", "7", "#", "Backspace", "Delete", "Home", "End"]) assert.equal(a(key, { zone: "list" }), "to-field", key);
  assert.equal(a("a", { zone: "list" }, { metaKey: true }), null);   // Cmd+A is not typing
  assert.equal(a("F5", { zone: "list" }), null);
  assert.ok(nav.native("to-field"));
  assert.ok(!nav.native("next"));
});

test("Esc: leaves the list first", () => {
  assert.equal(a("Escape", { zone: "list" }), "leave");
  assert.equal(a("Escape", { zone: "list", hasText: true, escClears: true }), "leave");
});

test("bare list (the palette): rows, Enter, Tab, Esc only", () => {
  const p = { zone: "field", bare: true, canComplete: true };
  assert.equal(a("ArrowDown", p), "next");
  assert.equal(a("Enter", p), "take");
  assert.equal(a("Tab", p), "complete");
  assert.equal(a("Escape", p), "close");
  assert.equal(a("ArrowRight", { ...p, caretAtEnd: true }), null);
  assert.equal(a(" ", p), null);
});

test("remapping replaces chords of an action", () => {
  const n = create({ keys: { next: ["j"], mark: ["x"] } });
  assert.equal(n.action(k("j"), { zone: "list" }), "next");
  assert.equal(n.action(k("ArrowDown"), { zone: "list" }), null);
  assert.equal(n.action(k("x"), { zone: "list", multi: true }), "mark");
  assert.equal(n.action(k(" "), { zone: "list", multi: true }), "to-field");
});

test("an unknown zone is the field (the pick list calls its filter zone 'filter')", () => {
  assert.equal(a(" ", { zone: "filter", multi: true }), null);   // a space types, it does not mark
  assert.equal(a("ArrowRight", { zone: "filter" }), null);   // the caret moves
  assert.equal(a("ArrowRight", { zone: "filter", caretAtEnd: true }), "enter-list");
  assert.equal(a("Escape", { zone: "whatever" }), "close");
});

test("Shift+Enter takes like Enter", () => {
  assert.equal(a("Enter", { zone: "field", bare: true }, { shiftKey: true }), "take");
});
