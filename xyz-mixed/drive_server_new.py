#!/usr/bin/env python3
"""
╔══════════════════════════════════════╗
║   PocketDrive — Mini Google Drive   ║
║   Run: python drive_server.py        ║
║   Termux: pip install flask pillow   ║
╚══════════════════════════════════════╝
"""

import os, sys, json, shutil, mimetypes, subprocess, base64, hashlib, time
from pathlib import Path
from io import BytesIO
from datetime import datetime

try:
    from flask import Flask, request, jsonify, send_file, Response, abort
except ImportError:
    print("Installing Flask..."); os.system("pip install flask"); from flask import Flask, request, jsonify, send_file, Response, abort

try:
    from PIL import Image
    PIL_AVAILABLE = True
except ImportError:
    print("Installing Pillow..."); os.system("pip install pillow"); 
    try: from PIL import Image; PIL_AVAILABLE = True
    except: PIL_AVAILABLE = False

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = None 

# ─── Config ──────────────────────────────────────────────────────────────────
BASE_DIR   = Path(os.environ.get("DRIVE_ROOT", Path.home() / "PocketDrive")).resolve()
THUMB_DIR  = BASE_DIR / ".thumbs"
CONFIG_FILE = BASE_DIR / ".config.json"
BASE_DIR.mkdir(parents=True, exist_ok=True)
THUMB_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_CONFIG = {
    "theme": "dark",
    "view": "grid",
    "sort": "name",
    "sort_dir": "asc",
    "show_hidden": False,
    "port": 8080,
    "title": "PocketDrive",
    "thumbnail_size": 200,
    "allow_delete": True,
}

def load_config():
    if CONFIG_FILE.exists():
        try: return {**DEFAULT_CONFIG, **json.loads(CONFIG_FILE.read_text())}
        except: pass
    return DEFAULT_CONFIG.copy()

def save_config(cfg):
    CONFIG_FILE.write_text(json.dumps(cfg, indent=2))

# ─── Helpers ─────────────────────────────────────────────────────────────────
def safe_path(rel):
    p = (BASE_DIR / rel).resolve()
    if not str(p).startswith(str(BASE_DIR)):
        abort(403)
    return p

def human_size(b):
    for u in ["B","KB","MB","GB","TB"]:
        if b < 1024: return f"{b:.1f} {u}"
        b /= 1024
    return f"{b:.1f} PB"

def file_category(ext):
    ext = ext.lower().lstrip(".")
    return (
        "image"  if ext in {"jpg","jpeg","png","gif","webp","bmp","svg","ico","heic","avif"} else
        "video"  if ext in {"mp4","mkv","webm","avi","mov","m4v","3gp","flv","ts","mpeg"} else
        "audio"  if ext in {"mp3","wav","ogg","flac","aac","m4a","opus","wma"} else
        "pdf"    if ext == "pdf" else
        "apk"    if ext == "apk" else
        "zip"    if ext in {"zip","rar","7z","tar","gz","bz2","xz"} else
        "code"   if ext in {"py","js","ts","html","css","json","xml","yaml","yml","sh","c","cpp","java","kt","go","rs","php","rb","swift"} else
        "doc"    if ext in {"doc","docx","odt","rtf","txt","md"} else
        "sheet"  if ext in {"xls","xlsx","ods","csv"} else
        "slide"  if ext in {"ppt","pptx","odp"} else
        "font"   if ext in {"ttf","otf","woff","woff2"} else
        "other"
    )

def get_mime(path):
    mime, _ = mimetypes.guess_type(str(path))
    return mime or "application/octet-stream"

def thumb_key(path):
    stat = path.stat()
    key = f"{path}{stat.st_size}{stat.st_mtime}"
    return hashlib.md5(key.encode()).hexdigest()

def make_thumbnail(path, size=200):
    ext  = path.suffix.lower().lstrip(".")
    cat  = file_category(ext)
    tkey = thumb_key(path)
    tpath = THUMB_DIR / f"{tkey}.jpg"
    if tpath.exists(): return tpath

    if cat == "image" and PIL_AVAILABLE:
        try:
            img = Image.open(path).convert("RGB")
            img.thumbnail((size, size), Image.LANCZOS)
            img.save(tpath, "JPEG", quality=75)
            return tpath
        except: pass

    if cat == "video":
        try:
            r = subprocess.run(
                ["ffmpeg","-y","-i",str(path),"-ss","00:00:01",
                 "-vframes","1","-vf",f"scale={size}:-1",str(tpath)],
                capture_output=True, timeout=10
            )
            if tpath.exists(): return tpath
        except: pass

    return None  # no thumbnail → use icon

def file_info(path, rel_base=""):
    stat  = path.stat()
    ext   = path.suffix.lower() if path.is_file() else ""
    cat   = file_category(ext.lstrip(".")) if path.is_file() else "folder"
    rel   = str(path.relative_to(BASE_DIR))
    return {
        "name"     : path.name,
        "path"     : rel.replace("\\", "/"),
        "is_dir"   : path.is_dir(),
        "category" : cat,
        "ext"      : ext.lstrip("."),
        "size"     : stat.st_size if path.is_file() else 0,
        "size_str" : human_size(stat.st_size) if path.is_file() else "—",
        "mtime"    : stat.st_mtime,
        "mtime_str": datetime.fromtimestamp(stat.st_mtime).strftime("%b %d, %Y"),
        "mime"     : get_mime(path) if path.is_file() else "inode/directory",
        "has_thumb": make_thumbnail(path) is not None if path.is_file() else False,
    }

# ─── API Routes ───────────────────────────────────────────────────────────────
@app.route("/api/files")
def api_files():
    rel  = request.args.get("path", "")
    cfg  = load_config()
    sort = request.args.get("sort", cfg["sort"])
    sdir = request.args.get("sort_dir", cfg["sort_dir"])
    show_hidden = request.args.get("show_hidden", str(cfg["show_hidden"])).lower() == "true"

    folder = safe_path(rel)
    if not folder.is_dir(): return jsonify({"error": "Not a directory"}), 400

    items = []
    for p in folder.iterdir():
        if not show_hidden and p.name.startswith("."): continue
        try: items.append(file_info(p))
        except PermissionError: pass

    rev = sdir == "desc"
    if sort == "name":    items.sort(key=lambda x: (not x["is_dir"], x["name"].lower()), reverse=rev)
    elif sort == "size":  items.sort(key=lambda x: (not x["is_dir"], x["size"]), reverse=rev)
    elif sort == "date":  items.sort(key=lambda x: (not x["is_dir"], x["mtime"]), reverse=rev)
    elif sort == "type":  items.sort(key=lambda x: (not x["is_dir"], x["ext"]), reverse=rev)

    # Build breadcrumbs
    parts = [p for p in rel.replace("\\","/").split("/") if p]
    crumbs = [{"name": "Home", "path": ""}]
    for i, p in enumerate(parts):
        crumbs.append({"name": p, "path": "/".join(parts[:i+1])})

    return jsonify({"items": items, "breadcrumbs": crumbs, "path": rel})

@app.route("/api/upload", methods=["POST"])
def api_upload():
    rel  = request.form.get("path", "")
    dest = safe_path(rel)
    if not dest.is_dir(): return jsonify({"error": "Destination not a folder"}), 400
    saved = []
    for f in request.files.getlist("files"):
        out = dest / f.filename
        f.save(str(out)); saved.append(f.filename)
    return jsonify({"saved": saved})

@app.route("/api/mkdir", methods=["POST"])
def api_mkdir():
    data = request.json or {}
    p = safe_path(os.path.join(data.get("path",""), data.get("name","")))
    p.mkdir(parents=True, exist_ok=True)
    return jsonify({"ok": True})

@app.route("/api/rename", methods=["POST"])
def api_rename():
    data = request.json or {}
    src  = safe_path(data.get("path",""))
    new  = src.parent / data.get("new_name","")
    src.rename(new)
    return jsonify({"ok": True})

@app.route("/api/delete", methods=["POST"])
def api_delete():
    cfg = load_config()
    if not cfg.get("allow_delete", True): return jsonify({"error": "Delete disabled in settings"}), 403
    data = request.json or {}
    p = safe_path(data.get("path",""))
    if p.is_dir(): shutil.rmtree(p)
    else: p.unlink()
    return jsonify({"ok": True})

@app.route("/api/move", methods=["POST"])
def api_move():
    data = request.json or {}
    src  = safe_path(data.get("src",""))
    dst  = safe_path(data.get("dst",""))
    if dst.is_dir(): dst = dst / src.name
    shutil.move(str(src), str(dst))
    return jsonify({"ok": True})

@app.route("/api/copy", methods=["POST"])
def api_copy():
    data = request.json or {}
    src  = safe_path(data.get("src",""))
    dst  = safe_path(data.get("dst","")) / src.name
    if src.is_dir(): shutil.copytree(src, dst)
    else: shutil.copy2(src, dst)
    return jsonify({"ok": True})

@app.route("/api/download")
def api_download():
    p = safe_path(request.args.get("path",""))
    if not p.is_file(): abort(404)
    return send_file(p, as_attachment=True)

@app.route("/api/preview")
def api_preview():
    p = safe_path(request.args.get("path",""))
    if not p.is_file(): abort(404)
    mime = get_mime(p)
    # Stream large files
    size = p.stat().st_size
    range_header = request.headers.get("Range")
    if range_header:
        byte_range = range_header.strip().replace("bytes=","").split("-")
        start = int(byte_range[0]) if byte_range[0] else 0
        end   = int(byte_range[1]) if byte_range[1] else size - 1
        length = end - start + 1
        def generate():
            with open(p, "rb") as f:
                f.seek(start)
                remaining = length
                while remaining:
                    chunk = min(65536, remaining)
                    data = f.read(chunk)
                    if not data: break
                    yield data
                    remaining -= len(data)
        resp = Response(generate(), 206, mimetype=mime, direct_passthrough=True)
        resp.headers["Content-Range"] = f"bytes {start}-{end}/{size}"
        resp.headers["Accept-Ranges"] = "bytes"
        resp.headers["Content-Length"] = length
        return resp
    return send_file(p, mimetype=mime)

@app.route("/api/thumbnail")
def api_thumbnail():
    p = safe_path(request.args.get("path",""))
    t = make_thumbnail(p, load_config().get("thumbnail_size", 200))
    if t: return send_file(t, mimetype="image/jpeg")
    abort(404)

@app.route("/api/info")
def api_info():
    p = safe_path(request.args.get("path",""))
    return jsonify(file_info(p))

@app.route("/api/search")
def api_search():
    q   = request.args.get("q","").lower().strip()
    rel = request.args.get("path","")
    if not q: return jsonify({"items":[]})
    root = safe_path(rel)
    results = []
    for p in root.rglob("*"):
        if q in p.name.lower():
            try: results.append(file_info(p))
            except: pass
        if len(results) >= 100: break
    return jsonify({"items": results})

@app.route("/api/settings", methods=["GET","POST"])
def api_settings():
    if request.method == "GET": return jsonify(load_config())
    cfg = load_config()
    cfg.update(request.json or {})
    save_config(cfg)
    return jsonify(cfg)

@app.route("/api/stats")
def api_stats():
    total = size = files = folders = 0
    for p in BASE_DIR.rglob("*"):
        if p.name.startswith("."): continue
        if p.is_file(): files += 1; size += p.stat().st_size
        elif p.is_dir(): folders += 1
    try:
        disk = shutil.disk_usage(str(BASE_DIR))
        disk_total, disk_used, disk_free = disk.total, disk.used, disk.free
    except: disk_total = disk_used = disk_free = 0
    return jsonify({
        "files": files, "folders": folders,
        "size": size, "size_str": human_size(size),
        "disk_total": disk_total, "disk_used": disk_used, "disk_free": disk_free,
        "disk_total_str": human_size(disk_total),
        "disk_used_str": human_size(disk_used),
        "disk_free_str": human_size(disk_free),
    })

# ─── Main HTML ───────────────────────────────────────────────────────────────
HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>PocketDrive</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
:root {
  --bg: #0f1117;
  --bg2: #181b23;
  --bg3: #1e2130;
  --surface: #23273a;
  --surface2: #2a2f45;
  --border: #2e3347;
  --accent: #4f8ef7;
  --accent2: #6ee7b7;
  --accent3: #f472b6;
  --text: #e2e8f0;
  --text2: #94a3b8;
  --text3: #64748b;
  --danger: #ef4444;
  --warn: #f59e0b;
  --success: #22c55e;
  --radius: 12px;
  --shadow: 0 4px 24px rgba(0,0,0,.4);
  --font: 'DM Sans', sans-serif;
  --mono: 'Space Mono', monospace;
  --sidebar: 240px;
  --topbar: 60px;
}
[data-theme="light"] {
  --bg: #f0f4f8; --bg2: #ffffff; --bg3: #e8edf4;
  --surface: #ffffff; --surface2: #f1f5f9;
  --border: #dde3ee; --text: #1e293b; --text2: #475569; --text3: #94a3b8;
  --shadow: 0 4px 24px rgba(0,0,0,.08);
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;overflow:hidden}
body{font-family:var(--font);background:var(--bg);color:var(--text);display:flex;flex-direction:column}

/* ── Topbar ── */
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
.sr-path{color:var(--text3);font-size:.75rem;margin-left:auto}
#topbar-actions{display:flex;gap:6px;align-items:center;margin-left:auto}
.tb-btn{background:none;border:none;color:var(--text2);cursor:pointer;padding:7px;border-radius:8px;transition:.15s;display:flex;align-items:center;justify-content:center}
.tb-btn:hover{background:var(--surface);color:var(--text)}
.tb-btn.active{color:var(--accent)}
#upload-btn{background:var(--accent);color:#fff;padding:7px 16px;border-radius:24px;font-family:var(--font);font-size:.85rem;font-weight:500;cursor:pointer;border:none;display:flex;align-items:center;gap:6px;transition:.2s}
#upload-btn:hover{filter:brightness(1.1)}

/* ── Layout ── */
#layout{display:flex;flex:1;overflow:hidden}

/* ── Sidebar ── */
#sidebar{width:var(--sidebar);background:var(--bg2);border-right:1px solid var(--border);display:flex;flex-direction:column;flex-shrink:0;overflow-y:auto;transition:.25s}
#sidebar.collapsed{width:0;overflow:hidden}
.sidebar-section{padding:12px 8px 4px}
.sidebar-label{font-size:.68rem;text-transform:uppercase;letter-spacing:.1em;color:var(--text3);padding:0 8px 6px;font-weight:600}
.nav-item{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;cursor:pointer;font-size:.85rem;color:var(--text2);transition:.15s;white-space:nowrap}
.nav-item:hover{background:var(--surface);color:var(--text)}
.nav-item.active{background:var(--accent)18;color:var(--accent)}
.nav-item svg{flex-shrink:0;opacity:.7}
.nav-item.active svg{opacity:1}
.sidebar-divider{height:1px;background:var(--border);margin:8px}
.storage-bar-wrap{padding:12px 12px 16px}
.storage-label{font-size:.75rem;color:var(--text2);margin-bottom:8px}
.storage-bar{height:4px;background:var(--border);border-radius:4px;overflow:hidden}
.storage-fill{height:100%;background:linear-gradient(90deg,var(--accent),var(--accent2));border-radius:4px;transition:width .5s}
.storage-nums{display:flex;justify-content:space-between;font-size:.72rem;color:var(--text3);margin-top:6px}

/* ── Main ── */
#main{flex:1;display:flex;flex-direction:column;overflow:hidden;background:var(--bg)}
#toolbar{display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid var(--border);background:var(--bg2);flex-shrink:0}
#breadcrumb{display:flex;align-items:center;gap:4px;font-size:.85rem;flex:1;overflow:hidden}
.bc-item{color:var(--text2);cursor:pointer;white-space:nowrap;padding:2px 4px;border-radius:4px;transition:.15s}
.bc-item:hover{color:var(--text);background:var(--surface)}
.bc-item.active{color:var(--text);pointer-events:none}
.bc-sep{color:var(--text3);font-size:.75rem}
.tool-btn{background:none;border:1px solid var(--border);color:var(--text2);cursor:pointer;padding:6px 12px;border-radius:8px;font-family:var(--font);font-size:.8rem;display:flex;align-items:center;gap:5px;transition:.15s;white-space:nowrap}
.tool-btn:hover{background:var(--surface);color:var(--text)}
.tool-btn.danger:hover{background:#ef444418;color:var(--danger);border-color:var(--danger)}
#sort-select{background:var(--surface);border:1px solid var(--border);color:var(--text2);padding:5px 10px;border-radius:8px;font-family:var(--font);font-size:.8rem;cursor:pointer;outline:none}
#view-toggle{display:flex;background:var(--surface);border:1px solid var(--border);border-radius:8px;overflow:hidden}
.view-btn{background:none;border:none;padding:6px 10px;cursor:pointer;color:var(--text3);transition:.15s;display:flex}
.view-btn.active{background:var(--accent);color:#fff}

/* ── File Grid ── */
#files-wrap{flex:1;overflow-y:auto;padding:16px}
#files-wrap.drop-active{background:var(--accent)10;outline:2px dashed var(--accent);outline-offset:-8px;border-radius:var(--radius)}
#files-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px}
#files-grid.list-view{grid-template-columns:1fr}
.file-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:0;cursor:pointer;transition:.18s;position:relative;overflow:hidden;user-select:none}
.file-card:hover{border-color:var(--accent)88;box-shadow:0 0 0 2px var(--accent)22,var(--shadow);transform:translateY(-1px)}
.file-card.selected{border-color:var(--accent);background:var(--accent)10}
.file-thumb{width:100%;aspect-ratio:1;object-fit:cover;display:block}
.file-icon-wrap{width:100%;aspect-ratio:1;display:flex;align-items:center;justify-content:center;font-size:2.8rem}
.file-info{padding:8px 10px 10px}
.file-name{font-size:.78rem;font-weight:500;word-break:break-word;line-height:1.3;color:var(--text)}
.file-meta{font-size:.68rem;color:var(--text3);margin-top:3px}
/* List view */
#files-grid.list-view .file-card{display:flex;align-items:center;border-radius:8px;padding:6px 12px;gap:12px}
#files-grid.list-view .file-thumb{width:36px;height:36px;aspect-ratio:1;border-radius:6px;flex-shrink:0}
#files-grid.list-view .file-icon-wrap{width:36px;height:36px;aspect-ratio:1;font-size:1.3rem;flex-shrink:0}
#files-grid.list-view .file-info{padding:0;flex:1;display:flex;align-items:center;gap:12px}
#files-grid.list-view .file-name{flex:1}
#files-grid.list-view .file-meta{margin:0;min-width:100px;text-align:right}
.file-card .sel-check{position:absolute;top:6px;left:6px;width:18px;height:18px;border-radius:50%;background:var(--accent);display:none;align-items:center;justify-content:center}
.file-card.selected .sel-check{display:flex}
.file-card .card-menu{position:absolute;top:6px;right:6px;background:var(--bg)cc;border-radius:6px;padding:2px;display:none}
.file-card:hover .card-menu{display:flex}
.card-menu-btn{background:none;border:none;cursor:pointer;color:var(--text2);padding:3px;border-radius:4px;display:flex;transition:.15s}
.card-menu-btn:hover{background:var(--surface2);color:var(--text)}
.empty-state{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:60px 20px;color:var(--text3);text-align:center}
.empty-state .empty-icon{font-size:3rem;opacity:.4}
.empty-state p{font-size:.9rem}

/* ── Selection Bar ── */
#sel-bar{display:none;align-items:center;gap:8px;padding:8px 16px;background:var(--accent)15;border-top:1px solid var(--border);flex-shrink:0}
#sel-bar.visible{display:flex}
#sel-count{font-size:.85rem;color:var(--accent);font-weight:500}

/* ── Context Menu ── */
#ctx-menu{position:fixed;z-index:9999;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);min-width:180px;padding:6px;display:none}
#ctx-menu.open{display:block}
.ctx-item{display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;cursor:pointer;font-size:.85rem;color:var(--text2);transition:.15s}
.ctx-item:hover{background:var(--surface2);color:var(--text)}
.ctx-item.danger{color:var(--danger)}
.ctx-item.danger:hover{background:#ef444415}
.ctx-divider{height:1px;background:var(--border);margin:4px 0}

/* ── Modal ── */
.modal-overlay{position:fixed;inset:0;background:#000a;z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(4px)}
.modal{background:var(--surface);border:1px solid var(--border);border-radius:16px;box-shadow:var(--shadow);width:100%;max-width:480px;overflow:hidden}
.modal-head{display:flex;align-items:center;justify-content:space-between;padding:18px 20px;border-bottom:1px solid var(--border)}
.modal-title{font-weight:600;font-size:1rem}
.modal-close{background:none;border:none;cursor:pointer;color:var(--text3);padding:4px;border-radius:6px;display:flex;transition:.15s}
.modal-close:hover{background:var(--surface2);color:var(--text)}
.modal-body{padding:20px}
.modal-foot{padding:16px 20px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end}
.inp{width:100%;background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:10px 14px;color:var(--text);font-family:var(--font);font-size:.9rem;outline:none;transition:.2s}
.inp:focus{border-color:var(--accent)}
.btn{padding:8px 18px;border-radius:8px;border:none;cursor:pointer;font-family:var(--font);font-size:.85rem;font-weight:500;transition:.15s}
.btn-primary{background:var(--accent);color:#fff}
.btn-primary:hover{filter:brightness(1.1)}
.btn-ghost{background:none;border:1px solid var(--border);color:var(--text2)}
.btn-ghost:hover{background:var(--surface2)}
.btn-danger{background:var(--danger);color:#fff}
.btn-danger:hover{filter:brightness(1.1)}
label.lbl{display:block;font-size:.8rem;color:var(--text2);margin-bottom:6px;font-weight:500}

/* ── Preview Modal ── */
#preview-modal .modal{max-width:95vw;max-height:95vh;width:auto;display:flex;flex-direction:column}
#preview-modal .modal-body{flex:1;padding:0;display:flex;align-items:center;justify-content:center;background:#000;overflow:hidden;min-height:200px}
#preview-modal .modal-head{background:var(--bg2)}
#preview-img{max-width:90vw;max-height:80vh;object-fit:contain;display:none}
#preview-video{max-width:90vw;max-height:80vh;display:none;outline:none}
#preview-audio{display:none;padding:20px}
#preview-iframe{width:90vw;height:80vh;border:none;display:none;background:#fff}
#preview-code{max-width:90vw;max-height:80vh;overflow:auto;padding:20px;font-family:var(--mono);font-size:.8rem;line-height:1.6;color:var(--accent2);background:#000;display:none;white-space:pre-wrap}
#preview-nopreview{text-align:center;padding:40px;color:var(--text3);display:none}
.preview-nav{position:absolute;top:50%;transform:translateY(-50%);background:var(--bg)cc;border:none;cursor:pointer;color:var(--text);padding:10px;border-radius:50%;display:flex;transition:.15s;z-index:10}
.preview-nav:hover{background:var(--bg)}
#preview-prev{left:10px}
#preview-next{right:10px}
#preview-info{font-size:.8rem;color:var(--text2)}

/* ── Settings Panel ── */
#settings-panel{position:fixed;right:0;top:0;height:100%;width:360px;background:var(--bg2);border-left:1px solid var(--border);z-index:500;transform:translateX(100%);transition:.25s;overflow-y:auto;display:flex;flex-direction:column}
#settings-panel.open{transform:none;box-shadow:var(--shadow)}
.settings-head{display:flex;align-items:center;justify-content:space-between;padding:18px 20px;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--bg2);z-index:1}
.settings-section{padding:20px}
.settings-section + .settings-section{border-top:1px solid var(--border)}
.setting-row{display:flex;align-items:center;justify-content:space-between;padding:10px 0}
.setting-label{font-size:.85rem;color:var(--text2)}
.setting-desc{font-size:.75rem;color:var(--text3);margin-top:2px}
.toggle{position:relative;width:42px;height:24px;flex-shrink:0}
.toggle input{opacity:0;width:0;height:0}
.toggle-slider{position:absolute;inset:0;background:var(--border);border-radius:24px;cursor:pointer;transition:.2s}
.toggle-slider::before{content:"";position:absolute;width:18px;height:18px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.2s}
.toggle input:checked + .toggle-slider{background:var(--accent)}
.toggle input:checked + .toggle-slider::before{transform:translateX(18px)}
.settings-select{background:var(--bg3);border:1px solid var(--border);color:var(--text);padding:6px 10px;border-radius:8px;font-family:var(--font);font-size:.83rem;outline:none;cursor:pointer;width:130px}

/* ── Upload Zone ── */
#upload-zone{position:fixed;inset:0;z-index:800;background:#000a;display:none;align-items:center;justify-content:center;flex-direction:column;gap:16px;backdrop-filter:blur(4px)}
#upload-zone.active{display:flex}
.uz-box{background:var(--surface);border:2px dashed var(--accent);border-radius:24px;padding:60px;text-align:center;color:var(--text2)}
.uz-icon{font-size:3rem;margin-bottom:12px}
.uz-text{font-size:1rem;font-weight:500}
.uz-sub{font-size:.8rem;color:var(--text3);margin-top:4px}

/* ── Toast ── */
#toasts{position:fixed;bottom:20px;right:20px;display:flex;flex-direction:column;gap:8px;z-index:9999}
.toast{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 16px;font-size:.83rem;box-shadow:var(--shadow);display:flex;align-items:center;gap:8px;animation:toastIn .2s ease;max-width:300px}
.toast.success{border-color:var(--success);color:var(--success)}
.toast.error{border-color:var(--danger);color:var(--danger)}
.toast.info{border-color:var(--accent);color:var(--accent)}
@keyframes toastIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}

/* ── Progress ── */
#upload-progress{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:12px 20px;z-index:5000;display:none;min-width:280px;box-shadow:var(--shadow)}
#up-label{font-size:.83rem;color:var(--text2);margin-bottom:8px}
#up-bar{height:4px;background:var(--border);border-radius:4px;overflow:hidden}
#up-fill{height:100%;background:linear-gradient(90deg,var(--accent),var(--accent2));width:0%;transition:width .2s;border-radius:4px}

/* ── Scrollbar ── */
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}
::-webkit-scrollbar-thumb:hover{background:var(--text3)}

/* ── Category Colors ── */
.cat-image .file-icon-wrap{background:linear-gradient(135deg,#4f8ef722,#6ee7b711)}
.cat-video .file-icon-wrap{background:linear-gradient(135deg,#a855f722,#ec489922)}
.cat-audio .file-icon-wrap{background:linear-gradient(135deg,#f472b622,#fb923c22)}
.cat-pdf .file-icon-wrap{background:linear-gradient(135deg,#ef444422,#f97c1622)}
.cat-apk .file-icon-wrap{background:linear-gradient(135deg,#22c55e22,#4ade8022)}
.cat-zip .file-icon-wrap{background:linear-gradient(135deg,#f59e0b22,#fde04722)}
.cat-code .file-icon-wrap{background:linear-gradient(135deg,#06b6d422,#818cf822)}
.cat-folder .file-icon-wrap{background:linear-gradient(135deg,#4f8ef7,#6ee7b7)}
.cat-doc .file-icon-wrap{background:linear-gradient(135deg,#4f8ef722,#93c5fd22)}

/* ── Responsive ── */
@media(max-width:640px){
  :root{--sidebar:0px}
  #sidebar{position:fixed;left:0;top:0;height:100%;z-index:200;width:240px;transform:translateX(-100%);transition:.25s}
  #sidebar.mobile-open{transform:none;box-shadow:var(--shadow)}
  #sidebar.collapsed{transform:translateX(-100%)}
  #main-overlay{display:none;position:fixed;inset:0;background:#0008;z-index:190}
  #main-overlay.visible{display:block}
  #logo{font-size:.95rem}
  #topbar-actions .hide-mobile{display:none}
  #settings-panel{width:100vw}
}
</style>
</head>
<body data-theme="dark">

<!-- Topbar -->
<div id="topbar">
  <button class="tb-btn" id="sidebar-toggle" title="Toggle Sidebar">
    <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
  </button>
  <div id="logo" onclick="navigate('')">Pocket<span>Drive</span></div>
  <div id="search-wrap">
    <span id="search-icon"><svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg></span>
    <input id="search" type="text" placeholder="Search files…" autocomplete="off">
    <div id="search-results"></div>
  </div>
  <div id="topbar-actions">
    <label id="upload-btn" title="Upload files">
      <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
      Upload
      <input type="file" id="file-input" multiple hidden>
    </label>
    <button class="tb-btn hide-mobile" id="new-folder-btn" title="New Folder">
      <svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
    </button>
    <button class="tb-btn hide-mobile" id="settings-btn" title="Settings">
      <svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
    </button>
  </div>
</div>

<!-- Layout -->
<div id="layout">
  <!-- Sidebar -->
  <div id="sidebar">
    <div class="sidebar-section">
      <div class="sidebar-label">Navigate</div>
      <div class="nav-item active" onclick="navigate('')" data-view="home">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
        Home
      </div>
      <div class="nav-item" onclick="showRecent()">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        Recent
      </div>
    </div>
    <div class="sidebar-divider"></div>
    <div class="sidebar-section">
      <div class="sidebar-label">Filter by type</div>
      <div class="nav-item" onclick="filterType('image')">🖼️ &nbsp;Images</div>
      <div class="nav-item" onclick="filterType('video')">🎬 &nbsp;Videos</div>
      <div class="nav-item" onclick="filterType('audio')">🎵 &nbsp;Audio</div>
      <div class="nav-item" onclick="filterType('doc')">📄 &nbsp;Documents</div>
      <div class="nav-item" onclick="filterType('apk')">📦 &nbsp;APKs</div>
      <div class="nav-item" onclick="filterType('zip')">🗜️ &nbsp;Archives</div>
      <div class="nav-item" onclick="filterType('code')">💻 &nbsp;Code</div>
    </div>
    <div class="sidebar-divider"></div>
    <div class="storage-bar-wrap">
      <div class="storage-label">Storage</div>
      <div class="storage-bar"><div class="storage-fill" id="storage-fill" style="width:0%"></div></div>
      <div class="storage-nums"><span id="storage-used">—</span><span id="storage-total">—</span></div>
    </div>
  </div>

  <!-- Main Content -->
  <div id="main">
    <!-- Toolbar -->
    <div id="toolbar">
      <div id="breadcrumb"></div>
      <select id="sort-select">
        <option value="name">Name</option>
        <option value="date">Date</option>
        <option value="size">Size</option>
        <option value="type">Type</option>
      </select>
      <button class="tool-btn" id="sort-dir-btn" title="Toggle sort direction">↑ ASC</button>
      <div id="view-toggle">
        <button class="view-btn active" id="grid-btn" title="Grid view">
          <svg width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/><rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>
        </button>
        <button class="view-btn" id="list-btn" title="List view">
          <svg width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><rect x="1" y="2" width="14" height="2" rx="1"/><rect x="1" y="7" width="14" height="2" rx="1"/><rect x="1" y="12" width="14" height="2" rx="1"/></svg>
        </button>
      </div>
    </div>

    <!-- Files Area -->
    <div id="files-wrap">
      <div id="files-grid"></div>
    </div>

    <!-- Selection Bar -->
    <div id="sel-bar">
      <span id="sel-count">0 selected</span>
      <button class="tool-btn" onclick="downloadSelected()">⬇ Download</button>
      <button class="tool-btn danger" onclick="deleteSelected()">🗑 Delete</button>
      <button class="tool-btn" onclick="clearSelection()" style="margin-left:auto">✕ Clear</button>
    </div>
  </div>
</div>

<!-- Context Menu -->
<div id="ctx-menu">
  <div class="ctx-item" id="ctx-open">📂 Open</div>
  <div class="ctx-item" id="ctx-preview">👁 Preview</div>
  <div class="ctx-item" id="ctx-download">⬇ Download</div>
  <div class="ctx-divider"></div>
  <div class="ctx-item" id="ctx-rename">✏️ Rename</div>
  <div class="ctx-item" id="ctx-copy">📋 Copy path</div>
  <div class="ctx-item" id="ctx-info">ℹ️ Info</div>
  <div class="ctx-divider"></div>
  <div class="ctx-item danger" id="ctx-delete">🗑 Delete</div>
</div>

<!-- Settings Panel -->
<div id="settings-panel">
  <div class="settings-head">
    <span style="font-weight:600">Settings</span>
    <button class="modal-close" onclick="closeSettings()">
      <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  </div>
  <div class="settings-section">
    <div style="font-size:.8rem;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">Appearance</div>
    <div class="setting-row">
      <div><div class="setting-label">Dark Mode</div></div>
      <label class="toggle"><input type="checkbox" id="s-dark" onchange="applySetting('theme',this.checked?'dark':'light')"><span class="toggle-slider"></span></label>
    </div>
    <div class="setting-row">
      <div><div class="setting-label">Default View</div></div>
      <select class="settings-select" id="s-view" onchange="applySetting('view',this.value)">
        <option value="grid">Grid</option>
        <option value="list">List</option>
      </select>
    </div>
  </div>
  <div class="settings-section">
    <div style="font-size:.8rem;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">Files</div>
    <div class="setting-row">
      <div><div class="setting-label">Show Hidden Files</div><div class="setting-desc">Files starting with .</div></div>
      <label class="toggle"><input type="checkbox" id="s-hidden" onchange="applySetting('show_hidden',this.checked)"><span class="toggle-slider"></span></label>
    </div>
    <div class="setting-row">
      <div><div class="setting-label">Allow Delete</div><div class="setting-desc">Enable file deletion</div></div>
      <label class="toggle"><input type="checkbox" id="s-delete" onchange="applySetting('allow_delete',this.checked)"><span class="toggle-slider"></span></label>
    </div>
    <div class="setting-row">
      <div><div class="setting-label">Default Sort</div></div>
      <select class="settings-select" id="s-sort" onchange="applySetting('sort',this.value)">
        <option value="name">Name</option>
        <option value="date">Date</option>
        <option value="size">Size</option>
        <option value="type">Type</option>
      </select>
    </div>
  </div>
  <div class="settings-section">
    <div style="font-size:.8rem;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">Storage Info</div>
    <div id="stats-display" style="font-size:.83rem;color:var(--text2);line-height:1.8"></div>
  </div>
  <div class="settings-section">
    <div style="font-size:.8rem;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">About</div>
    <div style="font-size:.83rem;color:var(--text2);line-height:1.8">
      <b style="color:var(--accent);font-family:var(--mono)">PocketDrive</b><br>
      Mini file server for Termux<br>
      Built with Flask + Vanilla JS<br>
      <span style="color:var(--text3)">v1.0.0</span>
    </div>
  </div>
</div>

<!-- Upload Drop Zone -->
<div id="upload-zone">
  <div class="uz-box">
    <div class="uz-icon">📂</div>
    <div class="uz-text">Drop files to upload</div>
    <div class="uz-sub" id="uz-path">to Home</div>
  </div>
</div>

<!-- Upload Progress -->
<div id="upload-progress">
  <div id="up-label">Uploading…</div>
  <div id="up-bar"><div id="up-fill"></div></div>
</div>

<!-- Toasts -->
<div id="toasts"></div>

<!-- Mobile overlay -->
<div id="main-overlay" onclick="closeSidebar()"></div>

<!-- Modals -->
<div id="new-folder-modal" style="display:none" class="modal-overlay">
  <div class="modal">
    <div class="modal-head"><span class="modal-title">New Folder</span><button class="modal-close" onclick="closeModal('new-folder-modal')">✕</button></div>
    <div class="modal-body"><label class="lbl">Folder Name</label><input class="inp" id="folder-name-inp" placeholder="My Folder" autofocus onkeydown="if(event.key==='Enter')createFolder()"></div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal('new-folder-modal')">Cancel</button><button class="btn btn-primary" onclick="createFolder()">Create</button></div>
  </div>
</div>

<div id="rename-modal" style="display:none" class="modal-overlay">
  <div class="modal">
    <div class="modal-head"><span class="modal-title">Rename</span><button class="modal-close" onclick="closeModal('rename-modal')">✕</button></div>
    <div class="modal-body"><label class="lbl">New Name</label><input class="inp" id="rename-inp" autofocus onkeydown="if(event.key==='Enter')doRename()"></div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal('rename-modal')">Cancel</button><button class="btn btn-primary" onclick="doRename()">Rename</button></div>
  </div>
</div>

<div id="delete-modal" style="display:none" class="modal-overlay">
  <div class="modal">
    <div class="modal-head"><span class="modal-title">Confirm Delete</span><button class="modal-close" onclick="closeModal('delete-modal')">✕</button></div>
    <div class="modal-body"><p id="delete-msg" style="color:var(--text2);font-size:.9rem;line-height:1.6"></p></div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal('delete-modal')">Cancel</button><button class="btn btn-danger" onclick="doDelete()">Delete</button></div>
  </div>
</div>

<div id="info-modal" style="display:none" class="modal-overlay">
  <div class="modal">
    <div class="modal-head"><span class="modal-title">File Info</span><button class="modal-close" onclick="closeModal('info-modal')">✕</button></div>
    <div class="modal-body" id="info-body" style="font-size:.85rem;line-height:2;color:var(--text2)"></div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal('info-modal')">Close</button></div>
  </div>
</div>

<!-- Preview Modal -->
<div id="preview-modal" style="display:none" class="modal-overlay" onclick="handlePreviewBgClick(event)">
  <div class="modal" style="position:relative">
    <div class="modal-head">
      <div>
        <div class="modal-title" id="preview-filename">Preview</div>
        <div id="preview-info"></div>
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-ghost" id="preview-dl-btn" style="padding:6px 12px;font-size:.78rem">⬇ Download</button>
        <button class="modal-close" onclick="closePreview()">✕</button>
      </div>
    </div>
    <div class="modal-body" style="position:relative">
      <button class="preview-nav" id="preview-prev" onclick="previewNav(-1)">‹</button>
      <button class="preview-nav" id="preview-next" onclick="previewNav(1)">›</button>
      <img id="preview-img" alt="preview">
      <video id="preview-video" controls playsinline></video>
      <audio id="preview-audio" controls></audio>
      <iframe id="preview-iframe" sandbox="allow-same-origin allow-scripts"></iframe>
      <pre id="preview-code"></pre>
      <div id="preview-nopreview">
        <div style="font-size:3rem;margin-bottom:12px">📄</div>
        <div style="font-size:.9rem">No preview available</div>
        <div style="font-size:.8rem;color:var(--text3);margin-top:4px">Download to open this file</div>
      </div>
    </div>
  </div>
</div>

<script>
// ─── State ───────────────────────────────────────────────────────────────────
let currentPath = '';
let currentItems = [];
let selectedItems = new Set();
let ctxTarget = null;
let renameTarget = null;
let deleteTargets = [];
let viewMode = 'grid';
let sortBy = 'name';
let sortDir = 'asc';
let showHidden = false;
let config = {};
let previewItems = [];
let previewIndex = 0;
let filterMode = null;
let searchTimeout = null;

// ─── Init ────────────────────────────────────────────────────────────────────
async function init() {
  await loadConfig();
  navigate('');
  loadStats();
  setupDrop();
  setupSearch();
  setupKeyboard();
}

async function loadConfig() {
  const r = await fetch('/api/settings'); config = await r.json();
  viewMode  = config.view || 'grid';
  sortBy    = config.sort || 'name';
  sortDir   = config.sort_dir || 'asc';
  showHidden = config.show_hidden || false;
  document.body.setAttribute('data-theme', config.theme || 'dark');
  applyViewMode();
  document.getElementById('sort-select').value = sortBy;
  document.getElementById('sort-dir-btn').textContent = sortDir === 'asc' ? '↑ ASC' : '↓ DESC';
  // Settings panel
  document.getElementById('s-dark').checked = (config.theme !== 'light');
  document.getElementById('s-view').value = viewMode;
  document.getElementById('s-hidden').checked = showHidden;
  document.getElementById('s-delete').checked = config.allow_delete !== false;
  document.getElementById('s-sort').value = sortBy;
}

// ─── Navigation ──────────────────────────────────────────────────────────────
async function navigate(path) {
  filterMode = null;
  currentPath = path;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.querySelector('[data-view="home"]')?.classList.add('active');
  await loadFiles(path);
}

async function loadFiles(path) {
  const url = `/api/files?path=${encodeURIComponent(path)}&sort=${sortBy}&sort_dir=${sortDir}&show_hidden=${showHidden}`;
  const r = await fetch(url); const data = await r.json();
  currentItems = data.items || [];
  renderBreadcrumb(data.breadcrumbs || []);
  renderFiles(currentItems);
  clearSelection();
}

function renderBreadcrumb(crumbs) {
  const bc = document.getElementById('breadcrumb');
  bc.innerHTML = crumbs.map((c,i) => {
    const active = i === crumbs.length - 1;
    return `<span class="bc-item${active?' active':''}" onclick="${active?'':`navigate('${c.path}')`}">${c.name}</span>${active?'':'<span class="bc-sep">›</span>'}`;
  }).join('');
}

function renderFiles(items) {
  const grid = document.getElementById('files-grid');
  if (!items.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">📂</div><p>This folder is empty</p><p style="font-size:.78rem">Upload files or create a folder</p></div>`;
    return;
  }
  grid.innerHTML = items.map((f,i) => buildCard(f, i)).join('');
}

const ICONS = {
  image:'🖼️', video:'🎬', audio:'🎵', pdf:'📕', apk:'📦',
  zip:'🗜️', code:'💻', doc:'📝', sheet:'📊', slide:'📊',
  font:'🔤', folder:'📁', other:'📄'
};

function buildCard(f, i) {
  const icon = ICONS[f.category] || '📄';
  const thumb = f.has_thumb
    ? `<img class="file-thumb" src="/api/thumbnail?path=${encodeURIComponent(f.path)}" loading="lazy" onerror="thi&&  s.parentNode.innerHTML='<div class=\\"file-icon-wrap\\">${icon}</div>`
    : `<div class="file-icon-wrap">${icon}</div>`;
  return `
  <div class="file-card cat-${f.category}" 
       data-path="${f.path}" data-index="${i}" data-is-dir="${f.is_dir}"
       onclick="cardClick(event, ${i})"
       ondblclick="cardDblClick(${i})"
       oncontextmenu="showCtx(event, ${i})">
    <div class="sel-check">✓</div>
    ${thumb}
    <div class="file-info">
      <div class="file-name" title="${f.name}">${f.name}</div>
      <div class="file-meta">${f.size_str} · ${f.mtime_str}</div>
    </div>
    <div class="card-menu">
      <button class="card-menu-btn" onclick="event.stopPropagation();showCtx(event,${i})" title="More options">
        <svg width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><circle cx="8" cy="3" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="8" cy="13" r="1.5"/></svg>
      </button>
    </div>
  </div>`;
}



// ─── Card Interactions ────────────────────────────────────────────────────────
function cardClick(e, i) {
  if (e.ctrlKey || e.metaKey || e.shiftKey) {
    toggleSelect(i); return;
  }
  if (selectedItems.size > 0) { toggleSelect(i); return; }
}

function cardDblClick(i) {
  const f = currentItems[i];
  if (f.is_dir) navigate(f.path);
  else openPreview(i);
}

function toggleSelect(i) {
  const f = currentItems[i];
  if (selectedItems.has(f.path)) selectedItems.delete(f.path);
  else selectedItems.add(f.path);
  updateSelection();
}

function clearSelection() {
  selectedItems.clear(); updateSelection();
}

function updateSelection() {
  document.querySelectorAll('.file-card').forEach(card => {
    card.classList.toggle('selected', selectedItems.has(card.dataset.path));
  });
  const bar = document.getElementById('sel-bar');
  const cnt = selectedItems.size;
  bar.classList.toggle('visible', cnt > 0);
  document.getElementById('sel-count').textContent = `${cnt} selected`;
}

// ─── Context Menu ─────────────────────────────────────────────────────────────
function showCtx(e, i) {
  e.preventDefault(); e.stopPropagation();
  ctxTarget = currentItems[i];
  const isDir = ctxTarget.is_dir;
  const menu = document.getElementById('ctx-menu');
  document.getElementById('ctx-open').style.display = isDir ? '' : 'none';
  document.getElementById('ctx-preview').style.display = isDir ? 'none' : '';
  menu.style.display = 'block';
  menu.classList.add('open');
  const mx = Math.min(e.clientX, window.innerWidth - 200);
  const my = Math.min(e.clientY, window.innerHeight - 250);
  menu.style.left = mx + 'px'; menu.style.top = my + 'px';
}

document.addEventListener('click', () => { document.getElementById('ctx-menu').classList.remove('open');
document.getElementById('ctx-menu').style.dislpay='none';});
document.getElementById('ctx-open').onclick = () => { if (ctxTarget?.is_dir) navigate(ctxTarget.path); };
document.getElementById('ctx-preview').onclick = () => { const i = currentItems.findIndex(f=>f.path===ctxTarget?.path); if(i>=0) openPreview(i); };
document.getElementById('ctx-download').onclick = () => { if(ctxTarget) window.open(`/api/download?path=${encodeURIComponent(ctxTarget.path)}`); };
document.getElementById('ctx-rename').onclick = () => { if(ctxTarget) startRename(ctxTarget); };
document.getElementById('ctx-copy').onclick = () => { if(ctxTarget){ navigator.clipboard?.writeText(ctxTarget.path); toast('Path copied','info'); } };
document.getElementById('ctx-info').onclick = () => { if(ctxTarget) showInfo(ctxTarget); };
document.getElementById('ctx-delete').onclick = () => { if(ctxTarget) confirmDelete([ctxTarget]); };

// ─── Sort / View ──────────────────────────────────────────────────────────────
document.getElementById('sort-select').onchange = function() {
  sortBy = this.value; reloadCurrentFiles();
};
document.getElementById('sort-dir-btn').onclick = function() {
  sortDir = sortDir === 'asc' ? 'desc' : 'asc';
  this.textContent = sortDir === 'asc' ? '↑ ASC' : '↓ DESC';
  reloadCurrentFiles();
};
document.getElementById('grid-btn').onclick = () => { viewMode='grid'; applyViewMode(); };
document.getElementById('list-btn').onclick = () => { viewMode='list'; applyViewMode(); };

function applyViewMode() {
  const grid = document.getElementById('files-grid');
  grid.classList.toggle('list-view', viewMode === 'list');
  document.getElementById('grid-btn').classList.toggle('active', viewMode === 'grid');
  document.getElementById('list-btn').classList.toggle('active', viewMode === 'list');
}

async function reloadCurrentFiles() {
  if (filterMode) { applyFilterDisplay(); return; }
  await loadFiles(currentPath);
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
document.getElementById('sidebar-toggle').onclick = () => {
  const s = document.getElementById('sidebar');
  const ov = document.getElementById('main-overlay');
  if (window.innerWidth <= 640) {
    s.classList.toggle('mobile-open');
    ov.classList.toggle('visible', s.classList.contains('mobile-open'));
  } else {
    s.classList.toggle('collapsed');
  }
};
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('mobile-open');
  document.getElementById('main-overlay').classList.remove('visible');
}

async function filterType(type) {
  filterMode = type;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  // Load all files recursively via search trick
  const r = await fetch(`/api/search?q=&path=`);
  // Actually we need to show filtered from recursive listing - use a workaround
  currentItems = await getAllFiles(type);
  renderBreadcrumb([{name:'Home',path:''},{name:type.charAt(0).toUpperCase()+type.slice(1),path:''}]);
  renderFiles(currentItems);
  clearSelection();
}

async function getAllFiles(type) {
  const r = await fetch(`/api/search?q=.&path=`);
  const data = await r.json();
  return (data.items || []).filter(f => !f.is_dir && f.category === type);
}

async function showRecent() {
  filterMode = 'recent';
  const r = await fetch('/api/search?q=.&path=');
  const data = await r.json();
  currentItems = (data.items || []).filter(f=>!f.is_dir).sort((a,b)=>b.mtime-a.mtime).slice(0,50);
  renderBreadcrumb([{name:'Home',path:''},{name:'Recent',path:''}]);
  renderFiles(currentItems);
  clearSelection();
}

// ─── Upload ───────────────────────────────────────────────────────────────────
document.getElementById('file-input').onchange = async function() {
  if (this.files.length) await uploadFiles(this.files);
  this.value = '';
};

async function uploadFiles(files) {
  const fd = new FormData();
  fd.append('path', currentPath);
  [...files].forEach(f => fd.append('files', f));
  const prog = document.getElementById('upload-progress');
  const fill = document.getElementById('up-fill');
  const label = document.getElementById('up-label');
  prog.style.display = 'block';
  label.textContent = `Uploading ${files.length} file(s)…`;
  const xhr = new XMLHttpRequest();
  xhr.upload.onprogress = e => {
    if (e.lengthComputable) fill.style.width = (e.loaded/e.total*100) + '%';
  };
  xhr.onload = () => {
    prog.style.display = 'none'; fill.style.width = '0%';
    toast(`Uploaded ${files.length} file(s)`, 'success');
    loadFiles(currentPath); loadStats();
  };
  xhr.onerror = () => { prog.style.display = 'none'; toast('Upload failed', 'error'); };
  xhr.open('POST', '/api/upload'); xhr.send(fd);
}

function setupDrop() {
  const wrap = document.getElementById('files-wrap');
  const zone = document.getElementById('upload-zone');
  let dragCount = 0;
  document.body.addEventListener('dragenter', e => {
    if (e.dataTransfer?.types.includes('Files')) {
      dragCount++; zone.classList.add('active');
      document.getElementById('uz-path').textContent = 'to ' + (currentPath || 'Home');
    }
  });
  document.body.addEventListener('dragleave', e => {
    dragCount--;
    if (dragCount <= 0) { dragCount = 0; zone.classList.remove('active'); }
  });
  document.body.addEventListener('dragover', e => e.preventDefault());
  document.body.addEventListener('drop', e => {
    e.preventDefault(); dragCount = 0; zone.classList.remove('active');
    if (e.dataTransfer?.files.length) uploadFiles(e.dataTransfer.files);
  });
}

// ─── New Folder ───────────────────────────────────────────────────────────────
document.getElementById('new-folder-btn').onclick = () => {
  document.getElementById('folder-name-inp').value = '';
  showModal('new-folder-modal');
  setTimeout(() => document.getElementById('folder-name-inp').focus(), 100);
};

async function createFolder() {
  const name = document.getElementById('folder-name-inp').value.trim();
  if (!name) return;
  const r = await fetch('/api/mkdir', {method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({path: currentPath, name})});
  if (r.ok) { toast('Folder created', 'success'); closeModal('new-folder-modal'); loadFiles(currentPath); }
  else toast('Error creating folder', 'error');
}

// ─── Rename ───────────────────────────────────────────────────────────────────
function startRename(f) {
  renameTarget = f;
  document.getElementById('rename-inp').value = f.name;
  showModal('rename-modal');
  setTimeout(() => { const inp = document.getElementById('rename-inp'); inp.focus(); inp.select(); }, 100);
}

async function doRename() {
  const newName = document.getElementById('rename-inp').value.trim();
  if (!newName || !renameTarget) return;
  const r = await fetch('/api/rename', {method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({path: renameTarget.path, new_name: newName})});
  if (r.ok) { toast('Renamed', 'success'); closeModal('rename-modal'); loadFiles(currentPath); }
  else toast('Error renaming', 'error');
}

// ─── Delete ───────────────────────────────────────────────────────────────────
function confirmDelete(files) {
  deleteTargets = files;
  const names = files.map(f=>f.name).join(', ');
  document.getElementById('delete-msg').textContent = `Delete "${names}"? This cannot be undone.`;
  showModal('delete-modal');
}

async function doDelete() {
  for (const f of deleteTargets) {
    await fetch('/api/delete', {method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({path: f.path})});
  }
  toast(`Deleted ${deleteTargets.length} item(s)`, 'success');
  closeModal('delete-modal');
  loadFiles(currentPath); loadStats();
}

async function deleteSelected() {
  const files = currentItems.filter(f => selectedItems.has(f.path));
  if (!files.length) return;
  confirmDelete(files);
}

async function downloadSelected() {
  for (const path of selectedItems) window.open(`/api/download?path=${encodeURIComponent(path)}`);
}

// ─── Preview ──────────────────────────────────────────────────────────────────
const CODE_EXTS = new Set(['py','js','ts','html','css','json','xml','yaml','yml','sh','c','cpp','java','kt','go','rs','php','rb','swift','txt','md','csv','log','conf','ini']);

function openPreview(i) {
  previewItems = currentItems.filter(f => !f.is_dir);
  previewIndex = previewItems.findIndex((f,idx) => f === currentItems[i]);
  if (previewIndex < 0) previewIndex = 0;
  showPreview();
}

function showPreview() {
  const f = previewItems[previewIndex];
  if (!f) return;
  document.getElementById('preview-modal').style.display = 'flex';
  document.getElementById('preview-filename').textContent = f.name;
  document.getElementById('preview-info').textContent = `${f.size_str} · ${f.mtime_str}`;
  document.getElementById('preview-dl-btn').onclick = () => window.open(`/api/download?path=${encodeURIComponent(f.path)}`);
  document.getElementById('preview-prev').style.display = previewIndex > 0 ? '' : 'none';
  document.getElementById('preview-next').style.display = previewIndex < previewItems.length-1 ? '' : 'none';

  // Hide all
  ['preview-img','preview-video','preview-audio','preview-iframe','preview-code','preview-nopreview'].forEach(id => {
    const el = document.getElementById(id);
    el.style.display = 'none';
    if (el.tagName === 'VIDEO' || el.tagName === 'AUDIO') { el.pause(); el.src = ''; }
  });

  const url = `/api/preview?path=${encodeURIComponent(f.path)}`;
  const cat = f.category;
  const ext = f.ext.toLowerCase();

  if (cat === 'image') {
    const img = document.getElementById('preview-img');
    img.src = url; img.style.display = 'block';
  } else if (cat === 'video') {
    const v = document.getElementById('preview-video');
    v.src = url; v.style.display = 'block'; v.play().catch(()=>{});
  } else if (cat === 'audio') {
    const a = document.getElementById('preview-audio');
    a.src = url; a.style.display = 'block';
  } else if (cat === 'pdf') {
    const fr = document.getElementById('preview-iframe');
    fr.src = url; fr.style.display = 'block';
  } else if (CODE_EXTS.has(ext)) {
    fetch(url).then(r=>r.text()).then(t => {
      const pre = document.getElementById('preview-code');
      pre.textContent = t.slice(0, 50000);
      pre.style.display = 'block';
    });
  } else {
    document.getElementById('preview-nopreview').style.display = 'block';
  }
}

function previewNav(dir) {
  previewIndex = Math.max(0, Math.min(previewItems.length-1, previewIndex + dir));
  showPreview();
}

function closePreview() {
  document.getElementById('preview-modal').style.display = 'none';
  const v = document.getElementById('preview-video');
  v.pause(); v.src = '';
  const a = document.getElementById('preview-audio');
  a.pause(); a.src = '';
}

function handlePreviewBgClick(e) {
  if (e.target === document.getElementById('preview-modal')) closePreview();
}

// ─── Info ─────────────────────────────────────────────────────────────────────
function showInfo(f) {
  const body = document.getElementById('info-body');
  body.innerHTML = `
    <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 16px">
      <span style="color:var(--text3)">Name</span><span>${f.name}</span>
      <span style="color:var(--text3)">Type</span><span>${f.category} ${f.ext ? `(.${f.ext})` : ''}</span>
      <span style="color:var(--text3)">Size</span><span>${f.size_str}</span>
      <span style="color:var(--text3)">Modified</span><span>${f.mtime_str}</span>
      <span style="color:var(--text3)">Path</span><span style="font-family:var(--mono);font-size:.75rem;word-break:break-all">${f.path}</span>
    </div>`;
  showModal('info-modal');
}

// ─── Search ───────────────────────────────────────────────────────────────────
function setupSearch() {
  const inp = document.getElementById('search');
  const results = document.getElementById('search-results');
  inp.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const q = inp.value.trim();
    if (!q) { results.classList.remove('open'); return; }
    searchTimeout = setTimeout(async () => {
      const r = await fetch(`/api/search?q=${encodeURIComponent(q)}&path=`);
      const data = await r.json();
      const items = data.items || [];
      if (!items.length) { results.innerHTML = '<div class="sr-item" style="color:var(--text3)">No results</div>'; }
      else {
        results.innerHTML = items.slice(0,12).map(f => `
          <div class="sr-item" onclick="searchOpen('${f.path}','${f.is_dir}')">
            <span>${ICONS[f.category]||'📄'}</span>
            <span>${f.name}</span>
            <span class="sr-path">${f.path.includes('/')?f.path.split('/').slice(0,-1).join('/'):'Home'}</span>
          </div>`).join('');
      }
      results.classList.add('open');
    }, 300);
  });
  document.addEventListener('click', e => {
    if (!inp.contains(e.target) && !results.contains(e.target)) results.classList.remove('open');
  });
}

function searchOpen(path, isDir) {
  document.getElementById('search-results').classList.remove('open');
  document.getElementById('search').value = '';
  if (isDir === 'true') navigate(path);
  else {
    const parentPath = path.includes('/') ? path.split('/').slice(0,-1).join('/') : '';
    navigate(parentPath).then(() => {
      const i = currentItems.findIndex(f => f.path === path);
      if (i >= 0) openPreview(i);
    });
  }
}

// ─── Settings ─────────────────────────────────────────────────────────────────
document.getElementById('settings-btn').onclick = () => document.getElementById('settings-panel').classList.add('open');
function closeSettings() { document.getElementById('settings-panel').classList.remove('open'); }

async function applySetting(key, val) {
  config[key] = val;
  if (key === 'theme') document.body.setAttribute('data-theme', val);
  if (key === 'view') { viewMode = val; applyViewMode(); }
  if (key === 'sort') { sortBy = val; }
  if (key === 'show_hidden') { showHidden = val; }
  await fetch('/api/settings', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(config)});
  if (['show_hidden','sort'].includes(key)) reloadCurrentFiles();
}

// ─── Stats ────────────────────────────────────────────────────────────────────
async function loadStats() {
  const r = await fetch('/api/stats'); const d = await r.json();
  const pct = d.disk_total ? Math.round(d.disk_used / d.disk_total * 100) : 0;
  document.getElementById('storage-fill').style.width = pct + '%';
  document.getElementById('storage-used').textContent = d.disk_used_str;
  document.getElementById('storage-total').textContent = d.disk_total_str;
  document.getElementById('stats-display').innerHTML = `
    Files: <b>${d.files}</b><br>
    Folders: <b>${d.folders}</b><br>
    Drive used: <b>${d.size_str}</b><br>
    Disk used: <b>${d.disk_used_str}</b> / ${d.disk_total_str} (${pct}%)<br>
    Free: <b>${d.disk_free_str}</b>`;
}

// ─── Keyboard ─────────────────────────────────────────────────────────────────
function setupKeyboard() {
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'Escape') { closePreview(); clearSelection(); }
    if (e.key === 'ArrowLeft' && document.getElementById('preview-modal').style.display === 'flex') previewNav(-1);
    if (e.key === 'ArrowRight' && document.getElementById('preview-modal').style.display === 'flex') previewNav(1);
    if (e.key === 'Delete' && selectedItems.size) deleteSelected();
    if (e.key === 'a' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); currentItems.forEach((_,i)=>selectedItems.add(currentItems[i].path)); updateSelection(); }
  });
}

// ─── Modals ───────────────────────────────────────────────────────────────────
function showModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }
document.querySelectorAll('.modal-overlay').forEach(m => m.addEventListener('click', e => { if(e.target===m) m.style.display='none'; }));

// ─── Toast ────────────────────────────────────────────────────────────────────
function toast(msg, type='info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = {'success':'✓ ','error':'✕ ','info':'ℹ '}[type] + msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ─── applyFilterDisplay ───────────────────────────────────────────────────────
function applyFilterDisplay() {
  renderFiles(currentItems);
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
init();
</script>
</body>
</html>"""

@app.route("/")
def index():
    return HTML

if __name__ == "__main__":
    cfg  = load_config()
    port = int(os.environ.get("PORT", cfg.get("port", 8080)))
    host = os.environ.get("HOST", "0.0.0.0")

    print(f"""
╔══════════════════════════════════════════╗
║         PocketDrive is running!          ║
╠══════════════════════════════════════════╣
║  Open:  http://localhost:{port:<5}          ║
║  Files: {str(BASE_DIR):<34}║
║  Stop:  Ctrl+C                           ║
╚══════════════════════════════════════════╝
    """)

    app.run(host=host, port=port, debug=False, threaded=True)
