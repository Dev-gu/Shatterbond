#!/usr/bin/env python3
"""Bundle Shatterbond into one HTML page.

dist/shatterbond.artifact.html  - page content for the claude.ai Artifact (no doctype/html/head/body)
dist/shatterbond.html           - standalone page that opens straight from disk
"""
import os, glob, json, re

ROOT = os.path.dirname(os.path.abspath(__file__))
THREE_VER = '0.170.0'
CDN = f'https://cdn.jsdelivr.net/npm/three@{THREE_VER}'

def read(p):
    with open(os.path.join(ROOT, p), encoding='utf-8') as f:
        return f.read()

def esc_script(js):
    # a literal "</script" inside inline code would end the element early
    return js.replace('</script', '<\\/script')

shell = read('src/shell.html')
engine_src = read('src/mhbody.js') + '\n' + read('src/builder.js') + '\n' + read('src/gpu.js') + '\n' + read('src/engine.js')
app_files = sorted(glob.glob(os.path.join(ROOT, 'src/app/*.js')))
app = '\n'.join(open(p, encoding='utf-8').read() for p in app_files)

importmap = json.dumps({'imports': {
    'three': f'{CDN}/build/three.module.js',
    'three/addons/': f'{CDN}/examples/jsm/',
}})
module = (
    "import * as THREE from 'three';\n"
    "import { OrbitControls } from 'three/addons/controls/OrbitControls.js';\n"
    "import { TransformControls } from 'three/addons/controls/TransformControls.js';\n"
    "import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';\n"
    "import { edgeTable, triTable } from 'three/addons/objects/MarchingCubes.js';\n"
    + app
)

body = (
    shell
    + '\n<script id="engine-src">\n' + esc_script(engine_src) + '\n</script>\n'
    + '<script type="importmap">' + importmap + '</script>\n'
    + '<script type="module">\n' + esc_script(module) + '\n</script>\n'
)

os.makedirs(os.path.join(ROOT, 'dist'), exist_ok=True)
with open(os.path.join(ROOT, 'dist/shatterbond.artifact.html'), 'w', encoding='utf-8') as f:
    f.write(body)

# standalone: wrap in a full document; head gets title/meta/fonts/style, body gets the rest
m = re.search(r'</style>', shell)
head_part = shell[:m.end()]
rest = body[len(head_part):]
standalone = (
    '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
    + head_part + '\n</head>\n<body>\n' + rest + '</body>\n</html>\n'
)
with open(os.path.join(ROOT, 'dist/shatterbond.html'), 'w', encoding='utf-8') as f:
    f.write(standalone)

print('artifact', len(body), 'bytes; standalone', len(standalone), 'bytes')

# desktop: the same page served by the Windows launcher from 127.0.0.1, with three.js bundled so it runs offline
import shutil
DESK = os.path.join(ROOT, 'dist/desktop/web')
if os.path.isdir(DESK): shutil.rmtree(DESK)
os.makedirs(os.path.join(DESK, 'lib/addons/controls'), exist_ok=True)
os.makedirs(os.path.join(DESK, 'lib/addons/environments'), exist_ok=True)
os.makedirs(os.path.join(DESK, 'lib/addons/objects'), exist_ok=True)
for d in ['loaders', 'libs', 'curves']: os.makedirs(os.path.join(DESK, 'lib/addons', d), exist_ok=True)
T = os.path.join(ROOT, 'node_modules/three')
shutil.copy(os.path.join(T, 'build/three.module.min.js'), os.path.join(DESK, 'lib/three.module.min.js'))
for rel in ['controls/OrbitControls.js', 'controls/TransformControls.js', 'environments/RoomEnvironment.js', 'objects/MarchingCubes.js',
            'loaders/FBXLoader.js', 'libs/fflate.module.js', 'curves/NURBSCurve.js', 'curves/NURBSUtils.js']:
    shutil.copy(os.path.join(T, 'examples/jsm', rel), os.path.join(DESK, 'lib/addons', rel))
local_map = json.dumps({'imports': {'three': '/lib/three.module.min.js', 'three/addons/': '/lib/addons/'}})
heartbeat = ("<script>/* tells the desktop launcher the window is still open */"
             "(function(){function p(){fetch('/__alive',{cache:'no-store'}).catch(function(){});}p();setInterval(p,5000);"
             "addEventListener('pagehide',function(){try{navigator.sendBeacon('/__bye');}catch(e){}});})();</script>\n")
desktop = standalone.replace('<script type="importmap">' + importmap + '</script>', '<script type="importmap">' + local_map + '</script>')
assert desktop != standalone
desktop = desktop.replace('<body>\n', '<body>\n' + heartbeat, 1)
with open(os.path.join(DESK, 'index.html'), 'w', encoding='utf-8') as f:
    f.write(desktop)
print('desktop web', len(desktop), 'bytes')

# web: the same offline-capable page for static hosting (GitHub Pages) under any subpath,
# three.js bundled next to it with relative paths so blocked CDNs (school networks) don't matter
WEB = os.path.join(ROOT, 'dist/web')
if os.path.isdir(WEB): shutil.rmtree(WEB)
shutil.copytree(os.path.join(DESK, 'lib'), os.path.join(WEB, 'lib'))
rel_map = json.dumps({'imports': {'three': './lib/three.module.min.js', 'three/addons/': './lib/addons/'}})
web = standalone.replace('<script type="importmap">' + importmap + '</script>', '<script type="importmap">' + rel_map + '</script>')
assert web != standalone
with open(os.path.join(WEB, 'index.html'), 'w', encoding='utf-8') as f:
    f.write(web)
open(os.path.join(WEB, '.nojekyll'), 'w').close()
print('web', len(web), 'bytes')
