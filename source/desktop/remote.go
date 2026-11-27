// Phone remote over Tailscale.
//
// The desktop window keeps running the simulation. It pushes JPEG frames of a phone camera and a
// small state summary to this server, and polls it for commands. A phone on the same tailnet opens
// http://<pc>:47231/ and gets a touch remote: the live picture, camera gestures, play/pause, scrubbing
// and the scene list. The phone side is only served on this PC's Tailscale addresses, so only
// devices signed in to the same tailnet can reach it.
package main

import (
	"bytes"
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
	"sync"
	"time"

	qrcode "github.com/skip2/go-qrcode"
)

type hub struct {
	mu        sync.Mutex
	frame     []byte
	seq       int64
	frameCh   chan struct{} // closed when a new frame arrives
	state     []byte
	cmds      [][]byte
	cmdCh     chan struct{}
	lastPhone time.Time
	addrs     []string // tailscale IPv4 addresses we listen on
	dns       string   // MagicDNS name, e.g. "aiden.tail1234.ts.net"
	bound     map[string]bool
	serveOK   bool   // tailscale serve forwards http://<pc>/ to our loopback phone port
	serveMsg  string // why tailscale serve is not on, for the Phone panel
	phonePort string // loopback port tailscale serve forwards to
	clip      []byte // the finished simulation encoded as a video for the phone to play itself
	clipType  string
	clipID    string
}

const phonePort = "47232"

var H = &hub{frameCh: make(chan struct{}), cmdCh: make(chan struct{}), bound: map[string]bool{}}

func (h *hub) viewers() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	if time.Since(h.lastPhone) < 4*time.Second {
		return 1
	}
	return 0
}

func (h *hub) touch() { h.mu.Lock(); h.lastPhone = time.Now(); h.mu.Unlock() }

// links lists the phone URLs, nicest first.
func (h *hub) links() []string {
	h.mu.Lock()
	defer h.mu.Unlock()
	var out []string
	if h.serveOK { // through Tailscale itself: no firewall involved, plain port 80
		if h.dns != "" {
			out = append(out, "http://"+strings.SplitN(h.dns, ".", 2)[0]+"/", "http://"+h.dns+"/")
		}
		for _, a := range h.addrs {
			out = append(out, "http://"+a+"/")
		}
	}
	anyBound := false
	for _, v := range h.bound {
		anyBound = anyBound || v
	}
	if h.dns != "" && anyBound {
		short := strings.SplitN(h.dns, ".", 2)[0]
		out = append(out, "http://"+short+":"+port+"/", "http://"+h.dns+":"+port+"/")
	}
	for _, a := range h.addrs {
		if h.bound[a] {
			out = append(out, "http://"+a+":"+port+"/")
		}
	}
	return out
}

/* ---------- Tailscale discovery ---------- */

func tailscaleCLI() string {
	if p, err := exec.LookPath("tailscale"); err == nil {
		return p
	}
	for _, root := range []string{os.Getenv("ProgramFiles"), os.Getenv("ProgramFiles(x86)"), os.Getenv("LOCALAPPDATA")} {
		if root == "" {
			continue
		}
		p := filepath.Join(root, "Tailscale", "tailscale.exe")
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p
		}
	}
	return ""
}

// discover finds this PC's Tailscale IPv4 addresses and MagicDNS name.
func discover() (ips []string, dns string) {
	if cli := tailscaleCLI(); cli != "" {
		cmd := exec.Command(cli, "status", "--json", "--peers=false")
		hideWindow(cmd)
		if out, err := cmd.Output(); err == nil {
			var st struct {
				Self struct {
					DNSName      string
					TailscaleIPs []string
				}
			}
			if json.Unmarshal(out, &st) == nil {
				dns = strings.TrimSuffix(st.Self.DNSName, ".")
				for _, a := range st.Self.TailscaleIPs {
					if ip := net.ParseIP(a); ip != nil && ip.To4() != nil {
						ips = append(ips, a)
					}
				}
			}
		}
	}
	if len(ips) == 0 { // CLI missing: look for an interface address in Tailscale's 100.64.0.0/10 range
		_, cgnat, _ := net.ParseCIDR("100.64.0.0/10")
		if addrs, err := net.InterfaceAddrs(); err == nil {
			for _, a := range addrs {
				if n, ok := a.(*net.IPNet); ok && n.IP.To4() != nil && cgnat.Contains(n.IP) {
					ips = append(ips, n.IP.String())
				}
			}
		}
	}
	return
}

// startRemote keeps trying to listen on the Tailscale addresses (Tailscale may connect after us).
func startRemote(site fs.FS) {
	phone := phoneMux(site)
	// loopback copy of the phone page for tailscale serve to forward to
	if ln, err := net.Listen("tcp", "127.0.0.1:"+phonePort); err == nil {
		H.phonePort = phonePort
		go http.Serve(ln, phone)
	} else if ln, err := net.Listen("tcp", "127.0.0.1:0"); err == nil {
		H.phonePort = strconv.Itoa(ln.Addr().(*net.TCPAddr).Port)
		go http.Serve(ln, phone)
	}
	if a := os.Getenv("SHATTERBOND_REMOTE_ADDR"); a != "" { // testing hook: also serve the phone page here
		if ln, err := net.Listen("tcp", a); err == nil {
			go http.Serve(ln, phone)
		}
	}
	go func() {
		for {
			ips, dns := discover()
			if len(ips) > 0 {
				ensureServe()
			}
			H.mu.Lock()
			if dns != "" {
				H.dns = dns
			}
			H.addrs = ips
			H.mu.Unlock()
			for _, ip := range ips {
				H.mu.Lock()
				done := H.bound[ip]
				H.mu.Unlock()
				if done {
					continue
				}
				if ln, err := net.Listen("tcp", ip+":"+port); err == nil {
					H.mu.Lock()
					H.bound[ip] = true
					H.mu.Unlock()
					go func(ip string, ln net.Listener) {
						http.Serve(ln, phone)
						H.mu.Lock()
						H.bound[ip] = false
						H.mu.Unlock()
					}(ip, ln)
				}
			}
			time.Sleep(20 * time.Second)
		}
	}()
}

/* ---------- desktop window side (127.0.0.1 only) ---------- */

func addHostRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/remote/info", func(w http.ResponseWriter, r *http.Request) {
		H.mu.Lock()
		dns, ips := H.dns, append([]string(nil), H.addrs...)
		H.mu.Unlock()
		H.mu.Lock()
		sok, smsg := H.serveOK, H.serveMsg
		H.mu.Unlock()
		writeJSON(w, map[string]any{"links": H.links(), "dns": dns, "ips": ips, "viewers": H.viewers(), "tailscale": tailscaleCLI() != "" || len(ips) > 0, "serve": sok, "serveMsg": smsg})
	})
	mux.HandleFunc("/remote/qr.png", func(w http.ResponseWriter, r *http.Request) {
		u := r.URL.Query().Get("u")
		if !strings.HasPrefix(u, "http://") || len(u) > 300 {
			http.Error(w, "bad link", 400)
			return
		}
		png, err := qrcode.Encode(u, qrcode.Medium, 360)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		w.Header().Set("Content-Type", "image/png")
		w.Write(png)
	})
	mux.HandleFunc("/remote/push", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "POST only", 405)
			return
		}
		b, err := io.ReadAll(io.LimitReader(r.Body, 6<<20))
		if err != nil || len(b) < 4 {
			http.Error(w, "bad frame", 400)
			return
		}
		H.mu.Lock()
		H.frame = b
		H.seq++
		close(H.frameCh)
		H.frameCh = make(chan struct{})
		H.mu.Unlock()
		w.WriteHeader(204)
	})
	// the finished simulation as a video file; the phone plays it locally instead of watching the live stream
	mux.HandleFunc("/remote/pushclip", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "POST only", 405)
			return
		}
		b, err := io.ReadAll(io.LimitReader(r.Body, 200<<20))
		if err != nil || len(b) < 16 {
			http.Error(w, "bad clip", 400)
			return
		}
		ct := r.Header.Get("Content-Type")
		if ct != "video/webm" {
			ct = "video/mp4"
		}
		H.mu.Lock()
		H.clip, H.clipType, H.clipID = b, ct, r.URL.Query().Get("id")
		H.mu.Unlock()
		w.WriteHeader(204)
	})
	mux.HandleFunc("/remote/pushstate", func(w http.ResponseWriter, r *http.Request) {
		b, err := io.ReadAll(io.LimitReader(r.Body, 256<<10))
		if err != nil {
			http.Error(w, "bad state", 400)
			return
		}
		H.mu.Lock()
		H.state = b
		H.mu.Unlock()
		w.WriteHeader(204)
	})
	// long poll: returns as soon as the phone sends commands, or after a second
	mux.HandleFunc("/remote/poll", func(w http.ResponseWriter, r *http.Request) {
		H.mu.Lock()
		ch := H.cmdCh
		empty := len(H.cmds) == 0
		H.mu.Unlock()
		if empty {
			select {
			case <-ch:
			case <-time.After(time.Second):
			case <-r.Context().Done():
				return
			}
		}
		H.mu.Lock()
		cmds := H.cmds
		H.cmds = nil
		H.mu.Unlock()
		raw := make([]json.RawMessage, 0, len(cmds))
		for _, c := range cmds {
			raw = append(raw, c)
		}
		writeJSON(w, map[string]any{"cmds": raw, "viewers": H.viewers()})
	})
}

/* ---------- phone side (Tailscale addresses only) ---------- */

func phoneMux(site fs.FS) http.Handler {
	mux := http.NewServeMux()
	serveFile := func(name, ctype string) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			b, err := fs.ReadFile(site, name)
			if err != nil {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Content-Type", ctype)
			w.Header().Set("Cache-Control", "no-cache")
			w.Write(b)
		}
	}
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" && r.URL.Path != "/remote" {
			http.NotFound(w, r)
			return
		}
		serveFile("remote.html", "text/html; charset=utf-8")(w, r)
	})
	mux.HandleFunc("/manifest.webmanifest", serveFile("remote.webmanifest", "application/manifest+json"))
	mux.HandleFunc("/icon.png", serveFile("icon.png", "image/png"))
	mux.HandleFunc("/remote/frame", func(w http.ResponseWriter, r *http.Request) {
		H.touch()
		after, _ := strconv.ParseInt(r.URL.Query().Get("after"), 10, 64)
		deadline := time.After(3 * time.Second)
		for {
			H.mu.Lock()
			seq, fr, ch := H.seq, H.frame, H.frameCh
			H.mu.Unlock()
			if seq > after && fr != nil {
				w.Header().Set("Content-Type", "image/jpeg")
				w.Header().Set("Cache-Control", "no-store")
				w.Header().Set("X-Seq", strconv.FormatInt(seq, 10))
				w.Write(fr)
				return
			}
			select {
			case <-ch:
			case <-deadline:
				w.WriteHeader(204)
				return
			case <-r.Context().Done():
				return
			}
			H.touch()
		}
	})
	// Range requests are answered too (iPhone Safari needs them to play a video)
	mux.HandleFunc("/remote/clip", func(w http.ResponseWriter, r *http.Request) {
		H.touch()
		H.mu.Lock()
		b, ct, id := H.clip, H.clipType, H.clipID
		H.mu.Unlock()
		if b == nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", ct)
		w.Header().Set("Cache-Control", "private, max-age=3600")
		w.Header().Set("ETag", `"`+id+`"`)
		if r.URL.Query().Get("dl") != "" {
			name := strings.Map(func(c rune) rune {
				if c < 32 || c > 126 || c == '"' || c == '\\' || c == '/' {
					return '_'
				}
				return c
			}, r.URL.Query().Get("name"))
			if name == "" {
				name = "shatterbond-clip.mp4"
			}
			w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
		}
		http.ServeContent(w, r, "clip", time.Time{}, bytes.NewReader(b))
	})
	mux.HandleFunc("/remote/state", func(w http.ResponseWriter, r *http.Request) {
		H.touch()
		H.mu.Lock()
		st := H.state
		H.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		if st == nil {
			io.WriteString(w, `{"connected":false}`)
			return
		}
		w.Write(st)
	})
	mux.HandleFunc("/remote/cmd", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "POST only", 405)
			return
		}
		H.touch()
		b, err := io.ReadAll(io.LimitReader(r.Body, 8<<10))
		if err != nil || !json.Valid(b) {
			http.Error(w, "bad command", 400)
			return
		}
		H.mu.Lock()
		if len(H.cmds) < 200 {
			H.cmds = append(H.cmds, b)
		}
		close(H.cmdCh)
		H.cmdCh = make(chan struct{})
		H.mu.Unlock()
		w.WriteHeader(204)
	})
	return mux
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(v)
}

// ensureServe asks Tailscale to forward http://<this pc>/ (port 80 on the tailnet) to the phone page.
// Tailscale delivers that traffic itself, so Windows Firewall never sees an inbound connection. It
// never replaces a port-80 setup that points somewhere else.
func ensureServe() {
	H.mu.Lock()
	ok, pp := H.serveOK, H.phonePort
	H.mu.Unlock()
	if ok || pp == "" {
		return
	}
	cli := tailscaleCLI()
	if cli == "" {
		setServe(false, "Tailscale's command-line tool wasn't found on this PC.")
		return
	}
	target := "http://127.0.0.1:" + pp
	run := func(args ...string) (string, error) {
		cmd := exec.Command(cli, args...)
		hideWindow(cmd)
		done := make(chan struct{})
		var out []byte
		var err error
		go func() { out, err = cmd.CombinedOutput(); close(done) }()
		select {
		case <-done:
		case <-time.After(15 * time.Second):
			if cmd.Process != nil {
				cmd.Process.Kill()
			}
			return "", errTimeout
		}
		return strings.TrimSpace(string(out)), err
	}
	if st, err := run("serve", "status", "--json"); err == nil && st != "" {
		var cfg struct {
			TCP map[string]json.RawMessage
			Web map[string]struct {
				Handlers map[string]struct{ Proxy string }
			}
		}
		if json.Unmarshal([]byte(st), &cfg) == nil {
			if _, used := cfg.TCP["80"]; used {
				for host, w := range cfg.Web {
					if strings.HasSuffix(host, ":80") {
						if hd, ok := w.Handlers["/"]; ok && hd.Proxy == target {
							setServe(true, "")
							return
						}
					}
				}
				setServe(false, "Port 80 on this PC's Tailscale address is already used by another Tailscale Serve setup, so Shatterbond left it alone.")
				return
			}
		}
	}
	out, err := run("serve", "--bg", "--http=80", target)
	if err != nil {
		msg := out
		if msg == "" {
			msg = err.Error()
		}
		setServe(false, "Tailscale Serve didn't start: "+msg)
		return
	}
	setServe(true, "")
}

type timeoutErr struct{}

func (timeoutErr) Error() string { return "timed out" }

var errTimeout = timeoutErr{}

func setServe(ok bool, msg string) {
	H.mu.Lock()
	H.serveOK, H.serveMsg = ok, msg
	H.mu.Unlock()
}
