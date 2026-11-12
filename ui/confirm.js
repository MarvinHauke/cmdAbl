// discard confirmation in the footer (user, 2026-11-12). Inlined into a <script> block at build time where /*CONFIRM_JS_PLACEHOLDER*/ stands,
// so this file must not contain a literal end tag of a script element. Defines the global `confirmBar`.
//
//   confirmBar.open(footerEl, { text, keep?, discard?, onKeep?, onDiscard? })
//     text       the question ("Discard 1 pending change?"); inserted with textContent
//     keep       label of the safe button (default "Keep editing"); focus starts here
//     discard    label of the destructive button (default "Discard")
//     onKeep     () => void   called after the bar is gone (Esc, a click on Keep, or Enter/Space on it): put the focus back here
//     onDiscard  () => void   called after the bar is gone (a click or Enter/Space on Discard)
//   The footer gets the class `confirming` (accent look, shared.css) and its other children are hidden by CSS, so its height stays
//   (the bar fills it); closing removes the bar and the footer is as before. Keys while open (capture, nothing reaches the page):
//   ←/→/↑/↓ move between the two buttons (no wrap), Tab/Shift+Tab switch between the two (focus stays in the bar), Enter/Space press the focused button, Esc = keep;
//   a mouse press outside the bar counts as keep. A page whose footer has no fixed height grows when the text wraps (up to 3 lines).
//   confirmBar.isOpen() tells whether it is up; confirmBar.close() removes it without calling anything.
const confirmBar = (() => {
  let cur = null;   // { footer, bar, keydown }

  function close() {
    if (!cur) return;
    document.removeEventListener('keydown', cur.keydown, true);
    document.removeEventListener('mousedown', cur.bar.mousedown, true);
    cur.bar.remove(); cur.footer.classList.remove('confirming');
    cur = null;
  }

  function open(footer, o) {
    if (cur) return;
    const bar = document.createElement('div'); bar.className = 'cbar';
    const text = document.createElement('span'); text.className = 'ctext'; text.textContent = o.text;
    const keep = document.createElement('button'); keep.type = 'button'; keep.className = 'ckeep'; keep.textContent = o.keep || 'Keep editing';
    const discard = document.createElement('button'); discard.type = 'button'; discard.className = 'cdiscard'; discard.textContent = o.discard || 'Discard';
    bar.append(text, keep, discard);
    const done = f => { close(); if (f) f(); };
    keep.addEventListener('click', () => done(o.onKeep));
    discard.addEventListener('click', () => done(o.onDiscard));
    const keydown = e => {
      e.stopPropagation();
      const onBtn = e.target === keep || e.target === discard;
      if (e.key === 'Escape') { e.preventDefault(); done(o.onKeep); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); keep.focus(); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); discard.focus(); }
      else if (e.key === 'Tab') { e.preventDefault(); (e.target === keep ? discard : keep).focus(); }   // focus stays in the bar
      else if (!((e.key === 'Enter' || e.key === ' ') && onBtn)) e.preventDefault();   // nothing reaches the fields behind the bar
    };
    const mousedown = e => { if (!bar.contains(e.target)) { e.preventDefault(); done(o.onKeep); } };   // a click elsewhere keeps editing
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('mousedown', mousedown, true);
    bar.mousedown = mousedown;
    cur = { footer, bar, keydown };
    footer.classList.add('confirming'); footer.append(bar);
    keep.focus();
  }

  return { open, close, isOpen: () => !!cur };
})();
