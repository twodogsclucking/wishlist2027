# -*- coding: utf-8 -*-
"""Local preview server — what preview.bat runs.

Serves the site like a normal web server, plus a few LOCAL-ONLY endpoints that let the
"Photos" panel on item pages save pictures into the project:

    assets/img/items/<item-id>/<timestamp>.jpg   + an entry in data/items.json  "images": [...]

None of this exists on the live site (Hostinger only serves the files), so bosses never see it.
Standard library only; Pillow is used if installed, to read formats the browser can't (TIFF, HEIC*).
    *HEIC needs:  pip install pillow-heif

    python scripts/preview_server.py [--port 8000] [--root PATH] [--no-browser]
"""
import argparse, collections, http.server, io, json, os, re, socketserver, sys, time, urllib.parse, urllib.request, webbrowser

ap = argparse.ArgumentParser()
ap.add_argument("--port", type=int, default=8000)
ap.add_argument("--root", default=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ap.add_argument("--no-browser", action="store_true")
ARGS = ap.parse_args()
ROOT = os.path.abspath(ARGS.root)
ITEMS = os.path.join(ROOT, "data", "items.json")
MAX_BYTES = 40 * 1024 * 1024
ID = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")

try:
    from PIL import Image, ImageOps
    try:
        import pillow_heif; pillow_heif.register_heif_opener()
    except Exception:
        pass
    PILLOW = True
except Exception:
    PILLOW = False


def load_items():
    with open(ITEMS, encoding="utf8") as f:
        return json.load(f, object_pairs_hook=collections.OrderedDict)

def save_items(doc):
    tmp = ITEMS + ".tmp"
    with open(tmp, "w", encoding="utf8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=2); f.write("\n")
    os.replace(tmp, ITEMS)

def find(doc, iid):
    return next((it for it in doc["items"] if it["id"] == iid), None)

def images_of(it):
    """the item's photo list, upgrading the old single "image" field if present"""
    if "images" not in it:
        new = collections.OrderedDict()
        for k, v in it.items():
            if k == "image": continue
            new[k] = v
            if k == "summary": new["images"] = [{"src": it["image"]}] if it.get("image") else []
        if "images" not in new: new["images"] = []
        it.clear(); it.update(new)
    return it["images"]

def valid_option(it, key):
    """'<component-id>/<option-id>' that exists in this item"""
    if not isinstance(key, str) or key.count("/") != 1: return False
    cid, oid = key.split("/")
    c = next((c for c in it["components"] if c["id"] == cid), None)
    return bool(c and any(o["id"] == oid for o in c["options"]))

def pillow_to_jpeg(raw):
    if not PILLOW: raise ValueError("no-pillow")
    im = Image.open(io.BytesIO(raw))
    im = ImageOps.exif_transpose(im)
    if im.mode not in ("RGB", "L"):
        bg = Image.new("RGB", im.size, "white")
        im = im.convert("RGBA"); bg.paste(im, mask=im.split()[-1]); im = bg
    im = im.convert("RGB")
    im.thumbnail((1600, 1600), Image.LANCZOS)
    out = io.BytesIO(); im.save(out, "JPEG", quality=86, optimize=True, progressive=True)
    return out.getvalue()


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw): super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, fmt, *args):
        if "/__photo" in self.path or (len(args) > 1 and str(args[1]).startswith(("4", "5"))):
            sys.stderr.write("  %s\n" % (fmt % args))

    def end_headers(self):
        if self.path.split("?")[0].endswith((".json", ".js", ".css", ".html", "/")):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    # ---------- helpers
    def reply(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers(); self.wfile.write(body)

    def allowed(self):
        """Only the site itself, opened from this computer, may use the photo endpoints.
        The custom header can't be sent cross-site without a CORS pre-flight we never answer."""
        if self.client_address[0] not in ("127.0.0.1", "::1"): return False
        if self.headers.get("X-NinePines") != "1": return False
        origin = self.headers.get("Origin")
        if origin and urllib.parse.urlparse(origin).hostname not in ("localhost", "127.0.0.1"): return False
        return True

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BYTES: raise ValueError("too-big")
        return self.rfile.read(n)

    # ---------- endpoints
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if not u.path.startswith("/__photo/"): return super().do_GET()
        if not self.allowed(): return self.reply(403, {"error": "forbidden"})
        q = urllib.parse.parse_qs(u.query)
        if u.path == "/__photo/ping":
            return self.reply(200, {"ok": True, "pillow": PILLOW})
        if u.path == "/__photo/fetch":                       # download a picture from a link, hand the bytes to the page
            url = (q.get("url") or [""])[0]
            if not re.match(r"^https?://", url, re.I): return self.reply(400, {"error": "bad-url"})
            try:
                req = urllib.request.Request(url, headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
                    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                    "Referer": f"{urllib.parse.urlparse(url).scheme}://{urllib.parse.urlparse(url).netloc}/"})
                with urllib.request.urlopen(req, timeout=20) as r:
                    data = r.read(MAX_BYTES + 1); ctype = r.headers.get("Content-Type", "")
            except Exception as e:
                return self.reply(502, {"error": "download-failed", "detail": str(e)[:200]})
            if len(data) > MAX_BYTES: return self.reply(413, {"error": "too-big"})
            if "html" in ctype.lower() or data[:200].lstrip().lower().startswith((b"<!doctype html", b"<html")):
                return self.reply(415, {"error": "is-webpage"})
            self.send_response(200)
            self.send_header("Content-Type", ctype or "application/octet-stream")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers(); self.wfile.write(data); return
        return self.reply(404, {"error": "unknown"})

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        if not u.path.startswith("/__photo/"): return self.reply(404, {"error": "unknown"})
        if not self.allowed(): return self.reply(403, {"error": "forbidden"})
        q = urllib.parse.parse_qs(u.query)
        iid = (q.get("item") or [""])[0]
        if not ID.match(iid): return self.reply(400, {"error": "bad-item"})
        try:
            doc = load_items(); it = find(doc, iid)
            if not it: return self.reply(404, {"error": "no-item"})
            imgs = images_of(it)

            if u.path == "/__photo/add":
                raw = self.body()
                if self.headers.get("X-Kind") == "jpeg":
                    if raw[:3] != b"\xff\xd8\xff": return self.reply(415, {"error": "not-image"})
                    jpg = raw
                else:                                           # the browser couldn't read it: try Pillow
                    try: jpg = pillow_to_jpeg(raw)
                    except ValueError: return self.reply(415, {"error": "unreadable", "pillow": PILLOW})
                    except Exception: return self.reply(415, {"error": "unreadable", "pillow": PILLOW})
                folder = os.path.join(ROOT, "assets", "img", "items", iid)
                os.makedirs(folder, exist_ok=True)
                name = time.strftime("%Y%m%d-%H%M%S") + "-%03d.jpg" % (int(time.time() * 1000) % 1000)
                with open(os.path.join(folder, name), "wb") as f: f.write(jpg)
                entry = collections.OrderedDict([("src", f"assets/img/items/{iid}/{name}")])
                src = (q.get("source") or [""])[0]
                if re.match(r"^https?://", src, re.I): entry["source"] = src[:500]
                opt = (q.get("option") or [""])[0]
                if valid_option(it, opt): entry["option"] = opt
                imgs.append(entry)

            elif u.path in ("/__photo/delete", "/__photo/cover", "/__photo/tag"):
                req = json.loads(self.body() or b"{}")
                src = req.get("src", "")
                hit = next((x for x in imgs if x.get("src") == src), None)
                if not hit: return self.reply(404, {"error": "no-photo"})
                if u.path == "/__photo/tag":                    # which option the photo shows ("" = the whole item)
                    hit.pop("option", None)
                    if valid_option(it, req.get("option") or ""): hit["option"] = req["option"]
                    save_items(doc); return self.reply(200, {"ok": True, "images": imgs})
                imgs.remove(hit)
                if u.path == "/__photo/cover": imgs.insert(0, hit)
                else:
                    path = os.path.normpath(os.path.join(ROOT, src))
                    base = os.path.normpath(os.path.join(ROOT, "assets", "img", "items"))
                    if path.startswith(base + os.sep) and os.path.isfile(path): os.remove(path)
            else:
                return self.reply(404, {"error": "unknown"})

            save_items(doc)
            return self.reply(200, {"ok": True, "images": imgs})
        except ValueError as e:
            return self.reply(413 if str(e) == "too-big" else 400, {"error": str(e)})


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True

if __name__ == "__main__":
    port = ARGS.port
    for p in range(port, port + 10):
        try: srv = Server(("127.0.0.1", p), Handler); port = p; break
        except OSError: continue
    else:
        sys.exit(f"No free port between {ARGS.port} and {ARGS.port + 9}.")
    url = f"http://localhost:{port}"
    print(f"\n  Nine Pines wishlist - local preview\n  {url}   (close this window to stop)")
    print(f"  Photo upload: on   |   Pillow: {'yes' if PILLOW else 'no (JPG/PNG/WebP still work)'}\n")
    if not ARGS.no_browser: webbrowser.open(url)
    try: srv.serve_forever()
    except KeyboardInterrupt: pass
