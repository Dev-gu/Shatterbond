/* ===================== renderer, studio, molecular display ===================== */
const R = {};
function initRenderer() {
  const vp = $('#viewport');
  const renderer = new THREE.WebGLRenderer({ antialias: PERF.aa !== false, preserveDrawingBuffer: true, powerPreference: PERF.gpu || 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  vp.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 600);
  camera.position.set(5.6, 2.9, 7.2);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.05, 0);
  controls.enableDamping = true; controls.dampingFactor = 0.12;
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
  controls.zoomSpeed = 1.1; controls.screenSpacePanning = true; controls.maxDistance = 1e5;
  // free zoom: our own wheel dolly that never slows to a crawl near the pivot. Close in, the pivot is pushed
  // ahead of the camera, so you can keep zooming straight in as far as you like.
  controls.enableZoom = false;
  {
    const _d = new THREE.Vector3();
    renderer.domElement.addEventListener('wheel', (e) => {
      if (!controls.enabled) return;
      e.preventDefault();
      const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      const dist = camera.position.distanceTo(controls.target);
      const f = 1 - Math.pow(0.9985, Math.abs(px) * controls.zoomSpeed);
      camera.getWorldDirection(_d);
      if (px < 0) { // in
        const mv = Math.max(dist, 0.8) * f;
        camera.position.addScaledVector(_d, mv);
        if (dist - mv < 0.4) controls.target.copy(camera.position).addScaledVector(_d, 0.4);
      } else { // out
        camera.position.addScaledVector(_d, -Math.min(Math.max(dist, 0.8) * f / (1 - f + 1e-6), 1e4));
      }
      controls.update();
    }, { passive: false });
  }
  controls.update();

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.38;

  const hemi = new THREE.HemisphereLight('#ffffff', '#8b8d92', 0.95);
  const sun = new THREE.DirectionalLight('#fffaf2', 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera; sc.left = -9; sc.right = 9; sc.top = 9; sc.bottom = -9; sc.near = 0.5; sc.far = 60;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.025; sun.shadow.radius = 7;
  const fill = new THREE.DirectionalLight('#dfe7ff', 0.45); fill.position.set(-6, 4, -5);
  scene.add(hemi, sun, sun.target, fill);

  const floorMat = new THREE.MeshStandardMaterial({ color: '#9d9fa4', roughness: 0.92, metalness: 0 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), floorMat);
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; floor.name = 'floor';
  scene.add(floor);
  scene.fog = new THREE.Fog('#b3b5b9', 9, 48); // the floor melts into the backdrop: one seamless grey studio, as in the reference videos

  // editor grid: one anti-aliased shader plane (1 m and 5 m lines, red X and blue Z axes) that fades out
  // with distance, so it never shimmers or moires the way line grids do
  const grid = new THREE.Group();
  const gridMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
    uniforms: { uFade: { value: 38 } },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `varying vec3 vW; uniform float uFade;
      float lines(vec2 p, float s){ vec2 q = p / s; vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q); return 1.0 - min(min(g.x, g.y), 1.0); }
      void main(){
        vec2 p = vW.xz;
        float d = length(cameraPosition.xz - p) + abs(cameraPosition.y) * 0.5;
        float fade = 1.0 - smoothstep(uFade * 0.35, uFade, d);
        vec2 fw = fwidth(p);
        float fine = lines(p, 1.0) * (1.0 - smoothstep(0.08, 0.3, max(fw.x, fw.y)));
        float major = lines(p, 5.0);
        float ax = 1.0 - min(abs(p.y) / (fw.y * 1.2), 1.0);
        float az = 1.0 - min(abs(p.x) / (fw.x * 1.2), 1.0);
        vec3 col = vec3(0.36, 0.37, 0.40);
        float a = max(fine * 0.28, major * 0.42);
        col = mix(col, vec3(0.88, 0.28, 0.36), ax); a = max(a, ax * 0.85);
        col = mix(col, vec3(0.31, 0.5, 0.88), az * (1.0 - ax)); a = max(a, az * 0.85);
        gl_FragColor = vec4(col, a * fade);
        if (gl_FragColor.a < 0.004) discard;
        #include <colorspace_fragment>
      }`,
  });
  const gridPlane = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), gridMat);
  gridPlane.rotation.x = -Math.PI / 2; gridPlane.position.y = 0.0005; gridPlane.renderOrder = -1; gridPlane.frustumCulled = false;
  grid.add(gridPlane);
  scene.add(grid);

  const world = new THREE.Group(); world.name = 'objects'; scene.add(world);
  const helpers = new THREE.Group(); scene.add(helpers);
  const gizmo = new TransformControls(camera, renderer.domElement);
  gizmo.setSize(0.85);
  const gizmoHelper = gizmo.getHelper ? gizmo.getHelper() : gizmo;
  scene.add(gizmoHelper);
  gizmo.addEventListener('dragging-changed', (e) => { controls.enabled = !e.value; });
  const selBox = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color('#ffae42')); selBox.visible = false; helpers.add(selBox);

  Object.assign(R, { renderer, scene, camera, controls, hemi, sun, fill, floor, floorMat, grid, world, helpers, gizmo, gizmoHelper, selBox, pmrem, vp });
  const ro = new ResizeObserver(resizeViewport); ro.observe(vp);
  resizeViewport();
  MOL.init();
}
function resizeViewport() {
  const vp = R.vp, w = Math.max(1, vp.clientWidth), h = Math.max(1, vp.clientHeight);
  R.renderer.setSize(w, h, false);
  R.camera.aspect = w / h; R.camera.updateProjectionMatrix();
  if (R.camCam) { R.camCam.aspect = w / h; R.camCam.updateProjectionMatrix(); }
  if (typeof updateCropGuide === 'function' && typeof OUT !== 'undefined') updateCropGuide();
}
function applyWorldLook(W) {
  const bg = new THREE.Color(W.background);
  R.scene.background = bg; R.scene.fog.color.copy(bg);
  R.floorMat.color.set(W.floorColor);
  R.renderer.toneMappingExposure = W.exposure;
  const a = W.sunAngle * DEG, e = W.sunHeight * DEG;
  R.sun.position.set(Math.sin(a) * Math.cos(e) * 14, Math.sin(e) * 14, Math.cos(a) * Math.cos(e) * 14);
  R.sun.intensity = W.sunIntensity;
  R.hemi.intensity = 0.55 + W.sunIntensity * 0.16;
  R.sun.castShadow = !!W.shadows;
  R.floor.visible = !!W.floor;
  const wet = W.wetness != null ? W.wetness : 0.6;
  if (MOL.pMat && MOL.pMat.clearcoat !== undefined && MOL._wet !== wet) {
    MOL._wet = wet;
    for (const m of [MOL.pMat, MOL.blobMat]) { m.clearcoat = wet; m.clearcoatRoughness = 0.22 - 0.14 * wet; m.roughness = 0.5 - 0.2 * wet; }
  }
}

/* ---------- blobby insides: torn molecules that touch melt together into one gooey surface ----------
 * A sparse metaball field (Wyvill falloff) is splatted on a block-hashed grid around the molecules and
 * polygonised with marching cubes, so only space near molecules costs anything. */
const BLOB = (() => {
  const BS = 8, OFF = 2048, CO = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
  const ED = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  const blocks = new Map(), pool = [];
  let list = [];
  const keyOf = (bx, by, bz) => ((bx + OFF) * 4096 + (by + OFF)) * 4096 + (bz + OFF);
  function block(bx, by, bz, make) {
    const k = keyOf(bx, by, bz); let b = blocks.get(k);
    if (!b && make) {
      b = pool.pop() || { v: new Float32Array(512), c: new Float32Array(1536) };
      b.v.fill(0); b.c.fill(0); b.bx = bx; b.by = by; b.bz = bz; blocks.set(k, b); list.push(b);
    }
    return b;
  }
  function get(ix, iy, iz) {
    const bx = Math.floor(ix / BS), by = Math.floor(iy / BS), bz = Math.floor(iz / BS);
    const b = block(bx, by, bz, false); if (!b) return 0;
    return b.v[((ix - bx * BS) * BS + (iy - by * BS)) * BS + (iz - bz * BS)];
  }
  function getC(ix, iy, iz, out) {
    const bx = Math.floor(ix / BS), by = Math.floor(iy / BS), bz = Math.floor(iz / BS);
    const b = block(bx, by, bz, false); if (!b) { out[0] = out[1] = out[2] = 0; return; }
    const q = 3 * (((ix - bx * BS) * BS + (iy - by * BS)) * BS + (iz - bz * BS));
    out[0] = b.c[q]; out[1] = b.c[q + 1]; out[2] = b.c[q + 2];
  }
  const LV = new Float32Array((BS + 3) ** 3), LCOL = new Float32Array(3 * (BS + 3) ** 3);
  const cv = new Float32Array(8), cg = new Float32Array(24), cc = new Float32Array(24), ev = new Int32Array(12), tmp = [0, 0, 0];
  // pts: Float32Array [x,y,z,r,g,b]*n ; R: influence radius ; h: grid step ; out: {pos,nor,col} growable
  function mesh(pts, n, rs, R, h, out, maxTris, first, p0) {
    first = first | 0; p0 = p0 | 0;
    for (const b of list) pool.push(b); blocks.clear(); list = [];
    const R2 = R * R, iR2 = 1 / R2, ih = 1 / h, T = Math.pow(1 - (rs * rs) / R2, 3); // a lone molecule's blob has radius rs
    for (let p = p0; p < n; p++) {
      const o = 6 * p, px = pts[o], py = pts[o + 1], pz = pts[o + 2];
      if (!(Math.abs(px) < 150 && Math.abs(py) < 150 && Math.abs(pz) < 150)) continue;
      const x0 = Math.ceil((px - R) * ih), x1 = Math.floor((px + R) * ih);
      const y0 = Math.ceil((py - R) * ih), y1 = Math.floor((py + R) * ih);
      const z0 = Math.ceil((pz - R) * ih), z1 = Math.floor((pz + R) * ih);
      for (let ix = x0; ix <= x1; ix++) {
        const dx = ix * h - px, dx2 = dx * dx; if (dx2 > R2) continue;
        const bx = Math.floor(ix / BS), lx = ix - bx * BS;
        for (let iy = y0; iy <= y1; iy++) {
          const dy = iy * h - py, dxy = dx2 + dy * dy; if (dxy > R2) continue;
          const by = Math.floor(iy / BS), ly = iy - by * BS;
          let cb = null, cbz = 1e9;
          for (let iz = z0; iz <= z1; iz++) {
            const dz = iz * h - pz, d2 = dxy + dz * dz; if (d2 >= R2) continue;
            const bz = Math.floor(iz / BS); if (bz !== cbz) { cb = block(bx, by, bz, true); cbz = bz; }
            const t = 1 - d2 * iR2, f = t * t * t, q = (lx * BS + ly) * BS + (iz - bz * BS);
            cb.v[q] += f; cb.c[3 * q] += f * pts[o + 3]; cb.c[3 * q + 1] += f * pts[o + 4]; cb.c[3 * q + 2] += f * pts[o + 5];
          }
        }
      }
    }
    // march block by block; each block's corners plus a 1-2 cell apron are first copied into a small dense
    // array so the inner loop never touches the hash map
    let nt = first; const P = out.pos, Nn = out.nor, C = out.col; const cap = Math.min(maxTris, P.length / 9);
    const W = BS + 3, W2 = W * W, L = LV, LC = LCOL; // local index of grid cell (i,j,k) in -1..BS+1
    for (let bi = 0; bi < list.length && nt < cap; bi++) {
      const b = list[bi], ox = b.bx * BS, oy = b.by * BS, oz = b.bz * BS;
      L.fill(0); LC.fill(0);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const nbk = blocks.get(keyOf(b.bx + dx, b.by + dy, b.bz + dz)); if (!nbk) continue;
        // overlap of that block with local range [-1, BS+1]
        const i0 = Math.max(-1, dx * BS), i1 = Math.min(BS + 1, dx * BS + BS - 1);
        const j0 = Math.max(-1, dy * BS), j1 = Math.min(BS + 1, dy * BS + BS - 1);
        const k0 = Math.max(-1, dz * BS), k1 = Math.min(BS + 1, dz * BS + BS - 1);
        for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
          const sb = ((i - dx * BS) * BS + (j - dy * BS)) * BS - dz * BS, lb = (i + 1) * W2 + (j + 1) * W + 1;
          for (let k = k0; k <= k1; k++) { const q = sb + k, l = lb + k; L[l] = nbk.v[q]; LC[3 * l] = nbk.c[3 * q]; LC[3 * l + 1] = nbk.c[3 * q + 1]; LC[3 * l + 2] = nbk.c[3 * q + 2]; }
        }
      }
      for (let i = 0; i < BS; i++) for (let j = 0; j < BS; j++) for (let k = 0; k < BS; k++) {
        const l0 = (i + 1) * W2 + (j + 1) * W + (k + 1);
        let idx = 0;
        for (let c = 0; c < 8; c++) { const v = L[l0 + CO[c][0] * W2 + CO[c][1] * W + CO[c][2]]; cv[c] = v; if (v < T) idx |= 1 << c; }
        if (idx === 0 || idx === 255) continue;
        const bits = edgeTable[idx]; if (!bits) continue;
        for (let c = 0; c < 8; c++) {
          const l = l0 + CO[c][0] * W2 + CO[c][1] * W + CO[c][2];
          cg[3 * c] = L[l - W2] - L[l + W2]; cg[3 * c + 1] = L[l - W] - L[l + W]; cg[3 * c + 2] = L[l - 1] - L[l + 1];
          const w = cv[c] > 1e-6 ? 1 / cv[c] : 0; cc[3 * c] = LC[3 * l] * w; cc[3 * c + 1] = LC[3 * l + 1] * w; cc[3 * c + 2] = LC[3 * l + 2] * w;
        }
        const ix = ox + i, iy = oy + j, iz = oz + k, t9 = idx * 16;
        for (let q = 0; q < 16 && triTable[t9 + q] !== -1; q += 3) {
          if (nt >= cap) break;
          for (let s = 0; s < 3; s++) {
            const e = triTable[t9 + q + s], a = ED[e][0], c2 = ED[e][1];
            const va = cv[a], vb = cv[c2], mu = Math.abs(vb - va) > 1e-9 ? (T - va) / (vb - va) : 0.5;
            const o9 = nt * 9 + s * 3;
            P[o9] = (ix + CO[a][0] + (CO[c2][0] - CO[a][0]) * mu) * h;
            P[o9 + 1] = (iy + CO[a][1] + (CO[c2][1] - CO[a][1]) * mu) * h;
            P[o9 + 2] = (iz + CO[a][2] + (CO[c2][2] - CO[a][2]) * mu) * h;
            const nx = cg[3 * a] + (cg[3 * c2] - cg[3 * a]) * mu, ny = cg[3 * a + 1] + (cg[3 * c2 + 1] - cg[3 * a + 1]) * mu, nz = cg[3 * a + 2] + (cg[3 * c2 + 2] - cg[3 * a + 2]) * mu;
            const ln = Math.hypot(nx, ny, nz) || 1; Nn[o9] = nx / ln; Nn[o9 + 1] = ny / ln; Nn[o9 + 2] = nz / ln;
            const wa = va >= T ? 1 : 0.0001, wb = vb >= T ? 1 : 0.0001, ws = wa + wb;
            C[o9] = (cc[3 * a] * wa + cc[3 * c2] * wb) / ws; C[o9 + 1] = (cc[3 * a + 1] * wa + cc[3 * c2 + 1] * wb) / ws; C[o9 + 2] = (cc[3 * a + 2] * wa + cc[3 * c2 + 2] * wb) / ws;
          }
          nt++;
        }
      }
    }
    return nt;
  }
  return { mesh };
})();

/* ---------- molecular bodies: skin shells deformed on the CPU + instanced molecule clumps ----------
   The skin is re-posed every frame from the molecules it is bound to. Triangles that stretch past their
   tear limit are dropped, so the shell rips open and the intact pieces fly off as flakes, white outside and
   tinted inside. Normals are rebuilt from the actual surface so shading stays smooth while it deforms. */
const MOL = {
  N: 0, bodies: [], style: 'molecular', shading: 'tissue', size: 1, CLUMP: 4, TEAR: 1.65,
  init() {
    this.skinGroup = new THREE.Group(); R.scene.add(this.skinGroup);
    this.sphere = new THREE.IcosahedronGeometry(1, 1);
    this.sphereLo = new THREE.IcosahedronGeometry(1, 0); // used when a scene is shredded into a huge cloud
    // wet look: a glossy clear coat over a soft base, so beads and goo catch sharp highlights but keep their colour
    this.pMat = new THREE.MeshPhysicalMaterial({ roughness: 0.42, metalness: 0.0, clearcoat: 0.6, clearcoatRoughness: 0.12 });
    this.cap = 0;
    // merged goo surface for torn insides
    this.bMaxT = 160000; this.bPts = new Float32Array(6 * 4096);
    this.bOut = { pos: new Float32Array(this.bMaxT * 9), nor: new Float32Array(this.bMaxT * 9), col: new Float32Array(this.bMaxT * 9) };
    const bg = new THREE.BufferGeometry();
    for (const [k, a] of [['position', this.bOut.pos], ['normal', this.bOut.nor], ['color', this.bOut.col]]) { const at = new THREE.BufferAttribute(a, 3); at.setUsage(THREE.DynamicDrawUsage); bg.setAttribute(k, at); }
    bg.setDrawRange(0, 0);
    this.blobMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.34, metalness: 0.0, clearcoat: 0.6, clearcoatRoughness: 0.1, side: THREE.DoubleSide });
    this.blob = new THREE.Mesh(bg, this.blobMat); this.blob.frustumCulled = false; this.blob.castShadow = true; this.blob.receiveShadow = true;
    R.scene.add(this.blob);
  },
  setLayout(layout) {
    for (const b of this.bodies) { this.skinGroup.remove(b.skin, b.inner); b.skin.geometry.dispose(); b.skinMat.dispose(); b.innerMat.dispose(); }
    this.bodies = [];
    let N = 0;
    for (const L of layout) N = Math.max(N, L.start + L.data.count);
    this.N = N;
    let capNeed = 0;
    for (const L of layout) {
      const d = L.data, sk = d.skin, nV = sk.pos.length / 3, nT = sk.index.length / 3;
      const geo = new THREE.BufferGeometry();
      const vpos = new Float32Array(sk.pos), vnor = new Float32Array(sk.nor || sk.pos.length);
      const idx = new Uint32Array(sk.index.length);
      geo.setAttribute('position', new THREE.BufferAttribute(vpos, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('normal', new THREE.BufferAttribute(vnor, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setIndex(new THREE.BufferAttribute(idx, 1).setUsage(THREE.DynamicDrawUsage));
      // rest measurements the tear test compares against
      const bi = sk.bindIdx, rest = d.rest, fr = new Float32Array(nV), tr = new Float32Array(nT), si = sk.index;
      for (let v = 0; v < nV; v++) {
        const a = 3 * bi[4 * v]; let m = 0;
        for (let k = 1; k < 4; k++) { const c = 3 * bi[4 * v + k], dx = rest[c] - rest[a], dy = rest[c + 1] - rest[a + 1], dz = rest[c + 2] - rest[a + 2]; m = Math.max(m, dx * dx + dy * dy + dz * dz); }
        fr[v] = m;
      }
      const P = sk.pos, e2 = (a, c) => { const dx = P[3 * a] - P[3 * c], dy = P[3 * a + 1] - P[3 * c + 1], dz = P[3 * a + 2] - P[3 * c + 2]; return dx * dx + dy * dy + dz * dz; };
      const ta = new Float32Array(nT);
      for (let t = 0; t < nT; t++) { const a = si[3 * t], b2 = si[3 * t + 1], c = si[3 * t + 2]; tr[t] = Math.max(e2(a, b2), e2(b2, c), e2(c, a), (d.spacing * 0.6) ** 2);
        const ux = P[3 * b2] - P[3 * a], uy = P[3 * b2 + 1] - P[3 * a + 1], uz = P[3 * b2 + 2] - P[3 * a + 2], wx = P[3 * c] - P[3 * a], wy = P[3 * c + 1] - P[3 * a + 1], wz = P[3 * c + 2] - P[3 * a + 2];
        const cx = uy * wz - uz * wy, cy = uz * wx - ux * wz, cz = ux * wy - uy * wx; ta[t] = Math.sqrt(cx * cx + cy * cy + cz * cz); }
      const isHuman = L.obj.type === 'humanoid';
      const col = isHuman ? L.obj.props.skinColor : (L.obj.props.color || '#cccccc');
      const skinMat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.74, metalness: 0, side: THREE.FrontSide, shadowSide: THREE.BackSide });
      // the inside of the shell: drawn only where it faces the camera, pushed back in depth so it never
      // fights with the outside at silhouettes
      const innerMat = new THREE.MeshStandardMaterial({ color: '#c4c6cc', roughness: 0.8, metalness: 0, side: THREE.BackSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
      const mesh = new THREE.Mesh(geo, skinMat), inner = new THREE.Mesh(geo, innerMat);
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
      inner.castShadow = false; inner.receiveShadow = true; inner.frustumCulled = false;
      mesh.userData.objId = inner.userData.objId = L.obj.id;
      this.skinGroup.add(mesh, inner);
      const n = d.count;
      // each molecule is drawn as a small clump of beads, which reads as the dense grainy interior
      const K = this.CLUMP, clump = new Float32Array(n * K * 4), rnd = BLD_RNG(L.start * 7 + 3);
      for (let i = 0; i < n * K; i++) {
        let x, y, z; do { x = rnd() * 2 - 1; y = rnd() * 2 - 1; z = rnd() * 2 - 1; } while (x * x + y * y + z * z > 1);
        clump[4 * i] = x * 0.55; clump[4 * i + 1] = y * 0.55; clump[4 * i + 2] = z * 0.55; clump[4 * i + 3] = 0.62 + 0.2 * rnd();
      }
      capNeed += n * K;
      this.bodies.push({ obj: L.obj, start: L.start, count: n, data: d, skin: mesh, inner, skinMat, innerMat, vpos, vnor, idx, fr, tr, ta, nV, nT, tid: new Uint32Array(nT), bad: new Uint8Array(nV), dm: new Uint8Array(nV), clump,
        cT: new Float32Array(3 * n), cM: new Float32Array(3 * n), isHuman });
    }
    this.recolor();
    if (capNeed > this.cap) {
      if (this.pts) { R.scene.remove(this.pts); this.pts.dispose(); }
      this.cap = Math.max(capNeed, 1024);
      this.pts = new THREE.InstancedMesh(this.sphere, this.pMat, this.cap);
      this.pts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.pts.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 3), 3);
      this.pts.instanceColor.setUsage(THREE.DynamicDrawUsage);
      this.pts.castShadow = true; this.pts.receiveShadow = true; this.pts.frustumCulled = false;
      R.scene.add(this.pts);
    }
    if (this.pts) this.pts.count = 0;
    this.applyStyle();
  },
  // per-molecule colours: tissue colours (with jitter) and a brightness for single-colour mode
  recolor() {
    const pal = TISSUES.map((t, i) => hexToRgb(tissueColor(i)));
    for (const b of this.bodies) {
      const d = b.data, rnd = BLD_RNG(b.start + 11), P = b.obj._eval || b.obj.props;
      const own = !b.isHuman && P.color ? hexToRgb(P.color) : null;
      for (let i = 0; i < b.count; i++) {
        const c = own || pal[d.tissue[i]];
        const j = 0.82 + 0.3 * rnd();
        b.cT[3 * i] = c[0] * j; b.cT[3 * i + 1] = c[1] * j; b.cT[3 * i + 2] = c[2] * j;
        const jm = 0.72 + 0.5 * rnd();
        b.cM[3 * i] = jm; b.cM[3 * i + 1] = jm; b.cM[3 * i + 2] = jm;
      }
      b.colorKey = own ? P.color : '';
    }
  },
  applyStyle() {
    const W = APP.worldP || WORLD_DEFAULTS();
    this.style = W.particleStyle; this.size = W.particleSize; this.blobs = W.blobs !== false;
    const mc = hexToRgb(W.moleculeColor);
    this.mol = mc;
    const xray = this.shading === 'xray';
    for (const b of this.bodies) {
      const P = b.obj._eval || b.obj.props;
      const col = b.isHuman ? (P.skinColor || '#eeeeee') : (P.color || '#cccccc');
      b.mc = (b.isHuman && P.insideColor) ? hexToRgb(P.insideColor) : mc;
      b.skinMat.color.set(col);
      // the inside of the skin shell is the same white as the outside, a little shaded, as in the reference videos:
      // wounds read as a white rim around the coloured insides
      b.innerMat.color.set(new THREE.Color(col).multiplyScalar(0.8));
      const show = (this.shading === 'skin' || xray) && P.visible !== false;
      b.skin.visible = show; b.inner.visible = show && !xray;
      b.skinMat.transparent = xray; b.skinMat.opacity = xray ? 0.16 : 1; b.skinMat.depthWrite = !xray;
      b.skinMat.side = xray ? THREE.DoubleSide : THREE.FrontSide;
      b.skin.castShadow = !xray;
      b.skinMat.needsUpdate = true;
    }
  },
  // skin squashed flat (a press, a body crushed under a weight) follows molecules that are packed much closer
  // than it was built for, so it crumples into spiky folds. Where triangles have shrunk a lot or flipped over,
  // the skin is relaxed toward its neighbours so it stays a smooth, squashed surface.
  unCrumple(b, V, si) {
    if (this.noUnCrumple) return;
    const nV = b.nV, nT = b.nT, ta = b.ta;
    // quick look first (every 5th triangle, with margin): most frames nothing is squashed and the full pass is skipped
    if (ta) {
      let any = false;
      for (let t = (b._ucOff = ((b._ucOff || 0) + 1) % 5); t < nT; t += 5) {
        const A = si[3 * t], B = si[3 * t + 1], C = si[3 * t + 2];
        const ax = V[3 * A], ay = V[3 * A + 1], az = V[3 * A + 2];
        const ux = V[3 * B] - ax, uy = V[3 * B + 1] - ay, uz = V[3 * B + 2] - az, wx = V[3 * C] - ax, wy = V[3 * C + 1] - ay, wz = V[3 * C + 2] - az;
        const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
        if (Math.sqrt(nx * nx + ny * ny + nz * nz) < 0.6 * ta[t]) { any = true; break; }
      }
      if (!any) return;
    }
    if (!b.adjS) {
      const cnt = new Uint32Array(nV + 1);
      for (let q = 0; q < si.length; q++) cnt[si[q] + 1] += 2;
      for (let v = 0; v < nV; v++) cnt[v + 1] += cnt[v];
      const adj = new Uint32Array(cnt[nV]), fill = cnt.slice(0, nV);
      for (let t = 0; t < nT; t++) { const A = si[3 * t], B = si[3 * t + 1], C = si[3 * t + 2]; adj[fill[A]++] = B; adj[fill[A]++] = C; adj[fill[B]++] = A; adj[fill[B]++] = C; adj[fill[C]++] = A; adj[fill[C]++] = B; }
      b.adjS = cnt; b.adj = adj; b.crush = new Float32Array(nV); b.vsum = new Float32Array(3 * nV); b.tmpV = new Float32Array(3 * nV);
    }
    const cr = b.crush, vs = b.vsum; cr.fill(0); vs.fill(0);
    for (let t = 0; t < nT; t++) {
      const A = si[3 * t], B = si[3 * t + 1], C = si[3 * t + 2];
      const ax = V[3 * A], ay = V[3 * A + 1], az = V[3 * A + 2];
      const ux = V[3 * B] - ax, uy = V[3 * B + 1] - ay, uz = V[3 * B + 2] - az, wx = V[3 * C] - ax, wy = V[3 * C + 1] - ay, wz = V[3 * C + 2] - az;
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      for (const q of [A, B, C]) { vs[3 * q] += nx; vs[3 * q + 1] += ny; vs[3 * q + 2] += nz; }
      const ar = Math.sqrt(nx * nx + ny * ny + nz * nz), k = ar / (ta[t] + 1e-12);
      if (k < 0.45) { const c = Math.min(1, (0.45 - k) / 0.3); if (c > cr[A]) cr[A] = c; if (c > cr[B]) cr[B] = c; if (c > cr[C]) cr[C] = c; }
    }
    // folded-over triangles: facing against the surface around them
    for (let t = 0; t < nT; t++) {
      const A = si[3 * t], B = si[3 * t + 1], C = si[3 * t + 2];
      const ax = V[3 * A], ay = V[3 * A + 1], az = V[3 * A + 2];
      const ux = V[3 * B] - ax, uy = V[3 * B + 1] - ay, uz = V[3 * B + 2] - az, wx = V[3 * C] - ax, wy = V[3 * C + 1] - ay, wz = V[3 * C + 2] - az;
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      const sx = vs[3 * A] + vs[3 * B] + vs[3 * C], sy = vs[3 * A + 1] + vs[3 * B + 1] + vs[3 * C + 1], sz = vs[3 * A + 2] + vs[3 * B + 2] + vs[3 * C + 2];
      if (nx * sx + ny * sy + nz * sz < 0) { cr[A] = cr[B] = cr[C] = 1; }
    }
    let any = false; for (let v = 0; v < nV; v++) if (cr[v] > 0) { any = true; break; }
    if (!any) return;
    // spread the flag one ring so the relaxed patch blends into the surface around it
    const S = b.adjS, J = b.adj, T = b.tmpV;
    for (let v = 0; v < nV; v++) { let m = cr[v]; for (let e = S[v]; e < S[v + 1]; e++) m = Math.max(m, cr[J[e]] * 0.6); T[v] = m; }
    for (let v = 0; v < nV; v++) cr[v] = T[v];
    for (let it = 0; it < 4; it++) {
      for (let v = 0; v < nV; v++) {
        if (!(cr[v] > 0)) continue;
        let x = 0, y = 0, z = 0; const n = S[v + 1] - S[v]; if (!n) continue;
        for (let e = S[v]; e < S[v + 1]; e++) { const u = J[e]; x += V[3 * u]; y += V[3 * u + 1]; z += V[3 * u + 2]; }
        const k = 0.65 * cr[v];
        T[3 * v] = V[3 * v] + (x / n - V[3 * v]) * k; T[3 * v + 1] = V[3 * v + 1] + (y / n - V[3 * v + 1]) * k; T[3 * v + 2] = V[3 * v + 2] + (z / n - V[3 * v + 2]) * k;
      }
      for (let v = 0; v < nV; v++) if (cr[v] > 0) { V[3 * v] = T[3 * v]; V[3 * v + 1] = T[3 * v + 1]; V[3 * v + 2] = T[3 * v + 2]; }
    }
  },
  // an animated body's skin, posed straight from its bones: K = { S: segment transforms, p, q: body placement }
  skinFromBones(b, K, V) {
    const sk = b.data.skin, P = sk.pos, n = b.nV, E = window.ShatterEngine;
    const DQ = E.segDQ(K.S, K.S.length / 12, b._dq), o3 = b._o3 || (b._o3 = new Float32Array(3));
    b._dq = DQ;
    const [qx, qy, qz, qw] = K.q, m = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion(qx, qy, qz, qw))).elements;
    const px = K.p[0], py = K.p[1], pz = K.p[2];
    for (let v = 0; v < n; v++) {
      E.dqSkin(DQ, sk.sk, sk.skw255 || (sk.skw255 = Float32Array.from(sk.skw, w => w / 255)), 4 * v, P[3 * v], P[3 * v + 1], P[3 * v + 2], o3);
      const x = o3[0], y = o3[1], z = o3[2];
      V[3 * v] = m[0] * x + m[3] * y + m[6] * z + px; V[3 * v + 1] = m[1] * x + m[4] * y + m[7] * z + py; V[3 * v + 2] = m[2] * x + m[5] * y + m[8] * z + pz;
    }
  },
  /* When physics takes over an animated body, the skin's ties to the molecules are measured again from the last
   * animated frame (molecules at fr, skin from the bones at fr), so the skin keeps the posed shape it had instead of
   * the shape it was built with. Cached per body and frame. */
  rebindFor(b, fr, posFr, K) {
    if (b.rebind && b.rebind.fr === fr && b.rebind.token === SIM.token) return b.rebind.uvw;
    const sk = b.data.skin, bi = sk.bindIdx, n = b.nV, o = b.start * 3, V = new Float32Array(3 * n), uvw = new Float32Array(sk.bindUVW);
    this.skinFromBones(b, K, V);
    for (let v = 0; v < n; v++) {
      const a = o + 3 * bi[4 * v], p1 = o + 3 * bi[4 * v + 1], p2 = o + 3 * bi[4 * v + 2], p3 = o + 3 * bi[4 * v + 3];
      if (p1 === a && p2 === a) continue;
      const ax = posFr[a], ay = posFr[a + 1], az = posFr[a + 2];
      const e1x = posFr[p1] - ax, e1y = posFr[p1 + 1] - ay, e1z = posFr[p1 + 2] - az, e2x = posFr[p2] - ax, e2y = posFr[p2 + 1] - ay, e2z = posFr[p2 + 2] - az, e3x = posFr[p3] - ax, e3y = posFr[p3 + 1] - ay, e3z = posFr[p3 + 2] - az;
      const det = e1x * (e2y * e3z - e2z * e3y) - e2x * (e1y * e3z - e1z * e3y) + e3x * (e1y * e2z - e1z * e2y);
      const L = Math.max(e1x * e1x + e1y * e1y + e1z * e1z, e2x * e2x + e2y * e2y + e2z * e2z, e3x * e3x + e3y * e3y + e3z * e3z);
      if (!(Math.abs(det) > 0.05 * L * Math.sqrt(L))) continue;
      const rx = V[3 * v] - ax, ry = V[3 * v + 1] - ay, rz = V[3 * v + 2] - az;
      // Cramer's rule: [e1 e2 e3] uvw = r
      const u = (rx * (e2y * e3z - e2z * e3y) - e2x * (ry * e3z - rz * e3y) + e3x * (ry * e2z - rz * e2y)) / det;
      const w = (e1x * (ry * e3z - rz * e3y) - rx * (e1y * e3z - e1z * e3y) + e3x * (e1y * rz - e1z * ry)) / det;
      const t = (e1x * (e2y * rz - e2z * ry) - e2x * (e1y * rz - e1z * ry) + rx * (e1y * e2z - e1z * e2y)) / det;
      if (Math.abs(u) > 4 || Math.abs(w) > 4 || Math.abs(t) > 4) continue;
      uvw[3 * v] = u; uvw[3 * v + 1] = w; uvw[3 * v + 2] = t;
    }
    b.rebind = { fr, token: SIM.token, uvw, V };
    return uvw;
  },
  /* An animated body after a hit: its skin moves like a skinned character whose bones follow the molecules. Per
   * segment, the best rigid fit from the molecules at the last animated frame to where they are now; the skin from
   * that frame is carried by those fits with its own bone weights (dual quaternions), so bending joints stay smooth
   * instead of creasing where the flesh under them squashes. Where the flesh is really deformed (dents, wounds, cut
   * pieces) the skin goes back to following the molecules themselves. Returns null when it does not apply. */
  segFit(b, pos, st, posFr) {
    const d = b.data, seg = d.seg, sk = d.skin; if (!seg || !sk.sk || !b.rebind || !b.rebind.V) return null;
    const n = d.count, o = 3 * b.start, NS = 49;
    const F = b._fit || (b._fit = { c0: new Float64Array(3 * NS), c1: new Float64Array(3 * NS), A: new Float64Array(9 * NS), cnt: new Int32Array(NS), q: new Float64Array(4 * NS).map((_, i) => i % 4 === 3 ? 1 : 0), S: new Float32Array(12 * NS), ok: new Uint8Array(NS) });
    const { c0, c1, A, cnt, q, S, ok } = F;
    c0.fill(0); c1.fill(0); A.fill(0); cnt.fill(0); ok.fill(0);
    for (let i = 0; i < n; i++) {
      if (st && st[b.start + i]) continue;
      const s = seg[i]; if (s >= NS) continue;
      const a = o + 3 * i;
      c0[3 * s] += posFr[a]; c0[3 * s + 1] += posFr[a + 1]; c0[3 * s + 2] += posFr[a + 2];
      c1[3 * s] += pos[a]; c1[3 * s + 1] += pos[a + 1]; c1[3 * s + 2] += pos[a + 2]; cnt[s]++;
    }
    for (let s = 0; s < NS; s++) if (cnt[s]) for (let k = 0; k < 3; k++) { c0[3 * s + k] /= cnt[s]; c1[3 * s + k] /= cnt[s]; }
    for (let i = 0; i < n; i++) {
      if (st && st[b.start + i]) continue;
      const s = seg[i]; if (s >= NS) continue;
      const a = o + 3 * i, x0 = posFr[a] - c0[3 * s], y0 = posFr[a + 1] - c0[3 * s + 1], z0 = posFr[a + 2] - c0[3 * s + 2];
      const x1 = pos[a] - c1[3 * s], y1 = pos[a + 1] - c1[3 * s + 1], z1 = pos[a + 2] - c1[3 * s + 2], m = 9 * s;
      A[m] += x1 * x0; A[m + 1] += x1 * y0; A[m + 2] += x1 * z0; A[m + 3] += y1 * x0; A[m + 4] += y1 * y0; A[m + 5] += y1 * z0; A[m + 6] += z1 * x0; A[m + 7] += z1 * y0; A[m + 8] += z1 * z0;
    }
    const par = BLD.SEG_PARENT, body = BLD.segBody;
    for (let s = 0; s < NS; s++) {
      if (cnt[s] < 6) continue;
      // rotation of A by Mueller et al.'s iterative extraction, warm started from the last frame's
      const m = 9 * s, R = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      let qx = q[4 * s], qy = q[4 * s + 1], qz = q[4 * s + 2], qw = q[4 * s + 3];
      for (let it = 0; it < 12; it++) {
        R[0] = 1 - 2 * (qy * qy + qz * qz); R[1] = 2 * (qx * qy - qw * qz); R[2] = 2 * (qx * qz + qw * qy);
        R[3] = 2 * (qx * qy + qw * qz); R[4] = 1 - 2 * (qx * qx + qz * qz); R[5] = 2 * (qy * qz - qw * qx);
        R[6] = 2 * (qx * qz - qw * qy); R[7] = 2 * (qy * qz + qw * qx); R[8] = 1 - 2 * (qx * qx + qy * qy);
        // omega = sum(r_i x a_i) / (|sum r_i . a_i| + eps), r_i and a_i the columns of R and A
        let wx = 0, wy = 0, wz = 0, dd = 0;
        for (let c = 0; c < 3; c++) {
          const rx = R[c], ry = R[3 + c], rz = R[6 + c], ax = A[m + c], ay = A[m + 3 + c], az = A[m + 6 + c];
          wx += ry * az - rz * ay; wy += rz * ax - rx * az; wz += rx * ay - ry * ax; dd += rx * ax + ry * ay + rz * az;
        }
        const k = 1 / (Math.abs(dd) + 1e-9); wx *= k; wy *= k; wz *= k;
        const wl = Math.hypot(wx, wy, wz); if (wl < 1e-9) break;
        const h = 0.5 * wl, sn = Math.sin(h) / wl, ex = wx * sn, ey = wy * sn, ez = wz * sn, ew = Math.cos(h);
        const nx = ew * qx + ex * qw + ey * qz - ez * qy, ny = ew * qy - ex * qz + ey * qw + ez * qx, nz = ew * qz + ex * qy - ey * qx + ez * qw, nw = ew * qw - ex * qx - ey * qy - ez * qz;
        const l = Math.hypot(nx, ny, nz, nw); qx = nx / l; qy = ny / l; qz = nz / l; qw = nw / l;
        if (wl < 1e-6) break;
      }
      q[4 * s] = qx; q[4 * s + 1] = qy; q[4 * s + 2] = qz; q[4 * s + 3] = qw;
      R[0] = 1 - 2 * (qy * qy + qz * qz); R[1] = 2 * (qx * qy - qw * qz); R[2] = 2 * (qx * qz + qw * qy);
      R[3] = 2 * (qx * qy + qw * qz); R[4] = 1 - 2 * (qx * qx + qz * qz); R[5] = 2 * (qy * qz - qw * qx);
      R[6] = 2 * (qx * qz - qw * qy); R[7] = 2 * (qy * qz + qw * qx); R[8] = 1 - 2 * (qx * qx + qy * qy);
      const c = 3 * s, t0 = c1[c] - (R[0] * c0[c] + R[1] * c0[c + 1] + R[2] * c0[c + 2]), t1 = c1[c + 1] - (R[3] * c0[c] + R[4] * c0[c + 1] + R[5] * c0[c + 2]), t2 = c1[c + 2] - (R[6] * c0[c] + R[7] * c0[c + 1] + R[8] * c0[c + 2]);
      S.set(R, 12 * s); S[12 * s + 9] = t0; S[12 * s + 10] = t1; S[12 * s + 11] = t2; ok[s] = 1;
    }
    // segments with too few intact molecules (a finger, a girdle) borrow the nearest fitted ancestor's
    for (let s = 0; s < NS; s++) {
      if (ok[s]) continue;
      let p = s, guard = 0;
      while (!ok[p] && guard++ < 8) { const bp = p >= 17 ? body(p) : par[p]; if (bp == null || bp < 0 || bp === p) { p = -1; break; } p = bp; }
      if (p < 0 || !ok[p]) return null;
      S.copyWithin(12 * s, 12 * p, 12 * p + 12);
    }
    const E = window.ShatterEngine, DQ = E.segDQ(S, NS, b._fitDQ); b._fitDQ = DQ;
    const V0 = b.rebind.V, nV = b.nV, out = b._fitV || (b._fitV = new Float32Array(3 * nV)), o3 = [0, 0, 0];
    const w = sk.skw255 || (sk.skw255 = Float32Array.from(sk.skw, x => x / 255));
    for (let v = 0; v < nV; v++) { E.dqSkin(DQ, sk.sk, w, 4 * v, V0[3 * v], V0[3 * v + 1], V0[3 * v + 2], o3); out[3 * v] = o3[0]; out[3 * v + 1] = o3[1]; out[3 * v + 2] = o3[2]; }
    return out;
  },
  // re-pose one body's skin from the molecule positions and drop torn triangles; K: its bone pose when animated
  poseSkin(b, pos, st, K, uvwOver, fitV) {
    const sk = b.data.skin, bi = sk.bindIdx, V = b.vpos, Nn = b.vnor, fr = b.fr, bad = b.bad, dm = b.dm, o = b.start * 3;
    const uvw = uvwOver || sk.bindUVW;
    if (K && sk.sk) {
      this.skinFromBones(b, K, V);
      Nn.fill(0); bad.fill(0); dm.fill(0);
      const si = sk.index, out = b.idx; let k = 0;
      for (let t = 0; t < b.nT; t++) {
        const A = si[3 * t], B = si[3 * t + 1], C = si[3 * t + 2];
        const ax = V[3 * A], ay = V[3 * A + 1], az = V[3 * A + 2];
        const ux = V[3 * B] - ax, uy = V[3 * B + 1] - ay, uz = V[3 * B + 2] - az, wx = V[3 * C] - ax, wy = V[3 * C + 1] - ay, wz = V[3 * C + 2] - az;
        const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
        Nn[3 * A] += nx; Nn[3 * A + 1] += ny; Nn[3 * A + 2] += nz; Nn[3 * B] += nx; Nn[3 * B + 1] += ny; Nn[3 * B + 2] += nz; Nn[3 * C] += nx; Nn[3 * C + 1] += ny; Nn[3 * C + 2] += nz;
        b.tid[k / 3] = t; out[k++] = A; out[k++] = B; out[k++] = C;
      }
      for (let v = 0; v < b.nV; v++) { const x = Nn[3 * v], y = Nn[3 * v + 1], z = Nn[3 * v + 2], l = Math.sqrt(x * x + y * y + z * z); if (l > 1e-20) { Nn[3 * v] = x / l; Nn[3 * v + 1] = y / l; Nn[3 * v + 2] = z / l; } else Nn[3 * v + 1] = 1; }
      const g = b.skin.geometry; g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true; g.index.needsUpdate = true; g.setDrawRange(0, k);
      b.tris = k / 3;
      return;
    }
    const T2 = this.TEAR * this.TEAR;
    for (let v = 0; v < b.nV; v++) {
      const a = o + 3 * bi[4 * v], p1 = o + 3 * bi[4 * v + 1], p2 = o + 3 * bi[4 * v + 2], p3 = o + 3 * bi[4 * v + 3];
      const ax = pos[a], ay = pos[a + 1], az = pos[a + 2];
      const e1x = pos[p1] - ax, e1y = pos[p1 + 1] - ay, e1z = pos[p1 + 2] - az;
      const e2x = pos[p2] - ax, e2y = pos[p2 + 1] - ay, e2z = pos[p2 + 2] - az;
      const e3x = pos[p3] - ax, e3y = pos[p3 + 1] - ay, e3z = pos[p3 + 2] - az;
      const m = Math.max(e1x * e1x + e1y * e1y + e1z * e1z, e2x * e2x + e2y * e2y + e2z * e2z, e3x * e3x + e3y * e3y + e3z * e3z);
      // healthy flesh stretches like rubber; the shell only tears where the molecules under it have
      // broken bonds, or when it is pulled far past any elastic limit
      const dmg = st ? Math.max(st[a / 3], st[p1 / 3], st[p2 / 3], st[p3 / 3]) : 0;
      const lim = dmg === 1 ? 3 : 14;
      // skin over a molecule that has come loose is gone: following loose beads would stretch it into shards
      bad[v] = dmg === 2 || m > fr[v] * lim ? 1 : 0;
      dm[v] = dmg;
      const u = uvw[3 * v], w = uvw[3 * v + 1], t = uvw[3 * v + 2];
      V[3 * v] = ax + u * e1x + w * e2x + t * e3x; V[3 * v + 1] = ay + u * e1y + w * e2y + t * e3y; V[3 * v + 2] = az + u * e1z + w * e2z + t * e3z;
      Nn[3 * v] = Nn[3 * v + 1] = Nn[3 * v + 2] = 0;
    }
    const si = sk.index, tr = b.tr, out = b.idx; let k = 0;
    if (fitV) {
      // smooth skinned skin where the flesh under it moves like a body, the molecules' own shape where it does not
      const s2 = b.data.spacing || 0.0145, d0 = 1.5 * s2, d1 = 4 * s2;
      for (let v = 0; v < b.nV; v++) {
        if (bad[v]) continue;
        const dx = V[3 * v] - fitV[3 * v], dy = V[3 * v + 1] - fitV[3 * v + 1], dz = V[3 * v + 2] - fitV[3 * v + 2], dd = Math.sqrt(dx * dx + dy * dy + dz * dz);
        let a = dm[v] ? 0 : 1 - Math.min(1, Math.max(0, (dd - d0) / (d1 - d0)));
        if (a <= 0) continue;
        V[3 * v] -= dx * a; V[3 * v + 1] -= dy * a; V[3 * v + 2] -= dz * a;
      }
    }
    this.unCrumple(b, V, si);
    for (let t = 0; t < b.nT; t++) {
      const A = si[3 * t], B = si[3 * t + 1], C = si[3 * t + 2];
      if (bad[A] || bad[B] || bad[C]) continue;
      const ax = V[3 * A], ay = V[3 * A + 1], az = V[3 * A + 2];
      const ux = V[3 * B] - ax, uy = V[3 * B + 1] - ay, uz = V[3 * B + 2] - az;
      const wx = V[3 * C] - ax, wy = V[3 * C + 1] - ay, wz = V[3 * C + 2] - az;
      const vx = wx - ux, vy = wy - uy, vz = wz - uz, dmx = Math.max(dm[A], dm[B], dm[C]), lim = tr[t] * (dmx >= 1 ? T2 : 14);
      if (ux * ux + uy * uy + uz * uz > lim || wx * wx + wy * wy + wz * wz > lim || vx * vx + vy * vy + vz * vz > lim) continue;
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      Nn[3 * A] += nx; Nn[3 * A + 1] += ny; Nn[3 * A + 2] += nz;
      Nn[3 * B] += nx; Nn[3 * B + 1] += ny; Nn[3 * B + 2] += nz;
      Nn[3 * C] += nx; Nn[3 * C + 1] += ny; Nn[3 * C + 2] += nz;
      b.tid[k / 3] = t; out[k++] = A; out[k++] = B; out[k++] = C;
    }
    // tidy tear edges: drop slivers and tiny flakes, i.e. damaged triangles that hang on by a corner or two
    {
      const use = b.use || (b.use = new Uint8Array(b.nV)), ta = b.ta, tid = b.tid; use.fill(0);
      for (let q = 0; q < k; q++) { const vv = out[q]; if (use[vv] < 255) use[vv]++; }
      let k2 = 0;
      for (let q = 0; q < k; q += 3) {
        const A = out[q], B = out[q + 1], C = out[q + 2];
        if (dm[A] | dm[B] | dm[C]) {
          if ((use[A] < 3 || use[B] < 3 || use[C] < 3) && use[A] + use[B] + use[C] < 12) continue;
          // torn skin that got crushed edge-on or folded over itself shows up as a flat shard: hide it
          const ax = V[3 * A], ay = V[3 * A + 1], az = V[3 * A + 2];
          const ux = V[3 * B] - ax, uy = V[3 * B + 1] - ay, uz = V[3 * B + 2] - az, wx = V[3 * C] - ax, wy = V[3 * C + 1] - ay, wz = V[3 * C + 2] - az;
          const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, ar = Math.sqrt(nx * nx + ny * ny + nz * nz);
          if (ar < 0.2 * ta[tid[q / 3]]) continue;
          const sx = Nn[3 * A] + Nn[3 * B] + Nn[3 * C], sy = Nn[3 * A + 1] + Nn[3 * B + 1] + Nn[3 * C + 1], sz = Nn[3 * A + 2] + Nn[3 * B + 2] + Nn[3 * C + 2];
          if (nx * sx + ny * sy + nz * sz < 0.2 * ar * Math.sqrt(sx * sx + sy * sy + sz * sz)) continue;
        }
        tid[k2 / 3] = tid[q / 3]; out[k2++] = A; out[k2++] = B; out[k2++] = C;
      }
      k = k2;
    }
    for (let v = 0; v < b.nV; v++) {
      const x = Nn[3 * v], y = Nn[3 * v + 1], z = Nn[3 * v + 2], l = Math.sqrt(x * x + y * y + z * z);
      if (l > 1e-20) { Nn[3 * v] = x / l; Nn[3 * v + 1] = y / l; Nn[3 * v + 2] = z / l; } else Nn[3 * v + 1] = 1;
    }
    const g = b.skin.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true; g.index.needsUpdate = true;
    g.setDrawRange(0, k);
    b.tris = k / 3;
  },
  // pos: Float32Array 3N, st: Uint8Array N
  // skel (optional): per body { K: bone pose while animated, R: { fr, pos, K } the last animated frame after release }
  upload(pos, st, skel) {
    const N = this.N; if (!N || !pos) { if (this.pts) this.pts.count = 0; if (this.blob) this.blob.visible = false; return; }
    this.bodies.forEach((b, k) => {
      if (!b.skin.visible) return;
      const e = skel && skel[k];
      if (e && e.K) return this.poseSkin(b, pos, st, e.K);
      const uvw = e && e.R && b.data.skin.sk ? this.rebindFor(b, e.R.fr, e.R.pos, e.R.K) : null;
      const fitV = uvw && this.segFitOn !== false ? this.segFit(b, pos, st, e.R.pos) : null;
      this.poseSkin(b, pos, st, null, uvw, fitV);
    });
    // instanced molecules
    const M = this.pts.instanceMatrix.array, C = this.pts.instanceColor.array;
    const mode = this.shading, mol = this.style === 'molecular', K = this.CLUMP;
    let k = 0, nv = 0, nb = 0, br = 0;
    const blobOn = this.blobs && mode === 'skin' && PERF.blobMax > 0, BMAX = Math.min(this.bBudget || 8000, PERF.blobMax || 8000);
    const bStarts = this.bStarts || (this.bStarts = []); bStarts.length = 0;
    for (const b of this.bodies) {
      const P = b.obj._eval || b.obj.props;
      if (P.visible === false) continue;
      bStarts.push(nb); // each body's goo is meshed on its own, so separate bodies never melt into each other
      const r = b.data.radius * 1.2 * this.size;
      const tis = b.data.tissue, cl = b.clump, mc = b.mc || this.mol;
      for (let j = 0; j < b.count; j++) {
        const i = b.start + j, s = st ? st[i] : 0;
        let show;
        if (mode === 'skin') show = s > 0;
        else if (mode === 'xray') { const t = tis[j]; show = s > 0 || (b.isHuman && t !== TI.skin && t !== TI.fat && t !== TI.muscle); }
        else show = true;
        if (!show) continue;
        nv++;
        const i3 = 3 * i, j3 = 3 * j, px = pos[i3], py = pos[i3 + 1], pz = pos[i3 + 2];
        let cr, cg, cb;
        if (mol && (mode === 'skin' || mode === 'molecules' || s > 0)) { const f = b.cM[j3]; cr = mc[0] * f; cg = mc[1] * f; cb = mc[2] * f; }
        else { cr = b.cT[j3]; cg = b.cT[j3 + 1]; cb = b.cT[j3 + 2]; }
        if (blobOn && s > 0 && nb < BMAX) {
          if (6 * nb + 6 > this.bPts.length) { const a = new Float32Array(this.bPts.length * 2); a.set(this.bPts); this.bPts = a; }
          const o6 = 6 * nb++; this.bPts[o6] = px; this.bPts[o6 + 1] = py; this.bPts[o6 + 2] = pz; this.bPts[o6 + 3] = cr; this.bPts[o6 + 4] = cg; this.bPts[o6 + 5] = cb;
          if (r > br) br = r;
          continue;
        }
        for (let q = 0; q < K; q++) {
          const c4 = 4 * (j * K + q), rr = r * cl[c4 + 3], o = 16 * k;
          M[o] = rr; M[o + 1] = 0; M[o + 2] = 0; M[o + 3] = 0;
          M[o + 4] = 0; M[o + 5] = rr; M[o + 6] = 0; M[o + 7] = 0;
          M[o + 8] = 0; M[o + 9] = 0; M[o + 10] = rr; M[o + 11] = 0;
          M[o + 12] = px + cl[c4] * r; M[o + 13] = py + cl[c4 + 1] * r; M[o + 14] = pz + cl[c4 + 2] * r; M[o + 15] = 1;
          const sh = 0.9 + (cl[c4 + 3] - 0.62), c3 = 3 * k;
          C[c3] = cr * sh; C[c3 + 1] = cg * sh; C[c3 + 2] = cb * sh;
          k++;
        }
      }
    }
    this.pts.count = k;
    // touching torn molecules melt together into one gooey surface
    if (nb > 0) {
      const t0 = performance.now(), rb = br * 1.1, g = this.blob.geometry; let nt = 0;
      bStarts.push(nb);
      for (let q = 0; q + 1 < bStarts.length; q++) if (bStarts[q + 1] > bStarts[q]) nt = BLOB.mesh(this.bPts, bStarts[q + 1], rb, rb * 2.0, rb * 0.8, this.bOut, this.bMaxT, nt, bStarts[q]);
      // keep playback smooth: on a slow computer fewer torn molecules are merged (the rest stay beads)
      const dt = performance.now() - t0; if (nb >= (this.bBudget || 8000) * 0.9) this.bBudget = clamp(Math.round((this.bBudget || 8000) * (dt > 30 ? 0.8 : dt < 12 ? 1.1 : 1)), 1500, Math.max(1500, PERF.blobMax || 12000));
      g.setDrawRange(0, nt * 3);
      for (const a of ['position', 'normal', 'color']) { const at = g.attributes[a]; at.clearUpdateRanges(); at.addUpdateRange(0, nt * 9); at.needsUpdate = true; }
      this.blob.visible = true;
    } else { this.blob.visible = false; this.blob.geometry.setDrawRange(0, 0); }
    // level of detail: big clouds use lower-poly beads and stop casting shadows to keep the frame rate up
    const g = k > PERF.lodAt ? this.sphereLo : this.sphere; if (this.pts.geometry !== g) this.pts.geometry = g;
    this.pts.castShadow = k < PERF.beadShadowMax;
    this.pts.instanceMatrix.needsUpdate = true; this.pts.instanceColor.needsUpdate = true;
    this.visibleCount = nv;
  },
};
function BLD_RNG(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
