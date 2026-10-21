// The settings page: a full-screen dialog with a section list on the left and the settings of every section stacked on the
// right (scrolling), a search box that filters them, and a "reset" button on every setting that differs from its default.
// It only knows the schema and the settings store; what a setting does is up to app.js (it subscribes to the store).

const el = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null) e.append(kid);
  return e;
};
// Which ends of a horizontally scrolling strip have more content past them (the tab strip of a narrow settings window fades there).
// Nothing when the strip does not overflow; 1 px of slack for fractional widths.
export function edgeFade(scrollLeft, clientWidth, scrollWidth) {
  const over = scrollWidth - clientWidth > 1;
  return { start: over && scrollLeft > 1, end: over && scrollLeft + clientWidth < scrollWidth - 1 };
}

const icon = (name) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.innerHTML = `<use href="#i-${name}"/>`;
  return s;
};

// frame: the window frame controller of `root` (src/windowframe-dom.js): it owns the window's width, edges and open/closed state.
export function mountSettings({ root, frame, settings, sections, renderers = {}, onOpen = () => {}, onClose = () => {} }) {
  const refreshers = []; // called whenever a setting changes, to bring the controls up to date
  const visibility = []; // { row, item } for `when`
  let query = '';

  const nav = el('nav', { class: 'sp-nav', 'aria-label': 'Settings sections' });
  const content = el('div', { class: 'sp-content' });
  const search = el('input', { class: 'sp-search', type: 'search', placeholder: 'Search settings', 'aria-label': 'Search settings' });
  const closeBtn = el('button', { class: 'icon lib-close', type: 'button', title: 'Close (Esc)', 'aria-label': 'Close settings', onclick: () => close() }, icon('chevron')); // (the same back arrow as the library's, at the left of the title)
  for (const k of [...root.children]) if (!k.classList.contains('win-edge')) k.remove(); // (the frame's edge handles stay)
  root.append(
    el('div', { class: 'sp-head' }, closeBtn, el('h2', { text: 'Settings' }), search),
    el('div', { class: 'sp-body' }, nav, content),
  );

  const idsOf = (item) => (item.type === 'custom' ? item.ids : [item.id]);

  function resetButton(item) {
    const ids = idsOf(item);
    if (!ids.length) return null;
    // (out of the Tab order: about a hundred of them would sit between the controls; the keyboard resets with the section's "Reset this section")
    const b = el('button', { class: 'icon small-icon sp-reset', type: 'button', tabindex: '-1', title: 'Restore the default', 'aria-label': `Restore the default of ${item.label}`, onclick: () => settings.resetMany(ids) }, icon('reset'));
    refreshers.push(() => { b.disabled = ids.every((id) => settings.isDefault(id)); });
    return b;
  }

  function control(item) {
    const id = item.id;
    if (item.type === 'toggle') {
      const input = el('input', { type: 'checkbox', role: 'switch', 'aria-label': item.label });
      input.addEventListener('change', () => settings.set(id, input.checked));
      refreshers.push(() => { input.checked = !!settings.get(id); });
      return el('label', { class: 'sp-switch' }, input, el('i'));
    }
    if (item.type === 'choice') {
      if (item.options.length <= 5) {
        const seg = el('div', { class: 'seg sp-seg', role: 'group', 'aria-label': item.label });
        for (const o of item.options) seg.append(el('button', { type: 'button', 'data-value': String(o.value), text: o.label, onclick: () => settings.set(id, o.value) }));
        refreshers.push(() => { for (const b of seg.children) b.setAttribute('aria-pressed', String(b.dataset.value === String(settings.get(id)))); });
        return seg;
      }
      const sel = el('select', { class: 'sp-select', 'aria-label': item.label }, item.options.map((o) => el('option', { value: String(o.value), text: o.label })));
      sel.addEventListener('change', () => settings.set(id, item.options.find((o) => String(o.value) === sel.value)?.value ?? sel.value));
      refreshers.push(() => { sel.value = String(settings.get(id)); });
      return sel;
    }
    if (item.type === 'multi') {
      const box = el('div', { class: 'sp-multi', role: 'group', 'aria-label': item.label });
      for (const o of item.options) {
        box.append(el('button', { type: 'button', class: 'chip', 'data-value': o.value, text: o.label, onclick: () => {
          const now = new Set(settings.get(id));
          if (now.has(o.value)) now.delete(o.value); else now.add(o.value);
          if (now.size < (item.minItems ?? 0)) return; // (the last one stays on)
          settings.set(id, item.options.map((x) => x.value).filter((v) => now.has(v))); // keeps the option order
        } }));
      }
      refreshers.push(() => { const on = new Set(settings.get(id)); for (const b of box.children) b.setAttribute('aria-pressed', String(on.has(b.dataset.value))); });
      return box;
    }
    if (item.type === 'range') {
      const out = el('output', { class: 'sp-out' });
      const input = el('input', { type: 'range', min: item.min, max: item.max, step: item.step ?? 1, 'aria-label': item.label });
      const show = () => { out.textContent = `${item.format ? item.format(Number(input.value)) : input.value}${item.unit ?? ''}`; };
      input.addEventListener('input', () => { show(); settings.set(id, Number(input.value)); });
      refreshers.push(() => { input.value = settings.get(id); show(); });
      return el('div', { class: 'sp-range' }, input, out);
    }
    if (item.type === 'color') {
      const picker = el('input', { type: 'color', 'aria-label': item.label });
      const hex = el('input', { type: 'text', class: 'sp-hex', maxlength: '7', spellcheck: 'false', 'aria-label': `${item.label} (hex)` });
      picker.addEventListener('input', () => settings.set(id, picker.value));
      hex.addEventListener('change', () => { if (/^#[0-9a-f]{6}$/i.test(hex.value.trim())) settings.set(id, hex.value.trim().toLowerCase()); else hex.value = settings.get(id); });
      refreshers.push(() => { picker.value = settings.get(id); hex.value = settings.get(id); });
      return el('div', { class: 'sp-color' }, picker, hex);
    }
    return el('span');
  }

  function buildRow(item, section) {
    const text = el('span', { class: 'sp-text' }, el('b', { text: item.label }), item.help ? el('small', { text: item.help }) : null);
    let row;
    if (item.type === 'custom') {
      const host = el('div', { class: 'sp-custom' });
      row = el('div', { class: 'sp-row sp-row-custom' }, el('div', { class: 'sp-row-head' }, text, resetButton(item)), host);
      const render = renderers[item.id];
      if (render) refreshers.push(render(host, { settings, item }) ?? (() => {}));
    } else {
      row = item.type === 'multi'
        ? el('div', { class: 'sp-row sp-row-custom' }, el('div', { class: 'sp-row-head' }, text, resetButton(item)), control(item))
        : el('div', { class: 'sp-row' }, text, el('span', { class: 'sp-ctl' }, control(item), resetButton(item)));
    }
    row.dataset.search = `${item.label} ${item.help ?? ''} ${item.keywords ?? ''} ${item.group ?? ''} ${section.title}`.toLowerCase(); // (the group and section titles match too)
    row.dataset.id = item.id; // (app.js adds live status lines to a few rows)
    if (item.when) visibility.push({ row, item });
    return row;
  }

  // "Reset this section": every setting of the section back to its default, after a confirmation. The saved themes are kept (they
  // are the user's work, not a setting; Reset all and the theme's own reset button still clear them).
  function sectionResetButton(section) {
    const ids = section.items.flatMap(idsOf).filter((id) => id !== 'theme.saved');
    if (!ids.length) return null;
    const b = el('button', { class: 'chip-btn sp-sec-reset', type: 'button', text: 'Reset this section', title: `Restore the defaults of every ${section.title} setting`, onclick: () => {
      if (window.confirm(`Reset every ${section.title} setting to its default?`)) settings.resetMany(ids);
    } });
    refreshers.push(() => { b.disabled = ids.every((id) => settings.isDefault(id)); });
    return b;
  }

  const sectionEls = [];
  for (const section of sections) {
    const rowsAndGroups = [];
    let lastGroup = null;
    for (const item of section.items) {
      if (item.group && item.group !== lastGroup) rowsAndGroups.push(el('h4', { class: 'sp-group', text: item.group }));
      lastGroup = item.group ?? null;
      rowsAndGroups.push(buildRow(item, section));
    }
    const body = el('div', { class: 'sp-section-body' }, rowsAndGroups);
    const sec = el('section', { class: 'sp-section', id: `sp-sec-${section.id}` }, el('h3', {}, icon(section.icon), section.title, sectionResetButton(section)), section.description ? el('p', { class: 'sp-desc', text: section.description }) : null, body);
    content.append(sec);
    const link = el('button', { type: 'button', class: 'sp-nav-btn', onclick: () => { search.value = ''; applyQuery(''); pinned = sec; markCurrent(sec); sec.scrollIntoView({ block: 'start', behavior: 'smooth' }); } }, icon(section.icon), el('span', { text: section.title }));
    nav.append(link);
    sectionEls.push({ section, sec, link });
  }

  // The tab strip (narrow window) fades at an end with more tabs past it.
  const syncNavFade = () => {
    const f = edgeFade(nav.scrollLeft, nav.clientWidth, nav.scrollWidth);
    nav.classList.toggle('fade-start', f.start);
    nav.classList.toggle('fade-end', f.end);
  };
  nav.addEventListener('scroll', syncNavFade, { passive: true });
  if (typeof ResizeObserver === 'function') new ResizeObserver(syncNavFade).observe(nav);

  function applyQuery(q) {
    query = q.trim().toLowerCase();
    let any = false;
    for (const { section, sec } of sectionEls) {
      let shown = 0;
      for (const row of sec.querySelectorAll('.sp-row')) {
        const match = !query || row.dataset.search.includes(query);
        row.hidden = !match;
        if (match) shown++;
      }
      for (const g of sec.querySelectorAll('.sp-group')) { // a group heading stays while one of its rows is shown
        let n = g.nextElementSibling;
        let any = false;
        while (n && !n.classList.contains('sp-group')) { if (!n.hidden) any = true; n = n.nextElementSibling; }
        g.hidden = !any;
      }
      sec.hidden = shown === 0;
      any ||= shown > 0;
    }
    content.classList.toggle('empty', !any);
    refresh();
  }
  search.addEventListener('input', () => applyQuery(search.value));
  content.append(el('p', { class: 'sp-none', text: 'No setting matches your search.' }));

  function refresh() {
    for (const fn of refreshers) fn();
    for (const { row, item } of visibility) {
      const ok = item.when(settings.get);
      row.classList.toggle('sp-off', !ok); // dimmed and not editable, so the dependency is visible
      for (const c of row.querySelectorAll('input,select,button.sp-reset,.sp-seg button')) c.disabled = !ok || (c.matches('button.sp-reset') && c.disabled);
    }
  }
  settings.subscribe(refresh);

  // The active section in the list follows the scrolling.
  // A section the user picked in the list (or opened on) stays the current one until the user scrolls by hand: the last sections cannot always reach the top of
  // the page (the content ends first), so the scroll position alone would never select them. At the very bottom, with nothing picked, the last section is current.
  let pinned = null;
  const markCurrent = (cur) => { for (const s of sectionEls) s.link.setAttribute('aria-current', String(s.sec === cur)); };
  content.addEventListener('scroll', () => {
    if (pinned && !pinned.hidden) { markCurrent(pinned); return; }
    const top = content.getBoundingClientRect().top;
    let current = sectionEls[0];
    for (const s of sectionEls) if (!s.sec.hidden && s.sec.getBoundingClientRect().top - top < 80) current = s;
    if (content.scrollTop + content.clientHeight >= content.scrollHeight - 2) for (const s of sectionEls) if (!s.sec.hidden) current = s;
    markCurrent(current.sec);
  }, { passive: true });
  for (const type of ['wheel', 'touchstart', 'keydown', 'pointerdown']) content.addEventListener(type, () => { pinned = null; }, { passive: true });

  function open(sectionId) {
    onOpen();
    frame.setClosed(false);
    frame.layout();
    document.body.classList.add('settings-open');
    refresh();
    search.value = '';
    applyQuery('');
    pinned = null;
    if (sectionId) { const target = document.getElementById(`sp-sec-${sectionId}`); pinned = sectionEls.find((s) => s.sec === target)?.sec ?? null; target?.scrollIntoView({ block: 'start' }); }
    else content.scrollTop = 0;
    content.dispatchEvent(new Event('scroll'));
    search.focus({ preventScroll: true });
  }
  function close() {
    if (frame.isClosed()) return;
    frame.setClosed(true);
    document.body.classList.remove('settings-open');
    onClose();
  }
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });

  refresh();
  // a click outside the window closes it (the dimmed stage around it); menus that live in <body> (custom selects, popovers) are not "outside"
  document.addEventListener('pointerdown', (e) => {
    if (frame.isClosed() || root.contains(e.target) || e.target.closest?.('.sel-pop, .popover, #settingsTab, #openSettings')) return;
    close();
  });
  return { open, close, isOpen: () => !frame.isClosed(), refresh };
}
