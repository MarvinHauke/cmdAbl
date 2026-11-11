// Keyboard model for selection lists (plan 0019 §5). Inlined into a <script> block at build time where
// /*LISTNAV_JS_PLACEHOLDER*/ stands (so this file must not contain a literal end tag of a script element); defines the
// global `CmdListNav`. Also loadable in Node (module.exports) for the unit tests of its key tables.
//
// It decides only WHAT a key means; the page does it (moves its cursor, marks, answers). No DOM.
//
//   const nav = CmdListNav.create({ keys? })          keys: { action: [chord, ...] } replaces those actions' chords (remapping)
//   nav.action(event, ctx) -> string | null
//   nav.native(action)    -> true when the page must NOT preventDefault (the key goes on to the text field)
//
//   event: anything with key, code, ctrlKey, metaKey, altKey, shiftKey.
//   ctx:   { zone: 'field' | 'list' | 'buttons',      where the keys act (the page keeps the zone; DOM focus may stay in the input)
//            multi?: bool                              rows can be marked (Space)
//            canComplete?: bool                        Tab completes (palette, a pick list with `fill`)
//            hasButtons?: bool                         the page has buttons Tab/Shift+Tab can reach
//            hasText?: bool                            the field is not empty
//            escClears?: bool                          Esc in a field with text clears it before closing (default false)
//            caretAtEnd?: bool                         (field) → enters the list, but only from the end of the text
//            col?, cols?: number                       (list) position in a row of items; default one item per row
//            bare?: bool }                             a list that is always live (the palette): only next/prev/take/complete/close
//
//   Actions: 'next' 'prev' (rows) · 'left' 'right' (along a row) · 'enter-list' · 'to-field' (native: typing, Backspace, caret keys
//   go to the field) · 'leave' (Esc in a list or buttons: back to the field) · 'clear' · 'close' · 'take' (Enter) · 'mark' (Space)
//   · 'complete' (Tab) · 'buttons' (focus the buttons) · 'next-button' 'prev-button' 'press' (in the buttons) ·
//   'none' (the key is ours and does nothing: prevent it) · null (not ours).
const CmdListNav = (() => {
  const DEFAULT_KEYS = {
    next: ['ArrowDown', 'Ctrl+n'],
    prev: ['ArrowUp', 'Ctrl+p'],
    left: ['ArrowLeft'],
    right: ['ArrowRight'],
    take: ['Enter', 'Shift+Enter'],
    mark: ['Space'],
    complete: ['Tab'],
    buttons: ['Shift+Tab'],   // Tab too, where nothing can be completed
    back: ['Escape'],
  };
  const TYPING = ['Backspace', 'Delete', 'Home', 'End'];

  // The name of a key press: Ctrl+Alt+Shift+Cmd+<key>; Shift only for keys that aren't one character (a typed "N" is not Shift+n).
  function chord(e) {
    let key = e.key;
    if (key === ' ' || key === 'Spacebar' || e.code === 'Space') key = 'Space';   // a webview may report only `code`
    const mods = (e.ctrlKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey && key.length > 1 ? 'Shift+' : '') + (e.metaKey ? 'Cmd+' : '');
    return mods + (key.length === 1 ? key.toLowerCase() : key);
  }

  function create(opts = {}) {
    const keys = { ...DEFAULT_KEYS, ...(opts.keys || {}) };
    const has = (name, c) => (keys[name] || []).includes(c);
    const plain = e => !e.ctrlKey && !e.metaKey && !e.altKey;

    function action(e, ctx) {
      const c = chord(e), zone = ctx.zone === 'list' || ctx.zone === 'buttons' ? ctx.zone : 'field';   // anything else is the field
      const tab = c === 'Tab' || c === 'Shift+Tab';
      const next = has('next', c), prev = has('prev', c);

      if (zone === 'buttons') {
        if (has('back', c)) return 'leave';
        if (has('take', c) || has('mark', c)) return 'press';
        if (c === 'Tab' || has('right', c) || next) return 'next-button';
        if (c === 'Shift+Tab' || has('left', c) || prev) return 'prev-button';
        return null;
      }
      if (has('take', c)) return 'take';
      if (next) return 'next';
      if (prev) return 'prev';
      if (tab) {   // Tab completes where something can be completed; otherwise Tab and Shift+Tab reach the buttons
        if (c === 'Tab' && has('complete', c) && ctx.canComplete) return 'complete';
        if (ctx.hasButtons && (has('buttons', c) || c === 'Tab')) return 'buttons';
        return 'none';
      }
      if (has('back', c)) {
        if (ctx.bare) return 'close';
        if (zone === 'list') return 'leave';
        return ctx.escClears && ctx.hasText ? 'clear' : 'close';
      }
      if (ctx.bare) return null;

      if (zone === 'field') {
        return has('right', c) && ctx.caretAtEnd ? 'enter-list' : null;   // elsewhere the arrows move the caret
      }
      // zone === 'list'
      const col = ctx.col || 0, cols = ctx.cols || 1;
      if (has('left', c)) return col > 0 ? 'left' : 'to-field';
      if (has('right', c)) return col < cols - 1 ? 'right' : 'none';
      if (has('mark', c)) return ctx.multi ? 'mark' : 'to-field';
      if (plain(e) && (e.key.length === 1 || TYPING.includes(e.key))) return 'to-field';
      return null;
    }
    return { action, native: a => a === 'to-field' };
  }

  return { create, chord, DEFAULT_KEYS };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = CmdListNav;
