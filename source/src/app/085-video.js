/* ===================== video export: frame-exact offline encoding (WebCodecs) + WebM / MP4 muxers ===================== */
// Every frame of the range is rendered and handed to the encoder with an exact timestamp, so the file
// plays at the scene frame rate no matter how slowly the machine renders. MediaRecorder is the fallback.
const VIDEO = {
  supported: typeof VideoEncoder === 'function' && typeof VideoFrame === 'function',
  codecs: {
    mp4: ['avc1.640034', 'avc1.640033', 'avc1.64002a', 'avc1.640028', 'avc1.4d0034', 'avc1.4d0033', 'avc1.4d0028', 'avc1.42e034', 'avc1.42e028'],
    webm: ['vp09.00.51.08', 'vp09.00.41.08', 'vp09.00.40.08', 'vp09.00.31.08', 'vp8'],
  },
  async pick(fmt, w, h, fps, bitrate) {
    for (const codec of this.codecs[fmt]) {
      const cfg = { codec, width: w, height: h, bitrate, framerate: fps };
      if (codec.startsWith('avc')) cfg.avc = { format: 'avc' };
      try { const s = await VideoEncoder.isConfigSupported(cfg); if (s && s.supported) return cfg; } catch (e) { /* try the next one */ }
    }
    return null;
  },
};
function videoBitrate(w, h, fps) {
  const base = { high: 20e6, med: 10e6, low: 4e6 }[OUT.quality] || 10e6;
  return Math.round(base * (w * h) / (1920 * 1080) * Math.sqrt(clamp(fps / 30, 0.5, 2.5)));
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Render one output frame exactly as the viewport would show it, from the output camera.
function renderOutputFrame(f, w, h) {
  APP.frame = f; APP.lastEvalFrame = f; APP.evalStamp++;
  evaluateScene(f); applyWorldLook(APP.worldP);
  for (const b of MOL.bodies) if (!b.isHuman) { const P = b.obj._eval || b.obj.props; if ((P.color || '') !== b.colorKey) { MOL.recolor(); break; } }
  MOL.applyStyle(); updateBodies(true);
  hideHelpers(true); R.gizmoHelper.visible = false;
  renderScene(camForOutput(w / h, OUT.useCam, true), { sceneCam: OUT.useCam, frame: f, camFn: () => camForOutput(w / h, OUT.useCam, true) });
}

async function encodeVideo(rec) {
  const [w0, h0] = outSize();
  const w = Math.max(2, w0 & ~1), h = Math.max(2, h0 & ~1);
  const fps = fpsOf(), bitrate = videoBitrate(w, h, fps);
  let fmt = OUT.format === 'webm' ? 'webm' : 'mp4';
  let cfg = await VIDEO.pick(fmt, w, h, fps, bitrate);
  if (!cfg) { fmt = fmt === 'mp4' ? 'webm' : 'mp4'; cfg = await VIDEO.pick(fmt, w, h, fps, bitrate); }
  if (!cfg || rec.cancel) return !!rec.cancel;
  const chunks = []; let desc = null, fail = null;
  const enc = new VideoEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
      chunks.push({ data, key: chunk.type === 'key', ts: chunk.timestamp });
      const d = meta && meta.decoderConfig && meta.decoderConfig.description;
      if (d && !desc) desc = ArrayBuffer.isView(d) ? new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength)) : new Uint8Array(d.slice(0));
    },
    error: (e) => { fail = e; },
  });
  try { enc.configure(cfg); } catch (e) { return false; }
  rec.phase = 'enc'; rec.fmt = fmt;
  rec.saved = enterOutputMode(w, h);
  const n = rec.e - rec.s + 1, gop = Math.max(1, Math.round(fps * 2));
  setStatusHint('Rendering video… press Esc to cancel');
  try {
    for (let i = 0; i < n && !rec.cancel && !fail; i++) {
      renderOutputFrame(rec.s + i, w, h);
      const vf = new VideoFrame(R.renderer.domElement, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
      enc.encode(vf, { keyFrame: i % gop === 0 }); vf.close();
      UI.busy(`Rendering video: frame ${i + 1} of ${n}  (Esc cancels)`, (i + 1) / n);
      if (i % 4 === 0) { TL.dirty = true; TL.updateFrameField(); TL.draw(); }
      while (enc.encodeQueueSize > 2 && !fail && !rec.cancel) await sleep(3);
      await sleep(0);
    }
    if (!fail && !rec.cancel) { UI.busy('Finishing the video file…', 1); await enc.flush(); }
  } catch (e) { fail = fail || e; }
  try { enc.close(); } catch (e) { /* already closed */ }
  leaveOutputMode(rec.saved);
  APP.recording = null; setStatusHint(null); UI.busy(null);
  APP.frame = rec.frame0; APP.dirtyEval = true; TL.dirty = true; TL.updateFrameField();
  if (rec.cancel) { toast('Video cancelled'); return true; }
  if (fail || !chunks.length) { toast('Video encoding failed' + (fail ? ': ' + (fail.message || fail) : ''), true); return true; }
  let blob;
  try {
    const track = { w, h, fps, codec: cfg.codec, desc };
    blob = fmt === 'mp4' ? muxMP4(chunks, track) : muxWebM(chunks, track);
  } catch (e) { toast('Could not write the video file: ' + e.message, true); return true; }
  await saveFile(`${slug(APP.scene.name)}.${fmt}`, blob);
  return true;
}

/* ---------- WebM (Matroska) writer ---------- */
function vbytes(n, len) { // big-endian unsigned integer in len bytes
  const b = new Uint8Array(len); let v = n;
  for (let i = len - 1; i >= 0; i--) { b[i] = v % 256; v = Math.floor(v / 256); }
  return b;
}
function ebId(id) { let len = 1; while (id >= 2 ** (8 * len)) len++; return vbytes(id, len); }
function ebSize(n) { let len = 1; while (n >= 2 ** (7 * len) - 1) len++; const b = vbytes(n, len); b[0] |= 1 << (8 - len); return b; }
const partsLen = (parts) => parts.reduce((s, p) => s + p.length, 0);
function E(id, ...kids) { const parts = kids.flat(Infinity).filter(Boolean); return [ebId(id), ebSize(partsLen(parts)), ...parts]; }
function Eu(id, n, len) { if (len == null) { len = 1; while (n >= 2 ** (8 * len)) len++; } return E(id, vbytes(n, len)); }
const Es = (id, s) => E(id, new TextEncoder().encode(s));
function Ef(id, x) { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, x); return E(id, b); }

function muxWebM(chunks, t) {
  const ms = (i) => Math.round(i * 1000 / t.fps);
  const durMs = chunks.length * 1000 / t.fps;
  const info = E(0x1549A966, Eu(0x2AD7B1, 1000000), Es(0x4D80, 'Shatterbond'), Es(0x5741, 'Shatterbond'), Ef(0x4489, durMs));
  const tracks = E(0x1654AE6B, E(0xAE,
    Eu(0xD7, 1), Eu(0x73C5, 1), Eu(0x83, 1), Eu(0x9C, 0), Es(0x22B59C, 'und'),
    Es(0x86, t.codec.startsWith('vp8') ? 'V_VP8' : 'V_VP9'), Eu(0x23E383, Math.round(1e9 / t.fps)),
    E(0xE0, Eu(0xB0, t.w), Eu(0xBA, t.h))));
  // clusters: a new one at every keyframe (and at least every 30 s, the limit of the 16-bit relative time)
  const clusters = []; let cur = null;
  chunks.forEach((c, i) => {
    const time = ms(i);
    if (!cur || c.key || time - cur.time > 30000) { cur = { time, blocks: [] }; clusters.push(cur); }
    const rel = time - cur.time;
    cur.blocks.push(E(0xA3, new Uint8Array([0x81, (rel >> 8) & 255, rel & 255, c.key ? 0x80 : 0]), c.data));
  });
  const clusterParts = clusters.map(cl => E(0x1F43B675, Eu(0xE7, cl.time), cl.blocks));
  const seekHead = (pos) => E(0x114D9B74, ...[[0x1549A966, pos.info], [0x1654AE6B, pos.tracks], [0x1C53BB6B, pos.cues]]
    .map(([id, p]) => E(0x4DBB, E(0x53AB, ebId(id)), Eu(0x53AC, p, 8))));
  const shLen = partsLen(seekHead({ info: 0, tracks: 0, cues: 0 }));
  const posInfo = shLen, posTracks = posInfo + partsLen(info);
  let off = posTracks + partsLen(tracks);
  const cuePoints = clusterParts.map((cp, i) => { const at = off; off += partsLen(cp); return E(0xBB, Eu(0xB3, clusters[i].time), E(0xB7, Eu(0xF7, 1), Eu(0xF1, at))); });
  const cues = E(0x1C53BB6B, cuePoints);
  const segment = E(0x18538067, seekHead({ info: posInfo, tracks: posTracks, cues: off }), info, tracks, clusterParts, cues);
  const header = E(0x1A45DFA3, Eu(0x4286, 1), Eu(0x42F7, 1), Eu(0x42F2, 4), Eu(0x42F3, 8), Es(0x4282, 'webm'), Eu(0x4287, 4), Eu(0x4285, 2));
  return new Blob([...header, ...segment], { type: 'video/webm' });
}

/* ---------- MP4 (ISO BMFF) writer, H.264, moov before mdat so it streams ---------- */
const u8 = (n) => new Uint8Array([n & 255]);
const u16 = (n) => vbytes(n & 0xffff, 2);
const u32 = (n) => vbytes(n >>> 0, 4);
const ascii = (s) => new TextEncoder().encode(s);
function BX(type, ...kids) { const parts = kids.flat(Infinity).filter(Boolean); return [u32(8 + partsLen(parts)), ascii(type), ...parts]; }
const FB = (type, ver, flags, ...kids) => BX(type, u8(ver), vbytes(flags, 3), ...kids);
const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].map(u32);

function muxMP4(chunks, t) {
  if (!t.desc) throw new Error('the encoder gave no stream description');
  const TS = 90000, delta = Math.round(TS / t.fps), n = chunks.length;
  const durTrack = n * delta, durMovie = Math.round(n * 1000 / t.fps);
  const sizes = chunks.map(c => c.data.length);
  const keys = []; chunks.forEach((c, i) => { if (c.key) keys.push(i + 1); });
  const name = new Uint8Array(32); const nm = ascii('Shatterbond H.264'); name[0] = nm.length; name.set(nm, 1);
  const moov = (offsets) => BX('moov',
    FB('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(durMovie), u32(0x00010000), u16(0x0100), u16(0), u32(0), u32(0), MATRIX, [0, 0, 0, 0, 0, 0].map(u32), u32(2)),
    BX('trak',
      FB('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(durMovie), u32(0), u32(0), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(t.w * 65536), u32(t.h * 65536)),
      BX('mdia',
        FB('mdhd', 0, 0, u32(0), u32(0), u32(TS), u32(durTrack), u16(0x55C4), u16(0)),
        FB('hdlr', 0, 0, u32(0), ascii('vide'), u32(0), u32(0), u32(0), ascii('VideoHandler\0')),
        BX('minf',
          FB('vmhd', 0, 1, u16(0), u16(0), u16(0), u16(0)),
          BX('dinf', FB('dref', 0, 0, u32(1), FB('url ', 0, 1))),
          BX('stbl',
            FB('stsd', 0, 0, u32(1), BX('avc1', new Uint8Array(6), u16(1), u16(0), u16(0), u32(0), u32(0), u32(0), u16(t.w), u16(t.h),
              u32(0x00480000), u32(0x00480000), u32(0), u16(1), name, u16(0x0018), u16(0xffff), BX('avcC', t.desc))),
            FB('stts', 0, 0, u32(1), u32(n), u32(delta)),
            keys.length < n ? FB('stss', 0, 0, u32(keys.length), keys.map(u32)) : null,
            FB('stsc', 0, 0, u32(1), u32(1), u32(1), u32(1)),
            FB('stsz', 0, 0, u32(0), u32(n), sizes.map(u32)),
            FB('stco', 0, 0, u32(n), offsets.map(u32)))))));
  const ftyp = BX('ftyp', ascii('isom'), u32(512), ascii('isom'), ascii('iso2'), ascii('avc1'), ascii('mp41'));
  const mdatLen = 8 + sizes.reduce((a, b) => a + b, 0);
  if (mdatLen > 0xffffffff) throw new Error('the video is too large for one file; try a shorter range or lower quality');
  const head = partsLen(ftyp) + partsLen(moov(new Array(n).fill(0))) + 8;
  const offsets = []; let o = head; for (const s of sizes) { offsets.push(o); o += s; }
  return new Blob([...ftyp, ...moov(offsets), u32(mdatLen), ascii('mdat'), ...chunks.map(c => c.data)], { type: 'video/mp4' });
}
