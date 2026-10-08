/**
 * Browser-side checks, injected with Runtime.evaluate.
 *
 * OVERFLOW_CHECK: every element that *looks like a box* (has a background or a border)
 * must contain its own text. Skipped on purpose:
 *   - boxes that scroll or clip (overflow != visible) — overflow is intended there
 *   - text inside a clipping ancestor between the text and the box (truncate / line-clamp)
 *   - visually hidden text (sr-only, aria-hidden)
 * Also reports page-level horizontal scrolling.
 *
 * STRESS(mode): makes text longer before the check, to find layouts that only survive
 * the short copy in the mockup.
 *   repeat   — every text node ×3 (long paragraphs, long names)
 *   unbroken — appends a 40-char token with no break opportunity (URLs, IDs, German words)
 */

export const OVERFLOW_CHECK = `(() => {
  const out = [];
  const range = document.createRange();
  const label = (el) => {
    const id = el.id ? '#' + el.id : '';
    const cls = typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/).slice(0, 3).join('.') : '';
    return el.tagName.toLowerCase() + id + cls;
  };
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    const boxed = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderBottomWidth) > 0;
    if (!boxed || cs.display === 'inline' || cs.position === 'fixed') continue;
    if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 20 || r.height < 12) continue;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (!t.textContent.trim()) continue;
      const parent = t.parentElement;
      if (parent.closest('[aria-hidden="true"], .sr-only, .visually-hidden')) continue;
      let clipped = false;
      for (let a = parent; a && a !== el; a = a.parentElement) {
        const s = getComputedStyle(a);
        if (s.overflowX !== 'visible' || s.overflowY !== 'visible' || s.visibility === 'hidden') { clipped = true; break; }
      }
      if (clipped) continue;
      range.selectNodeContents(t);
      for (const tr of range.getClientRects()) {
        if (!tr.width) continue;
        const dx = Math.max(r.left - tr.left, tr.right - r.right, 0);
        const dy = Math.max(r.top - tr.top, tr.bottom - r.bottom, 0);
        if (dx > 1 || dy > 1) {
          out.push({ text: t.textContent.trim().slice(0, 40), box: label(el), dx: Math.round(dx), dy: Math.round(dy) });
          break;
        }
      }
    }
  }
  const page = document.documentElement.scrollWidth - innerWidth;
  if (page > 0) out.push({ text: '(page)', box: 'horizontal scroll', dx: page, dy: 0 });
  const seen = new Set();
  return out.filter((o) => { const k = o.text + o.box; if (seen.has(k)) return false; seen.add(k); return true; });
})()`;

export const STRESS = (mode) => `(() => {
  const TOKEN = ' https://example.com/aVeryLongUnbrokenToken1234567890';
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      const p = n.parentElement;
      if (!n.textContent.trim() || !p) return NodeFilter.FILTER_REJECT;
      if (p.closest('script, style, noscript, svg, [aria-hidden="true"], .sr-only')) return NodeFilter.FILTER_REJECT;
      // icon fonts (ligatures) must stay intact
      if (/material|icon/i.test(getComputedStyle(p).fontFamily)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes = [];
  for (let t = walker.nextNode(); t; t = walker.nextNode()) nodes.push(t);
  for (const t of nodes) {
    const s = t.textContent;
    t.textContent = ${JSON.stringify(mode)} === 'unbroken' ? s + TOKEN : s + ' ' + s + ' ' + s;
  }
  return nodes.length;
})()`;
