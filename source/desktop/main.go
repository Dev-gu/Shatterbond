// Shatterbond desktop launcher for Windows.
//
// Serves the bundled app (HTML + three.js, so it works offline) from 127.0.0.1 and opens it in its
// own app window using Microsoft Edge or Google Chrome with a private profile. The fixed port keeps
// the same origin between runs, so the scene library and autosave stay put.
package main

import (
	"embed"
	"encoding/json"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

//go:embed all:web
var webFS embed.FS

const port = "47231"

// appVersion lets a new copy notice an older one still holding the port.
const appVersion = "40-play-vr6"

var lastBeat atomic.Int64
var byeAt atomic.Int64

func main() {
	site, err := fs.Sub(webFS, "web")
	if err != nil {
		fatal("The app files are missing from this program.")
	}
	url := "http://127.0.0.1:" + port + "/"
	ln, err := net.Listen("tcp", "127.0.0.1:"+port)
	if err != nil {
		if isOurs(url) { // already running: just open another window onto it
			if !sameVersion(url) {
				fatal("An older copy of Shatterbond is still running.\n\nClose every Shatterbond window (check the taskbar), wait a few seconds, then open this one again.")
			}
			launch(url)
			return
		}
		ln, err = net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			fatal("Shatterbond could not start its local server:\n" + err.Error())
		}
		url = "http://" + ln.Addr().String() + "/"
	}

	files := http.FileServer(http.FS(site))
	mux := http.NewServeMux()
	mux.HandleFunc("/__openvr", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || !strings.HasPrefix(r.RemoteAddr, "127.0.0.1:") {
			http.Error(w, "no", http.StatusForbidden)
			return
		}
		if err := launchVR(url); err != nil {
			http.Error(w, "Chrome or Edge was not found", http.StatusNotFound)
			return
		}
		io.WriteString(w, "ok")
	})
	mux.HandleFunc("/__alive", func(w http.ResponseWriter, r *http.Request) {
		lastBeat.Store(time.Now().Unix())
		w.Header().Set("Cache-Control", "no-store")
		io.WriteString(w, "shatterbond")
	})
	mux.HandleFunc("/__bye", func(w http.ResponseWriter, r *http.Request) {
		// the window is closing (or reloading): if nothing checks in again shortly, shut everything down
		byeAt.Store(time.Now().UnixMilli())
		w.WriteHeader(204)
	})
	mux.HandleFunc("/__version", func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, appVersion) })
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		if strings.HasSuffix(r.URL.Path, ".js") {
			w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
		}
		files.ServeHTTP(w, r)
	})
	addHostRoutes(mux)
	go http.Serve(ln, mux)
	startRemote(site)

	lastBeat.Store(time.Now().Unix())
	cmd := launch(url)
	quit := func() {
		// close the app window's whole browser process tree too, so nothing keeps running in the background
		if cmd != nil && cmd.Process != nil {
			tk := exec.Command("taskkill", "/PID", strconv.Itoa(cmd.Process.Pid), "/T", "/F")
			hideWindow(tk)
			tk.Run()
		}
		killProfileBrowsers()
		os.Exit(0)
	}
	// Stay up only while the window is open. The page checks in every 5 s and says goodbye when it closes;
	// a reload checks in again within a moment, a real close does not.
	start := time.Now()
	for {
		time.Sleep(1 * time.Second)
		now := time.Now()
		if b := byeAt.Load(); b > 0 && now.UnixMilli()-b > 4000 && lastBeat.Load()*1000 < b {
			quit()
		}
		if now.Sub(start) > 60*time.Second && now.Unix()-lastBeat.Load() > 25 {
			quit()
		}
	}
}

// killProfileBrowsers ends any browser processes still using Shatterbond's own profile folder
// (Edge and Chrome can linger in the background after their last window closes).
func killProfileBrowsers() {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		return
	}
	profile := filepath.Join(base, "Shatterbond", "Browser")
	ps := "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*" + strings.ReplaceAll(profile, "'", "''") + "*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
	c := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", ps)
	hideWindow(c)
	c.Run()
}

func isOurs(url string) bool {
	c := http.Client{Timeout: 2 * time.Second}
	r, err := c.Get(url + "__alive")
	if err != nil {
		return false
	}
	defer r.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(r.Body, 64))
	return string(b) == "shatterbond"
}

// findChrome prefers Google Chrome (its WebXR works with every OpenXR runtime), then Edge
func findChrome() string {
	roots := []string{os.Getenv("ProgramFiles"), os.Getenv("ProgramFiles(x86)"), os.Getenv("LOCALAPPDATA")}
	for _, rel := range []string{`Google\Chrome\Application\chrome.exe`, `Microsoft\Edge\Application\msedge.exe`} {
		for _, root := range roots {
			if root == "" {
				continue
			}
			c := filepath.Join(root, rel)
			if st, err := os.Stat(c); err == nil && !st.IsDir() {
				return c
			}
		}
	}
	return ""
}

// launchVR opens a second window just for VR play, in Chrome with its own profile
func launchVR(url string) error {
	exe := findChrome()
	if exe == "" {
		return os.ErrNotExist
	}
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		base = os.TempDir()
	}
	profile := filepath.Join(base, "Shatterbond", "BrowserVR")
	os.MkdirAll(profile, 0o755)
	allowVR(profile, url)
	return exec.Command(exe, "--app="+url+"?vr=1", "--user-data-dir="+profile, "--no-first-run", "--no-default-browser-check",
		"--window-size=1280,800", "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding",
		// the VR runtime (Meta Link / SteamVR) has to load inside the browser's XR process; the sandbox around that
		// process blocks runtimes that don't support it, which shows up as "session configuration is not supported"
		"--disable-features=XRSandbox", "--enable-features=WebXR,OpenXR,WebXRHandInput", "--force-webxr-runtime=openxr").Start()
}

// allowVR pre-answers Chrome's "use your virtual reality devices" question for this one local site. The
// question appears on the PC screen, not in the headset, so a player in VR never sees it and the headset
// sits on its loading screen. Only the VR window's own profile is touched; open Chrome windows keep theirs.
func allowVR(profile, url string) {
	dir := filepath.Join(profile, "Default")
	os.MkdirAll(dir, 0o755)
	file := filepath.Join(dir, "Preferences")
	prefs := map[string]any{}
	if b, err := os.ReadFile(file); err == nil {
		json.Unmarshal(b, &prefs)
	}
	sub := func(m map[string]any, k string) map[string]any {
		if v, ok := m[k].(map[string]any); ok {
			return v
		}
		v := map[string]any{}
		m[k] = v
		return v
	}
	origin := strings.TrimSuffix(url, "/") + ",*"
	ex := sub(sub(sub(prefs, "profile"), "content_settings"), "exceptions")
	for _, t := range []string{"vr", "ar", "hand_tracking"} {
		sub(ex, t)[origin] = map[string]any{"setting": 1, "last_modified": "13350000000000000"}
	}
	if b, err := json.Marshal(prefs); err == nil {
		os.WriteFile(file, b, 0o644)
	}
}

func findBrowser() string {
	var cands []string
	roots := []string{os.Getenv("ProgramFiles(x86)"), os.Getenv("ProgramFiles"), os.Getenv("LOCALAPPDATA")}
	for _, rel := range []string{`Microsoft\Edge\Application\msedge.exe`, `Google\Chrome\Application\chrome.exe`} {
		for _, root := range roots {
			if root != "" {
				cands = append(cands, filepath.Join(root, rel))
			}
		}
	}
	for _, c := range cands {
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c
		}
	}
	return ""
}

// launch opens the app window and returns the browser process, or nil if it fell back to the
// default browser.
func launch(url string) *exec.Cmd {
	if exe := findBrowser(); exe != "" {
		base := os.Getenv("LOCALAPPDATA")
		if base == "" {
			base = os.TempDir()
		}
		profile := filepath.Join(base, "Shatterbond", "Browser")
		os.MkdirAll(profile, 0o755)
		cmd := exec.Command(exe,
			"--app="+url,
			"--user-data-dir="+profile,
			"--no-first-run",
			"--no-default-browser-check",
			"--window-size=1600,960",
			// keep simulating and streaming to the phone while the window is in the background
			"--disable-background-timer-throttling",
			"--disable-backgrounding-occluded-windows",
			"--disable-renderer-backgrounding",
			// do not keep running in the background after the window closes
			"--disable-background-mode",
			"--disable-features=msEdgeStartupBoost,msEdgeSidebarV2,XRSandbox",
			// play mode: VR through whatever OpenXR runtime is active (Quest Link / Meta Horizon Link or SteamVR)
			"--enable-features=WebXR,OpenXR,WebXRHandInput",
			"--force-webxr-runtime=openxr",
		)
		if err := cmd.Start(); err == nil {
			return cmd
		}
	}
	exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	return nil
}

func sameVersion(url string) bool {
	c := http.Client{Timeout: 2 * time.Second}
	r, err := c.Get(url + "__version")
	if err != nil {
		return false
	}
	defer r.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(r.Body, 64))
	return r.StatusCode == 200 && string(b) == appVersion
}
