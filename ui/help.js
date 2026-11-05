// help line (plan 0019 §3). Inlined into a <script> block at build time where /*HELP_JS_PLACEHOLDER*/ stands,
// so this file must not contain a literal end tag of a script element. Defines the global `help`.
//
//   help.init(lineEl, { idle, enabled?, current?, override? })
//     idle     () => string | [[key, label] | string, ...]   the text when nothing is hovered or focused: a string is
//                                                   plain text, pairs are drawn as key caps ("[Tab] complete").
//     enabled  boolean (default true)               false (the request's `help: false`): only idle (and override) show.
//     current  () => Element | null                 the page's own cursor (a row with the cursor but no DOM focus);
//                                                   counts as "focused" when no real element has focus.
//     override (el) => string | [pairs] | { text, warn?, bad? } | null   a state line that wins over everything (pending-change warning,
//                                                   an error of the row; el = target()): `warn` draws it in the accent colour, `bad` red.
//   An override may also be { lines: [a, b] }: two lines (a string, or key-cap pairs as idle), each clipped to one line (the palette's footer: the command, then the
//   argument at the caret). Each is drawn like a data-help text (a "Subject: rest" gets the subject in normal weight).
//   The line shows, in this order: override, the data-help of the hovered element, of the focused one
//   (document.activeElement, else current()), else idle. Leaving an element falls back to the next in that order.
//   help.hovered() tells whether the target is the hovered element (a state line may yield to a hover only);
//   help.update() redraws (call it when idle or override would answer differently); help.target() is the element
//   whose data-help is shown now. Everything goes in with textContent; there is no delay and no animation.
//   A focused INPUT/TEXTAREA does not count as focus (its help shows on hover only). The line gets the class `helpline`.
//   A text "Subject: rest" draws the subject in normal weight (class .subj) and the rest dim.
const help = (() => {
  let line = null, opts = {}, hovered = null;
  const closestHelp = el => (el instanceof Element ? el.closest('[data-help]') : null);

  function target() {
    if (opts.enabled === false) return null;
    if (hovered && hovered.isConnected) return hovered;
    // A focused text field carries its help for hover only: it is the page's resting place, and the keys matter more there.
    const a = document.activeElement;
    const isText = a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !/^(checkbox|radio|button)$/.test(a.type)));
    const f = isText ? null : closestHelp(a);
    if (f) return f;
    const c = opts.current ? opts.current() : null;
    return c && c.dataset && c.dataset.help ? c : (c ? closestHelp(c) : null);
  }

  function text(parent, s) {
    const m = /^([^:]{1,28}): (.+)$/s.exec(s);
    if (m) { const subj = document.createElement('span'); subj.className = 'subj'; subj.textContent = m[1] + ':'; parent.append(subj, ' ' + m[2]); }
    else parent.append(s);
  }

  function idleInto(parent, v) {
    if (Array.isArray(v)) {
      line.classList.add('keys');   // key caps: no line clamp (its ellipsis can land inside a cap)
      v.forEach((it, i) => {
        if (i) parent.append(' ');
        if (typeof it === 'string') { parent.append((i ? '· ' : '') + it + (i < v.length - 1 ? ' ·' : '')); return; }   // a plain-text item among the key caps, set off by dots
        const pair = document.createElement('span'); pair.className = 'kp';   // a key cap and its label never wrap apart
        const k = document.createElement('kbd'); k.textContent = it[0];
        pair.append(k, ' ' + it[1]);
        parent.append(pair);
      });
    } else if (v) parent.append(String(v));
  }

  function update() {
    if (!line) return;
    line.textContent = '';
    line.classList.remove('warn', 'bad', 'keys', 'two');
    // One block child holds all of it: the line is a -webkit-box (for the line clamp), whose direct children become
    // boxes of their own and would shrink the subject and the key caps apart from the text.
    const box = document.createElement('div');
    line.append(box);
    const o = opts.override ? opts.override(target()) : null;
    if (Array.isArray(o)) { idleInto(box, o); return; }   // a state line made of key caps
    if (o && o.lines) {
      line.classList.add('two');
      for (const l of o.lines) { const d = document.createElement('div'); d.className = 'l'; if (Array.isArray(l)) idleInto(d, l); else text(d, l); box.append(d); }
      return;
    }
    if (o) {
      const t = typeof o === 'string' ? { text: o } : o;
      line.classList.toggle('warn', !!t.warn);
      line.classList.toggle('bad', !!t.bad);
      box.append(t.text);
      return;
    }
    const el = target();
    if (el && el.dataset.help) text(box, el.dataset.help);
    else idleInto(box, opts.idle ? opts.idle() : '');
  }

  function init(lineEl, options) {
    line = lineEl; opts = options || {};
    line.classList.add('helpline');
    document.addEventListener('mouseover', e => { const h = closestHelp(e.target); if (h !== hovered) { hovered = h; update(); } });
    document.addEventListener('mouseout', e => { if (!e.relatedTarget && hovered) { hovered = null; update(); } });
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', () => setTimeout(update, 0));   // activeElement is the new one only after the event
    update();
  }

  return { init, update, target, hovered: () => !!(hovered && hovered.isConnected && opts.enabled !== false) };
})();
