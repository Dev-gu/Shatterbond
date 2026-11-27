#!/bin/sh
# Builds dist/Shatterbond.exe (Windows x64). Needs Go 1.22+ and go-winres (go install github.com/tc-hib/go-winres@latest).
set -e
cd "$(dirname "$0")"
python3 ../build.py
rm -rf web && cp -r ../dist/desktop/web web
cp icon192.png web/icon.png
cp remote.html remote.webmanifest web/
sed -i 's#<title>Shatterbond</title>#<title>Shatterbond</title>\n<link rel="icon" href="/icon.png">#' web/index.html
"${GOWINRES:-$HOME/go/bin/go-winres}" make --arch amd64
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-H=windowsgui -s -w" -o ../dist/Shatterbond.exe .
ls -la ../dist/Shatterbond.exe
