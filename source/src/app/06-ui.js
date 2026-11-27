/* ===================== UI: menus, toolbar, outliner, properties ===================== */
const CHECK = S('<path d="M5 12.5l4.5 4.5L19 7.5" stroke-width="2.2"/>');

function toast(msg, err) {
  const wrap = $('#toasts');
  const t = el('div', { class: 'toast' + (err ? ' err' : ''), role: err ? 'alert' : 'status' }, msg);
  wrap.append(t);
  while (wrap.children.length > 4) wrap.firstChild.remove();
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 320); }, err ? 4500 : 1900);
}

/* small safe expression evaluator for number fields: 1.5*2, (3+4)/2, -0.5 */
function evalExpr(src) {
  const s = String(src).replace(/,/g, '.').replace(/[a-z°%\s]+$/i, '').trim();
  let i = 0;
  const ws = () => { while (s[i] === ' ') i++; };
  function atom() {
    ws();
    if (s[i] === '(') { i++; const v = sum(); ws(); if (s[i] !== ')') throw new Error('paren'); i++; return v; }
    if (s[i] === '-') { i++; return -atom(); }
    if (s[i] === '+') { i++; return atom(); }
    const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));
    if (!m) throw new Error('num'); i += m[0].length; return parseFloat(m[0]);
  }
  function prod() { let v = atom(); for (;;) { ws(); const c = s[i]; if (c === '*') { i++; v *= atom(); } else if (c === '/') { i++; v /= atom(); } else return v; } }
  function sum() { let v = prod(); for (;;) { ws(); const c = s[i]; if (c === '+') { i++; v += prod(); } else if (c === '-') { i++; v -= prod(); } else return v; } }
  const v = sum(); ws();
  if (i < s.length || !isFinite(v)) throw new Error('expr');
  return v;
}

/* ---------- number field: drag to scrub, click to type, arrows to nudge ---------- */
function numberField(o) {
  const step = o.step || 0.1;
  const root = el('div', { class: 'numf', tabindex: 0, role: 'spinbutton', 'aria-label': o.label || 'value' });
  const hasRange = o.min != null && o.max != null && (o.max - o.min) <= 20 && o.unit !== '°' && !o.int;
  const fill = hasRange ? el('div', { class: 'fill' }) : null;
  const left = el('span', { class: 'arr', 'aria-hidden': 'true' }, '‹');
  const right = el('span', { class: 'arr', 'aria-hidden': 'true' }, '›');
  const ax = o.axis != null ? el('span', { class: 'ax', style: { color: ['var(--axis-x)', 'var(--axis-y)', 'var(--axis-z)'][o.axis] } }, 'XYZ'[o.axis]) : null;
  const txt = el('span', { class: 'v' });
  if (fill) root.append(fill);
  root.append(left); if (ax) root.append(ax); root.append(txt, right);
  let v = o.value != null ? o.value : 0, editing = false;
  const decimals = o.int ? 0 : step >= 1 ? 1 : step >= 0.05 ? 2 : 3;
  const fmt = (x) => {
    if (x == null || !isFinite(x)) return '—';
    let s = o.int ? String(Math.round(x)) : x.toFixed(decimals);
    if (s === '-0' || /^-0\.0+$/.test(s)) s = s.slice(1);
    return o.unit ? (o.unit === '°' ? s + '°' : s + ' ' + o.unit) : s;
  };
  const lim = (x) => { if (o.min != null) x = Math.max(o.min, x); if (o.max != null) x = Math.min(o.max, x); return o.int ? Math.round(x) : x; };
  const show = () => {
    txt.textContent = fmt(v); root.setAttribute('aria-valuenow', String(v));
    if (fill) fill.style.width = (clamp((v - o.min) / (o.max - o.min), 0, 1) * 100).toFixed(1) + '%';
  };
  show();
  const nudge = (d, e) => { e.stopPropagation(); o.onStart && o.onStart(); v = lim(v + d * step); show(); o.onCommit && o.onCommit(v); };
  left.addEventListener('pointerdown', (e) => e.stopPropagation());
  right.addEventListener('pointerdown', (e) => e.stopPropagation());
  left.addEventListener('click', (e) => nudge(-1, e));
  right.addEventListener('click', (e) => nudge(1, e));
  let drag = null;
  root.addEventListener('pointerdown', (e) => {
    if (editing || e.button !== 0) return;
    drag = { x: e.clientX, v0: v, moved: false, id: e.pointerId };
  });
  root.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved) {
      if (Math.abs(dx) < 3) return;
      drag.moved = true; root.setPointerCapture(e.pointerId); root.classList.add('dragging');
      o.onStart && o.onStart();
    }
    let sens = hasRange ? (o.max - o.min) / 240 : step * 0.35;
    if (e.shiftKey) sens *= 0.1;
    let nv = drag.v0 + dx * sens;
    if (e.ctrlKey || e.metaKey) { const q = hasRange ? (o.max - o.min) / 20 : step * 10; nv = Math.round(nv / q) * q; }
    v = lim(nv); show();
    o.onChange && o.onChange(v);
  });
  const end = (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const d = drag; drag = null; root.classList.remove('dragging');
    if (d.moved) { o.onCommit && o.onCommit(v); }
    else if (e.type === 'pointerup') startEdit();
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
  root.addEventListener('keydown', (e) => {
    if (editing) return;
    if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); startEdit(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); nudge(-1, e); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); nudge(1, e); }
  });
  function startEdit() {
    if (editing) return; editing = true;
    const inp = el('input', { type: 'text', value: o.int ? String(Math.round(v)) : String(+v.toFixed(5)), spellcheck: 'false', 'aria-label': o.label || 'value' });
    root.append(inp); inp.focus(); inp.select();
    let done = false;
    const finish = (commit) => {
      if (done) return; done = true; editing = false;
      if (commit) {
        try { const nv = lim(evalExpr(inp.value)); if (nv !== v) { o.onStart && o.onStart(); v = nv; show(); o.onCommit && o.onCommit(v); } }
        catch (err) { toast('Not a number: ' + inp.value, true); }
      }
      inp.remove(); root.focus({ preventScroll: true });
    };
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      else if (e.key === 'Tab') { finish(true); }
    });
    inp.addEventListener('blur', () => finish(true));
    inp.addEventListener('pointerdown', (e) => e.stopPropagation());
  }
  return {
    el: root,
    set(x) { if (editing || drag) return; if (x !== v) { v = x; show(); } },
    get() { return v; },
    state(cls) { root.classList.toggle('animated', cls === 'animated'); root.classList.toggle('keyed', cls === 'keyed'); },
  };
}

/* ---------- menus ---------- */
const MENU = { open: null, btn: null, items: null };
function closeMenu() {
  if (MENU.open) { MENU.open.remove(); MENU.open = null; }
  if (MENU.btn) { MENU.btn.classList.remove('open'); MENU.btn.setAttribute('aria-expanded', 'false'); MENU.btn = null; }
}
function menuItem(it) {
  if (it === 'sep') return el('div', { class: 'sep', role: 'separator' });
  if (it.hdr) return el('div', { class: 'hdr' }, it.hdr);
  const dis = typeof it.disabled === 'function' ? it.disabled() : it.disabled;
  const chk = typeof it.checked === 'function' ? it.checked() : it.checked;
  const b = el('button', { class: 'mi' + (dis ? ' disabled' : ''), role: chk != null ? 'menuitemcheckbox' : 'menuitem', 'aria-checked': chk != null ? String(!!chk) : null },
    el('span', { class: 'ic', html: chk ? CHECK : it.icon ? ICON[it.icon] || '' : '' }),
    el('span', { class: 'lbl' }, it.label),
    it.sc ? el('span', { class: 'sc' }, it.sc) : null);
  if (it.title) b.title = it.title;
  b.addEventListener('click', (e) => { closeMenu(); if (it.action) it.action(e); });
  return b;
}
function showMenu(items, x, y, btn, opts = {}) {
  closeMenu();
  const dd = el('div', { class: 'dropdown' + (opts.cols ? ' cols' : ''), role: 'menu' });
  if (opts.cols) {
    let col = el('div', { class: 'mcol' }); dd.append(col);
    for (const it of items) { if (it === 'col') { col = el('div', { class: 'mcol' }); dd.append(col); continue; } col.append(menuItem(it)); }
  } else for (const it of items) dd.append(menuItem(it));
  document.body.append(dd);
  const r = dd.getBoundingClientRect(), W = window.innerWidth, H = window.innerHeight;
  let left = x, top = y;
  if (left + r.width > W - 6) left = Math.max(6, W - r.width - 6);
  if (top + r.height > H - 6) top = Math.max(6, opts.above != null ? opts.above - r.height - 4 : H - r.height - 6);
  dd.style.left = left + 'px'; dd.style.top = top + 'px';
  dd.style.maxHeight = (H - top - 8) + 'px';
  MENU.open = dd; MENU.btn = btn || null;
  if (btn) { btn.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); }
  const first = dd.querySelector('.mi:not(.disabled)'); if (first && opts.focus) first.focus();
  return dd;
}
document.addEventListener('pointerdown', (e) => {
  if (!MENU.open) return;
  if (MENU.open.contains(e.target)) return;
  if (MENU.btn && MENU.btn.contains(e.target)) return;
  closeMenu();
}, true);
document.addEventListener('keydown', (e) => {
  if (!MENU.open) return;
  const items = [...MENU.open.querySelectorAll('.mi:not(.disabled)')];
  const i = items.indexOf(document.activeElement);
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); const b = MENU.btn; closeMenu(); if (b) b.focus(); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); (items[i + 1] || items[0]).focus(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); (items[i - 1] || items[items.length - 1]).focus(); }
}, true);
function menuAt(items, e, opts) { e.preventDefault(); showMenu(items, e.clientX, e.clientY, null, opts); }

/* ---------- modal ---------- */
function openModal(title, body, buttons = [], opts = {}) {
  const bg = el('div', { class: 'modal-bg' });
  const m = el('div', { class: 'modal' + (opts.wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  const prevFocus = document.activeElement;
  const close = () => { bg.remove(); document.removeEventListener('keydown', onKey, true); if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true }); if (opts.onClose) opts.onClose(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } else e.stopPropagation(); };
  const x = el('button', { class: 'icon-btn', 'aria-label': 'Close', title: 'Close (Esc)', html: S('<path d="M6 6l12 12M18 6 6 18"/>') });
  x.onclick = close;
  const head = el('div', { class: 'modal-h' }, opts.icon ? el('span', { class: 'mh-ic', html: ICON[opts.icon] }) : null, el('h2', null, title), el('span', { class: 'grow' }), ...(opts.headExtra || []), x);
  const foot = el('div', { class: 'modal-f' });
  for (const b of buttons) {
    const btn = el('button', { class: 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''), html: (b.icon ? ICON[b.icon] : '') }, b.label);
    btn.onclick = () => { const r = b.action ? b.action() : null; if (r !== false) close(); };
    foot.append(btn);
  }
  m.append(head, el('div', { class: 'modal-b' }, body));
  if (buttons.length) m.append(foot);
  bg.append(m);
  bg.addEventListener('pointerdown', (e) => { if (e.target === bg) close(); });
  document.body.append(bg);
  document.addEventListener('keydown', onKey, true);
  setTimeout(() => { const f = m.querySelector('.modal-b input, .modal-f .btn.primary, .modal-h .icon-btn'); if (f) f.focus(); }, 0);
  return { close, el: m };
}
// non-blocking confirmation (never window.confirm)
function confirmModal(title, text, label, action, danger) {
  openModal(title, el('p', { class: 'p-help', style: { margin: 0, fontSize: '13px', color: 'var(--fg2)' } }, text), [
    { label: 'Cancel' }, { label, primary: !danger, danger: !!danger, action },
  ]);
}

/* ---------- UI object ---------- */
const UI = {
  timeline: null,
  refreshAll() {
    $('#scene-name').value = APP.scene.name;
    buildOutliner(); buildProps(); updateToolbar(); syncGizmo();
    if (UI.timeline) { UI.timeline.rebuildLabels(); UI.timeline.dirty = true; }
  },
  onPropChanged(obj, key) {
    APP.dirtyEval = true;
    if (key === 'name' || key === 'visible' || key === 'physics') buildOutliner();
    else updateOutlinerBadges();
    const tgt = propTarget();
    const showing = PROPS.objId === (obj ? obj.id : null) || (obj && obj.type === 'world' && PROPS.tab === 'scene');
    if (showing && PROPS.sig !== sigOf(obj)) buildProps(); else syncProps();
    if (UI.timeline) { UI.timeline.dirty = true; if (UI.timeline.labelSig() !== UI.timeline.sig) UI.timeline.rebuildLabels(); }
    if (tgt && obj === tgt) syncGizmo();
  },
  onSelection() {
    buildOutliner(); buildProps(); syncGizmo();
    if (UI.timeline) { UI.timeline.rebuildLabels(); UI.timeline.dirty = true; }
  },
  busy(text, prog) {
    const b = $('#busy');
    if (!text) { b.hidden = true; return; }
    b.hidden = false; $('#busy-text').textContent = text;
    const p = $('#busy-prog');
    if (prog == null) p.hidden = true; else { p.hidden = false; p.firstChild.style.width = (clamp(prog, 0, 1) * 100).toFixed(1) + '%'; }
  },
};
window.UI = UI;

/* ---------- top menus ---------- */
const ADD_ITEMS = () => {
  const add = (type, props, name) => () => addObjectAtCursor(type, props, name);
  const mi = (type, label, props, name, icon) => ({ label: label || TYPES[type].label, icon: icon || TYPES[type].icon, action: add(type, props, name) });
  const molP = (mat, color, scale, extra) => Object.assign({ physics: 'molecular', material: String(TI[mat]), color, scale, sleep: true }, extra || {});
  return [
    { hdr: 'Mesh' }, mi('cube'), mi('sphere'), mi('cylinder'), mi('cone'), mi('torus'), mi('capsule'), mi('plane'),
    { hdr: 'Bodies' }, { label: 'Humanoid', icon: 'humanoid', sc: '⇧H', action: add('humanoid') },
    mi('cube', 'Breakable clay block', molP('clay', '#c98b5d', [0.6, 0.6, 0.6]), 'Clay block', 'cube'),
    mi('sphere', 'Jelly ball', molP('jelly', '#56d38f', [0.7, 0.7, 0.7]), 'Jelly ball', 'sphere'),
    mi('cube', 'Glass pane', molP('glass', '#9fd6e8', [1.4, 1.4, 0.08], { opacity: 1 }), 'Glass pane', 'plane'),
    mi('cylinder', 'Stone pillar', molP('stone', '#9b9a94', [0.45, 2, 0.45]), 'Stone pillar', 'cylinder'),
    mi('cube', 'Ice block', molP('ice', '#cfeefc', [0.7, 0.7, 0.7]), 'Ice block', 'cube'),
    { hdr: 'Other' }, mi('camera'),
    'col',
    { hdr: 'Weapons' }, mi('hammer'), mi('wreckingball'), mi('blade'), mi('saw'), mi('crusher'), mi('pusher'), mi('spinner'), mi('guillotine'), mi('spikes'), mi('cannon'), mi('emitter'),
    { hdr: 'Forces' }, mi('bomb'), mi('wind'), mi('vortex'), mi('singularity'),
  ];
};
function addObjectAtCursor(type, props, name) {
  const T = TYPES[type], P = Object.assign({}, props || {});
  const tg = R.controls.target;
  const dflt = T.defaults();
  if (T.cat === 'mesh') {
    const sc = P.scale || dflt.scale || [1, 1, 1];
    const half = type === 'plane' ? 0.01 : 0.5 * Math.abs(sc[1]);
    P.position = [+(tg.x).toFixed(2), +half.toFixed(3), +(tg.z).toFixed(2)];
  } else if (type === 'humanoid') {
    // step new humanoids sideways so they don't spawn inside each other
    const others = allObjs().filter(o => o.type === 'humanoid');
    P.position = [others.length ? +(others.length * 0.9).toFixed(2) : 0, 0, 0];
  }
  const o = addObject(type, P, name);
  toast(`Added ${o.name}`);
  return o;
}

function buildMenus() {
  const M = {
    File: () => [
      { label: 'New scene', icon: 'plus', sc: 'Ctrl N', action: () => newSceneCmd() },
      { label: 'Scene library…', icon: 'folder', sc: 'Ctrl O', action: () => openLibrary() },
      { label: 'Save to library', icon: 'save', sc: 'Ctrl S', action: () => saveSceneCmd(false) },
      { label: 'Save as copy', icon: 'copy', sc: 'Ctrl ⇧ S', action: () => saveSceneCmd(true) },
      'sep',
      { label: 'Import scene file (.json)…', icon: 'upload', action: () => importJSON() },
      { label: 'Export scene file (.json)', icon: 'download', action: () => exportJSON() },
      'sep',
      { label: 'Render image (.png)', icon: 'image', sc: 'F12', action: () => renderStill() },
      { label: 'Export video', icon: 'film', sc: 'Ctrl F12', action: () => recordVideo() },
    ],
    Edit: () => [
      { label: 'Undo', icon: 'undo', sc: 'Ctrl Z', action: doUndo, disabled: !APP.undo.length },
      { label: 'Redo', icon: 'redo', sc: 'Ctrl ⇧ Z', action: doRedo, disabled: !APP.redo.length },
      'sep',
      { label: 'Duplicate', icon: 'copy', sc: '⇧ D', action: duplicateSelected, disabled: !selObjs().length },
      { label: 'Delete', icon: 'trash', sc: 'X', action: deleteSelected, disabled: !selObjs().length },
      'sep',
      { label: 'Select all', sc: 'A', action: () => select(allObjs().map(o => o.id)) },
      { label: 'Deselect all', sc: 'Alt A', action: () => select([]) },
      'sep',
      { label: 'Snap while transforming', checked: () => APP.snap, action: () => { APP.snap = !APP.snap; applyGizmoSettings(); updateToolbar(); } },
      { label: 'Local transform axes', checked: () => APP.gizmoSpace === 'local', action: () => { APP.gizmoSpace = APP.gizmoSpace === 'local' ? 'world' : 'local'; applyGizmoSettings(); updateToolbar(); } },
    ],
    Add: () => ADD_ITEMS(),
    Animation: () => [
      { label: 'Insert keyframe', icon: 'diamond', sc: 'I', action: () => insertKeyframeSelected(), disabled: !APP.active },
      { label: 'Delete keyframe', icon: 'diamondO', sc: 'Alt I', action: () => deleteKeyframeSelected(), disabled: !APP.active },
      { label: 'Clear all animation', icon: 'trash', action: () => clearAnimSelected(), disabled: !APP.active },
      { label: 'Auto-keying', checked: () => APP.autokey, action: () => toggleAutokey() },
      'sep',
      { label: 'Import Mixamo animation (FBX)…', icon: 'upload', title: 'Plays on the selected humanoids, and is saved so every scene can use it. You can also drop .fbx files onto the window.', action: () => importMixamo() },
      { label: 'Saved animations…', icon: 'film', title: 'Your imported animations: rename, delete, use, or move them to another device as a file.', action: () => openAnimLibrary() },
      { label: 'Cut to selected camera here', icon: 'camera', disabled: !(activeObj() && activeObj().type === 'camera'), action: () => { const o = activeObj(); pushUndo(); setProp(o, 'shotStart', APP.frame); APP.scene.world.props.activeCam = ''; toast(`${o.name} takes over from frame ${APP.frame}`); } },
      'sep',
      { hdr: 'Motion presets (at the current frame)' },
      ...MOTIONS.map(m => ({ label: m.name, icon: m.icon, title: m.desc, action: () => applyMotion(m.id), disabled: !m.ok(activeObj()) })),
      'sep',
      { label: 'Previous keyframe', icon: 'prevKey', sc: '↓', action: () => jumpKey(-1) },
      { label: 'Next keyframe', icon: 'nextKey', sc: '↑', action: () => jumpKey(1) },
    ],
    Simulation: () => [
      { label: APP.playing ? 'Pause' : 'Play', icon: APP.playing ? 'pause' : 'play', sc: 'Space', action: togglePlay },
      { label: 'Reset to start', icon: 'reset', sc: '⇧ ←', action: resetSim },
      { label: 'Simulate the whole range', icon: 'bake', action: bakeAll },
      { label: 'Clear simulation cache', icon: 'trash', action: clearCache },
      'sep',
      { label: 'Blast tool', icon: 'blast', sc: 'B', action: () => setTool('blast') },
      { label: 'Detonate at the 3D view centre', icon: 'bomb', action: () => blastAt(R.controls.target.clone(), 1.6, 14) },
      { label: `Remove interactive blasts (${(APP.scene.events || []).length})`, icon: 'trash', disabled: !(APP.scene.events || []).length, action: clearBlasts },
      'sep',
      { hdr: 'Viewport shading' },
      ...SHADINGS.map(s => ({ label: s.label, checked: () => MOL.shading === s.id, sc: s.sc, action: () => setShading(s.id) })),
    ],
    Scenes: () => [
      { label: 'Scene library…', icon: 'folder', action: () => openLibrary() },
      'sep', { hdr: 'Demo scenes' },
      ...DEMOS.map(d => ({ label: d.name, icon: d.icon, title: d.desc, action: () => loadDemo(d.id) })),
    ],
    Help: () => [
      { label: 'Keyboard shortcuts', icon: 'help', sc: '?', action: showShortcuts },
      { label: 'How Shatterbond works', icon: 'info', action: showAbout },
      { label: 'Quick start tips', icon: 'info', action: showTips },
    ],
  };
  const bar = $('#menus'); bar.textContent = '';
  for (const name in M) {
    const b = el('button', { class: 'menu-btn', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, name);
    const open = () => { const r = b.getBoundingClientRect(); showMenu(M[name](), r.left, r.bottom + 3, b, { cols: name === 'Add' }); };
    b.addEventListener('click', () => { if (MENU.btn === b) closeMenu(); else open(); });
    b.addEventListener('pointerenter', () => { if (MENU.open && MENU.btn && MENU.btn !== b && MENU.btn.classList.contains('menu-btn')) open(); });
    b.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); open(); const f = MENU.open.querySelector('.mi:not(.disabled)'); if (f) f.focus(); } });
    bar.append(b);
  }
}

/* ---------- toolbar + viewport header ---------- */
const TOOLS = [
  { id: 'select', icon: 'select', label: 'Select', k: 'Q' },
  { id: 'move', icon: 'move', label: 'Move', k: 'G' },
  { id: 'rotate', icon: 'rotate', label: 'Rotate', k: 'R' },
  { id: 'scale', icon: 'scale', label: 'Scale', k: 'S' },
  'sep',
  { id: 'blast', icon: 'blast', label: 'Blast: click anywhere to blow molecules apart', k: 'B' },
];
const SHADINGS = [
  { id: 'skin', icon: 'skin', label: 'Skin', sc: '1', tip: 'Solid skin, exposed molecules where it tears' },
  { id: 'xray', icon: 'xray', label: 'X-ray', sc: '2', tip: 'See-through skin with the organs inside' },
  { id: 'tissue', icon: 'tissue', label: 'Molecules', sc: '3', tip: 'Molecule view: every molecule on its own, colored by tissue' },
  { id: 'molecules', icon: 'molecule', label: 'One color', sc: '4', tip: 'Every molecule in the scene molecule color' },
];
function buildToolbar() {
  const tb = $('#toolbar'); tb.textContent = '';
  for (const t of TOOLS) {
    if (t === 'sep') { tb.append(el('div', { class: 'tool-sep' })); continue; }
    const b = el('button', { class: 'tool', 'data-tool': t.id, title: `${t.label} (${t.k})`, 'aria-label': t.label, html: ICON[t.icon] + `<span class="k">${t.k}</span>` });
    b.onclick = () => setTool(t.id);
    tb.append(b);
  }
  tb.append(el('div', { class: 'tool-sep' }));
  const extra = [
    { icon: 'plus', label: 'Add object (Shift+A)', fn: (b) => { const r = b.getBoundingClientRect(); showMenu(ADD_ITEMS(), r.right + 6, r.top, b, { cols: true }); } },
    { icon: 'diamond', label: 'Insert keyframe on selection (I)', fn: () => insertKeyframeSelected() },
    { icon: 'camera', label: 'Look through scene camera (Numpad 0 / C)', fn: () => toggleCamView(), id: 'camview' },
    { icon: 'blackhole', label: 'Frame selected (F)', fn: () => frameSelected(), svg: S('<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><circle cx="12" cy="12" r="2.5"/>') },
  ];
  for (const x of extra) {
    const b = el('button', { class: 'tool', title: x.label, 'aria-label': x.label, html: x.svg || ICON[x.icon], 'data-extra': x.id || '' });
    b.onclick = () => x.fn(b);
    tb.append(b);
  }
  // viewport header
  const vh = $('#vp-header'); vh.textContent = '';
  const g1 = el('div', { class: 'vp-group', role: 'group', 'aria-label': 'Shading' });
  for (const s of SHADINGS) {
    const b = el('button', { class: 'vp-btn', 'data-shade': s.id, title: `${s.tip} (${s.sc})`, html: ICON[s.icon] }, el('span', { class: 'vl' }, s.label));
    b.onclick = () => setShading(s.id); g1.append(b);
  }
  const g2 = el('div', { class: 'vp-group', role: 'group', 'aria-label': 'Transform options' });
  const space = el('button', { class: 'vp-btn', id: 'vb-space', title: 'Transform axes: global or local' });
  space.onclick = () => { APP.gizmoSpace = APP.gizmoSpace === 'local' ? 'world' : 'local'; applyGizmoSettings(); updateToolbar(); };
  const snap = el('button', { class: 'vp-btn', id: 'vb-snap', title: 'Snap: 0.25 m, 15°, 0.1× while dragging (hold Ctrl to toggle)', html: ICON.snap }, el('span', { class: 'vl' }, 'Snap'));
  snap.onclick = () => { APP.snap = !APP.snap; applyGizmoSettings(); updateToolbar(); };
  g2.append(space, snap);
  const g3 = el('div', { class: 'vp-group', role: 'group', 'aria-label': 'View' });
  const cam = el('button', { class: 'vp-btn', id: 'vb-cam', title: 'Look through the scene camera (Numpad 0)', html: ICON.camera }, el('span', { class: 'vl' }, 'Camera'));
  cam.onclick = () => toggleCamView();
  const camMenu = el('button', { class: 'vp-btn vp-caret', id: 'vb-camlist', title: 'Pick which camera to look through (PgUp / PgDn)', 'aria-label': 'Choose camera', html: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>' });
  camMenu.onclick = () => { const r = camMenu.getBoundingClientRect(); showMenu(cameraMenuItems(), r.left - 120, r.bottom + 4, camMenu); };
  const grid = el('button', { class: 'vp-btn', id: 'vb-grid', title: 'Show grid and helpers (H)', html: ICON.grid });
  grid.onclick = () => { APP.showGrid = !APP.showGrid; updateToolbar(); APP.dirtyEval = true; };
  const clean = el('button', { class: 'vp-btn', id: 'vb-clean', title: 'Clean view: hide every editor helper (Shift+H)', html: ICON.render });
  clean.onclick = () => { APP.renderMode = !APP.renderMode; updateToolbar(); APP.dirtyEval = true; syncGizmo(); };
  g3.append(cam, camMenu, grid, clean);
  vh.append(g1, g2, el('div', { class: 'vp-spacer' }), g3);
}
function updateToolbar() {
  $$('#toolbar .tool[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === APP.tool));
  const cv = $('#toolbar .tool[data-extra="camview"]'); if (cv) cv.classList.toggle('on', APP.camView);
  $$('#vp-header [data-shade]').forEach(b => b.classList.toggle('on', b.dataset.shade === MOL.shading));
  const sp = $('#vb-space'); if (sp) { sp.innerHTML = (APP.gizmoSpace === 'local' ? ICON.local : ICON.world) + `<span class="vl">${APP.gizmoSpace === 'local' ? 'Local' : 'Global'}</span>`; sp.classList.toggle('on', APP.gizmoSpace === 'local'); }
  const sn = $('#vb-snap'); if (sn) sn.classList.toggle('on', APP.snap);
  const c = $('#vb-cam'); if (c) c.classList.toggle('on', APP.camView);
  const g = $('#vb-grid'); if (g) g.classList.toggle('on', APP.showGrid);
  const cl = $('#vb-clean'); if (cl) cl.classList.toggle('on', APP.renderMode);
  R.vp.dataset.tool = APP.tool;
}
function setTool(t) {
  APP.tool = t;
  applyGizmoSettings(); updateToolbar(); syncGizmo();
  if (t === 'blast') setStatusHint('Blast: click a spot in the 3D view. Hold Shift for a bigger blast.');
  else setStatusHint(null);
}
function setShading(m) {
  MOL.shading = m; MOL.applyStyle(); APP.dirtyEval = true; updateToolbar();
}
function toggleAutokey() { APP.autokey = !APP.autokey; if (UI.timeline) UI.timeline.updateBar(); toast(APP.autokey ? 'Auto-keying on: every change records a keyframe' : 'Auto-keying off'); }
let _hintEl = null;
function setStatusHint(text) {
  if (_hintEl) { _hintEl.remove(); _hintEl = null; }
  if (text) { _hintEl = el('div', { class: 'vp-hint' }, text); R.vp.append(_hintEl); }
}

/* ---------- gizmo ---------- */
function selObjs() { return APP.sel.map(objById).filter(o => o && o.type !== 'world'); }
function activeObj() { const o = APP.active ? objById(APP.active) : null; return o && o.type !== 'world' ? o : null; }
function applyGizmoSettings() {
  const g = R.gizmo;
  const mode = { move: 'translate', rotate: 'rotate', scale: 'scale' }[APP.tool];
  if (mode) g.setMode(mode);
  g.setSpace(APP.gizmoSpace === 'local' || APP.tool === 'scale' ? 'local' : 'world');
  g.setTranslationSnap(APP.snap ? 0.25 : null);
  g.setRotationSnap(APP.snap ? 15 * DEG : null);
  g.setScaleSnap(APP.snap ? 0.1 : null);
}
function gizmoAllowed(o) {
  if (!o || APP.playing || APP.renderMode) return false;
  const P = o.props;
  if (APP.tool === 'move') return !!P.position;
  if (APP.tool === 'rotate') return !!P.rotation || o.type === 'camera';
  if (APP.tool === 'scale') return !!P.scale;
  return false;
}
function syncGizmo() {
  const o = activeObj();
  const g = R.gizmo, tgt = R.gizmoTarget;
  if (!gizmoAllowed(o) || (APP.camView && o.type === 'camera')) { if (g.object) g.detach(); return; }
  if (R.gizmoDragging) return;
  const P = o.type === 'camera' ? camState(o, evalProps(o, APP.frame)) : evalProps(o, APP.frame);
  tgt.position.set(P.position[0], P.position[1], P.position[2]);
  if (o.type === 'camera') { tgt.up.set(0, 1, 0); tgt.lookAt(P.target[0], P.target[1], P.target[2]); } // +Z aims at the target
  else if (P.rotation) tgt.rotation.set(P.rotation[0] * DEG, P.rotation[1] * DEG, P.rotation[2] * DEG, 'XYZ'); else tgt.rotation.set(0, 0, 0);
  if (P.scale) tgt.scale.set(P.scale[0] || 1e-3, P.scale[1] || 1e-3, P.scale[2] || 1e-3); else tgt.scale.set(1, 1, 1);
  tgt.updateMatrixWorld(true);
  if (g.object !== tgt) g.attach(tgt);
}
function initGizmo() {
  const tgt = new THREE.Object3D(); R.scene.add(tgt); R.gizmoTarget = tgt;
  const g = R.gizmo;
  let start = null;
  g.addEventListener('mouseDown', () => {
    const o = activeObj(); if (!o) return;
    pushUndo(); R.gizmoDragging = true;
    const P = evalProps(o, APP.frame);
    // a following camera: the gizmo sits where following put it, the stored position is relative to that
    const fs = o.type === 'camera' ? camState(o, P) : null;
    start = { fd: fs && fs._fd ? fs._fd.slice() : [0, 0, 0], look: !!(fs && fs._look), pos: tgt.position.clone(), tgt: P.target ? P.target.slice() : null, others: selObjs().filter(x => x !== o && x.props.position).map(x => ({ o: x, p: evalProps(x, APP.frame).position.slice() })), P };
  });
  g.addEventListener('mouseUp', () => {
    R.gizmoDragging = false; start = null;
    const o = activeObj(); if (o) UI.onPropChanged(o, 'position');
    for (const x of selObjs()) if (x !== o) UI.onPropChanged(x, 'position');
  });
  g.addEventListener('objectChange', () => {
    const o = activeObj(); if (!o || !start) return;
    const r3 = (v, d = 4) => +v.toFixed(d);
    if (g.mode === 'translate') {
      const fd = start.fd;
      const p = [r3(tgt.position.x - fd[0]), r3(tgt.position.y - fd[1]), r3(tgt.position.z - fd[2])];
      const cur = evalProps(o, APP.frame).position;
      for (let i = 0; i < 3; i++) if (Math.abs(p[i] - cur[i]) > 1e-6) setProp(o, 'position', p[i], i, { silent: true });
      const d = tgt.position.clone().sub(start.pos);
      // a camera moves with its aim: what it looks at shifts along, so the shot keeps its direction
      if (o.type === 'camera' && start.tgt && !start.look) { const ct = evalProps(o, APP.frame).target; for (let i = 0; i < 3; i++) { const v = r3(start.tgt[i] + d.getComponent(i)); if (Math.abs(v - ct[i]) > 1e-6) setProp(o, 'target', v, i, { silent: true }); } }
      for (const s of start.others) for (let i = 0; i < 3; i++) setProp(s.o, 'position', r3(s.p[i] + d.getComponent(i)), i, { silent: true });
    } else if (g.mode === 'rotate' && o.type === 'camera') {
      // turn the camera in place: keep the distance to what it looks at, swing the target around
      // (a camera that follows and watches an object aims at it, so turning does nothing then)
      if (start.look) return;
      const P = evalProps(o, APP.frame), dist = Math.max(0.05, Math.hypot(P.target[0] - P.position[0], P.target[1] - P.position[1], P.target[2] - P.position[2]));
      const f = new THREE.Vector3(0, 0, 1).applyQuaternion(tgt.quaternion).multiplyScalar(dist).add(tgt.position).sub(new THREE.Vector3(...start.fd));
      const nt = [r3(f.x), r3(f.y), r3(f.z)];
      for (let i = 0; i < 3; i++) if (Math.abs(nt[i] - P.target[i]) > 1e-6) setProp(o, 'target', nt[i], i, { silent: true });
    } else if (g.mode === 'rotate') {
      const e = tgt.rotation, cur = evalProps(o, APP.frame).rotation;
      const r = [r3(e.x / DEG, 2), r3(e.y / DEG, 2), r3(e.z / DEG, 2)];
      // keep angles continuous with the current value (avoid ±180 flips in keyframes)
      for (let i = 0; i < 3; i++) { while (r[i] - cur[i] > 180) r[i] -= 360; while (r[i] - cur[i] < -180) r[i] += 360; if (Math.abs(r[i] - cur[i]) > 1e-4) setProp(o, 'rotation', r3(r[i], 2), i, { silent: true }); }
    } else if (g.mode === 'scale') {
      const s = [r3(tgt.scale.x), r3(tgt.scale.y), r3(tgt.scale.z)], cur = evalProps(o, APP.frame).scale;
      for (let i = 0; i < 3; i++) if (Math.abs(s[i] - cur[i]) > 1e-6) setProp(o, 'scale', Math.max(0.001, s[i]), i, { silent: true });
    }
    syncProps();
    if (UI.timeline) UI.timeline.dirty = true;
  });
}

/* ---------- outliner ---------- */
function objBadges(o) {
  const out = [];
  if (o.type === 'humanoid' || (TYPES[o.type] && TYPES[o.type].cat === 'mesh' && o.props.physics === 'molecular')) out.push(el('span', { class: 'badge mol', title: 'Molecular body: made of bonded particles' }, 'MOL'));
  if (o.anim && Object.keys(o.anim).length) out.push(el('span', { class: 'badge anim', title: 'Has keyframes' }, '◆'));
  return out;
}
function buildOutliner() {
  const list = $('#outliner-list'); list.textContent = '';
  const W = APP.scene.world;
  const wr = el('div', { class: 'ol-row ol-world' + (APP.sel.includes('world') ? ' sel active' : ''), role: 'treeitem', 'data-id': 'world', tabindex: -1 },
    el('span', { class: 'ic', html: ICON.world }), el('span', { class: 'nm' }, 'World & time'), ...objBadges(W));
  wr.onclick = () => { select(['world']); PROPS.want = 'scene'; buildProps(); };
  list.append(wr);
  for (const o of allObjs()) {
    const P = o._eval || o.props;
    const sel = APP.sel.includes(o.id);
    const row = el('div', { class: 'ol-row' + (sel ? ' sel' : '') + (APP.active === o.id ? ' active' : '') + (P.visible === false ? ' hidden' : ''), role: 'treeitem', 'aria-selected': String(sel), 'data-id': o.id, tabindex: -1 });
    const nm = el('span', { class: 'nm', title: o.name }, o.name);
    const eye = el('button', { class: 'icon-btn eye', title: P.visible === false ? 'Show' : 'Hide', 'aria-label': (P.visible === false ? 'Show ' : 'Hide ') + o.name, html: P.visible === false ? ICON.eyeOff : ICON.eye });
    eye.onclick = (e) => { e.stopPropagation(); pushUndo(); setProp(o, 'visible', !(evalProps(o, APP.frame).visible !== false)); };
    row.append(el('span', { class: 'ic', html: ICON[TYPES[o.type].icon] }), nm, ...objBadges(o), eye);
    row.addEventListener('click', (e) => select([o.id], e.shiftKey || e.ctrlKey || e.metaKey));
    row.addEventListener('dblclick', () => renameInline(o, nm));
    row.addEventListener('contextmenu', (e) => {
      if (!APP.sel.includes(o.id)) select([o.id]);
      menuAt([
        { label: 'Rename', action: () => renameInline(o, nm) },
        { label: 'Duplicate', icon: 'copy', sc: '⇧ D', action: duplicateSelected },
        { label: 'Delete', icon: 'trash', sc: 'X', action: deleteSelected },
        'sep',
        { label: 'Frame in view', sc: 'F', action: frameSelected },
        ...(o.type === 'camera' ? [{ label: 'Look through this camera', icon: 'camera', sc: 'C', action: () => lookThrough(o) }] : []),
        { label: 'Clear animation', action: clearAnimSelected, disabled: !Object.keys(o.anim || {}).length },
      ], e);
    });
    list.append(row);
  }
  // interactive blasts from the Blast tool: one row each, so any of them can be picked and deleted
  (APP.scene.events || []).forEach((ev, i) => {
    const sel = APP.blastSel === i;
    const row = el('div', { class: 'ol-row ol-blast' + (sel ? ' sel active' : ''), role: 'treeitem', 'aria-selected': String(sel), 'data-blast': i, tabindex: -1 });
    const del = el('button', { class: 'icon-btn eye', title: 'Delete this blast', 'aria-label': `Delete blast at frame ${ev.f}`, html: ICON.trash });
    del.onclick = (e) => { e.stopPropagation(); deleteBlast(i); };
    row.append(el('span', { class: 'ic', html: ICON.blast }), el('span', { class: 'nm', title: 'Made with the Blast tool' }, `Blast · frame ${ev.f}`), del);
    row.addEventListener('click', () => selectBlast(i));
    row.addEventListener('dblclick', () => { selectBlast(i); setFrame(ev.f); });
    row.addEventListener('contextmenu', (e) => { selectBlast(i); menuAt([
      { label: 'Delete this blast', icon: 'trash', sc: 'X', action: () => deleteBlast(i) },
      { label: 'Go to its frame', action: () => setFrame(ev.f) },
      { label: `Delete all blasts (${APP.scene.events.length})`, icon: 'trash', action: clearBlasts },
    ], e); });
    list.append(row);
  });
  if (!allObjs().length && !(APP.scene.events || []).length) list.append(el('div', { class: 'p-help' }, 'The scene is empty. Use Add (Shift+A) or pick a demo from Scenes.'));
}
function updateOutlinerBadges() {
  for (const row of $$('#outliner-list .ol-row')) {
    const o = objById(row.dataset.id); if (!o) continue;
    const old = row.querySelectorAll('.badge'); old.forEach(b => b.remove());
    const eye = row.querySelector('.eye');
    for (const b of objBadges(o)) row.insertBefore(b, eye);
  }
}
function renameInline(o, nmEl) {
  const inp = el('input', { type: 'text', value: o.name, 'aria-label': 'Object name', spellcheck: 'false' });
  nmEl.textContent = ''; nmEl.append(inp); inp.focus(); inp.select();
  let done = false;
  const fin = (ok) => {
    if (done) return; done = true;
    const v = inp.value.trim();
    if (ok && v && v !== o.name) { pushUndo(); o.name = allObjs().some(x => x !== o && x.name === v) ? uniqueName(v) : v; }
    buildOutliner(); buildProps(); if (UI.timeline) UI.timeline.rebuildLabels();
  };
  inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') fin(true); else if (e.key === 'Escape') fin(false); });
  inp.addEventListener('blur', () => fin(true));
  inp.addEventListener('click', (e) => e.stopPropagation());
}

/* ---------- properties ---------- */
const PROPS = { tab: 'scene', want: null, rows: [], sig: '', objId: null, gstate: {} };
try { Object.assign(PROPS.gstate, JSON.parse(localStorage.getItem('shatterbond.groups') || '{}')); } catch (e) { /* storage unavailable */ }
function saveGroups() { try { localStorage.setItem('shatterbond.groups', JSON.stringify(PROPS.gstate)); } catch (e) { /* ignore */ } }
function propTarget() { return APP.active ? objById(APP.active) : null; }
const TAB_OF = { physics: 'physics', molecular: 'physics', material: 'material' };
function groupsOf(obj) { return obj.type === 'world' ? WORLD_GROUPS : TYPES[obj.type].groups(evalProps(obj, APP.frame)); }
function sigOf(obj) { if (!obj) return ''; return groupsOf(obj).map(g => g.id + ':' + g.fields.map(f => f.key).join(',')).join('|'); }
function tabsFor(obj) {
  const tabs = [];
  if (obj && obj.type !== 'world') {
    const gs = groupsOf(obj);
    tabs.push({ id: 'object', icon: TYPES[obj.type].icon, title: 'Object' });
    if (gs.some(g => TAB_OF[g.id] === 'physics')) tabs.push({ id: 'physics', icon: 'physics', title: 'Physics' });
    if (gs.some(g => TAB_OF[g.id] === 'material')) tabs.push({ id: 'material', icon: 'material', title: 'Colors & surface' });
  }
  tabs.push({ id: 'scene', icon: 'world', title: 'Scene, time & world' }, { id: 'tissues', icon: 'anatomy', title: 'Tissues & materials' }, { id: 'render', icon: 'render', title: 'Render & export' });
  return tabs;
}
function groupEl(id, title, kids, defaultOpen = true, extraHead) {
  const open = PROPS.gstate[id] != null ? PROPS.gstate[id] : defaultOpen;
  const g = el('div', { class: 'group' + (open ? '' : ' closed') });
  const h = el('div', { class: 'gh', role: 'button', tabindex: 0, 'aria-expanded': String(open) }, el('span', { class: 'chev', html: ICON.chev }), el('span', { class: 'gt' }, title), extraHead || null);
  const tog = () => { const now = g.classList.toggle('closed'); PROPS.gstate[id] = !now; h.setAttribute('aria-expanded', String(!now)); saveGroups(); };
  h.addEventListener('click', (e) => { if (e.target.closest('button,input,select')) return; tog(); });
  h.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tog(); } });
  g.append(h, el('div', { class: 'gb' }, kids));
  return g;
}
function buildProps() {
  const obj = propTarget();
  const tabs = tabsFor(obj);
  const want = PROPS.want || PROPS.tab;
  const prevTab = PROPS.tab, prevObj = PROPS.objId;
  PROPS.tab = tabs.find(t => t.id === want) ? want : (obj && obj.type !== 'world' ? 'object' : (tabs.find(t => t.id === PROPS.tab) ? PROPS.tab : 'scene'));
  if (obj && obj.type === 'world' && !['scene', 'tissues', 'render'].includes(PROPS.tab)) PROPS.tab = 'scene';
  const tb = $('#prop-tabs'); tb.textContent = '';
  for (const t of tabs) {
    const b = el('button', { class: 'ptab' + (t.id === PROPS.tab ? ' on' : ''), title: t.title, 'aria-label': t.title, role: 'tab', 'aria-selected': String(t.id === PROPS.tab), html: ICON[t.icon] });
    b.onclick = () => { PROPS.want = t.id; buildProps(); };
    tb.append(b);
  }
  const body = $('#prop-body');
  const keepScroll = prevTab === PROPS.tab && prevObj === (obj ? obj.id : null);
  const sc = body.scrollTop;
  body.textContent = ''; PROPS.rows = [];
  PROPS.objId = obj ? obj.id : null;
  if (PROPS.tab === 'scene') scenePanel(body);
  else if (PROPS.tab === 'tissues') tissuePanel(body, obj);
  else if (PROPS.tab === 'render') renderPanel(body);
  else if (obj) objPanel(body, obj, PROPS.tab);
  PROPS.sig = obj && PROPS.tab !== 'scene' ? sigOf(obj) : sigOf(APP.scene.world);
  if (PROPS.tab === 'scene') PROPS.sig = sigOf(APP.scene.world);
  if (keepScroll) body.scrollTop = sc;
  syncProps();
}
function syncProps() {
  const cache = new Map();
  for (const r of PROPS.rows) {
    let P = null;
    if (r.obj) { P = cache.get(r.obj); if (!P) { P = evalProps(r.obj, APP.frame); cache.set(r.obj, P); } }
    r.fn(P);
  }
}
function keyState(obj, path) { if (!isAnimated(obj, path)) return ''; return keyAt(obj, path, APP.frame) >= 0 ? 'keyed' : 'animated'; }
function simRel(obj, key) { return simKey(obj, key); }
function fieldPaths(fd) { return fd.comp != null ? [`${fd.key}.${fd.comp}`] : fd.type === 'vec3' ? [0, 1, 2].map(i => `${fd.key}.${i}`) : [fd.key]; }
function toggleKey(obj, fd) {
  pushUndo();
  const paths = fieldPaths(fd), f = APP.frame;
  const keyed = paths.some(p => keyAt(obj, p, f) >= 0);
  const P = evalProps(obj, f);
  for (const p of paths) {
    if (keyed) { deleteKey(obj, p, f); if (!isAnimated(obj, p)) setPath(obj.props, p, getPath(P, p)); }
    else insertKey(obj, p, f, getPath(P, p));
  }
  changed(obj, simRel(obj, fd.key)); UI.onPropChanged(obj, fd.key);
  toast(keyed ? `Removed ${fd.label} keyframe at frame ${f}` : `Keyed ${fd.label} at frame ${f}`);
}
function clearChannel(obj, fd) {
  pushUndo();
  const P = evalProps(obj, APP.frame);
  for (const p of fieldPaths(fd)) if (obj.anim && obj.anim[p]) { delete obj.anim[p]; setPath(obj.props, p, getPath(P, p)); }
  changed(obj, simRel(obj, fd.key)); UI.onPropChanged(obj, fd.key);
}
function resetField(obj, fd) {
  const D = obj.type === 'world' ? WORLD_DEFAULTS() : TYPES[obj.type].defaults();
  if (D[fd.key] == null) return;
  pushUndo();
  if (fd.comp != null) setProp(obj, fd.key, D[fd.key][fd.comp], fd.comp, { silent: true });
  else if (fd.type === 'vec3') D[fd.key].forEach((v, i) => setProp(obj, fd.key, v, i, { silent: true }));
  else setProp(obj, fd.key, D[fd.key], null, { silent: true });
  UI.onPropChanged(obj, fd.key);
}
function fieldMenu(e, obj, fd) {
  const paths = fieldPaths(fd);
  const anim = paths.some(p => isAnimated(obj, p)), keyed = paths.some(p => keyAt(obj, p, APP.frame) >= 0);
  menuAt([
    { label: 'Insert keyframe', icon: 'diamond', sc: 'I', disabled: !fd.anim || keyed, action: () => toggleKey(obj, fd) },
    { label: 'Delete keyframe', icon: 'diamondO', disabled: !keyed, action: () => toggleKey(obj, fd) },
    { label: 'Clear keyframes', icon: 'trash', disabled: !anim, action: () => clearChannel(obj, fd) },
    'sep',
    { label: 'Reset to default', icon: 'reset', action: () => resetField(obj, fd) },
  ], e);
}
function fieldRow(obj, fd) {
  // vectors are shown Blender-style: one row per component, each with its own keyframe toggle
  if (fd.type === 'vec3') return el('div', { class: 'vecblock' }, [0, 1, 2].map(i => fieldRow(obj, Object.assign({}, fd, { type: 'num', comp: i, label: `${fd.label} ${'XYZ'[i]}`, shown: i === 0 ? fd.label : '' }))));
  const row = el('div', { class: 'row' + (fd.comp != null ? ' comp' : '') });
  const lab = el('label', { title: fd.help ? `${fd.label}: ${fd.help}` : fd.label }, fd.shown != null ? fd.shown : fd.label);
  if (fd.help) lab.classList.add('has-help');
  const ctl = el('div', { class: 'ctl' });
  let kd;
  if (fd.anim) {
    kd = el('button', { class: 'kd', title: 'Keyframe this value at the current frame (I over a field)', 'aria-label': 'Keyframe ' + fd.label, html: ICON.diamondO });
    kd.onclick = () => toggleKey(obj, fd);
  } else kd = el('span');
  row.append(lab, ctl, kd);
  row.addEventListener('contextmenu', (e) => fieldMenu(e, obj, fd));
  row._field = { obj, fd };
  const live = (v, idx) => { setProp(obj, fd.key, v, idx, { silent: true }); syncProps(); if (UI.timeline) UI.timeline.dirty = true; };
  const commit = (v, idx) => setProp(obj, fd.key, v, idx);
  let update;
  switch (fd.type) {
    case 'num': case 'int': {
      const idx = fd.comp != null ? fd.comp : null, path = fieldPaths(fd)[0];
      const nf = numberField({ label: fd.label, axis: idx != null ? idx : undefined, step: fd.step, min: fd.min, max: fd.max, unit: fd.unit, int: fd.type === 'int', onStart: pushUndo, onChange: (v) => live(v, idx), onCommit: (v) => commit(v, idx) });
      ctl.append(nf.el);
      update = (P) => { const v = idx != null ? (P[fd.key] || [0, 0, 0])[idx] : P[fd.key]; nf.set(+v); nf.state(keyState(obj, path)); };
      break;
    }
    case 'vec3': {
      const nfs = [0, 1, 2].map(i => numberField({ label: `${fd.label} ${'XYZ'[i]}`, axis: i, step: fd.step, min: fd.min, max: fd.max, unit: fd.unit, onStart: pushUndo, onChange: (v) => live(v, i), onCommit: (v) => commit(v, i) }));
      nfs.forEach(n => ctl.append(n.el));
      update = (P) => { const a = P[fd.key] || [0, 0, 0]; nfs.forEach((n, i) => { n.set(+a[i]); n.state(keyState(obj, `${fd.key}.${i}`)); }); };
      break;
    }
    case 'bool': {
      const cb = el('input', { type: 'checkbox', 'aria-label': fd.label });
      const lb = el('label', { class: 'checkf' }, cb, el('span', null, ''));
      cb.addEventListener('change', () => { pushUndo(); setProp(obj, fd.key, cb.checked); });
      ctl.append(lb);
      update = (P) => { cb.checked = !!P[fd.key]; lb.classList.toggle('keyed', keyState(obj, fd.key) === 'keyed'); lb.classList.toggle('animated', keyState(obj, fd.key) === 'animated'); };
      break;
    }
    case 'select': {
      const s = el('select', { class: 'selectf', 'aria-label': fd.label });
      for (const [v, t] of (typeof fd.options === 'function' ? fd.options() : fd.options)) s.append(el('option', { value: v }, t));
      s.addEventListener('change', () => { const pre = fd.beforeSet ? fd.beforeSet(obj) : null; pushUndo(); setProp(obj, fd.key, s.value); if (fd.onSet) { fd.onSet(obj, s.value, pre); buildProps(); } });
      ctl.append(s);
      update = (P) => { if (document.activeElement !== s) s.value = String(P[fd.key]); };
      break;
    }
    case 'button': {
      const b = el('button', { class: 'btn small', type: 'button' }, fd.text || fd.label);
      b.addEventListener('click', () => fd.action(obj));
      ctl.append(b);
      update = () => {};
      break;
    }
    case 'color': {
      const c = el('input', { type: 'color', class: 'colorf', 'aria-label': fd.label });
      let started = false;
      c.addEventListener('input', () => { if (!started) { pushUndo(); started = true; } live(c.value); });
      c.addEventListener('change', () => { started = false; commit(c.value); });
      ctl.append(c);
      update = (P) => { if (!started) c.value = P[fd.key] || '#000000'; c.classList.toggle('keyed', keyState(obj, fd.key) === 'keyed'); c.classList.toggle('animated', keyState(obj, fd.key) === 'animated'); };
      break;
    }
    default: {
      const t = el('input', { type: 'text', class: 'textf', 'aria-label': fd.label });
      t.addEventListener('change', () => { pushUndo(); setProp(obj, fd.key, t.value); });
      t.addEventListener('keydown', (e) => e.stopPropagation());
      ctl.append(t);
      update = (P) => { if (document.activeElement !== t) t.value = P[fd.key] || ''; };
    }
  }
  const kdUpdate = () => {
    if (!fd.anim) return;
    const st = fieldPaths(fd).map(p => keyState(obj, p));
    const s = st.includes('keyed') ? 'keyed' : st.includes('animated') ? 'animated' : '';
    kd.className = 'kd' + (s === 'keyed' ? ' key' : s === 'animated' ? ' anim' : '');
    kd.innerHTML = s === 'keyed' ? ICON.diamond : ICON.diamondO;
  };
  PROPS.rows.push({ obj, fn: (P) => { update(P); kdUpdate(); } });
  return row;
}
function titleBlock(icon, name, sub, onRename) {
  const t = el('div', { class: 'p-title' }, el('span', { class: 'ic', html: ICON[icon] }));
  if (onRename) {
    const inp = el('input', { class: 'title-in', type: 'text', value: name, 'aria-label': 'Name', spellcheck: 'false' });
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.value = name; inp.blur(); } });
    inp.addEventListener('change', () => onRename(inp.value.trim()));
    t.append(inp);
  } else t.append(el('span', null, name));
  if (sub) t.append(el('span', { class: 'sub' }, sub));
  return t;
}
const TYPE_HELP = {
  hammer: 'A heavy head on two ropes swings from the pivot. Pull-back angle sets how far it starts, release frame sets when it lets go.',
  wreckingball: 'A heavy ball on a chain. Swings like a pendulum from the pivot point.',
  blade: 'A sharp pendulum blade. Thin blades slice through molecules instead of pushing them.',
  saw: 'A spinning disc that grips and tears whatever touches its rim. Give it a travel distance to make it advance.',
  crusher: 'A press plate drives down by the stroke length, holds, then returns.',
  pusher: 'A wall that rams forward at the given speed.',
  spinner: 'A bar sweeping around a post. Set its height to trip legs or hit torsos.',
  guillotine: 'The blade free-falls under gravity at the drop frame.',
  spikes: 'A bed of sharp cones. Drop or throw bodies onto it.',
  cannon: 'Fires a volley of iron balls along its forward (blue) axis.',
  emitter: 'Keeps launching real physics objects along its blue arrow. Set how many per second, how fast, how wide the spray is and how long they last. Rate and speed can be keyframed.',
  bomb: 'Blasts every molecule in its radius outward at the detonation frame. Molecules in the core are torn loose.',
  wind: 'Constant push along its arrow while active.',
  vortex: 'Swirls molecules around its vertical axis and lifts them.',
  singularity: 'Pulls every molecule in reach towards its centre.',
  humanoid: 'A procedurally sculpted human made entirely of soft tissue: skin, fat, muscle and organs, with every molecule bonded to its neighbours. No skeleton, so it flops like a ragdoll once knocked out.',
  camera: 'The camera used for rendering and recording. Keyframe its location and target to animate shots.',
};
function objPanel(body, obj, tab) {
  const T = TYPES[obj.type];
  body.append(titleBlock(T.icon, obj.name, T.label, (v) => { if (v && v !== obj.name) { pushUndo(); obj.name = allObjs().some(x => x !== obj && x.name === v) ? uniqueName(v) : v; buildOutliner(); if (UI.timeline) UI.timeline.rebuildLabels(); } }));
  if (tab === 'object' && TYPE_HELP[obj.type]) body.append(el('div', { class: 'p-help' }, TYPE_HELP[obj.type]));
  for (const g of groupsOf(obj)) {
    if ((TAB_OF[g.id] || 'object') !== tab) continue;
    body.append(groupEl(obj.type + ':' + g.id, g.title, g.fields.map(fd => fieldRow(obj, fd))));
  }
  if (tab === 'physics' && obj.type === 'humanoid') body.append(anatomyGroup(obj));
  if (tab === 'object' && obj.type === 'humanoid') body.append(humanDefaultsGroup(obj));
  if (tab === 'physics' && obj.type !== 'humanoid' && obj.props.physics === 'molecular') body.append(el('div', { class: 'p-help' }, 'Molecular props are filled with bonded particles of the chosen material. Edit the material’s stiffness and tear limits in the Tissues tab.'));
  if (tab === 'object') {
    const btns = el('div', { class: 'motion-grid' });
    for (const m of MOTIONS) {
      if (!m.ok(obj)) continue;
      const b = el('button', { class: 'btn sm', title: m.desc, html: ICON[m.icon] || '' }, m.name);
      b.onclick = () => applyMotion(m.id);
      btns.append(b);
    }
    body.append(groupEl('motions', 'Motion presets', [el('div', { class: 'p-help', style: { margin: '2px 2px 6px' } }, 'Adds keyframes starting at the current frame. Edit them afterwards in the timeline.'), btns], false));
  }
}
function humanDefaultsGroup(obj) {
  const save = el('button', { class: 'btn sm primary', title: 'Every humanoid you add from now on starts with this one’s colors, body and physics settings' }, 'Make these my defaults');
  save.onclick = () => { HDEF.props = HDEF.pick(evalProps(obj, APP.frame)); if (HDEF.save()) toast('Saved. Every new humanoid now starts with these settings'); else toast('Could not save: browser storage is unavailable', true); buildProps(); };
  const reset = el('button', { class: 'btn sm', title: 'New humanoids go back to the built-in look' }, 'Reset to built-in');
  reset.disabled = !HDEF.props;
  reset.onclick = () => { HDEF.props = null; HDEF.save(); toast('New humanoids use the built-in defaults again'); buildProps(); };
  const apply = el('button', { class: 'btn sm', title: 'Give this humanoid your saved defaults (keeps where it stands and its keyframes)' }, 'Apply to this one');
  apply.disabled = !HDEF.props;
  apply.onclick = () => { pushUndo(); for (const k in HDEF.props) if (!(obj.anim && Object.keys(obj.anim).some(p => p === k || p.startsWith(k + '.')))) obj.props[k] = deepClone(HDEF.props[k]); changed(obj, true); UI.refreshAll(); toast('Applied your defaults'); };
  const applyAll = el('button', { class: 'btn sm', title: 'Give every humanoid in this scene your saved defaults' }, 'Apply to all in scene');
  applyAll.disabled = !HDEF.props;
  applyAll.onclick = () => { pushUndo(); for (const o of allObjs()) if (o.type === 'humanoid') { for (const k in HDEF.props) if (!(o.anim && Object.keys(o.anim).some(p => p === k || p.startsWith(k + '.')))) o.props[k] = deepClone(HDEF.props[k]); changed(o, true); } UI.refreshAll(); toast('Applied your defaults to every humanoid'); };
  const demo = el('input', { type: 'checkbox', 'aria-label': 'Use in demo scenes too' }); demo.checked = HDEF.demos;
  demo.onchange = () => { HDEF.demos = demo.checked; HDEF.save(); };
  const n = HDEF.props ? Object.keys(HDEF.props).length : 0;
  return groupEl('hdef', 'Defaults for new humanoids', [
    el('div', { class: 'p-help', style: { margin: '2px 2px 6px' } }, HDEF.props ? `Your defaults are on (${n} settings, including skin ${HDEF.props.skinColor} and inside ${HDEF.props.insideColor}). Every humanoid you add starts with them.` : 'Set this humanoid up the way you like, then save it. Every humanoid you add afterwards starts with the same colors, body and physics.'),
    el('div', { class: 'btn-row', style: { flexWrap: 'wrap' } }, save, apply, applyAll, reset),
    el('div', { class: 'row', title: 'Demo scenes normally keep their own colors (for example the red insides in the split). Tick this to use yours there too. Poses stay as the demo sets them.' }, el('label', null, 'Use in demo scenes too'), el('div', { class: 'ctl' }, demo), el('span')),
  ], false);
}
function tissueCounts(d) {
  if (d._counts) return d._counts;
  const c = new Map();
  for (let i = 0; i < d.count; i++) c.set(d.tissue[i], (c.get(d.tissue[i]) || 0) + 1);
  return (d._counts = c);
}
function anatomyGroup(obj) {
  const L = SIM.layout && SIM.layout.find(l => l.obj.id === obj.id);
  const kids = [];
  if (!L) kids.push(el('div', { class: 'p-help', style: { margin: '4px 2px' } }, 'The anatomy is generated the first time you press Play or scrub the timeline.'));
  else {
    const d = L.data, counts = tissueCounts(d);
    kids.push(el('div', { class: 'stat-line' }, `${d.count.toLocaleString()} molecules · ${(d.bonds.length / 2).toLocaleString()} bonds · ${(d.skin.pos.length / 3).toLocaleString()} skin vertices`));
    const lg = el('div', { class: 'legend' });
    for (const [t, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
      lg.append(el('span', { title: TISSUES[t].name }, el('i', { class: 'swatch', style: { background: tissueColor(t) } }), `${TISSUES[t].name}`, el('b', { class: 'cnt' }, n.toLocaleString())));
    }
    kids.push(lg);
  }
  const reroll = el('button', { class: 'btn sm', html: ICON.reset }, 'New random body');
  reroll.onclick = () => { pushUndo(); setProp(obj, 'seed', 1 + Math.floor(Math.random() * 99998)); };
  const xr = el('button', { class: 'btn sm', html: ICON.xray }, 'Look inside');
  xr.onclick = () => setShading(MOL.shading === 'xray' ? 'skin' : 'xray');
  kids.push(el('div', { class: 'btn-row' }, reroll, xr));
  return groupEl('anatomy', 'Anatomy', kids, true);
}
function scenePanel(body) {
  const W = APP.scene.world;
  body.append(titleBlock('world', APP.scene.name, 'Scene', (v) => { if (v) { APP.scene.name = v; $('#scene-name').value = v; } }));
  for (const g of WORLD_GROUPS) body.append(groupEl('world:' + g.id, g.title, g.fields.map(fd => fieldRow(W, fd))));
  const info = el('div', { class: 'stat-line', id: 'cache-info' });
  const b1 = el('button', { class: 'btn sm', html: ICON.reset }, 'Reset'); b1.onclick = resetSim;
  const b2 = el('button', { class: 'btn sm', html: ICON.bake }, 'Simulate all'); b2.onclick = bakeAll;
  const b3 = el('button', { class: 'btn sm', html: ICON.trash }, 'Clear cache'); b3.onclick = clearCache;
  body.append(groupEl('world:cache', 'Simulation cache', [el('div', { class: 'p-help', style: { margin: '2px' } }, 'Frames are simulated once and cached, so you can scrub back and forth. Any edit clears the cache.'), info, el('div', { class: 'btn-row' }, b1, b2, b3)]));
  PROPS.rows.push({ obj: null, fn: () => { info.textContent = cacheSummary(); } });
}
function cacheSummary() {
  const c = SIM.cache;
  if (!SIM.bodyObjs().length) return 'No molecular bodies in the scene.';
  if (c.end < c.start) return 'Nothing simulated yet.';
  return `Frames ${c.start}–${c.end} cached · ${(c.bytes / 1048576).toFixed(0)} MB${c.full ? ' (memory limit reached)' : ''}`;
}

/* ---------- tissues: per-scene overrides of every tissue and material ---------- */
const TISSUE_FIELDS = [
  { key: 'stiffness', label: 'Stiffness', min: 0.02, max: 1, step: 0.01, help: 'How hard the bonds pull back to their rest length.' },
  { key: 'stretch', label: 'Tear stretch', min: 0.01, max: 3, step: 0.01, help: 'Strain (fraction of rest length) at which a bond snaps when pulled.' },
  { key: 'compress', label: 'Crush limit', min: 0.01, max: 1, step: 0.01, help: 'Strain at which a bond fails when squashed.' },
  { key: 'density', label: 'Density', min: 0.1, max: 10, step: 0.01, unit: 'g/cm³', help: 'Heavier tissue carries more momentum.' },
  { key: 'rigidity', label: 'Shape memory', min: 0, max: 1, step: 0.01, help: 'How strongly a piece keeps its shape (bone 1, organs low).' },
  { key: 'shatter', label: 'Toughness', min: 0.1, max: 10, step: 0.05, help: 'Multiplies the impact speed needed to blast molecules loose.' },
];
function tissueOverride(id) { const t = APP.scene.tissues; return t && t[id]; }
function tissueVal(i, key) { const t = TISSUES[i], o = tissueOverride(t.id); return o && o[key] != null ? o[key] : t[key]; }
function tissueColor(i) { return tissueVal(i, 'color'); }
function tissueTable() {
  if (!APP.scene.tissues || !Object.keys(APP.scene.tissues).length) return null;
  return TISSUES.map((t, i) => Object.assign({}, t, APP.scene.tissues[t.id] || {}));
}
function setTissue(i, key, v, final) {
  const id = TISSUES[i].id;
  APP.scene.tissues = APP.scene.tissues || {};
  const o = APP.scene.tissues[id] = APP.scene.tissues[id] || {};
  o[key] = v;
  if (TISSUES[i][key] === v) delete o[key];
  if (!Object.keys(o).length) delete APP.scene.tissues[id];
  if (key === 'color') { MOL.recolor(); APP.dirtyEval = true; }
  else SIM.invalidate();
  if (final) syncProps();
}
function tissuePanel(body) {
  body.append(titleBlock('anatomy', 'Tissues & materials', 'This scene'));
  body.append(el('div', { class: 'p-help' }, 'Every molecule belongs to a tissue. Neighbouring molecules are joined by bonds whose stiffness and tear limits come from the softer of the two tissues. Skin is stretchy; fat and organs tear easily. Changes rebuild the bodies in this scene.'));
  const kinds = [['tissue', 'Body tissues'], ['organ', 'Organs'], ['material', 'Prop materials']];
  for (const [kind, title] of kinds) {
    body.append(el('div', { class: 'section-t', style: { margin: '12px 12px 4px' } }, title));
    TISSUES.forEach((t, i) => {
      if (t.kind !== kind) return;
      const rows = [];
      for (const f of TISSUE_FIELDS) {
        const row = el('div', { class: 'row' }, el('label', { title: f.help, class: 'has-help' }, f.label));
        const nf = numberField({ label: `${t.name} ${f.label}`, step: f.step, min: f.min, max: f.max, unit: f.unit, onStart: pushUndo, onChange: (v) => setTissue(i, f.key, v), onCommit: (v) => setTissue(i, f.key, v, true) });
        row.append(el('div', { class: 'ctl' }, nf.el), el('span'));
        PROPS.rows.push({ obj: null, fn: () => { nf.set(tissueVal(i, f.key)); nf.state(tissueOverride(t.id) && tissueOverride(t.id)[f.key] != null ? 'keyed' : ''); } });
        rows.push(row);
      }
      const col = el('input', { type: 'color', class: 'colorf', 'aria-label': t.name + ' color' });
      let started = false;
      col.addEventListener('input', () => { if (!started) { pushUndo(); started = true; } setTissue(i, 'color', col.value); });
      col.addEventListener('change', () => { started = false; setTissue(i, 'color', col.value, true); });
      rows.push(el('div', { class: 'row' }, el('label', null, 'Color'), el('div', { class: 'ctl' }, col), el('span')));
      const reset = el('button', { class: 'btn sm', html: ICON.reset }, 'Reset');
      reset.onclick = () => { if (!tissueOverride(t.id)) return; pushUndo(); delete APP.scene.tissues[t.id]; MOL.recolor(); SIM.invalidate(); syncProps(); };
      rows.push(el('div', { class: 'btn-row' }, reset));
      const sw = el('i', { class: 'swatch' });
      PROPS.rows.push({ obj: null, fn: () => { const c = tissueColor(i); sw.style.background = c; if (!started) col.value = c; } });
      body.append(groupEl('tis:' + t.id, [sw, ' ', t.name], rows, false, el('span', { class: 'gsub' }, `stretch ${(tissueVal(i, 'stretch') * 100).toFixed(0)}%`)));
    });
  }
  const resetAll = el('button', { class: 'btn', html: ICON.reset }, 'Reset every tissue');
  resetAll.onclick = () => { if (!tissueTable()) return toast('Tissues are already at their defaults'); pushUndo(); APP.scene.tissues = {}; MOL.recolor(); SIM.invalidate(); buildProps(); };
  body.append(el('div', { class: 'btn-row', style: { padding: '10px 12px' } }, resetAll));
}

/* ---------- render & export panel ---------- */
const OUT = { res: '1080', useCam: true, fps: 'scene', quality: 'high', pixelRatio: 'auto', format: 'mp4', cw: 1920, ch: 1080, zoom: 1, guide: true, trimS: -1, trimE: -1 };
// output sizes: every common platform crop, plus your own
const OUT_PRESETS = [
  ['General', [['720', '720p HD · 1280 × 720 (16:9)', 1280, 720], ['1080', '1080p Full HD · 1920 × 1080 (16:9)', 1920, 1080], ['1440', '1440p QHD · 2560 × 1440 (16:9)', 2560, 1440], ['2160', '4K UHD · 3840 × 2160 (16:9)', 3840, 2160], ['cinema', 'Cinema wide · 2560 × 1080 (21:9)', 2560, 1080], ['square', 'Square · 1080 × 1080 (1:1)', 1080, 1080], ['vertical', 'Vertical · 1080 × 1920 (9:16)', 1080, 1920]]],
  ['YouTube', [['yt', 'YouTube video · 1920 × 1080 (16:9)', 1920, 1080], ['yt4k', 'YouTube 4K · 3840 × 2160 (16:9)', 3840, 2160], ['shorts', 'YouTube Shorts · 1080 × 1920 (9:16)', 1080, 1920], ['ytthumb', 'YouTube thumbnail · 1280 × 720', 1280, 720]]],
  ['Instagram', [['ig-reel', 'Instagram Reels & Stories · 1080 × 1920 (9:16)', 1080, 1920], ['ig-portrait', 'Instagram portrait post · 1080 × 1350 (4:5)', 1080, 1350], ['ig-square', 'Instagram square post · 1080 × 1080 (1:1)', 1080, 1080], ['ig-land', 'Instagram landscape post · 1080 × 566 (1.91:1)', 1080, 566]]],
  ['TikTok & others', [['tiktok', 'TikTok · 1080 × 1920 (9:16)', 1080, 1920], ['x', 'X / Twitter · 1280 × 720 (16:9)', 1280, 720], ['x-sq', 'X / Twitter square · 1080 × 1080', 1080, 1080], ['fb', 'Facebook feed · 1080 × 1350 (4:5)', 1080, 1350], ['fb-story', 'Facebook & Snapchat stories · 1080 × 1920', 1080, 1920], ['pin', 'Pinterest · 1000 × 1500 (2:3)', 1000, 1500], ['li', 'LinkedIn · 1920 × 1080 (16:9)', 1920, 1080]]],
  ['Other', [['viewport', 'Viewport size', 0, 0], ['custom', 'Custom size…', 0, 0]]],
];
function outPreset(id) { for (const [, list] of OUT_PRESETS) for (const p of list) if (p[0] === id) return p; return null; }
try { Object.assign(OUT, JSON.parse(localStorage.getItem('shatterbond.output') || '{}')); } catch (e) { /* ignore */ }
function saveOut() { try { localStorage.setItem('shatterbond.output', JSON.stringify(OUT)); } catch (e) { /* ignore */ } }
function selRow(label, value, opts, onChange, help) {
  const s = el('select', { class: 'selectf', 'aria-label': label });
  for (const [v, t] of opts) s.append(el('option', { value: v }, t));
  s.value = value; s.onchange = () => onChange(s.value);
  return el('div', { class: 'row', title: help || null }, el('label', null, label), el('div', { class: 'ctl' }, s), el('span'));
}
function groupedSel(label, value, onChange, help) {
  const s = el('select', { class: 'selectf', 'aria-label': label });
  for (const [g, list] of OUT_PRESETS) { const og = el('optgroup', { label: g }); for (const [v, t] of list) og.append(el('option', { value: v }, t)); s.append(og); }
  s.value = outPreset(value) ? value : '1080'; s.onchange = () => onChange(s.value);
  return el('div', { class: 'row', title: help || null }, el('label', null, label), el('div', { class: 'ctl' }, s), el('span'));
}
// the export frame drawn over the viewport: what is outside it is not in the video
function updateCropGuide() {
  if (!APP.scene || !R.vp) return;
  let g = $('#crop-guide');
  const [w, h] = outSize(), vp = R.vp, vw = Math.max(1, vp.clientWidth), vh = Math.max(1, vp.clientHeight);
  // shown when the viewport is what gets exported: looking through the scene camera, or exporting the free view
  const show = OUT.guide !== false && OUT.res !== 'viewport' && !APP.renderMode && (APP.camView || !OUT.useCam || !sceneCamObj());
  if (!show) { if (g) g.remove(); return; }
  if (!g) { g = el('div', { id: 'crop-guide' }, el('div', { class: 'cg-box' }, el('span', { class: 'cg-lab' }))); R.vp.append(g); }
  const fr = cropFrame(w / h, vw / vh), bw = vw * fr.w, bh = vh * fr.h;
  const box = g.firstChild; box.style.width = bw + 'px'; box.style.height = bh + 'px'; box.style.left = (vw - bw) / 2 + 'px'; box.style.top = (vh - bh) / 2 + 'px';
  const p = outPreset(OUT.res); box.firstChild.textContent = (p && OUT.res !== 'custom' ? p[1].split(' · ')[0] + ' · ' : '') + w + ' × ' + h + (OUT.zoom > 1.001 ? ' · ' + (+OUT.zoom).toFixed(2) + '×' : '');
}
function renderPanel(body) {
  body.append(titleBlock('render', 'Render & export', ''));
  const shade = el('div', { class: 'seg' });
  for (const s of SHADINGS) { const b = el('button', { class: 'btn sm' + (MOL.shading === s.id ? ' on' : ''), html: ICON[s.icon] }, s.label); b.onclick = () => { setShading(s.id); buildProps(); }; shade.append(b); }
  body.append(groupEl('r:shade', 'Viewport shading', [shade, el('div', { class: 'p-help', style: { margin: '4px 2px' } }, 'Renders and videos use the same shading as the viewport.')]));
  const cam = sceneCamObj(), cams = camList(), shots = camShots(), pin = pinnedCam();
  const viewFrom = !cam || !OUT.useCam ? 'view' : pin ? pin.id : shots.length > 1 ? 'shots' : cam.id;
  const st = el('button', { class: 'btn primary', html: ICON.image }, 'Render image');
  st.onclick = () => renderStill();
  const vid = el('button', { class: 'btn primary', html: ICON.film }, 'Export video');
  vid.onclick = () => recordVideo();
  body.append(groupEl('r:out', 'Output', [
    groupedSel('Size & crop', OUT.res, (v) => { OUT.res = v; saveOut(); updateCropGuide(); buildProps(); }, 'Pick a platform and the video is framed for it. The frame in the viewport shows exactly what gets exported.'),
    OUT.res === 'custom' ? el('div', { class: 'row' }, el('label', null, 'Width × height'), el('div', { class: 'ctl', style: { display: 'flex', gap: '6px' } },
      ...[['cw', 'Width'], ['ch', 'Height']].map(([k, lab]) => { const nf = numberField({ label: lab, step: 2, min: 64, max: 7680, int: true, value: OUT[k], onChange: (v) => { OUT[k] = Math.round(v); updateCropGuide(); }, onCommit: (v) => { OUT[k] = Math.round(v); saveOut(); updateCropGuide(); } }); nf.set(OUT[k]); return nf.el; })), el('span')) : null,
    (() => { const nf = numberField({ label: 'Crop zoom', step: 0.05, min: 1, max: 4, value: OUT.zoom || 1, onChange: (v) => { OUT.zoom = v; updateCropGuide(); }, onCommit: (v) => { OUT.zoom = v; saveOut(); updateCropGuide(); } }); nf.set(OUT.zoom || 1);
      return el('div', { class: 'row', title: 'Punch in on the centre of the frame (1 = no zoom).' }, el('label', null, 'Crop zoom'), el('div', { class: 'ctl' }, nf.el), el('span')); })(),
    (() => { const c = el('input', { type: 'checkbox', 'aria-label': 'Show crop frame' }); c.checked = OUT.guide !== false; c.onchange = () => { OUT.guide = c.checked; saveOut(); updateCropGuide(); };
      return el('div', { class: 'row', title: 'Dims everything outside the exported frame in the viewport.' }, el('label', null, 'Show crop frame'), el('div', { class: 'ctl' }, c), el('span')); })(),
    (() => { const [fs, fe] = frameRange();
      const mk = (k, lab, dflt) => { const nf = numberField({ label: lab, step: 1, min: fs, max: fe, int: true, value: OUT[k] >= 0 ? OUT[k] : dflt, onCommit: (v) => { OUT[k] = Math.round(v); saveOut(); } }); nf.set(OUT[k] >= 0 ? OUT[k] : dflt); return nf.el; };
      const reset = el('button', { class: 'btn sm', title: 'Export the whole scene range' }, 'All'); reset.onclick = () => { OUT.trimS = OUT.trimE = -1; saveOut(); buildProps(); };
      return el('div', { class: 'row', title: 'Only export part of the timeline.' }, el('label', null, 'Export frames'), el('div', { class: 'ctl', style: { display: 'flex', gap: '6px', alignItems: 'center' } }, mk('trimS', 'From frame', fs), mk('trimE', 'To frame', fe), reset), el('span')); })(),
    selRow('View from', viewFrom, [...(shots.length > 1 ? [['shots', 'Shot list (cuts between cameras)']] : []), ...cams.map(o => [o.id, `Camera: ${o.name}`]), ...(cams.length ? [] : [['none', 'Scene camera (none yet)']]), ['view', 'Current viewport']],
      (v) => { if (v === 'none') return; OUT.useCam = v !== 'view'; if (v === 'shots') setPinnedCam(''); else if (v !== 'view') setPinnedCam(v); saveOut(); updateCropGuide(); if (APP.camView) { R.camSync = null; updateCamLabel(); } buildProps(); }, 'Which camera renders and videos are filmed from. Press C to look through it and see its crop frame.'),
    selRow('Video format', OUT.format, [['mp4', 'MP4 (H.264)'], ['webm', 'WebM (VP9)']], (v) => { OUT.format = v; saveOut(); }, 'MP4 opens in every editor and phone. WebM is smaller at the same quality.'),
    selRow('Video quality', OUT.quality, [['high', 'High'], ['med', 'Balanced'], ['low', 'Small file']], (v) => { OUT.quality = v; saveOut(); }),
    el('div', { class: 'p-help', style: { margin: '4px 2px' } }, 'Videos cover the scene’s frame range at the scene frame rate. Every frame is simulated and rendered one by one, so the file is perfectly smooth even if your computer is slow.'),
    el('div', { class: 'btn-row' }, st, vid),
    cam ? null : (() => { const b = el('button', { class: 'btn sm', html: ICON.camera }, 'Add a camera at this view'); b.onclick = () => addCameraFromView(); return b; })(),
  ]));
  {
    const ck = (label, key, help) => { const c = el('input', { type: 'checkbox', 'aria-label': label }); c.checked = !!FXS[key]; c.onchange = () => { FXS[key] = c.checked; FXS.user = true; saveFX(); APP.dirtyEval = true; VFX.valid = false; };
      return el('div', { class: 'row', title: help }, el('label', null, label), el('div', { class: 'ctl' }, c), el('span')); };
    const shut = numberField({ label: 'Shutter', step: 0.05, min: 0.05, max: 1, value: FXS.shutter, onCommit: (v) => { FXS.shutter = v; FXS.user = true; saveFX(); VFX.valid = false; } }); shut.set(FXS.shutter);
    body.append(groupEl('r:fx', 'Render effects', [
      ck('Motion blur', 'mblur', 'Fast things smear along their path, like a real camera. Shows in camera view (C) when the view is still, and in every render.'),
      el('div', { class: 'row', title: 'How much of each frame the shutter stays open: 0.5 is a classic film look, 1 smears the most.' }, el('label', null, 'Shutter'), el('div', { class: 'ctl' }, shut.el), el('span')),
      selRow('Blur quality', String(FXS.samples), [['4', 'Fast (4 samples)'], ['8', 'Good (8)'], ['16', 'Best (16)']], (v) => { FXS.samples = +v; FXS.user = true; saveFX(); VFX.valid = false; }, 'More samples give smoother motion blur and take longer to render.'),
      ck('Depth of field (all cameras)', 'dof', 'Things nearer or further than the camera\'s focus point go soft. Each camera can also switch it on by itself, with its own focus distance and blur amount (select the camera, Depth of field section). Those can be keyframed.'),
      el('div', { class: 'p-help', style: { margin: '4px 2px' } }, 'Off on slower machines to keep things smooth. The automatic performance check turns them on when your graphics card is strong enough.'),
    ]));
  }
  body.append(groupEl('r:perf', 'Performance', [
    ...perfPanelRows(),
    selRow('Cache memory', String(Math.round(SIM.budget / 1048576)), [['768', '768 MB'], ['1536', '1.5 GB'], ['3072', '3 GB'], ['6144', '6 GB'], ['10240', '10 GB'], ['16384', '16 GB']],
      (v) => { SIM.budget = +v * 1048576; try { localStorage.setItem('shatterbond.cacheMB', v); } catch (e) { /* ignore */ } if (SIM.cache.full) { SIM.invalidate(); toast('Simulating again from the start with the bigger cache'); } toast(`Cache memory: ${+v >= 1024 ? (+v / 1024) + ' GB' : v + ' MB'}`); },
      'Simulated frames are kept in memory up to this size. Big cinematic scenes need several GB; pick less than your computer has free, or the browser can run out of memory. When it fills up the simulation stops and tells you.'),
    (() => { const c = el('input', { type: 'checkbox', 'aria-label': 'Compact cache' }); c.checked = SIM.compact !== false;
      c.onchange = () => { SIM.compact = c.checked; try { localStorage.setItem('shatterbond.cacheCompact', c.checked ? '1' : '0'); } catch (e) { /* ignore */ } SIM.invalidate(); toast(c.checked ? 'Compact cache on: about half the memory per frame' : 'Full precision cache'); };
      return el('div', { class: 'row', title: 'Stores cached frames in about half the memory, with rounding far smaller than a molecule. Parts of the scene that do not move are stored only once either way.' }, el('label', null, 'Compact cache'), el('div', { class: 'ctl' }, el('label', { class: 'checkf' }, c, 'Half the memory per frame')), el('span')); })(),
    el('div', { class: 'p-help', style: { margin: '4px 2px' } }, 'For speed: use Low resolution on bodies, fewer substeps in the Scene tab, or turn off shadows.'),
  ]));
}
function applyPixelRatio() {
  const v = OUT.pixelRatio === 'auto' ? Math.min(window.devicePixelRatio || 1, 1.75) : +OUT.pixelRatio * Math.min(window.devicePixelRatio || 1, 2);
  R.renderer.setPixelRatio(v); resizeViewport();
}
function addCameraFromView() {
  const c = R.camera, t = R.controls.target;
  const o = addObject('camera', { position: [c.position.x, c.position.y, c.position.z].map(v => +v.toFixed(3)), target: [t.x, t.y, t.z].map(v => +v.toFixed(3)), fov: +c.fov.toFixed(1) });
  toast(`Added ${o.name} at the current view`);
  return o;
}

/* ---------- navigation gizmo (top-right axis widget) ---------- */
const NAV = { hit: [], hover: null };
function drawNavGizmo() {
  const cv = $('#navgizmo'); const ctx = cv.getContext('2d');
  const W = cv.width, c = W / 2, rad = W * 0.33;
  ctx.clearRect(0, 0, W, W);
  const q = R.camera.quaternion.clone().invert();
  const axes = [
    { v: [1, 0, 0], col: '#ff5468', lab: 'X', view: 'right' }, { v: [0, 1, 0], col: '#7bd34a', lab: 'Y', view: 'top' }, { v: [0, 0, 1], col: '#4f8dff', lab: 'Z', view: 'front' },
    { v: [-1, 0, 0], col: '#ff5468', view: 'left' }, { v: [0, -1, 0], col: '#7bd34a', view: 'bottom' }, { v: [0, 0, -1], col: '#4f8dff', view: 'back' },
  ].map(a => { const p = new THREE.Vector3(...a.v).applyQuaternion(q); return Object.assign(a, { x: c + p.x * rad, y: c - p.y * rad, z: p.z }); });
  axes.sort((a, b) => a.z - b.z);
  NAV.hit = [];
  for (const a of axes) {
    const pos = !!a.lab, r = pos ? W * 0.085 : W * 0.06;
    if (pos) { ctx.strokeStyle = a.col; ctx.lineWidth = W * 0.018; ctx.beginPath(); ctx.moveTo(c, c); ctx.lineTo(a.x, a.y); ctx.stroke(); }
    ctx.beginPath(); ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
    const hov = NAV.hover === a.view;
    ctx.fillStyle = pos ? a.col : 'rgba(30,30,36,.55)'; ctx.fill();
    if (!pos) { ctx.strokeStyle = a.col; ctx.lineWidth = W * 0.014; ctx.stroke(); }
    if (hov) { ctx.strokeStyle = '#fff'; ctx.lineWidth = W * 0.016; ctx.stroke(); }
    if (pos) { ctx.fillStyle = '#121215'; ctx.font = `700 ${W * 0.085}px Inter, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(a.lab, a.x, a.y + W * 0.004); }
    NAV.hit.push({ x: a.x, y: a.y, r: r * 1.25, view: a.view, z: a.z });
  }
}
function initNavGizmo() {
  const cv = $('#navgizmo');
  const pick = (e) => {
    const r = cv.getBoundingClientRect(), sx = cv.width / r.width;
    const x = (e.clientX - r.left) * sx, y = (e.clientY - r.top) * sx;
    let best = null;
    for (const h of NAV.hit) if (Math.hypot(h.x - x, h.y - y) < h.r && (!best || h.z > best.z)) best = h;
    return best;
  };
  cv.addEventListener('pointermove', (e) => { const h = pick(e); NAV.hover = h ? h.view : null; cv.style.cursor = h ? 'pointer' : 'default'; });
  cv.addEventListener('pointerleave', () => { NAV.hover = null; });
  cv.addEventListener('click', (e) => { const h = pick(e); if (h) setView(h.view); });
}

/* ---------- help modals ---------- */
const SHORTCUTS = [
  ['View', [['Orbit', 'Left drag'], ['Pan', 'Right drag'], ['Zoom', 'Wheel'], ['Front / right / top', 'Numpad 1 3 7'], ['Opposite side', 'Ctrl + Numpad'], ['Scene camera', 'Numpad 0 or C'], ['Look through selected camera', 'C or Ctrl Numpad 0'], ['Next / previous camera', 'PgDn / PgUp'], ['Frame selected', 'F'], ['Frame everything', 'Home'], ['Toggle grid', 'H'], ['Clean view', 'Shift H']]],
  ['Objects', [['Add menu', 'Shift A'], ['Add humanoid', 'Shift H… menu'], ['Select / add to selection', 'Click / Shift click'], ['Select all / none', 'A / Alt A'], ['Move / rotate / scale', 'G / R / S'], ['Select tool', 'Q'], ['Duplicate', 'Shift D'], ['Delete', 'X or Delete'], ['Snap while dragging', 'Hold Ctrl'], ['Undo / redo', 'Ctrl Z / Ctrl Shift Z']]],
  ['Animation', [['Play / pause', 'Space'], ['Back to start', 'Shift ←'], ['Jump to end', 'Shift →'], ['Step one frame', '← / →'], ['Previous / next keyframe', '↓ / ↑'], ['Insert keyframe', 'I'], ['Delete keyframe', 'Alt I'], ['Delete selected keys (timeline)', 'X'], ['Zoom timeline', 'Wheel over timeline'], ['Pan timeline', 'Shift wheel or right drag']]],
  ['Simulation & output', [['Blast tool', 'B'], ['Bigger blast', 'Shift click'], ['Shading: skin / x-ray / tissue / molecules', '1 2 3 4'], ['Save to library', 'Ctrl S'], ['Scene library', 'Ctrl O'], ['Render image', 'F12'], ['Export video', 'Ctrl F12'], ['This list', '?']]],
];
function showShortcuts() {
  const b = el('div');
  for (const [t, list] of SHORTCUTS) {
    b.append(el('div', { class: 'section-t', style: { marginTop: '6px' } }, t));
    b.append(el('div', { class: 'keys' }, list.map(([a, k]) => el('div', null, el('span', null, a), el('kbd', null, k)))));
  }
  openModal('Keyboard shortcuts', b, [], { icon: 'help' });
}
function showAbout() {
  const p = (t) => el('p', { style: { margin: '0 0 10px', color: 'var(--fg2)', lineHeight: '1.55' } }, t);
  const b = el('div', null,
    p('Shatterbond builds every body out of thousands of molecules. Each molecule is bonded to up to 18 neighbours. Every frame the solver pulls bonds back toward their rest length and keeps each region of flesh loosely close to its shape. When a bond stretches or squashes past its tissue’s limit, it snaps for good.'),
    p('Bodies (adults, children, heavier builds, dogs and horses) are filled with soft tissue and organs: heart, lungs, liver, stomach, kidneys, intestines and bladder. Height, build, body fat, pose and a random seed reshape the body.'),
    p('A body can play an animation (walk, run, punch, a Mixamo clip and more): its skin and molecules follow a full skeleton (spine, shoulders, arms, legs and every finger) and it stays on its feet. Imported Mixamo clips are saved under Animation › Saved animations, so they are there in every scene. When something hits it, physics takes over from the pose it is in.'),
    p('A figure holds its pose until a hit knocks it out, then it goes completely limp. Fast impacts and sharp edges blast molecules loose, which is the purple cloud you see, and torn flesh clings together in sticky strands.'),
    p('Weapons and props are solid shapes that push molecules out of the way. Anything with keyframes moves exactly as animated, and molecular props break just like bodies. The simulation runs in a background thread and caches every frame so you can scrub through it.'),
  );
  openModal('How Shatterbond works', b, [{ label: 'Got it', primary: true }], { icon: 'info' });
}
function showTips() {
  const li = (t) => el('li', { style: { margin: '0 0 8px', color: 'var(--fg2)', lineHeight: '1.5' } }, t);
  const b = el('ul', { style: { margin: 0, paddingLeft: '18px' } },
    li('Press Space to play. The first play generates the anatomy, which takes a second or two.'),
    li('Pick a demo from the Scenes menu to see each weapon in action.'),
    li('Select anything and press I to keyframe it, move to another frame, change it, and press I again. Every value with a diamond next to it can be animated, even gravity and time scale.'),
    li('Turn on Auto-keying (the red dot in the timeline) to record a keyframe whenever you change a value.'),
    li('Use the Blast tool (B) and click while the simulation plays to blow molecules apart.'),
    li('Switch to X-ray (2) to watch the organs tear inside the body.'),
    li('Give a humanoid an animation under Animation. Mixamo clips: download as FBX from mixamo.com, then Import FBX on any humanoid.'),
    li('Several cameras: set each camera’s "Shot starts at frame" and renders cut between them. To look through one camera, select it and press C, or use the arrow next to Camera at the top right.'),
    li('Anchor a camera to an object under Follow an object in the camera settings: it can stay put and watch, or travel along with it.'),
    li('Motion blur and depth of field are in the Output panel, under Render effects.'),
    li('Ctrl+S saves the scene to your library in this browser. Export a .json file to keep it anywhere.'),
  );
  openModal('Quick start', b, [{ label: 'Start creating', primary: true }], { icon: 'info' });
}

function initUI() {
  buildMenus(); buildToolbar(); initGizmo(); initNavGizmo();
  applyGizmoSettings();
  $('#scene-name').addEventListener('change', (e) => { const v = e.target.value.trim(); if (v) { APP.scene.name = v; if (PROPS.tab === 'scene') buildProps(); } else e.target.value = APP.scene.name; });
  $('#scene-name').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') e.target.blur(); });
  $('#ol-add').onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(); showMenu(ADD_ITEMS(), r.left - 300, r.bottom + 4, e.currentTarget, { cols: true }); };
  $('#ol-del').onclick = () => deleteSelected();
  $('#side-toggle').onclick = () => $('#side').classList.toggle('open');
  // phones: the panels are a bottom sheet; a big play button sits on the viewport
  $('#sheet-grab').onclick = () => $('#side').classList.remove('open');
  const fab = $('#fab-play'), playSvg = S('<path d="M8 5v14l11-7z" fill="currentColor"/>'), pauseSvg = S('<path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/>');
  fab.innerHTML = playSvg; let fabOn = false;
  fab.onclick = () => togglePlay();
  setInterval(() => { if (fabOn !== !!APP.playing) { fabOn = !!APP.playing; fab.innerHTML = fabOn ? pauseSvg : playSvg; fab.setAttribute('aria-label', fabOn ? 'Pause' : 'Play'); } }, 200);
  // selecting something on a phone opens its properties in the sheet
  let swipeY = null;
  $('#side').addEventListener('touchstart', (e) => { if (e.target.closest('#sheet-grab, .panel-h, #prop-tabs')) swipeY = e.touches[0].clientY; }, { passive: true });
  $('#side').addEventListener('touchend', (e) => { if (swipeY != null && e.changedTouches[0].clientY - swipeY > 60) $('#side').classList.remove('open'); swipeY = null; }, { passive: true });
}
