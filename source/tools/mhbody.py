#!/usr/bin/env python3
"""Make src/mhbody.js: the humanoid body shape from the MakeHuman base mesh (CC0 1.0, makehumancommunity/makehuman).

Inputs (download into a folder and pass it as argv[1]): base.obj, caucasian-male-young.target,
universal-male-young-maxmuscle-averageweight.target, male-young-averagemuscle-averageweight-idealproportions.target.
Output: positions (metres, feet at y=0, facing +z), triangles, rest joints and 4 bone weights per vertex.
"""
import sys, os, json, base64, math, collections
import numpy as np

SRC = sys.argv[1]
MUSCLE = float(os.environ.get('MUSCLE', '0.45'))
PROP = float(os.environ.get('PROP', '0.6'))

V = []; groups = collections.defaultdict(list); g = None
for line in open(os.path.join(SRC, 'base.obj')):
    if line.startswith('v '): V.append([float(t) for t in line.split()[1:4]])
    elif line.startswith('g '): g = line.split()[1]
    elif line.startswith('f '): groups[g].append([int(t.split('/')[0]) - 1 for t in line.split()[1:]])
V = np.array(V)

def target(name, w):
    for line in open(os.path.join(SRC, name)):
        if not line.strip() or line.startswith('#'): continue
        a = line.split(); V[int(a[0])] += w * np.array([float(a[1]), float(a[2]), float(a[3])])
target('caucasian-male-young.target', 1.0)
target('universal-male-young-maxmuscle-averageweight.target', MUSCLE)
target('male-young-averagemuscle-averageweight-idealproportions.target', PROP)

def jc(name):
    f = groups['joint-' + name]; ids = sorted({i for q in f for i in q}); return V[ids].mean(0)

body = groups['body']
used = sorted({i for q in body for i in q}); remap = {v: k for k, v in enumerate(used)}
P = V[used].copy()
tris = []
for q in body:
    q = [remap[i] for i in q]
    tris.append([q[0], q[1], q[2]])
    if len(q) == 4: tris.append([q[0], q[2], q[3]])
tris = np.array(tris)

J = {k: jc(k) for k in ['head', 'neck', 'spine-1', 'spine-2', 'spine-3', 'spine-4', 'pelvis', 'l-shoulder', 'l-elbow', 'l-hand', 'r-shoulder', 'r-elbow', 'r-hand',
                        'l-upper-leg', 'l-knee', 'l-ankle', 'l-foot-1', 'l-foot-2', 'r-upper-leg', 'r-knee', 'r-ankle', 'r-foot-1', 'r-foot-2', 'l-finger-3-4', 'r-finger-3-4', 'head-2', 'l-clavicle', 'r-clavicle', 'mouth', 'jaw', 'l-eye', 'r-eye']
     + ['%s-finger-%d-%d' % (sd, f, k) for sd in 'lr' for f in range(1, 6) for k in range(1, 5)]}
# metres, feet on the floor, centred
ymin = P[:, 1].min(); sc = 1.8 / (P[:, 1].max() - ymin)
cx = (P[:, 0].max() + P[:, 0].min()) / 2; cz = J['pelvis'][2]
def tf(p): return np.array([(p[0] - cx) * sc, (p[1] - ymin) * sc, (p[2] - cz) * sc])
P = np.array([tf(p) for p in P]); J = {k: tf(v) for k, v in J.items()}
# MakeHuman "l" is the figure's left = +x when it faces +z
if J['l-shoulder'][0] < 0: P[:, 0] *= -1; J = {k: v * [-1, 1, 1] for k, v in J.items()}
print('height', P[:, 1].max(), 'verts', len(P), 'tris', len(tris), 'nose z', P[np.argmax(P[:, 2])])
for k in ['l-shoulder', 'l-elbow', 'l-hand', 'l-upper-leg', 'l-knee', 'l-ankle', 'neck', 'head', 'pelvis', 'spine-3']: print(k, np.round(J[k], 3))

# bones (same ids as the builder's segments): 0 head, 1 neck, 2 chest, 3 abdomen, 4 pelvis, 5/8 upper arm, 6/9 forearm, 7/10 hand,
# 11/14 thigh, 12/15 shin, 13/16 foot   (first of each pair is the figure's left = +x)
B = {0: (J['neck'] * 0.3 + J['head'] * 0.7, J['head-2']), 1: (J['spine-1'] * 0 + J['neck'], J['head']), 2: (J['spine-2'], J['neck']), 3: (J['spine-4'], J['spine-2']), 4: (J['l-upper-leg'] * 0.5 + J['r-upper-leg'] * 0.5, J['spine-4'])}
for s, L in (('l', 0), ('r', 1)):
    B[5 + 3 * L] = (J[s + '-shoulder'], J[s + '-elbow']); B[6 + 3 * L] = (J[s + '-elbow'], J[s + '-hand']); B[7 + 3 * L] = (J[s + '-hand'], J[s + '-finger-3-4'])
    B[11 + 3 * L] = (J[s + '-upper-leg'], J[s + '-knee']); B[12 + 3 * L] = (J[s + '-knee'], J[s + '-ankle']); B[13 + 3 * L] = (J[s + '-ankle'], J[s + '-foot-2'])
ADJ = {0: [1], 1: [0, 2], 2: [1, 3, 5, 8], 3: [2, 4], 4: [3, 11, 14], 5: [2, 6], 6: [5, 7], 7: [6], 8: [2, 9], 9: [8, 10], 10: [9], 11: [4, 12], 12: [11, 13], 13: [12], 14: [4, 15], 15: [14, 16], 16: [15]}
def segd(p, a, b):
    ab = b - a; t = np.clip(((p - a) @ ab) / (ab @ ab), 0, 1); return np.linalg.norm(p - (a + t[:, None] * ab), axis=1)
D = np.stack([segd(P, *B[b]) for b in range(17)], 1)
# torso parts are wide: measure them along the spine only so the belly is not claimed by an arm bone
own = np.argmin(D + np.where(np.arange(17) <= 4, -0.02, 0), 1)
W = np.zeros((len(P), 17))
for v in range(len(P)):
    o = own[v]; cand = [o] + ADJ[o]
    d = D[v, cand]; w = np.exp(-((d - d.min()) / 0.035) ** 2); w[0] = max(w[0], 1e-3)
    W[v, cand] = w / w.sum()
idx = np.argsort(-W, 1)[:, :4]; wt = np.take_along_axis(W, idx, 1); wt = wt / wt.sum(1, keepdims=True)
q = (np.round(P / 0.00006)).astype(np.int16)  # 0.06 mm steps, +-1.96 m
wq = np.round(wt * 255).astype(np.uint8)
out = {
    'n': len(P), 'scale': 0.00006,
    'pos': base64.b64encode(q.tobytes()).decode(), 'idx': base64.b64encode(tris.astype(np.uint16).tobytes()).decode(),
    'bi': base64.b64encode(idx.astype(np.uint8).tobytes()).decode(), 'bw': base64.b64encode(wq.tobytes()).decode(),
    'bones': {str(k): [list(map(lambda x: round(float(x), 5), B[k][0])), list(map(lambda x: round(float(x), 5), B[k][1]))] for k in B},
    'joints': {k: [round(float(x), 5) for x in v] for k, v in J.items()},
}
js = ('/* Humanoid body shape derived from the MakeHuman base mesh and targets (CC0 1.0 Universal, makehumancommunity.org).\n'
      ' * Generated by tools/mhbody.py: male, young, muscle %.2f, ideal proportions %.2f. */\n' % (MUSCLE, PROP)
      + '(function (root) { const M = ' + json.dumps(out, separators=(',', ':')) + ';\n'
      + 'root.SB_MHBODY = M; if (typeof module !== "undefined" && module.exports) module.exports = M; })(typeof self !== "undefined" ? self : globalThis);\n')
open(os.path.join(os.path.dirname(__file__), '..', 'src', 'mhbody.js'), 'w').write(js)
print('wrote', len(js), 'bytes')
