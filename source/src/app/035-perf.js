/* ===================== performance settings and auto-detect =====================
 * Presets bundle the settings that cost the most: viewport sharpness, shadows, molecule bead detail,
 * the merged goo surface and a frame cap. "Auto" reads the graphics card and CPU, picks a preset,
 * then watches the real frame rate for a few seconds and steps down if the machine struggles. */
const PERF_TIERS = {
  ultra:    { label: 'Ultra',    pr: 'auto', shadows: 'soft', shadowRes: 4096, beads: 'high', lodAt: 90000, beadShadowMax: 160000, blobMax: 12000, fpsCap: 0 },
  high:     { label: 'High',     pr: 'auto', shadows: 'soft', shadowRes: 2048, beads: 'high', lodAt: 40000, beadShadowMax: 80000, blobMax: 10000, fpsCap: 0 },
  balanced: { label: 'Balanced', pr: '1',    shadows: 'soft', shadowRes: 2048, beads: 'auto', lodAt: 24000, beadShadowMax: 60000, blobMax: 7000, fpsCap: 0 },
  low:      { label: 'Low',      pr: '0.75', shadows: 'hard', shadowRes: 1024, beads: 'low',  lodAt: 8000,  beadShadowMax: 20000, blobMax: 3500, fpsCap: 60 },
  potato:   { label: 'Lowest',   pr: '0.5',  shadows: 'off',  shadowRes: 1024, beads: 'low',  lodAt: 0,     beadShadowMax: 0,     blobMax: 0,    fpsCap: 30 },
};
const PERF = Object.assign({ preset: 'auto', gpu: 'high-performance', aa: true, physics: 'cpu', custom: null, autoTier: null, detected: null }, PERF_TIERS.balanced);
try { Object.assign(PERF, JSON.parse(localStorage.getItem('shatterbond.perf') || '{}')); } catch (e) { /* storage unavailable */ }
function savePerf() { try { const o = {}; for (const k of ['preset', 'gpu', 'aa', 'physics', 'custom', 'autoTier', 'pr', 'shadows', 'shadowRes', 'beads', 'lodAt', 'beadShadowMax', 'blobMax', 'fpsCap']) o[k] = PERF[k]; localStorage.setItem('shatterbond.perf', JSON.stringify(o)); } catch (e) { /* ignore */ } }

// what the machine has: graphics card name, its class, CPU threads, memory, WebGPU
function detectHardware() {
  const info = { gpu: 'Unknown graphics', cls: 'unknown', threads: navigator.hardwareConcurrency || 4, memGB: navigator.deviceMemory || null, webgpu: !!navigator.gpu };
  try {
    const gl = R.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
    const raw = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    // ANGLE wraps the name: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 (0x00002786) Direct3D11 vs_5_0 ps_5_0, D3D11)"
    info.raw = raw || '';
    let name = info.raw.replace(/^ANGLE \(/, '').replace(/\)$/, '');
    const parts = name.split(', '); name = parts.length > 1 ? parts[1] : parts[0];
    const vk = /^(?:Vulkan|OpenGL|Metal)[^(]*\((.*)\)\s*$/.exec(name); if (vk) name = vk[1];
    name = name.replace(/\s*\(0x[0-9a-fA-F]+\)/g, '').replace(/\s*Direct3D.*$/, '').replace(/\s*OpenGL.*$/, '').trim();
    info.gpu = name || 'Unknown graphics';
  } catch (e) { /* no context info */ }
  const g = (info.gpu + ' ' + (info.raw || '')).toLowerCase();
  if (/swiftshader|llvmpipe|software|basic render|microsoft basic/.test(g)) info.cls = 'software';
  else if (/rtx\s*(30|40|50)\d\d|rtx\s*a\d|radeon rx\s*(6[789]|7\d|9\d)\d\d|apple m\d (pro|max|ultra)|quadro rtx|titan/.test(g)) info.cls = 'fast';
  else if (/geforce|rtx|gtx|radeon rx|radeon pro|arc\s*a|quadro|firepro/.test(g)) info.cls = 'discrete';
  else if (/intel|uhd|iris|radeon(tm)? graphics|vega \d|adreno|mali|apple m\d|apple gpu/.test(g)) info.cls = 'integrated';
  return info;
}
function tierForHardware(h) {
  if (h.cls === 'software') return 'potato';
  if (h.cls === 'fast') return h.threads >= 8 ? 'ultra' : 'high';
  if (h.cls === 'discrete') return 'high';
  if (h.cls === 'integrated') return h.threads <= 4 || (h.memGB && h.memGB <= 4) ? 'low' : 'balanced';
  return 'balanced';
}
const TIER_ORDER = ['ultra', 'high', 'balanced', 'low', 'potato'];
function perfTierNow() { return PERF.preset === 'auto' ? (PERF.autoTier || 'balanced') : PERF.preset; }
function applyPerfTier(tier, opts = {}) {
  const T = PERF_TIERS[tier]; if (!T) return;
  if (tier !== 'custom') for (const k in T) if (k !== 'label') PERF[k] = T[k];
  if (PERF.preset === 'auto' && tier !== 'custom' && typeof fxAutoApply === 'function') fxAutoApply(tier);
  OUT.pixelRatio = PERF.pr; if (typeof saveOut === 'function') saveOut();
  applyPerf();
  if (!opts.quiet) savePerf();
}
// push the current settings into the renderer
function applyPerf() {
  if (!R.renderer) return;
  const r = R.renderer;
  const wantOn = PERF.shadows !== 'off', type = PERF.shadows === 'hard' ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
  if (r.shadowMap.enabled !== wantOn || r.shadowMap.type !== type) {
    r.shadowMap.enabled = wantOn; r.shadowMap.type = type; r.shadowMap.needsUpdate = true;
    R.scene.traverse((o) => { const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []; for (const m of ms) m.needsUpdate = true; });
  }
  const sz = PERF.shadowRes | 0;
  if (R.sun && R.sun.shadow.mapSize.x !== sz) { R.sun.shadow.mapSize.set(sz, sz); if (R.sun.shadow.map) { R.sun.shadow.map.dispose(); R.sun.shadow.map = null; } }
  if (typeof applyPixelRatio === 'function') applyPixelRatio();
  if (MOL.bBudget > PERF.blobMax && PERF.blobMax > 0) MOL.bBudget = PERF.blobMax;
  APP.dirtyEval = true; if (typeof _dispKey !== 'undefined') _dispKey = '';
}
// auto mode: pick from the hardware, then watch the real frame rate and step down if needed
const PERF_WATCH = { t0: 0, frames: 0, slow: 0, done: false };
function initPerf() {
  PERF.detected = detectHardware();
  if (PERF.preset === 'auto') {
    if (!PERF.autoTier) PERF.autoTier = tierForHardware(PERF.detected);
    applyPerfTier(PERF.autoTier, { quiet: true });
  } else if (PERF.preset !== 'custom') applyPerfTier(PERF.preset, { quiet: true });
  else applyPerf();
  if (PERF.physics === 'auto' || PERF.physics === 'gpu') { /* resolved by the physics backend when it starts */ }
}
function perfWatch(now, frameMs) {
  if (PERF.preset !== 'auto' || PERF_WATCH.done || APP.recording || document.hidden) return;
  if (!PERF_WATCH.t0) { PERF_WATCH.t0 = now; return; }
  if (now - PERF_WATCH.t0 < 2500) return; // let the scene settle
  PERF_WATCH.frames++; if (frameMs > 40) PERF_WATCH.slow++;
  if (PERF_WATCH.frames < 240) return;
  PERF_WATCH.done = true;
  const i = TIER_ORDER.indexOf(PERF.autoTier);
  if (PERF_WATCH.slow / PERF_WATCH.frames > 0.4 && i >= 0 && i < TIER_ORDER.length - 1) {
    PERF.autoTier = TIER_ORDER[i + 1]; applyPerfTier(PERF.autoTier); savePerf();
    toast(`Auto performance: switched to ${PERF_TIERS[PERF.autoTier].label} for smoother playback`);
    PERF_WATCH.done = false; PERF_WATCH.t0 = now; PERF_WATCH.frames = PERF_WATCH.slow = 0;
  }
}
function perfPanelRows() {
  const h = PERF.detected || detectHardware();
  const tierNow = perfTierNow();
  const rows = [];
  rows.push(el('div', { class: 'p-help', style: { margin: '2px 2px 6px' } },
    `Detected: ${h.gpu} · ${h.threads} CPU threads${h.memGB ? ' · ' + h.memGB + ' GB+ memory' : ''}${h.webgpu ? ' · WebGPU available' : ''}.` + (PERF.preset === 'auto' ? ` Auto chose ${PERF_TIERS[tierNow].label}.` : '')));
  rows.push(selRow('Quality preset', PERF.preset, [['auto', 'Auto (detect my computer)'], ...TIER_ORDER.map(t => [t, PERF_TIERS[t].label]), ['custom', 'Custom']], (v) => {
    PERF.preset = v;
    if (v === 'auto') { PERF.autoTier = tierForHardware(PERF.detected || detectHardware()); PERF_WATCH.done = false; PERF_WATCH.t0 = 0; PERF_WATCH.frames = PERF_WATCH.slow = 0; applyPerfTier(PERF.autoTier); }
    else if (v !== 'custom') applyPerfTier(v);
    savePerf(); buildProps();
  }, 'Auto looks at your graphics card and processor, then keeps an eye on the frame rate and steps down if playback stutters.'));
  const custom = (fn) => (v) => { fn(v); PERF.preset = 'custom'; savePerf(); applyPerf(); buildProps(); };
  rows.push(selRow('Physics runs on', PERF.physics, [['cpu', 'CPU (exact, default)'], ['gpu', 'GPU (experimental, much faster for big scenes)'], ['auto', 'Auto (GPU for big scenes when available)']], (v) => { PERF.physics = v; savePerf(); if (typeof SIM !== 'undefined') SIM.invalidate(); buildProps(); },
    'The GPU solver runs the physics on your graphics card with WebGPU. It is much faster for high molecule counts, and cuts and squishes look slightly different.'));
  if (PERF.physics !== 'cpu') {
    const ph = (typeof SIM !== 'undefined' && SIM.physics) || null;
    let msg = '', warn = false;
    if (!h.webgpu) { msg = 'WebGPU is not available in this browser, so physics stays on the CPU.'; warn = true; }
    else if (ph && ph.gpu === 'failed') { msg = 'The GPU solver could not start, so physics runs on the CPU. ' + (ph.err || ''); warn = true; }
    else if (ph && ph.on) msg = 'Physics is running on the GPU' + (ph.adapter ? ' (' + ph.adapter + ')' : '') + '.';
    else if (ph && ph.gpu === 'on') msg = PERF.physics === 'auto' ? 'This scene is small, so it runs on the CPU. Scenes over 40,000 molecules use the GPU.' : 'Frames with loose cannonballs run on the CPU.';
    else msg = 'The GPU solver starts with the next simulation.';
    rows.push(el('div', { class: 'p-help', style: { margin: '2px 2px 6px', color: warn ? 'var(--warn, #c58a00)' : '' } }, msg));
  }
  rows.push(selRow('Graphics card', PERF.gpu, [['high-performance', 'Fastest (dedicated GPU)'], ['low-power', 'Power saving (integrated GPU)'], ['default', 'Let the system decide']], (v) => { PERF.gpu = v; savePerf(); buildProps(); toast('Restart Shatterbond (or reload the page) to switch graphics card'); },
    'Which graphics card to ask for on laptops with two. Applies after a restart. Windows can also force it in Settings > System > Display > Graphics.'));
  rows.push(selRow('Viewport sharpness', OUT.pixelRatio, [['auto', 'Automatic'], ['1', 'Standard'], ['0.75', 'Faster'], ['0.5', 'Fastest']], custom((v) => { OUT.pixelRatio = v; PERF.pr = v; saveOut(); })));
  rows.push(selRow('Shadows', PERF.shadows, [['soft', 'Soft'], ['hard', 'Hard (faster)'], ['off', 'Off (fastest)']], custom((v) => { PERF.shadows = v; })));
  rows.push(selRow('Shadow detail', String(PERF.shadowRes), [['4096', 'Very high'], ['2048', 'High'], ['1024', 'Normal']], custom((v) => { PERF.shadowRes = +v; })));
  rows.push(selRow('Molecule beads', PERF.beads, [['high', 'Round (detailed)'], ['auto', 'Automatic'], ['low', 'Simple (fastest)']], custom((v) => { PERF.beads = v; PERF.lodAt = v === 'high' ? 1e9 : v === 'low' ? 0 : 24000; })));
  rows.push(selRow('Merged goo surface', String(PERF.blobMax), [['12000', 'Full detail'], ['7000', 'Normal'], ['3500', 'Light'], ['0', 'Off (beads only)']], custom((v) => { PERF.blobMax = +v; MOL.bBudget = Math.min(MOL.bBudget || 8000, Math.max(1500, +v)); })));
  rows.push(selRow('Frame rate cap', String(PERF.fpsCap), [['0', 'Unlimited'], ['60', '60 fps'], ['30', '30 fps (saves battery)']], custom((v) => { PERF.fpsCap = +v; })));
  rows.push(selRow('Antialiasing', PERF.aa ? 'on' : 'off', [['on', 'On'], ['off', 'Off (faster)']], (v) => { PERF.aa = v === 'on'; savePerf(); toast('Restart Shatterbond (or reload the page) to apply antialiasing'); }));
  return rows;
}
