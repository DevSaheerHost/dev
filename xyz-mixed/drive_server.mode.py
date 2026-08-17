#!/usr/bin/env python3
"""
PocketDrive v2 - Secure File Server for Termux
Run:  python drive_server.py
Pass: DRIVE_PASS=yourpassword python drive_server.py
Root: DRIVE_ROOT=/sdcard/Files python drive_server.py
"""
import os, json, shutil, mimetypes, subprocess, hashlib, time, secrets, re
from pathlib import Path
from datetime import datetime
from functools import wraps
from collections import defaultdict

try:
    from flask import Flask, request, jsonify, send_file, Response, abort, make_response, redirect
    from werkzeug.utils import secure_filename
except ImportError:
    os.system("pip install flask")
    from flask import Flask, request, jsonify, send_file, Response, abort, make_response, redirect
    from werkzeug.utils import secure_filename

try:
    from PIL import Image
    PIL_AVAILABLE = True
except ImportError:
    os.system("pip install pillow")
    try:
        from PIL import Image
        PIL_AVAILABLE = True
    except Exception:
        PIL_AVAILABLE = False

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = None

# ---------------------------------------------------------------------------
# Paths & Settings
# ---------------------------------------------------------------------------
BASE_DIR    = Path(os.environ.get("DRIVE_ROOT", Path.home() / "PocketDrive")).resolve()
THUMB_DIR   = BASE_DIR / ".thumbs"
CONFIG_FILE = BASE_DIR / ".config.json"
CHUNK_DIR   = BASE_DIR / ".chunks"
for _d in [BASE_DIR, THUMB_DIR, CHUNK_DIR]:
    _d.mkdir(parents=True, exist_ok=True)

PASSWORD       = os.environ.get("DRIVE_PASS", "admin1234")   # ← CHANGE THIS
SESSION_SECRET = os.environ.get("SESSION_SECRET", secrets.token_hex(32))
SESSION_COOKIE = "pd_session"
SESSION_MAXAGE = 60 * 60 * 24 * 7   # 7 days

active_sessions: dict = {}
rate_store: dict      = defaultdict(list)
RATE_WINDOW           = 60
RATE_MAX              = 120
AUTH_RATE_MAX         = 5

DEFAULT_CONFIG = {
    "theme": "dark", "view": "grid", "sort": "name", "sort_dir": "asc",
    "show_hidden": False, "port": 8080, "title": "PocketDrive",
    "thumbnail_size": 200, "allow_delete": True,
}
BLOCKED_NAMES  = {".config.json", ".thumbs", ".chunks"}
DANGEROUS_EXTS = {".sh",".bash",".zsh",".fish",".ksh",".exe",".bat",".cmd",
                  ".ps1",".vbs",".php",".php3",".php4",".php5",".phtml",".cgi",".pl"}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def load_config():
    if CONFIG_FILE.exists():
        try:
            return {**DEFAULT_CONFIG, **json.loads(CONFIG_FILE.read_text())}
        except Exception:
            pass
    return DEFAULT_CONFIG.copy()

def save_config(cfg):
    CONFIG_FILE.write_text(json.dumps(cfg, indent=2))

def get_ip():
    return request.headers.get("X-Forwarded-For", request.remote_addr or "").split(",")[0].strip()

def human_size(b):
    for u in ["B","KB","MB","GB","TB"]:
        if b < 1024: return f"{b:.1f} {u}"
        b /= 1024
    return f"{b:.1f} PB"

def file_category(ext):
    e = ext.lower().lstrip(".")
    if e in {"jpg","jpeg","png","gif","webp","bmp","svg","ico","heic","avif"}: return "image"
    if e in {"mp4","mkv","webm","avi","mov","m4v","3gp","flv","ts","mpeg"}:   return "video"
    if e in {"mp3","wav","ogg","flac","aac","m4a","opus","wma"}:              return "audio"
    if e == "pdf":  return "pdf"
    if e == "apk":  return "apk"
    if e in {"zip","rar","7z","tar","gz","bz2","xz"}:                        return "zip"
    if e in {"py","js","ts","html","css","json","xml","yaml","yml","sh",
             "c","cpp","java","kt","go","rs","php","rb","swift"}:             return "code"
    if e in {"doc","docx","odt","rtf","txt","md"}:                           return "doc"
    if e in {"xls","xlsx","ods","csv"}:                                       return "sheet"
    if e in {"ppt","pptx","odp"}:                                             return "slide"
    if e in {"ttf","otf","woff","woff2"}:                                     return "font"
    return "other"

def get_mime(path):
    m, _ = mimetypes.guess_type(str(path))
    return m or "application/octet-stream"

def thumb_key(path):
    s = path.stat()
    return hashlib.md5(f"{path}{s.st_size}{s.st_mtime}".encode()).hexdigest()

def make_thumbnail(path, size=200):
    cat   = file_category(path.suffix)
    tpath = THUMB_DIR / f"{thumb_key(path)}.jpg"
    if tpath.exists(): return tpath
    if cat == "image" and PIL_AVAILABLE:
        try:
            img = Image.open(path).convert("RGB")
            img.thumbnail((size, size), Image.LANCZOS)
            img.save(tpath, "JPEG", quality=75)
            return tpath
        except Exception:
            pass
    if cat == "video":
        try:
            subprocess.run(["ffmpeg","-y","-i",str(path),"-ss","00:00:01",
                            "-vframes","1","-vf",f"scale={size}:-1",str(tpath)],
                           capture_output=True, timeout=10)
            if tpath.exists(): return tpath
        except Exception:
            pass
    return None

def file_info(path):
    s   = path.stat()
    ext = path.suffix.lower() if path.is_file() else ""
    cat = file_category(ext) if path.is_file() else "folder"
    rel = str(path.relative_to(BASE_DIR)).replace("\\", "/")
    return {
        "name": path.name, "path": rel, "is_dir": path.is_dir(),
        "category": cat, "ext": ext.lstrip("."),
        "size": s.st_size if path.is_file() else 0,
        "size_str": human_size(s.st_size) if path.is_file() else "—",
        "mtime": s.st_mtime,
        "mtime_str": datetime.fromtimestamp(s.st_mtime).strftime("%b %d, %Y"),
        "mime": get_mime(path) if path.is_file() else "inode/directory",
        "has_thumb": make_thumbnail(path) is not None if path.is_file() else False,
    }

def validate_name(name):
    if not name or len(name) > 255: return False
    if "\x00" in name: return False
    if any(c in name for c in ["/","\\",":",'"',"<",">","|","*","?"]): return False
    return name not in (".", "..")

def safe_path(rel):
    if not rel: return BASE_DIR
    rel = rel.lstrip("/\\")
    try:
        p = (BASE_DIR / rel).resolve()
    except Exception:
        abort(400)
    if not (str(p) == str(BASE_DIR) or str(p).startswith(str(BASE_DIR) + os.sep)):
        abort(403)
    if p.name in BLOCKED_NAMES: abort(403)
    if p.parent == BASE_DIR and p.name.startswith("."): abort(403)
    return p

def safe_filename(name):
    name = secure_filename(name) or "file"
    if Path(name).suffix.lower() in DANGEROUS_EXTS:
        name += ".blocked"
    return name

# ---------------------------------------------------------------------------
# Rate limiter
# ---------------------------------------------------------------------------
def rate_limit(max_req=RATE_MAX, window=RATE_WINDOW):
    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            ip  = get_ip()
            now = time.time()
            rate_store[ip] = [t for t in rate_store[ip] if now - t < window]
            if len(rate_store[ip]) >= max_req:
                return jsonify({"error": "Too many requests"}), 429
            rate_store[ip].append(now)
            return f(*args, **kwargs)
        return wrapper
    return decorator

# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
def hash_pw(pw):
    return hashlib.sha256((pw + SESSION_SECRET).encode()).hexdigest()

def create_session():
    token = secrets.token_urlsafe(48)
    active_sessions[token] = time.time() + SESSION_MAXAGE
    return token

def is_valid_session(token):
    if not token: return False
    exp = active_sessions.get(token)
    if not exp: return False
    if time.time() > exp:
        active_sessions.pop(token, None)
        return False
    active_sessions[token] = time.time() + SESSION_MAXAGE   # sliding
    return True

def require_auth(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if not is_valid_session(request.cookies.get(SESSION_COOKIE, "")):
            if request.path.startswith("/api/"):
                return jsonify({"error": "Unauthorized"}), 401
            return redirect("/login")
        return f(*args, **kwargs)
    return wrapper

# ---------------------------------------------------------------------------
# Security headers (applied to every response)
# ---------------------------------------------------------------------------
@app.after_request
def sec_headers(r):
    r.headers.update({
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "SAMEORIGIN",
        "X-XSS-Protection": "1; mode=block",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Cache-Control": "no-store",
    })
    return r

# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------
@app.route("/")
@require_auth
def index():
    return MAIN_HTML

@app.route("/login", methods=["GET"])
def login_page():
    return LOGIN_HTML

@app.route("/login", methods=["POST"])
@rate_limit(max_req=AUTH_RATE_MAX)
def login_post():
    pw = (request.get_json(silent=True) or {}).get("password", "")
    if not pw or len(pw) > 256:
        return jsonify({"error": "Invalid"}), 400
    if not secrets.compare_digest(hash_pw(PASSWORD), hash_pw(pw)):
        time.sleep(1)   # slow brute force
        return jsonify({"error": "Wrong password"}), 401
    token = create_session()
    resp  = make_response(jsonify({"ok": True}))
    resp.set_cookie(SESSION_COOKIE, token, max_age=SESSION_MAXAGE,
                    httponly=True, samesite="Strict", secure=False)
    return resp

@app.route("/logout")
def logout():
    active_sessions.pop(request.cookies.get(SESSION_COOKIE, ""), None)
    r = make_response(redirect("/login"))
    r.delete_cookie(SESSION_COOKIE)
    return r

@app.route("/api/logout", methods=["POST"])
def api_logout():
    active_sessions.pop(request.cookies.get(SESSION_COOKIE, ""), None)
    r = make_response(jsonify({"ok": True}))
    r.delete_cookie(SESSION_COOKIE)
    return r

# ---------------------------------------------------------------------------
# File API
# ---------------------------------------------------------------------------
@app.route("/api/files")
@require_auth
@rate_limit()
def api_files():
    rel    = request.args.get("path", "")
    cfg    = load_config()
    sort   = request.args.get("sort", cfg["sort"])
    sdir   = request.args.get("sort_dir", cfg["sort_dir"])
    show   = request.args.get("show_hidden", "false").lower() == "true"
    folder = safe_path(rel)
    if not folder.is_dir():
        return jsonify({"error": "Not a directory"}), 400
    items = []
    for p in folder.iterdir():
        if not show and p.name.startswith("."): continue
        if p.name in BLOCKED_NAMES: continue
        try:
            items.append(file_info(p))
        except (PermissionError, OSError):
            pass
    rev = (sdir == "desc")
    if   sort == "name": items.sort(key=lambda x: (not x["is_dir"], x["name"].lower()), reverse=rev)
    elif sort == "size": items.sort(key=lambda x: (not x["is_dir"], x["size"]),         reverse=rev)
    elif sort == "date": items.sort(key=lambda x: (not x["is_dir"], x["mtime"]),        reverse=rev)
    elif sort == "type": items.sort(key=lambda x: (not x["is_dir"], x["ext"]),          reverse=rev)
    parts  = [p for p in rel.replace("\\", "/").split("/") if p]
    crumbs = [{"name": "Home", "path": ""}]
    for i, p in enumerate(parts):
        crumbs.append({"name": p, "path": "/".join(parts[:i+1])})
    return jsonify({"items": items, "breadcrumbs": crumbs, "path": rel})

@app.route("/api/upload", methods=["POST"])
@require_auth
@rate_limit()
def api_upload():
    dest = safe_path(request.form.get("path", ""))
    if not dest.is_dir():
        return jsonify({"error": "Not a folder"}), 400
    saved = []
    for f in request.files.getlist("files"):
        fn = safe_filename(f.filename or "file")
        out = dest / fn
        c = 1
        while out.exists():
            out = dest / f"{Path(fn).stem}_{c}{Path(fn).suffix}"
            c += 1
        f.save(str(out))
        saved.append(fn)
    return jsonify({"saved": saved})

@app.route("/api/upload/chunk", methods=["POST"])
@require_auth
@rate_limit()
def api_upload_chunk():
    uid   = request.form.get("upload_id", "")
    cidx  = request.form.get("chunk_index", "")
    total = request.form.get("total_chunks", "")
    fname = request.form.get("filename", "")
    rel   = request.form.get("path", "")
    if not all([uid, cidx, total, fname]):
        return jsonify({"error": "Missing fields"}), 400
    if not re.match(r"^[a-zA-Z0-9_-]{8,64}$", uid):
        return jsonify({"error": "Bad upload_id"}), 400
    try:
        cidx = int(cidx); total = int(total)
        if cidx < 0 or total < 1 or cidx >= total: raise ValueError
    except ValueError:
        return jsonify({"error": "Bad chunk params"}), 400
    fn    = safe_filename(fname)
    cf    = CHUNK_DIR / f"{uid}_{cidx:05d}"
    chunk = request.files.get("chunk")
    if not chunk:
        return jsonify({"error": "No data"}), 400
    chunk.save(str(cf))
    arrived = list(CHUNK_DIR.glob(f"{uid}_*"))
    if len(arrived) == total:
        dest = safe_path(rel)
        out  = dest / fn
        c = 1
        while out.exists():
            out = dest / f"{Path(fn).stem}_{c}{Path(fn).suffix}"
            c += 1
        with open(out, "wb") as fh:
            for i in range(total):
                p = CHUNK_DIR / f"{uid}_{i:05d}"
                fh.write(p.read_bytes())
                p.unlink()
        return jsonify({"done": True, "filename": out.name})
    return jsonify({"done": False, "received": len(arrived)})

@app.route("/api/mkdir", methods=["POST"])
@require_auth
@rate_limit()
def api_mkdir():
    d = request.get_json(silent=True) or {}
    if not validate_name(d.get("name", "")):
        return jsonify({"error": "Invalid folder name"}), 400
    safe_path(os.path.join(d.get("path", ""), d["name"])).mkdir(parents=True, exist_ok=True)
    return jsonify({"ok": True})

@app.route("/api/rename", methods=["POST"])
@require_auth
@rate_limit()
def api_rename():
    d = request.get_json(silent=True) or {}
    if not validate_name(d.get("new_name", "")):
        return jsonify({"error": "Invalid name"}), 400
    src = safe_path(d.get("path", ""))
    new = src.parent / d["new_name"]
    if not str(new.resolve()).startswith(str(BASE_DIR)): abort(403)
    src.rename(new)
    return jsonify({"ok": True})

@app.route("/api/delete", methods=["POST"])
@require_auth
@rate_limit()
def api_delete():
    if not load_config().get("allow_delete", True):
        return jsonify({"error": "Delete is disabled"}), 403
    d = request.get_json(silent=True) or {}
    if not d.get("path"):
        return jsonify({"error": "No path"}), 400
    p = safe_path(d["path"])
    if p == BASE_DIR:
        return jsonify({"error": "Cannot delete root"}), 403
    shutil.rmtree(p) if p.is_dir() else p.unlink()
    return jsonify({"ok": True})

@app.route("/api/move", methods=["POST"])
@require_auth
@rate_limit()
def api_move():
    d   = request.get_json(silent=True) or {}
    src = safe_path(d.get("src", ""))
    dst = safe_path(d.get("dst", ""))
    if dst.is_dir(): dst = dst / src.name
    if not str(dst.resolve()).startswith(str(BASE_DIR)): abort(403)
    shutil.move(str(src), str(dst))
    return jsonify({"ok": True})

@app.route("/api/copy", methods=["POST"])
@require_auth
@rate_limit()
def api_copy():
    d   = request.get_json(silent=True) or {}
    src = safe_path(d.get("src", ""))
    dst = safe_path(d.get("dst", "")) / src.name
    if not str(dst.resolve()).startswith(str(BASE_DIR)): abort(403)
    shutil.copytree(src, dst) if src.is_dir() else shutil.copy2(src, dst)
    return jsonify({"ok": True})

@app.route("/api/download")
@require_auth
@rate_limit()
def api_download():
    p = safe_path(request.args.get("path", ""))
    if not p.is_file(): abort(404)
    return send_file(p, as_attachment=True)

@app.route("/api/preview")
@require_auth
@rate_limit()
def api_preview():
    p    = safe_path(request.args.get("path", ""))
    if not p.is_file(): abort(404)
    mime = get_mime(p)
    size = p.stat().st_size
    rh   = request.headers.get("Range")
    if rh:
        try:
            pts   = rh.strip().replace("bytes=", "").split("-")
            start = int(pts[0]) if pts[0] else 0
            end   = int(pts[1]) if len(pts) > 1 and pts[1] else size - 1
            end   = min(end, size - 1)
            length = end - start + 1
        except (ValueError, IndexError):
            abort(416)
        def gen():
            with open(p, "rb") as fh:
                fh.seek(start)
                rem = length
                while rem:
                    c = fh.read(min(65536, rem))
                    if not c: break
                    yield c
                    rem -= len(c)
        r = Response(gen(), 206, mimetype=mime, direct_passthrough=True)
        r.headers["Content-Range"]  = f"bytes {start}-{end}/{size}"
        r.headers["Accept-Ranges"]  = "bytes"
        r.headers["Content-Length"] = length
        return r
    return send_file(p, mimetype=mime)

@app.route("/api/thumbnail")
@require_auth
@rate_limit()
def api_thumbnail():
    p = safe_path(request.args.get("path", ""))
    if not p.is_file(): abort(404)
    t = make_thumbnail(p, load_config().get("thumbnail_size", 200))
    if t: return send_file(t, mimetype="image/jpeg")
    abort(404)

@app.route("/api/search")
@require_auth
@rate_limit()
def api_search():
    q    = request.args.get("q", "").lower().strip()
    if not q: return jsonify({"items": []})
    root    = safe_path(request.args.get("path", ""))
    results = []
    for p in root.rglob("*"):
        if p.name.startswith("."): continue
        if p.name in BLOCKED_NAMES: continue
        if q in p.name.lower():
            try: results.append(file_info(p))
            except Exception: pass
        if len(results) >= 100: break
    return jsonify({"items": results})

@app.route("/api/settings", methods=["GET", "POST"])
@require_auth
@rate_limit()
def api_settings():
    if request.method == "GET":
        return jsonify(load_config())
    cfg = load_config()
    new = request.get_json(silent=True) or {}
    ok  = {"theme","view","sort","sort_dir","show_hidden","allow_delete","thumbnail_size","title"}
    for k, v in new.items():
        if k in ok: cfg[k] = v
    save_config(cfg)
    return jsonify(cfg)

@app.route("/api/stats")
@require_auth
@rate_limit()
def api_stats():
    files = folders = size = 0
    for p in BASE_DIR.rglob("*"):
        if p.name.startswith("."): continue
        if p.is_file():  files += 1; size += p.stat().st_size
        elif p.is_dir(): folders += 1
    try:
        disk = shutil.disk_usage(str(BASE_DIR))
        dt, du, df = disk.total, disk.used, disk.free
    except Exception:
        dt = du = df = 0
    return jsonify({
        "files": files, "folders": folders,
        "size": size, "size_str": human_size(size),
        "disk_total": dt, "disk_used": du, "disk_free": df,
        "disk_total_str": human_size(dt),
        "disk_used_str":  human_size(du),
        "disk_free_str":  human_size(df),
    })

# ---------------------------------------------------------------------------
# HTML — Login
# ---------------------------------------------------------------------------
LOGIN_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PocketDrive</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=Space+Mono:wght@700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{min-height:100vh;background:#0f1117;display:flex;align-items:center;justify-content:center;font-family:'DM Sans',sans-serif}
.card{background:#181b23;border:1px solid #2e3347;border-radius:20px;padding:40px;width:100%;max-width:380px;box-shadow:0 8px 40px #0008}
.logo{font-family:'Space Mono',monospace;font-size:1.5rem;color:#4f8ef7;letter-spacing:-1px;margin-bottom:6px}
.logo span{color:#6ee7b7}.sub{font-size:.85rem;color:#64748b;margin-bottom:32px}
.lbl{display:block;font-size:.8rem;color:#94a3b8;margin-bottom:6px;font-weight:500}
.inp{width:100%;background:#0f1117;border:1px solid #2e3347;border-radius:10px;padding:12px 16px;color:#e2e8f0;font-size:.95rem;outline:none;transition:.2s;margin-bottom:20px;font-family:inherit}
.inp:focus{border-color:#4f8ef7}
.btn{width:100%;background:#4f8ef7;color:#fff;border:none;border-radius:10px;padding:13px;font-size:.95rem;font-weight:600;cursor:pointer;transition:.2s;font-family:inherit}
.btn:hover{filter:brightness(1.1)}.btn:disabled{opacity:.5;cursor:not-allowed}
.err{background:#ef444418;border:1px solid #ef4444;border-radius:8px;padding:10px 14px;font-size:.83rem;color:#ef4444;margin-top:14px;display:none}
.hint{font-size:.75rem;color:#475569;margin-top:16px;text-align:center}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#22c55e;margin-right:6px;animation:p 2s infinite}
@keyframes p{0%,100%{opacity:1}50%{opacity:.4}}
</style>
</head>
<body>
<div class="card">
  <div class="logo">Pocket<span>Drive</span></div>
  <div class="sub"><span class="dot"></span>Server running — enter password</div>
  <label class="lbl">Password</label>
  <input class="inp" id="pw" type="password" placeholder="••••••••" autofocus>
  <button class="btn" id="btn" onclick="login()">Sign in &rarr;</button>
  <div class="err" id="err"></div>
  <div class="hint">PocketDrive &middot; Secure local file server</div>
</div>
<script>
document.getElementById('pw').addEventListener('keydown', function(e){ if(e.key==='Enter') login(); });
async function login(){
  var pw=document.getElementById('pw').value, btn=document.getElementById('btn'), err=document.getElementById('err');
  if(!pw) return;
  btn.disabled=true; btn.textContent='Signing in\u2026'; err.style.display='none';
  try{
    var r=await fetch('/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pw})});
    var d=await r.json();
    if(r.ok) window.location.href='/';
    else { err.textContent=d.error||'Wrong password'; err.style.display='block'; }
  }catch(e){ err.textContent='Connection error'; err.style.display='block'; }
  btn.disabled=false; btn.textContent='Sign in \u2192';
}
</script>
</body>
</html>"""

# ---------------------------------------------------------------------------
# HTML — Main App
# ---------------------------------------------------------------------------
MAIN_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>PocketDrive</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#0f1117;--bg2:#181b23;--bg3:#1e2130;--surface:#23273a;--surface2:#2a2f45;--border:#2e3347;--accent:#4f8ef7;--accent2:#6ee7b7;--text:#e2e8f0;--text2:#94a3b8;--text3:#64748b;--danger:#ef4444;--success:#22c55e;--radius:12px;--shadow:0 4px 24px rgba(0,0,0,.4);--font:'DM Sans',sans-serif;--mono:'Space Mono',monospace;--sidebar:240px;--topbar:60px}
[data-theme=light]{--bg:#f0f4f8;--bg2:#fff;--bg3:#e8edf4;--surface:#fff;--surface2:#f1f5f9;--border:#dde3ee;--text:#1e293b;--text2:#475569;--text3:#94a3b8;--shadow:0 4px 24px rgba(0,0,0,.08)}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;overflow:hidden}
body{font-family:var(--font);background:var(--bg);color:var(--text);display:flex;flex-direction:column}
#topbar{height:var(--topbar);background:var(--bg2);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;padding:0 16px;flex-shrink:0;z-index:100}
#logo{font-family:var(--mono);font-weight:700;font-size:1.1rem;color:var(--accent);letter-spacing:-1px;white-space:nowrap;cursor:pointer}
#logo span{color:var(--accent2)}
#search-wrap{flex:1;max-width:520px;position:relative}
#search{width:100%;background:var(--bg3);border:1px solid var(--border);border-radius:24px;padding:8px 16px 8px 40px;color:var(--text);font-family:var(--font);font-size:.9rem;outline:none;transition:.2s}
#search:focus{border-color:var(--accent);background:var(--surface)}
#search-icon{position:absolute;left:13px;top:50%;transform:translateY(-50%);opacity:.5;pointer-events:none}
#search-results{position:absolute;top:calc(100% + 6px);left:0;right:0;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);max-height:320px;overflow-y:auto;z-index:999;display:none}
#search-results.open{display:block}
.sr-item{display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;font-size:.85rem;transition:.15s}
.sr-item:hover{background:var(--surface2)}
.sr-path{color:var(--text3);font-size:.75rem;margin-left:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px}
#topbar-actions{display:flex;gap:6px;align-items:center;margin-left:auto}
.tb-btn{background:none;border:none;color:var(--text2);cursor:pointer;padding:7px;border-radius:8px;transition:.15s;display:flex;align-items:center;justify-content:center}
.tb-btn:hover{background:var(--surface);color:var(--text)}
#upload-btn{background:var(--accent);color:#fff;padding:7px 16px;border-radius:24px;font-family:var(--font);font-size:.85rem;font-weight:500;cursor:pointer;border:none;display:flex;align-items:center;gap:6px;transition:.2s}
#upload-btn:hover{filter:brightness(1.1)}
#layout{display:flex;flex:1;overflow:hidden}
#sidebar{width:var(--sidebar);background:var(--bg2);border-right:1px solid var(--border);display:flex;flex-direction:column;flex-shrink:0;overflow-y:auto;transition:.25s}
#sidebar.collapsed{width:0;overflow:hidden}
.sidebar-section{padding:12px 8px 4px}
.sidebar-label{font-size:.68rem;text-transform:uppercase;letter-spacing:.1em;color:var(--text3);padding:0 8px 6px;font-weight:600}
.nav-item{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;cursor:pointer;font-size:.85rem;color:var(--text2);transition:.15s;white-space:nowrap}
.nav-item:hover{background:var(--surface);color:var(--text)}
.nav-item.active{background:#4f8ef718;color:var(--accent)}
.sidebar-divider{height:1px;background:var(--border);margin:8px}
.storage-bar-wrap{padding:12px 12px 16px}
.storage-label{font-size:.75rem;color:var(--text2);margin-bottom:8px}
.storage-bar{height:4px;background:var(--border);border-radius:4px;overflow:hidden}
.storage-fill{height:100%;background:linear-gradient(90deg,var(--accent),var(--accent2));border-radius:4px;transition:width .5s}
.storage-nums{display:flex;justify-content:space-between;font-size:.72rem;color:var(--text3);margin-top:6px}
#main{flex:1;display:flex;flex-direction:column;overflow:hidden;background:var(--bg)}
#toolbar{display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid var(--border);background:var(--bg2);flex-shrink:0;flex-wrap:wrap}
#breadcrumb{display:flex;align-items:center;gap:4px;font-size:.85rem;flex:1;overflow:hidden;min-width:0}
.bc-item{color:var(--text2);cursor:pointer;white-space:nowrap;padding:2px 4px;border-radius:4px;transition:.15s}
.bc-item:hover{color:var(--text);background:var(--surface)}
.bc-item.active{color:var(--text);pointer-events:none}
.bc-sep{color:var(--text3);font-size:.75rem;flex-shrink:0}
.tool-btn{background:none;border:1px solid var(--border);color:var(--text2);cursor:pointer;padding:6px 12px;border-radius:8px;font-family:var(--font);font-size:.8rem;display:flex;align-items:center;gap:5px;transition:.15s;white-space:nowrap}
.tool-btn:hover{background:var(--surface);color:var(--text)}
.tool-btn.danger:hover{background:#ef444418;color:var(--danger);border-color:var(--danger)}
#sort-select{background:var(--surface);border:1px solid var(--border);color:var(--text2);padding:5px 10px;border-radius:8px;font-family:var(--font);font-size:.8rem;cursor:pointer;outline:none}
#view-toggle{display:flex;background:var(--surface);border:1px solid var(--border);border-radius:8px;overflow:hidden}
.view-btn{background:none;border:none;padding:6px 10px;cursor:pointer;color:var(--text3);transition:.15s;display:flex}
.view-btn.active{background:var(--accent);color:#fff}
#files-wrap{flex:1;overflow-y:auto;padding:16px}
#files-wrap.drop-active{outline:2px dashed var(--accent);outline-offset:-8px;border-radius:var(--radius);background:#4f8ef710}
#files-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px}
#files-grid.list-view{grid-template-columns:1fr}
.file-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);cursor:pointer;transition:.18s;position:relative;overflow:hidden;user-select:none}
.file-card:hover{border-color:#4f8ef788;box-shadow:0 0 0 2px #4f8ef722,var(--shadow);transform:translateY(-1px)}
.file-card.selected{border-color:var(--accent);background:#4f8ef710}
.file-thumb{width:100%;aspect-ratio:1;object-fit:cover;display:block}
.file-icon-wrap{width:100%;aspect-ratio:1;display:flex;align-items:center;justify-content:center;font-size:2.8rem}
.file-info{padding:8px 10px 10px}
.file-name{font-size:.78rem;font-weight:500;word-break:break-word;line-height:1.3;color:var(--text)}
.file-meta{font-size:.68rem;color:var(--text3);margin-top:3px}
#files-grid.list-view .file-card{display:flex;align-items:center;border-radius:8px;padding:6px 12px;gap:12px}
#files-grid.list-view .file-thumb{width:36px;height:36px;aspect-ratio:1;border-radius:6px;flex-shrink:0}
#files-grid.list-view .file-icon-wrap{width:36px;height:36px;aspect-ratio:1;font-size:1.3rem;flex-shrink:0}
#files-grid.list-view .file-info{padding:0;flex:1;display:flex;align-items:center;gap:12px}
#files-grid.list-view .file-name{flex:1}
#files-grid.list-view .file-meta{margin:0;min-width:100px;text-align:right}
.file-card .sel-check{position:absolute;top:6px;left:6px;width:18px;height:18px;border-radius:50%;background:var(--accent);display:none;align-items:center;justify-content:center;font-size:.7rem;color:#fff}
.file-card.selected .sel-check{display:flex}
.file-card .card-menu{position:absolute;top:6px;right:6px;background:#0f1117cc;border-radius:6px;padding:2px;display:none}
.file-card:hover .card-menu{display:flex}
.card-menu-btn{background:none;border:none;cursor:pointer;color:var(--text2);padding:3px;border-radius:4px;display:flex;transition:.15s}
.card-menu-btn:hover{background:var(--surface2);color:var(--text)}
.empty-state{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:60px 20px;color:var(--text3);text-align:center;grid-column:1/-1}
.empty-state .empty-icon{font-size:3rem;opacity:.4}
#sel-bar{display:none;align-items:center;gap:8px;padding:8px 16px;background:#4f8ef715;border-top:1px solid var(--border);flex-shrink:0}
#sel-bar.visible{display:flex}
#sel-count{font-size:.85rem;color:var(--accent);font-weight:500}
#ctx-menu{position:fixed;z-index:9999;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);min-width:180px;padding:6px;display:none}
#ctx-menu.open{display:block}
.ctx-item{display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;cursor:pointer;font-size:.85rem;color:var(--text2);transition:.15s}
.ctx-item:hover{background:var(--surface2);color:var(--text)}
.ctx-item.danger{color:var(--danger)}.ctx-item.danger:hover{background:#ef444415}
.ctx-divider{height:1px;background:var(--border);margin:4px 0}
.modal-overlay{position:fixed;inset:0;background:#000a;z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(4px)}
.modal{background:var(--surface);border:1px solid var(--border);border-radius:16px;box-shadow:var(--shadow);width:100%;max-width:480px;overflow:hidden}
.modal-head{display:flex;align-items:center;justify-content:space-between;padding:18px 20px;border-bottom:1px solid var(--border)}
.modal-title{font-weight:600;font-size:1rem}
.modal-close{background:none;border:none;cursor:pointer;color:var(--text3);padding:4px 8px;border-radius:6px;font-size:1rem;transition:.15s;line-height:1}
.modal-close:hover{background:var(--surface2);color:var(--text)}
.modal-body{padding:20px}.modal-foot{padding:16px 20px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end}
.inp{width:100%;background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:10px 14px;color:var(--text);font-family:var(--font);font-size:.9rem;outline:none;transition:.2s}
.inp:focus{border-color:var(--accent)}
.btn{padding:8px 18px;border-radius:8px;border:none;cursor:pointer;font-family:var(--font);font-size:.85rem;font-weight:500;transition:.15s}
.btn-primary{background:var(--accent);color:#fff}.btn-primary:hover{filter:brightness(1.1)}
.btn-ghost{background:none;border:1px solid var(--border);color:var(--text2)}.btn-ghost:hover{background:var(--surface2)}
.btn-danger{background:var(--danger);color:#fff}.btn-danger:hover{filter:brightness(1.1)}
label.lbl{display:block;font-size:.8rem;color:var(--text2);margin-bottom:6px;font-weight:500}
#preview-modal .modal{max-width:95vw;max-height:95vh;width:auto;display:flex;flex-direction:column}
#preview-modal .modal-body{flex:1;padding:0;display:flex;align-items:center;justify-content:center;background:#000;overflow:hidden;min-height:200px;position:relative}
#preview-modal .modal-head{background:var(--bg2)}
#preview-img{max-width:90vw;max-height:80vh;object-fit:contain;display:none}
#preview-video{max-width:90vw;max-height:80vh;display:none;outline:none}
#preview-audio{display:none;padding:20px}
#preview-iframe{width:90vw;height:80vh;border:none;display:none;background:#fff}
#preview-code{max-width:90vw;max-height:80vh;overflow:auto;padding:20px;font-family:var(--mono);font-size:.8rem;line-height:1.6;color:var(--accent2);background:#000;display:none;white-space:pre-wrap;margin:0}
#preview-nopreview{text-align:center;padding:40px;color:var(--text3);display:none}
.preview-nav{position:absolute;top:50%;transform:translateY(-50%);background:rgba(0,0,0,.6);border:none;cursor:pointer;color:#fff;padding:10px 14px;border-radius:50%;display:flex;transition:.15s;z-index:10;font-size:1.4rem;line-height:1}
.preview-nav:hover{background:rgba(0,0,0,.9)}
#preview-prev{left:10px}#preview-next{right:10px}
#settings-panel{position:fixed;right:0;top:0;height:100%;width:360px;background:var(--bg2);border-left:1px solid var(--border);z-index:500;transform:translateX(100%);transition:.25s;overflow-y:auto;display:flex;flex-direction:column}
#settings-panel.open{transform:none;box-shadow:var(--shadow)}
.settings-head{display:flex;align-items:center;justify-content:space-between;padding:18px 20px;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--bg2);z-index:1}
.settings-section{padding:20px}.settings-section+.settings-section{border-top:1px solid var(--border)}
.setting-row{display:flex;align-items:center;justify-content:space-between;padding:10px 0}
.setting-label{font-size:.85rem;color:var(--text2)}.setting-desc{font-size:.75rem;color:var(--text3);margin-top:2px}
.toggle{position:relative;width:42px;height:24px;flex-shrink:0}.toggle input{opacity:0;width:0;height:0}
.toggle-slider{position:absolute;inset:0;background:var(--border);border-radius:24px;cursor:pointer;transition:.2s}
.toggle-slider::before{content:"";position:absolute;width:18px;height:18px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.2s}
.toggle input:checked+.toggle-slider{background:var(--accent)}.toggle input:checked+.toggle-slider::before{transform:translateX(18px)}
.settings-select{background:var(--bg3);border:1px solid var(--border);color:var(--text);padding:6px 10px;border-radius:8px;font-family:var(--font);font-size:.83rem;outline:none;cursor:pointer;width:130px}
#upload-zone{position:fixed;inset:0;z-index:800;background:#000a;display:none;align-items:center;justify-content:center;backdrop-filter:blur(4px)}
#upload-zone.active{display:flex}
.uz-box{background:var(--surface);border:2px dashed var(--accent);border-radius:24px;padding:60px;text-align:center;color:var(--text2)}
#toasts{position:fixed;bottom:20px;right:20px;display:flex;flex-direction:column;gap:8px;z-index:9999}
.toast{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 16px;font-size:.83rem;box-shadow:var(--shadow);display:flex;align-items:center;gap:8px;animation:ti .2s ease;max-width:300px}
.toast.success{border-color:var(--success);color:var(--success)}.toast.error{border-color:var(--danger);color:var(--danger)}.toast.info{border-color:var(--accent);color:var(--accent)}
@keyframes ti{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
#upload-progress{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 20px;z-index:5000;display:none;min-width:300px;box-shadow:var(--shadow)}
#up-label{font-size:.83rem;color:var(--text2);margin-bottom:8px}
#up-bar{height:5px;background:var(--border);border-radius:4px;overflow:hidden}
#up-fill{height:100%;background:linear-gradient(90deg,var(--accent),var(--accent2));width:0%;transition:width .15s;border-radius:4px}
#up-stats{font-size:.75rem;color:var(--text3);margin-top:6px;display:flex;justify-content:space-between}
::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}
.cat-image  .file-icon-wrap{background:linear-gradient(135deg,#4f8ef722,#6ee7b711)}
.cat-video  .file-icon-wrap{background:linear-gradient(135deg,#a855f722,#ec489922)}
.cat-audio  .file-icon-wrap{background:linear-gradient(135deg,#f472b622,#fb923c22)}
.cat-pdf    .file-icon-wrap{background:linear-gradient(135deg,#ef444422,#f97c1622)}
.cat-apk    .file-icon-wrap{background:linear-gradient(135deg,#22c55e22,#4ade8022)}
.cat-zip    .file-icon-wrap{background:linear-gradient(135deg,#f59e0b22,#fde04722)}
.cat-code   .file-icon-wrap{background:linear-gradient(135deg,#06b6d422,#818cf822)}
.cat-folder .file-icon-wrap{background:linear-gradient(135deg,#4f8ef7,#6ee7b7)}
.cat-doc    .file-icon-wrap{background:linear-gradient(135deg,#4f8ef722,#93c5fd22)}
@media(max-width:640px){
  :root{--sidebar:0px}
  #sidebar{position:fixed;left:0;top:0;height:100%;z-index:200;width:240px;transform:translateX(-100%);transition:.25s}
  #sidebar.mobile-open{transform:none;box-shadow:var(--shadow)}
  #main-overlay{display:none;position:fixed;inset:0;background:#0008;z-index:190}
  #main-overlay.visible{display:block}
  .hide-mobile{display:none!important}
  #settings-panel{width:100vw}
}
</style>
</head>
<body data-theme="dark">
<div id="topbar">
  <button class="tb-btn" id="sidebar-toggle"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg></button>
  <div id="logo" onclick="navigate('')">Pocket<span>Drive</span></div>
  <div id="search-wrap">
    <span id="search-icon"><svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg></span>
    <input id="search" type="text" placeholder="Search files&hellip;" autocomplete="off">
    <div id="search-results"></div>
  </div>
  <div id="topbar-actions">
    <label id="upload-btn"><svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Upload<input type="file" id="file-input" multiple hidden></label>
    <button class="tb-btn hide-mobile" id="new-folder-btn" title="New Folder"><svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg></button>
    <button class="tb-btn hide-mobile" id="settings-btn" title="Settings"><svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button>
    <button class="tb-btn" id="logout-btn" title="Logout" style="color:var(--danger)"><svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg></button>
  </div>
</div>
<div id="layout">
  <div id="sidebar">
    <div class="sidebar-section">
      <div class="sidebar-label">Navigate</div>
      <div class="nav-item active" id="nav-home" onclick="navigate('')"><svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg> Home</div>
      <div class="nav-item" onclick="showRecent()"><svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Recent</div>
    </div>
    <div class="sidebar-divider"></div>
    <div class="sidebar-section">
      <div class="sidebar-label">Filter by type</div>
      <div class="nav-item" onclick="filterType('image')">&#128444;&#65039; &nbsp;Images</div>
      <div class="nav-item" onclick="filterType('video')">&#127916; &nbsp;Videos</div>
      <div class="nav-item" onclick="filterType('audio')">&#127925; &nbsp;Audio</div>
      <div class="nav-item" onclick="filterType('doc')">&#128196; &nbsp;Documents</div>
      <div class="nav-item" onclick="filterType('apk')">&#128230; &nbsp;APKs</div>
      <div class="nav-item" onclick="filterType('zip')">&#128476;&#65039; &nbsp;Archives</div>
      <div class="nav-item" onclick="filterType('code')">&#128187; &nbsp;Code</div>
    </div>
    <div class="sidebar-divider"></div>
    <div class="storage-bar-wrap">
      <div class="storage-label">Storage</div>
      <div class="storage-bar"><div class="storage-fill" id="storage-fill" style="width:0%"></div></div>
      <div class="storage-nums"><span id="storage-used">&mdash;</span><span id="storage-total">&mdash;</span></div>
    </div>
  </div>
  <div id="main">
    <div id="toolbar">
      <div id="breadcrumb"></div>
      <select id="sort-select"><option value="name">Name</option><option value="date">Date</option><option value="size">Size</option><option value="type">Type</option></select>
      <button class="tool-btn" id="sort-dir-btn">&#8593; ASC</button>
      <div id="view-toggle">
        <button class="view-btn active" id="grid-btn"><svg width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/><rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg></button>
        <button class="view-btn" id="list-btn"><svg width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><rect x="1" y="2" width="14" height="2" rx="1"/><rect x="1" y="7" width="14" height="2" rx="1"/><rect x="1" y="12" width="14" height="2" rx="1"/></svg></button>
      </div>
    </div>
    <div id="files-wrap"><div id="files-grid"></div></div>
    <div id="sel-bar">
      <span id="sel-count">0 selected</span>
      <button class="tool-btn" onclick="downloadSelected()">&#8595; Download</button>
      <button class="tool-btn danger" onclick="deleteSelected()">&#128465; Delete</button>
      <button class="tool-btn" onclick="clearSel()" style="margin-left:auto">&#10005; Clear</button>
    </div>
  </div>
</div>
<div id="ctx-menu">
  <div class="ctx-item" id="ctx-open">&#128194; Open</div>
  <div class="ctx-item" id="ctx-preview">&#128065; Preview</div>
  <div class="ctx-item" id="ctx-download">&#8595; Download</div>
  <div class="ctx-divider"></div>
  <div class="ctx-item" id="ctx-rename">&#9999;&#65039; Rename</div>
  <div class="ctx-item" id="ctx-copy-path">&#128203; Copy path</div>
  <div class="ctx-item" id="ctx-info">&#8505;&#65039; Info</div>
  <div class="ctx-divider"></div>
  <div class="ctx-item danger" id="ctx-delete">&#128465; Delete</div>
</div>
<div id="settings-panel">
  <div class="settings-head"><span style="font-weight:600">Settings</span><button class="modal-close" onclick="closeSettings()">&#10005;</button></div>
  <div class="settings-section">
    <div style="font-size:.8rem;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">Appearance</div>
    <div class="setting-row"><div><div class="setting-label">Dark Mode</div></div><label class="toggle"><input type="checkbox" id="s-dark" onchange="applySetting('theme',this.checked?'dark':'light')"><span class="toggle-slider"></span></label></div>
    <div class="setting-row"><div><div class="setting-label">Default View</div></div><select class="settings-select" id="s-view" onchange="applySetting('view',this.value)"><option value="grid">Grid</option><option value="list">List</option></select></div>
  </div>
  <div class="settings-section">
    <div style="font-size:.8rem;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">Files</div>
    <div class="setting-row"><div><div class="setting-label">Show Hidden Files</div><div class="setting-desc">Files starting with .</div></div><label class="toggle"><input type="checkbox" id="s-hidden" onchange="applySetting('show_hidden',this.checked)"><span class="toggle-slider"></span></label></div>
    <div class="setting-row"><div><div class="setting-label">Allow Delete</div></div><label class="toggle"><input type="checkbox" id="s-delete" onchange="applySetting('allow_delete',this.checked)"><span class="toggle-slider"></span></label></div>
    <div class="setting-row"><div><div class="setting-label">Default Sort</div></div><select class="settings-select" id="s-sort" onchange="applySetting('sort',this.value)"><option value="name">Name</option><option value="date">Date</option><option value="size">Size</option><option value="type">Type</option></select></div>
  </div>
  <div class="settings-section">
    <div style="font-size:.8rem;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">Storage</div>
    <div id="stats-display" style="font-size:.83rem;color:var(--text2);line-height:1.9"></div>
  </div>
  <div class="settings-section">
    <div style="font-size:.8rem;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">About</div>
    <div style="font-size:.83rem;color:var(--text2);line-height:1.8"><b style="color:var(--accent);font-family:var(--mono)">PocketDrive v2</b><br>Secure file server for Termux<br>Flask + Vanilla JS</div>
  </div>
</div>
<div id="upload-zone"><div class="uz-box"><div style="font-size:3rem;margin-bottom:12px">&#128194;</div><div style="font-size:1rem;font-weight:500">Drop files to upload</div><div style="font-size:.8rem;color:var(--text3);margin-top:4px" id="uz-path">to Home</div></div></div>
<div id="upload-progress"><div id="up-label">Uploading&hellip;</div><div id="up-bar"><div id="up-fill"></div></div><div id="up-stats"><span id="up-pct">0%</span><span id="up-speed"></span></div></div>
<div id="toasts"></div>
<div id="main-overlay" onclick="closeSidebar()"></div>
<div id="new-folder-modal" style="display:none" class="modal-overlay"><div class="modal"><div class="modal-head"><span class="modal-title">New Folder</span><button class="modal-close" onclick="closeModal('new-folder-modal')">&#10005;</button></div><div class="modal-body"><label class="lbl">Folder Name</label><input class="inp" id="folder-name-inp" placeholder="My Folder"></div><div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal('new-folder-modal')">Cancel</button><button class="btn btn-primary" onclick="createFolder()">Create</button></div></div></div>
<div id="rename-modal" style="display:none" class="modal-overlay"><div class="modal"><div class="modal-head"><span class="modal-title">Rename</span><button class="modal-close" onclick="closeModal('rename-modal')">&#10005;</button></div><div class="modal-body"><label class="lbl">New Name</label><input class="inp" id="rename-inp"></div><div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal('rename-modal')">Cancel</button><button class="btn btn-primary" onclick="doRename()">Rename</button></div></div></div>
<div id="delete-modal" style="display:none" class="modal-overlay"><div class="modal"><div class="modal-head"><span class="modal-title">Confirm Delete</span><button class="modal-close" onclick="closeModal('delete-modal')">&#10005;</button></div><div class="modal-body"><p id="delete-msg" style="color:var(--text2);font-size:.9rem;line-height:1.6"></p></div><div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal('delete-modal')">Cancel</button><button class="btn btn-danger" onclick="doDelete()">Delete</button></div></div></div>
<div id="info-modal" style="display:none" class="modal-overlay"><div class="modal"><div class="modal-head"><span class="modal-title">File Info</span><button class="modal-close" onclick="closeModal('info-modal')">&#10005;</button></div><div class="modal-body" id="info-body" style="font-size:.85rem;line-height:2;color:var(--text2)"></div><div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal('info-modal')">Close</button></div></div></div>
<div id="preview-modal" style="display:none" class="modal-overlay" onclick="pvBg(event)">
  <div class="modal">
    <div class="modal-head"><div><div class="modal-title" id="pv-name">Preview</div><div id="pv-info" style="font-size:.8rem;color:var(--text2)"></div></div><div style="display:flex;gap:6px"><button class="btn btn-ghost" id="pv-dl" style="padding:6px 12px;font-size:.78rem">&#8595; Download</button><button class="modal-close" onclick="closePv()">&#10005;</button></div></div>
    <div class="modal-body"><button class="preview-nav" id="pv-prev" onclick="pvNav(-1)">&#8249;</button><button class="preview-nav" id="pv-next" onclick="pvNav(1)">&#8250;</button><img id="pv-img" alt=""><video id="pv-video" controls playsinline></video><audio id="pv-audio" controls></audio><iframe id="pv-frame" sandbox="allow-same-origin allow-scripts"></iframe><pre id="pv-code"></pre><div id="pv-none"><div style="font-size:3rem;margin-bottom:12px">&#128196;</div><div>No preview available</div><div style="font-size:.8rem;color:var(--text3);margin-top:4px">Download to open</div></div></div>
  </div>
</div>
<script>
var P='', items=[], sel=new Set(), ctxT=null, renT=null, delTs=[];
var view='grid', sortBy='name', sortDir='asc', showHidden=false;
var cfg={}, pvItems=[], pvIdx=0, filterMode=null, searchTO=null;
var ICONS={image:'🖼️',video:'🎬',audio:'🎵',pdf:'📕',apk:'📦',zip:'🗜️',code:'💻',doc:'📝',sheet:'📊',slide:'📊',font:'🔤',folder:'📁',other:'📄'};
var CODE_EXTS=new Set(['py','js','ts','html','css','json','xml','yaml','yml','sh','c','cpp','java','kt','go','rs','php','rb','swift','txt','md','csv','log','conf','ini']);

function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

async function api(url,o){
  var r=await fetch(url,o||{});
  if(r.status===401) location.href='/login';
  return r;
}

async function init(){await loadCfg();navigate('');loadStats();setupDrop();setupSearch();setupKeys();}

async function loadCfg(){
  try{var r=await fetch('/api/settings');if(r.status===401){location.href='/login';return;}cfg=await r.json();}catch(e){return;}
  view=cfg.view||'grid';sortBy=cfg.sort||'name';sortDir=cfg.sort_dir||'asc';showHidden=cfg.show_hidden||false;
  document.body.setAttribute('data-theme',cfg.theme||'dark');applyView();
  document.getElementById('sort-select').value=sortBy;
  document.getElementById('sort-dir-btn').textContent=sortDir==='asc'?'\u2191 ASC':'\u2193 DESC';
  document.getElementById('s-dark').checked=cfg.theme!=='light';
  document.getElementById('s-view').value=view;
  document.getElementById('s-hidden').checked=showHidden;
  document.getElementById('s-delete').checked=cfg.allow_delete!==false;
  document.getElementById('s-sort').value=sortBy;
}

async function navigate(path){
  filterMode=null;P=path;
  document.querySelectorAll('.nav-item').forEach(function(e){e.classList.remove('active');});
  document.getElementById('nav-home').classList.add('active');
  await loadFiles(path);
}

async function loadFiles(path){
  var r=await api('/api/files?path='+encodeURIComponent(path)+'&sort='+sortBy+'&sort_dir='+sortDir+'&show_hidden='+showHidden);
  if(!r.ok)return;
  var d=await r.json();items=d.items||[];renderCrumbs(d.breadcrumbs||[]);renderFiles(items);clearSel();
}

function renderCrumbs(crumbs){
  document.getElementById('breadcrumb').innerHTML=crumbs.map(function(c,i){
    var a=i===crumbs.length-1;
    return '<span class="bc-item'+(a?' active':'')+'"'+(a?'':' onclick="navigate(\''+esc(c.path)+'\')"')+'>'+esc(c.name)+'</span>'+(a?'':'<span class="bc-sep">&rsaquo;</span>');
  }).join('');
}

function renderFiles(fs){
  var g=document.getElementById('files-grid');
  if(!fs.length){g.innerHTML='<div class="empty-state"><div class="empty-icon">📂</div><p>This folder is empty</p></div>';return;}
  g.innerHTML=fs.map(function(f,i){return card(f,i);}).join('');
}

function card(f,i){
  var icon=ICONS[f.category]||'📄';
  var thumb=f.has_thumb
    ?'<img class="file-thumb" src="/api/thumbnail?path='+encodeURIComponent(f.path)+'" loading="lazy" onerror="this.outerHTML=\'<div class=\\"file-icon-wrap\\">'+icon+'</div>\''
    :'<div class="file-icon-wrap">'+icon+'</div>';
  return '<div class="file-card cat-'+esc(f.category)+'" data-path="'+esc(f.path)+'" onclick="cardClick(event,'+i+')" ondblclick="cardDblClick('+i+')" oncontextmenu="showCtx(event,'+i+')">'
    +'<div class="sel-check">\u2713</div>'+thumb
    +'<div class="file-info"><div class="file-name" title="'+esc(f.name)+'">'+esc(f.name)+'</div><div class="file-meta">'+esc(f.size_str)+' &middot; '+esc(f.mtime_str)+'</div></div>'
    +'<div class="card-menu"><button class="card-menu-btn" onclick="event.stopPropagation();showCtx(event,'+i+')"><svg width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><circle cx="8" cy="3" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="8" cy="13" r="1.5"/></svg></button></div>'
    +'</div>';
}

function cardClick(e,i){if(e.ctrlKey||e.metaKey||e.shiftKey||sel.size>0){e.preventDefault();toggleSel(i);}}
function cardDblClick(i){var f=items[i];if(f.is_dir)navigate(f.path);else openPv(i);}
function toggleSel(i){var p=items[i].path;if(sel.has(p))sel.delete(p);else sel.add(p);updateSel();}
function clearSel(){sel.clear();updateSel();}
function updateSel(){
  document.querySelectorAll('.file-card').forEach(function(c){c.classList.toggle('selected',sel.has(c.dataset.path));});
  var n=sel.size;document.getElementById('sel-bar').classList.toggle('visible',n>0);
  document.getElementById('sel-count').textContent=n+' selected';
}

function showCtx(e,i){
  e.preventDefault();e.stopPropagation();ctxT=items[i];
  var m=document.getElementById('ctx-menu');
  document.getElementById('ctx-open').style.display=ctxT.is_dir?'':'none';
  document.getElementById('ctx-preview').style.display=ctxT.is_dir?'none':'';
  m.style.left=Math.min(e.clientX,innerWidth-200)+'px';
  m.style.top=Math.min(e.clientY,innerHeight-260)+'px';
  m.classList.add('open');
}
document.addEventListener('click',function(){document.getElementById('ctx-menu').classList.remove('open');});
document.getElementById('ctx-open').onclick=function(){if(ctxT&&ctxT.is_dir)navigate(ctxT.path);};
document.getElementById('ctx-preview').onclick=function(){var i=items.findIndex(function(f){return f.path===ctxT&&ctxT.path;});if(ctxT){var idx=items.findIndex(function(f){return f.path===ctxT.path;});if(idx>=0)openPv(idx);}};
document.getElementById('ctx-download').onclick=function(){if(ctxT)window.open('/api/download?path='+encodeURIComponent(ctxT.path));};
document.getElementById('ctx-rename').onclick=function(){if(ctxT)startRename(ctxT);};
document.getElementById('ctx-copy-path').onclick=function(){if(ctxT){if(navigator.clipboard)navigator.clipboard.writeText(ctxT.path);toast('Path copied','info');}};
document.getElementById('ctx-info').onclick=function(){if(ctxT)showInfo(ctxT);};
document.getElementById('ctx-delete').onclick=function(){if(ctxT)confirmDel([ctxT]);};

document.getElementById('sort-select').onchange=function(){sortBy=this.value;reload();};
document.getElementById('sort-dir-btn').onclick=function(){sortDir=sortDir==='asc'?'desc':'asc';this.textContent=sortDir==='asc'?'\u2191 ASC':'\u2193 DESC';reload();};
document.getElementById('grid-btn').onclick=function(){view='grid';applyView();};
document.getElementById('list-btn').onclick=function(){view='list';applyView();};
function applyView(){
  document.getElementById('files-grid').classList.toggle('list-view',view==='list');
  document.getElementById('grid-btn').classList.toggle('active',view==='grid');
  document.getElementById('list-btn').classList.toggle('active',view==='list');
}
async function reload(){if(!filterMode)await loadFiles(P);}

document.getElementById('sidebar-toggle').onclick=function(){
  var s=document.getElementById('sidebar'),o=document.getElementById('main-overlay');
  if(innerWidth<=640){s.classList.toggle('mobile-open');o.classList.toggle('visible',s.classList.contains('mobile-open'));}
  else s.classList.toggle('collapsed');
};
function closeSidebar(){document.getElementById('sidebar').classList.remove('mobile-open');document.getElementById('main-overlay').classList.remove('visible');}

async function filterType(type){
  filterMode=type;document.querySelectorAll('.nav-item').forEach(function(e){e.classList.remove('active');});
  var r=await api('/api/search?q=.&path=');var d=await r.json();
  items=(d.items||[]).filter(function(f){return !f.is_dir&&f.category===type;});
  renderCrumbs([{name:'Home',path:''},{name:type[0].toUpperCase()+type.slice(1)+'s',path:''}]);
  renderFiles(items);clearSel();
}
async function showRecent(){
  filterMode='recent';
  var r=await api('/api/search?q=.&path=');var d=await r.json();
  items=(d.items||[]).filter(function(f){return !f.is_dir;}).sort(function(a,b){return b.mtime-a.mtime;}).slice(0,50);
  renderCrumbs([{name:'Home',path:''},{name:'Recent',path:''}]);renderFiles(items);clearSel();
}

// Upload
document.getElementById('file-input').onchange=async function(){if(this.files.length)await upload(Array.from(this.files));this.value='';};
var CHUNK_SIZE=10*1024*1024;

async function upload(files){
  var prog=document.getElementById('upload-progress'),fill=document.getElementById('up-fill'),
      lbl=document.getElementById('up-label'),pct=document.getElementById('up-pct'),spd=document.getElementById('up-speed');
  prog.style.display='block';
  var total=files.reduce(function(s,f){return s+f.size;},0),done=0,t0=Date.now();

  for(var fi=0;fi<files.length;fi++){
    var f=files[fi];lbl.textContent='Uploading '+(fi+1)+'/'+files.length+': '+f.name;
    if(f.size<=CHUNK_SIZE){
      var fd=new FormData();fd.append('path',P);fd.append('files',f);
      await new Promise(function(res,rej){
        var x=new XMLHttpRequest();
        x.upload.onprogress=function(e){
          if(!e.lengthComputable)return;
          var p=Math.round((done+e.loaded)/total*100);fill.style.width=p+'%';pct.textContent=p+'%';
          var sp=(done+e.loaded)/((Date.now()-t0)/1000);spd.textContent=fspd(sp);
        };
        x.onload=function(){done+=f.size;res();};x.onerror=rej;
        x.open('POST','/api/upload');x.send(fd);
      });
    }else{
      var chunks=Math.ceil(f.size/CHUNK_SIZE),uid=Math.random().toString(36).slice(2)+'_'+Date.now();
      for(var ci=0;ci<chunks;ci++){
        var blob=f.slice(ci*CHUNK_SIZE,(ci+1)*CHUNK_SIZE),fd2=new FormData();
        fd2.append('upload_id',uid);fd2.append('chunk_index',ci);fd2.append('total_chunks',chunks);
        fd2.append('filename',f.name);fd2.append('path',P);fd2.append('chunk',blob);
        await api('/api/upload/chunk',{method:'POST',body:fd2});
        done+=blob.size;var p2=Math.round(done/total*100);fill.style.width=p2+'%';pct.textContent=p2+'%';
        lbl.textContent='Uploading '+(fi+1)+'/'+files.length+': '+f.name+' [chunk '+(ci+1)+'/'+chunks+']';
        spd.textContent=fspd(done/((Date.now()-t0)/1000));
      }
    }
  }
  prog.style.display='none';fill.style.width='0%';pct.textContent='0%';spd.textContent='';
  toast('Uploaded '+files.length+' file(s)','success');loadFiles(P);loadStats();
}
function fspd(b){if(b>1e9)return(b/1e9).toFixed(1)+' GB/s';if(b>1e6)return(b/1e6).toFixed(1)+' MB/s';if(b>1e3)return(b/1e3).toFixed(1)+' KB/s';return b.toFixed(0)+' B/s';}

function setupDrop(){
  var z=document.getElementById('upload-zone');var dc=0;
  document.body.addEventListener('dragenter',function(e){if(e.dataTransfer&&e.dataTransfer.types&&e.dataTransfer.types.includes('Files')){dc++;z.classList.add('active');document.getElementById('uz-path').textContent='to '+(P||'Home');}});
  document.body.addEventListener('dragleave',function(){if(--dc<=0){dc=0;z.classList.remove('active');}});
  document.body.addEventListener('dragover',function(e){e.preventDefault();});
  document.body.addEventListener('drop',function(e){e.preventDefault();dc=0;z.classList.remove('active');if(e.dataTransfer&&e.dataTransfer.files.length)upload(Array.from(e.dataTransfer.files));});
}

document.getElementById('new-folder-btn').onclick=function(){document.getElementById('folder-name-inp').value='';showModal('new-folder-modal');setTimeout(function(){document.getElementById('folder-name-inp').focus();},100);};
document.getElementById('folder-name-inp').addEventListener('keydown',function(e){if(e.key==='Enter')createFolder();});
async function createFolder(){
  var name=document.getElementById('folder-name-inp').value.trim();if(!name)return;
  var r=await api('/api/mkdir',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:P,name:name})});
  if(r.ok){toast('Folder created','success');closeModal('new-folder-modal');loadFiles(P);}
  else{var d=await r.json();toast(d.error||'Error','error');}
}

function startRename(f){renT=f;document.getElementById('rename-inp').value=f.name;showModal('rename-modal');setTimeout(function(){var i=document.getElementById('rename-inp');i.focus();i.select();},100);}
document.getElementById('rename-inp').addEventListener('keydown',function(e){if(e.key==='Enter')doRename();});
async function doRename(){
  var name=document.getElementById('rename-inp').value.trim();if(!name||!renT)return;
  var r=await api('/api/rename',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:renT.path,new_name:name})});
  if(r.ok){toast('Renamed','success');closeModal('rename-modal');loadFiles(P);}
  else{var d=await r.json();toast(d.error||'Error','error');}
}

function confirmDel(files){
  delTs=files;
  document.getElementById('delete-msg').textContent='Delete "'+files.map(function(f){return f.name;}).join(', ')+'"? Cannot be undone.';
  showModal('delete-modal');
}
async function doDelete(){
  for(var i=0;i<delTs.length;i++){
    var r=await api('/api/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:delTs[i].path})});
    if(!r.ok){var d=await r.json();toast(d.error||'Error','error');closeModal('delete-modal');return;}
  }
  toast('Deleted '+delTs.length+' item(s)','success');closeModal('delete-modal');loadFiles(P);loadStats();
}
function deleteSelected(){var fs=items.filter(function(f){return sel.has(f.path);});if(fs.length)confirmDel(fs);}
function downloadSelected(){sel.forEach(function(p){window.open('/api/download?path='+encodeURIComponent(p));});}

function openPv(i){pvItems=items.filter(function(f){return !f.is_dir;});pvIdx=pvItems.findIndex(function(f){return f===items[i];});if(pvIdx<0)pvIdx=0;showPv();}
function showPv(){
  var f=pvItems[pvIdx];if(!f)return;
  document.getElementById('preview-modal').style.display='flex';
  document.getElementById('pv-name').textContent=f.name;
  document.getElementById('pv-info').textContent=f.size_str+' \u00B7 '+f.mtime_str;
  document.getElementById('pv-dl').onclick=function(){window.open('/api/download?path='+encodeURIComponent(f.path));};
  document.getElementById('pv-prev').style.display=pvIdx>0?'':'none';
  document.getElementById('pv-next').style.display=pvIdx<pvItems.length-1?'':'none';
  ['pv-img','pv-video','pv-audio','pv-frame','pv-code','pv-none'].forEach(function(id){
    var el=document.getElementById(id);el.style.display='none';
    if(el.tagName==='VIDEO'||el.tagName==='AUDIO'){el.pause();el.src='';}
  });
  var url='/api/preview?path='+encodeURIComponent(f.path);
  if(f.category==='image'){var e=document.getElementById('pv-img');e.src=url;e.style.display='block';}
  else if(f.category==='video'){var e=document.getElementById('pv-video');e.src=url;e.style.display='block';e.play().catch(function(){});}
  else if(f.category==='audio'){var e=document.getElementById('pv-audio');e.src=url;e.style.display='block';}
  else if(f.category==='pdf'){var e=document.getElementById('pv-frame');e.src=url;e.style.display='block';}
  else if(CODE_EXTS.has(f.ext)){fetch(url).then(function(r){return r.text();}).then(function(t){var e=document.getElementById('pv-code');e.textContent=t.slice(0,50000);e.style.display='block';});}
  else{document.getElementById('pv-none').style.display='block';}
}
function pvNav(d){pvIdx=Math.max(0,Math.min(pvItems.length-1,pvIdx+d));showPv();}
function closePv(){
  document.getElementById('preview-modal').style.display='none';
  var v=document.getElementById('pv-video');v.pause();v.src='';
  var a=document.getElementById('pv-audio');a.pause();a.src='';
}
function pvBg(e){if(e.target===document.getElementById('preview-modal'))closePv();}

function showInfo(f){
  document.getElementById('info-body').innerHTML='<div style="display:grid;grid-template-columns:auto 1fr;gap:4px 16px">'
    +'<span style="color:var(--text3)">Name</span><span>'+esc(f.name)+'</span>'
    +'<span style="color:var(--text3)">Type</span><span>'+esc(f.category)+(f.ext?' (.'+esc(f.ext)+')')+'</span>'
    +'<span style="color:var(--text3)">Size</span><span>'+esc(f.size_str)+'</span>'
    +'<span style="color:var(--text3)">Modified</span><span>'+esc(f.mtime_str)+'</span>'
    +'<span style="color:var(--text3)">Path</span><span style="font-family:var(--mono);font-size:.75rem;word-break:break-all">'+esc(f.path)+'</span>'
    +'</div>';
  showModal('info-modal');
}

function setupSearch(){
  var inp=document.getElementById('search'),res=document.getElementById('search-results');
  inp.addEventListener('input',function(){
    clearTimeout(searchTO);var q=inp.value.trim();
    if(!q){res.classList.remove('open');return;}
    searchTO=setTimeout(async function(){
      var r=await api('/api/search?q='+encodeURIComponent(q)+'&path=');if(!r.ok)return;
      var d=await r.json();var fs=d.items||[];
      if(!fs.length) res.innerHTML='<div class="sr-item" style="color:var(--text3)">No results</div>';
      else res.innerHTML=fs.slice(0,12).map(function(f){return '<div class="sr-item" onclick="searchOpen(\''+esc(f.path)+'\','+f.is_dir+')">'+(ICONS[f.category]||'📄')+' <span>'+esc(f.name)+'</span><span class="sr-path">'+esc(f.path.includes('/')?f.path.split('/').slice(0,-1).join('/'):'Home')+'</span></div>';}).join('');
      res.classList.add('open');
    },300);
  });
  document.addEventListener('click',function(e){if(!inp.contains(e.target)&&!res.contains(e.target))res.classList.remove('open');});
}
function searchOpen(path,isDir){
  document.getElementById('search-results').classList.remove('open');document.getElementById('search').value='';
  if(isDir) navigate(path);
  else{var par=path.includes('/')?path.split('/').slice(0,-1).join('/'):'';navigate(par).then(function(){var i=items.findIndex(function(f){return f.path===path;});if(i>=0)openPv(i);});}
}

document.getElementById('settings-btn').onclick=function(){document.getElementById('settings-panel').classList.add('open');};
function closeSettings(){document.getElementById('settings-panel').classList.remove('open');}
async function applySetting(k,v){
  cfg[k]=v;
  if(k==='theme')document.body.setAttribute('data-theme',v);
  if(k==='view'){view=v;applyView();}
  if(k==='sort')sortBy=v;
  if(k==='show_hidden')showHidden=v;
  await api('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(cfg)});
  if(k==='show_hidden'||k==='sort')reload();
}

document.getElementById('logout-btn').onclick=async function(){await fetch('/api/logout',{method:'POST'});location.href='/login';};

async function loadStats(){
  try{
    var r=await api('/api/stats');if(!r.ok)return;var d=await r.json();
    var pct=d.disk_total?Math.round(d.disk_used/d.disk_total*100):0;
    document.getElementById('storage-fill').style.width=pct+'%';
    document.getElementById('storage-used').textContent=d.disk_used_str;
    document.getElementById('storage-total').textContent=d.disk_total_str;
    document.getElementById('stats-display').innerHTML='Files: <b>'+d.files+'</b><br>Folders: <b>'+d.folders+'</b><br>Drive: <b>'+d.size_str+'</b><br>Disk: <b>'+d.disk_used_str+'</b>/'+d.disk_total_str+' ('+pct+'%)<br>Free: <b>'+d.disk_free_str+'</b>';
  }catch(e){}
}

function setupKeys(){
  document.addEventListener('keydown',function(e){
    var inInp=['INPUT','TEXTAREA'].includes(e.target.tagName);
    if(e.key==='Escape'){closePv();clearSel();}
    if(!inInp){
      var open=document.getElementById('preview-modal').style.display==='flex';
      if(e.key==='ArrowLeft'&&open)pvNav(-1);
      if(e.key==='ArrowRight'&&open)pvNav(1);
      if(e.key==='Delete'&&sel.size)deleteSelected();
      if((e.ctrlKey||e.metaKey)&&e.key==='a'){e.preventDefault();items.forEach(function(f){sel.add(f.path);});updateSel();}
    }
  });
}

function showModal(id){document.getElementById(id).style.display='flex';}
function closeModal(id){document.getElementById(id).style.display='none';}
document.querySelectorAll('.modal-overlay').forEach(function(m){m.addEventListener('click',function(e){if(e.target===m)m.style.display='none';});});

function toast(msg,type){
  type=type||'info';var el=document.createElement('div');el.className='toast '+type;
  el.textContent={success:'\u2713 ',error:'\u2715 ',info:'\u2139 '}[type]+msg;
  document.getElementById('toasts').appendChild(el);setTimeout(function(){el.remove();},3000);
}

init();
</script>
</body>
</html>"""

# ---------------------------------------------------------------------------
# Boot
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    cfg  = load_config()
    port = int(os.environ.get("PORT", cfg.get("port", 8080)))
    host = os.environ.get("HOST", "0.0.0.0")
    print(f"""
\u256c\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
  PocketDrive v2  \u2014  SECURE
\u255f\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2562
  URL:      http://localhost:{port}
  Files:    {BASE_DIR}
  Password: {PASSWORD}

  Change password:
  DRIVE_PASS=secret python drive_server.py

  Stop: Ctrl+C
\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d
""")
    app.run(host=host, port=port, debug=False, threaded=True)
