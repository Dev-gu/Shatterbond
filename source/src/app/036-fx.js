/* ===================== render effects: motion blur and depth of field =====================
 * Motion blur renders several moments inside the shutter (molecules blended between simulated frames,
 * weapons and cameras evaluated at the in-between time) and averages them. Depth of field blurs by
 * distance from the camera's focus point (the camera's "Looks at" point unless set by hand).
 * Both are off on slower machines; the automatic performance check turns them on for strong graphics cards.
 * In the editor they show while looking through the scene camera; renders and videos always use them. */
const FXS = { mblur: false, dof: false, shutter: 0.5, samples: 8, user: false };
try { Object.assign(FXS, JSON.parse(localStorage.getItem('shatterbond.fx') || '{}')); } catch (e) { /* storage unavailable */ }
function saveFX() { try { localStorage.setItem('shatterbond.fx', JSON.stringify(FXS)); } catch (e) { /* ignore */ } }
// what the automatic check picks for a tier (only until the user changes the effects themselves)
function fxForTier(tier) { const on = tier === 'ultra' || tier === 'high'; return { mblur: on, dof: on }; }
function fxAutoApply(tier) { if (FXS.user) return; Object.assign(FXS, fxForTier(tier)); saveFX(); }

const POSTFX = {
  rt: null, acc: null, w: 0, h: 0, quad: null, scene: null, cam: null, matDof: null, matCopy: null, matAcc: null,
  init() {
    if (this.quad) return;
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene = new THREE.Scene();
    const vs = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
    // depth of field: gather blur with a golden-angle spiral; each tap's own blur size limits how far it
    // can spread, so sharp things in front are not smeared over the background
    this.matDof = new THREE.ShaderMaterial({
      uniforms: { tColor: { value: null }, tDepth: { value: null }, near: { value: 0.05 }, far: { value: 600 }, focus: { value: 4 }, aper: { value: 8 }, res: { value: new THREE.Vector2(1, 1) }, maxR: { value: 14 } },
      vertexShader: vs, depthTest: false, depthWrite: false, toneMapped: false,
      fragmentShader: `#include <packing>
        uniform sampler2D tColor; uniform sampler2D tDepth; uniform float near, far, focus, aper, maxR; uniform vec2 res; varying vec2 vUv;
        float viewZ(vec2 uv){ return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, near, far); }
        float coc(float z){ return clamp(aper * abs(z - focus) / max(z, 1e-3), 0.0, maxR); }
        void main(){
          float z0 = viewZ(vUv), c0 = coc(z0);
          vec4 base = texture2D(tColor, vUv);
          if (c0 < 0.5) { gl_FragColor = base; return; }
          vec3 acc = base.rgb; float wsum = 1.0;
          const int N = 40;
          for (int i = 1; i < N; i++) {
            float fi = float(i), r = sqrt(fi / float(N)) * c0, a = fi * 2.39996323;
            vec2 uv = vUv + vec2(cos(a), sin(a)) * r / res;
            float zt = viewZ(uv), ct = coc(zt);
            float w = (zt < z0 - 0.05) ? smoothstep(0.0, 1.0, ct - r + 1.0) : 1.0;
            acc += texture2D(tColor, uv).rgb * w; wsum += w;
          }
          gl_FragColor = vec4(acc / wsum, base.a);
        }`,
    });
    // averaging the motion-blur samples (additive, each scaled by 1/N)
    this.matAcc = new THREE.ShaderMaterial({ uniforms: { tColor: { value: null }, k: { value: 1 } }, vertexShader: vs, depthTest: false, depthWrite: false, toneMapped: false, transparent: true,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      fragmentShader: 'uniform sampler2D tColor; uniform float k; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tColor, vUv) * k; }' });
    // final copy to the screen: tone mapping and sRGB happen here, as they would for a direct render
    this.matCopy = new THREE.ShaderMaterial({ uniforms: { tColor: { value: null } }, vertexShader: vs, depthTest: false, depthWrite: false, toneMapped: true,
      fragmentShader: 'uniform sampler2D tColor; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tColor, vUv); \n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}' });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.matCopy); this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  },
  targets(w, h) {
    if (this.rt && this.w === w && this.h === h) return;
    for (const t of [this.rt, this.rt2, this.acc]) if (t) { if (t.depthTexture) t.depthTexture.dispose(); t.dispose(); }
    const opt = { type: THREE.HalfFloatType, colorSpace: THREE.LinearSRGBColorSpace };
    this.rt = new THREE.WebGLRenderTarget(w, h, Object.assign({ samples: 4, depthTexture: new THREE.DepthTexture(w, h) }, opt));
    this.rt2 = new THREE.WebGLRenderTarget(w, h, opt);
    this.acc = new THREE.WebGLRenderTarget(w, h, opt);
    this.w = w; this.h = h;
  },
  pass(mat, target, clear) {
    const r = R.renderer; this.quad.material = mat;
    const ac = r.autoClear; r.autoClear = false;
    r.setRenderTarget(target); if (clear) { r.setClearColor(0x000000, 0); r.clear(true, false, false); }
    r.render(this.scene, this.cam);
    r.autoClear = ac;
  },
};
// is depth of field on for this scene camera: the camera's own switch (keyframable) or Render effects for every camera
function dofEnabled(co) {
  if (!co) return false;
  const P = co._eval || co.props;
  return !!(P.dof || FXS.dof) && (P.blur == null || P.blur > 0);
}
// distance from the camera to where it is focused: a picked object, a set distance, or the "Looks at" point
function focusDistFor(co, P, id) {
  if (id === '@auto') { const d = autofocusDist(co, P); if (d > 0) return d; }
  const fo = id && id !== '@auto' ? objById(id) : null;
  if (fo && fo !== co) {
    const a = followAnchor(fo);
    if (a) return Math.max(0.1, Math.hypot(a.x - P.position[0], a.y - P.position[1], a.z - P.position[2]));
  }
  if (P.focusDist > 0) return P.focusDist;
  return Math.max(0.1, Math.hypot(P.target[0] - P.position[0], P.target[1] - P.position[1], P.target[2] - P.position[2]));
}
function camFocusDist(co, P) {
  P = P || camState(co);
  const d = focusDistFor(co, P, P.focusObj);
  // a keyframed switch of focus subject: glide from the old subject's distance to the new one over "Focus pull" frames
  const ks = co.anim && co.anim.focusObj, pull = P.focusPull != null ? +P.focusPull : 12;
  if (!ks || ks.length < 2 || !(pull > 0)) return d;
  const f = APP.frame;
  let i = -1; for (let k = 0; k < ks.length; k++) { if (ks[k].f <= f + 1e-6) i = k; else break; }
  if (i < 1 || ks[i].v === ks[i - 1].v || f - ks[i].f >= pull) return d;
  let t = Math.max(0, Math.min(1, (f - ks[i].f) / pull)); t = t * t * (3 - 2 * t);
  const d0 = focusDistFor(co, P, ks[i - 1].v);
  // blend in 1/distance (dioptres), the way a lens focus ring moves
  return 1 / (1 / d0 + (1 / d - 1 / d0) * t);
}
// autofocus: a ray straight out of the middle of the camera's view; the focus goes to the first thing it hits
// (molecules, weapons, props, the floor). Re-measured every frame, so moving the camera or the subject keeps it sharp.
const AF = { ray: new THREE.Raycaster(), key: '', d: 0 };
function autofocusDist(co, P) {
  const o = new THREE.Vector3(P.position[0], P.position[1], P.position[2]);
  const dir = new THREE.Vector3(P.target[0] - o.x, P.target[1] - o.y, P.target[2] - o.z);
  if (dir.lengthSq() < 1e-10) return 0;
  dir.normalize();
  const key = o.toArray().map(v => v.toFixed(4)).join() + dir.toArray().map(v => v.toFixed(4)).join() + '|' + (typeof _dispKey !== 'undefined' ? _dispKey : '') + '|' + APP.evalStamp + '|' + APP.frame;
  if (key === AF.key) return AF.d;
  AF.ray.set(o, dir); AF.ray.near = 0.05; AF.ray.far = 1e4;
  const meshes = [];
  for (const [, v] of APP.views) {
    const ob = v.obj; if (ob.type === 'camera' || ob === co) continue;
    const Pv = ob._eval || ob.props; if (Pv.visible === false) continue;
    for (const m of v.pick) if (visibleChain(m) && !(m.material && m.material.wireframe)) meshes.push(m);
  }
  let best = Infinity;
  const hits = AF.ray.intersectObjects(meshes, false);
  if (hits[0]) best = hits[0].distance;
  const ph = typeof pickParticles === 'function' ? pickParticles(AF.ray.ray) : null;
  if (ph && ph.t < best) best = ph.t;
  const W = APP.scene.world.props;
  if (W.floor && dir.y < -1e-4) { const t = -o.y / dir.y; if (t > 0 && t < best) best = t; }
  // while bodies are being rebuilt after an edit their molecules can't be hit yet: hold the last focus instead of jumping
  const unsure = SIM.layoutDirty || !SIM.disp;
  if (!unsure) AF.key = key;
  AF.last = AF.last || new Map();
  if (isFinite(best) && !(unsure && AF.last.has(co.id) && best > AF.last.get(co.id))) AF.last.set(co.id, best);
  AF.d = AF.last.has(co.id) ? AF.last.get(co.id) : 0;
  return AF.d;
}
// focus distance and blur strength for a camera (scene camera props, or the editor view's orbit target)
function dofParams(cam, co) {
  const P = co ? camState(co) : null;
  const focus = P ? camFocusDist(co, P) : cam.position.distanceTo(R.controls.target);
  const fstop = P && P.fstop ? P.fstop : 2.8;
  const blur = P && P.blur != null ? Math.max(0, P.blur) : 1;
  return { focus: Math.max(0.1, focus), fstop, blur };
}
// the scene at an in-between time t (frames): objects evaluated there, molecules blended between frames
function setSubframe(t) {
  evaluateScene(t);
  const f0 = Math.floor(t), a = t - f0;
  if (SIM.layout && SIM.disp && SIM.N && SIM.has(f0)) {
    SIM.load(f0, SIM.disp, SIM.dispSt);
    if (a > 1e-4 && SIM.has(f0 + 1)) {
      if (!POSTFX.tmp || POSTFX.tmp.length !== SIM.disp.length) { POSTFX.tmp = new Float32Array(SIM.disp.length); POSTFX.tmpSt = new Uint8Array(SIM.dispSt.length); }
      SIM.load(f0 + 1, POSTFX.tmp, POSTFX.tmpSt);
      const d = SIM.disp, q = POSTFX.tmp;
      for (let i = 0; i < d.length; i++) d[i] += (q[i] - d[i]) * a;
      if (a > 0.5) SIM.dispSt.set(POSTFX.tmpSt);
    }
    MOL.upload(SIM.disp, SIM.dispSt, SIM.skelAt(f0, 'cache', a));
    _dispKey = '';
  } else updateBodies(true);
}
// draw the frame, with the effects that are on. frame: the timeline frame being shown (motion blur needs it)
function renderScene(cam, opts = {}) {
  const r = R.renderer;
  const co = opts.sceneCam ? sceneCamObj() : null;
  const dof = dofEnabled(co), mb = FXS.mblur && opts.frame != null && opts.motion !== false;
  if (!dof && !mb) { r.render(R.scene, cam); return; }
  POSTFX.init();
  const size = r.getDrawingBufferSize(new THREE.Vector2()), w = Math.max(2, size.x | 0), h = Math.max(2, size.y | 0);
  POSTFX.targets(w, h);
  const D = POSTFX.matDof.uniforms;
  const drawOne = (out, clear) => {
    r.setRenderTarget(POSTFX.rt); r.render(R.scene, cam);
    if (dof) {
      const dp = dofParams(cam, co);
      D.tColor.value = POSTFX.rt.texture; D.tDepth.value = POSTFX.rt.depthTexture;
      D.near.value = cam.near; D.far.value = cam.far; D.focus.value = dp.focus; D.res.value.set(w, h);
      // blur radius in pixels for something far behind the focus point; scales with output height
      const k = h / 1080;
      D.aper.value = 26 * k * (2.8 / dp.fstop) * dp.blur; D.maxR.value = Math.min(40, (22 * k + 4) * Math.max(1, Math.sqrt(dp.blur)));
      POSTFX.pass(POSTFX.matDof, out, clear);
      return out;
    }
    return POSTFX.rt;
  };
  const prevTarget = r.getRenderTarget();
  if (mb) {
    const n = Math.max(2, FXS.samples | 0), sh = FXS.shutter, f = opts.frame;
    r.setRenderTarget(POSTFX.acc); r.setClearColor(0x000000, 0); r.clear(true, true, false);
    for (let i = 0; i < n; i++) {
      const t = f + (i / (n - 1) - 0.5) * sh;
      setSubframe(Math.max(frameRange()[0], t));
      if (opts.camFn) cam = opts.camFn();
      const src = drawOne(POSTFX.rt2, true);
      POSTFX.matAcc.uniforms.tColor.value = src.texture; POSTFX.matAcc.uniforms.k.value = 1 / n;
      POSTFX.pass(POSTFX.matAcc, POSTFX.acc, false);
    }
    // back to the frame itself, so the editor and the next render start from the right state
    evaluateScene(f); updateBodies(true);
    POSTFX.matCopy.uniforms.tColor.value = POSTFX.acc.texture;
  } else {
    const src = drawOne(POSTFX.rt2, true);
    POSTFX.matCopy.uniforms.tColor.value = src.texture;
  }
  POSTFX.pass(POSTFX.matCopy, prevTarget, false);
  r.setRenderTarget(prevTarget);
}
