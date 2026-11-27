# Shatterbond

A 3D molecular ragdoll simulator that runs in the browser. Bodies are made of bonded particles that bend, tear and shatter when weapons, explosions and flying objects hit them. Blender-style editor with keyframes, cameras, depth of field, emitters and video export.

**Play:** https://dev-gu.github.io/Shatterbond/ (GitHub Pages, rebuilt from `index.html` on every push to main).

## Source
- `source/src` app, physics engine (Web Worker), anatomy builder
- `source/build.py` bundles everything into one HTML page (`python3 build.py`, needs `npm i` for three.js in the desktop build)
- `source/desktop` Windows launcher (Go) that embeds the page and runs it offline
- `source/test` Playwright and Node tests
