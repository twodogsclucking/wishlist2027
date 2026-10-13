# -*- coding: utf-8 -*-
"""Validate the site's data before it goes live.

    python scripts/validate.py

Runs on every push via GitHub Actions and as a git pre-commit hook.
Standard library only, so it runs anywhere Python 3 does.
Exits 1 and lists every problem if anything is wrong.
"""
import ast, json, math, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ERR = []
def err(where, msg): ERR.append(f"  {where}: {msg}")

def load(rel):
    path = os.path.join(ROOT, rel)
    try:
        with open(path, encoding="utf8") as f: return json.load(f)
    except FileNotFoundError: err(rel, "file is missing"); return None
    except json.JSONDecodeError as e: err(rel, f"is not valid JSON (line {e.lineno}, col {e.colno}: {e.msg})"); return None

ID = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
LANGS = ("mn", "en")
PAR = re.compile(r"^[a-z][a-z0-9]*$")
FUNCS = {"ceil": math.ceil, "floor": math.floor, "round": round, "max": max, "min": min}

def formula(expr, names):
    """Evaluate a quantity formula like "length * width" safely. Returns (value, error)."""
    try: tree = ast.parse(str(expr), mode="eval")
    except SyntaxError: return None, "is not a valid formula"
    def ev(n):
        if isinstance(n, ast.Expression): return ev(n.body)
        if isinstance(n, ast.Constant) and isinstance(n.value, (int, float)) and not isinstance(n.value, bool): return n.value
        if isinstance(n, ast.Name):
            if n.id not in names: raise ValueError(f"uses '{n.id}', which is not one of this item's params {sorted(names)}")
            return names[n.id]
        if isinstance(n, ast.UnaryOp) and isinstance(n.op, ast.USub): return -ev(n.operand)
        if isinstance(n, ast.BinOp) and isinstance(n.op, (ast.Add, ast.Sub, ast.Mult, ast.Div)):
            a, b = ev(n.left), ev(n.right)
            return {ast.Add: a + b, ast.Sub: a - b, ast.Mult: a * b}.get(type(n.op)) if not isinstance(n.op, ast.Div) else a / b
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id in FUNCS and not n.keywords:
            return FUNCS[n.func.id](*[ev(a) for a in n.args])
        raise ValueError("may only use numbers, the item's params, + - * / ( ) and ceil/floor/round/max/min")
    try: return ev(tree), None
    except ZeroDivisionError: return None, "divides by zero"
    except ValueError as e: return None, str(e)

def text(where, v, required=True):
    if v is None:
        if required: err(where, "is missing")
        return
    if not isinstance(v, dict): err(where, 'must be {"mn": "...", "en": "..."}'); return
    for lang in LANGS:
        if not isinstance(v.get(lang), str) or not v[lang].strip():
            err(where, f'needs a non-empty "{lang}" translation')
    extra = set(v) - set(LANGS)
    if extra: err(where, f"has unknown language keys {sorted(extra)}")

def num(where, v, minimum=0, integer=False):
    if isinstance(v, bool) or not isinstance(v, (int, float)): err(where, f"must be a number (got {v!r})"); return
    if v < minimum: err(where, f"must be >= {minimum} (got {v})")
    if integer and v != int(v): err(where, f"must be a whole number (got {v})")

settings = load("data/settings.json")
items_doc = load("data/items.json")
mn, en = load("i18n/mn.json"), load("i18n/en.json")

# ---------------------------------------------------------------- settings
scen_ids, cat_ids, src_ids = set(), set(), set()
if settings:
    num("settings.fx", settings.get("fx"), minimum=1)
    num("settings.guestNights", settings.get("guestNights"), minimum=1)
    for k in ("customsDuty", "vat", "remotePremium"):
        num(f"settings.{k}", settings.get(k), minimum=0)
        if isinstance(settings.get(k), (int, float)) and settings[k] > 1:
            err(f"settings.{k}", f"is a fraction — use 0.05 for 5% (got {settings[k]})")
    for s in settings.get("scenarios", []):
        scen_ids.add(s.get("id")); text(f"settings.scenarios[{s.get('id')}].name", s.get("name"))
    if settings.get("defaultScenario") not in scen_ids:
        err("settings.defaultScenario", f"'{settings.get('defaultScenario')}' is not one of {sorted(scen_ids)}")
    for c in settings.get("categories", []):
        cat_ids.add(c.get("id")); text(f"settings.categories[{c.get('id')}].name", c.get("name"))
    for s in settings.get("sources", []):
        src_ids.add(s.get("id")); text(f"settings.sources[{s.get('id')}].name", s.get("name"))
        if s.get("confidence") not in ("high", "medium", "low"):
            err(f"settings.sources[{s.get('id')}].confidence", "must be high, medium or low")

# ---------------------------------------------------------------- items
item_ids = set()
if items_doc:
    items = items_doc.get("items")
    if not isinstance(items, list) or not items: err("items.json", 'needs a non-empty "items" list'); items = []
    for i, it in enumerate(items):
        iid = it.get("id"); w = f"item '{iid or '#'+str(i+1)}'"
        if not isinstance(iid, str) or not ID.match(iid): err(w, "id must be lowercase-with-dashes, e.g. 'jet-boat'")
        elif iid in item_ids: err(w, "id is used twice — ids must be unique")
        item_ids.add(iid)
        text(f"{w}.name", it.get("name")); text(f"{w}.summary", it.get("summary"))
        if it.get("category") not in cat_ids: err(f"{w}.category", f"'{it.get('category')}' is not a category in settings.json")
        if it.get("earns") not in ("yes", "partial", "no"): err(f"{w}.earns", "must be yes, partial or no")
        if "included" in it and not isinstance(it["included"], bool): err(f"{w}.included", "must be true or false")
        if it.get("funding") is not None:
            if not isinstance(it["funding"], dict): err(f"{w}.funding", 'must be {"by": {"mn": "...", "en": "..."}}')
            else: text(f"{w}.funding.by", it["funding"].get("by"))
            if it.get("revenue") is not None: err(w, "a partner-funded item cannot have a revenue block (it is not in our finances)")
        if it.get("image"):
            if not os.path.exists(os.path.join(ROOT, it["image"])): err(f"{w}.image", f"file not found: {it['image']}")
        names = {}
        for k, p in enumerate(it.get("params") or []):
            pw = f"{w}.params[{k}]"
            if not isinstance(p.get("id"), str) or not PAR.match(p["id"]): err(pw, "id must be lowercase letters/digits starting with a letter, e.g. 'length'")
            elif p["id"] in names: err(pw, "id is used twice")
            text(f"{pw}.name", p.get("name"))
            if p.get("unit") is not None: text(f"{pw}.unit", p.get("unit"))
            if p.get("basis") is not None: text(f"{pw}.basis", p.get("basis"))
            num(f"{pw}.value", p.get("value"), minimum=0)
            if isinstance(p.get("id"), str) and isinstance(p.get("value"), (int, float)): names[p["id"]] = p["value"]
        comps = it.get("components")
        if not isinstance(comps, list) or not comps: err(w, "needs at least one component"); comps = []
        comp_ids = set()
        for c in comps:
            cid = c.get("id"); cw = f"{w} > component '{cid}'"
            if not isinstance(cid, str) or not ID.match(cid): err(cw, "id must be lowercase-with-dashes")
            elif cid in comp_ids: err(cw, "component id is used twice in this item")
            comp_ids.add(cid)
            if len(comps) > 1: text(f"{cw}.name", c.get("name"))
            if isinstance(c.get("quantity"), str):
                val, e = formula(c["quantity"], names)
                if e: err(f"{cw}.quantity", f"formula '{c['quantity']}' {e}")
                elif val < 0: err(f"{cw}.quantity", f"formula '{c['quantity']}' gives a negative number ({val})")
            else: num(f"{cw}.quantity", c.get("quantity"), minimum=0)
            if c.get("quantityBasis") is not None: text(f"{cw}.quantityBasis", c.get("quantityBasis"))
            if c.get("unit") is not None: text(f"{cw}.unit", c.get("unit"))
            opts = c.get("options")
            if not isinstance(opts, list) or not opts: err(cw, "needs at least one option"); continue
            opt_ids, defaults = set(), 0
            for o in opts:
                oid = o.get("id"); ow = f"{cw} > option '{oid}'"
                if not isinstance(oid, str) or not ID.match(oid): err(ow, "id must be lowercase-with-dashes")
                elif oid in opt_ids: err(ow, "option id is used twice in this component")
                opt_ids.add(oid)
                text(f"{ow}.name", o.get("name"))
                if len(opts) > 1: text(f"{ow}.note", o.get("note"))
                pr = o.get("price") or {}
                num(f"{ow}.price.amount", pr.get("amount"), minimum=0)
                if pr.get("currency") not in ("MNT", "USD"): err(f"{ow}.price.currency", "must be MNT or USD")
                if "freight" in o: err(f"{ow}.freight", 'is no longer used — use "origin" ("local"/"import") and "shipping" instead')
                if o.get("origin") not in ("local", "import"): err(f"{ow}.origin", 'must be "local" or "import"')
                num(f"{ow}.shipping", o.get("shipping"), minimum=0)
                if isinstance(o.get("shipping"), (int, float)) and o["shipping"] > 1:
                    err(f"{ow}.shipping", f"is a fraction — use 0.04 for 4% (got {o['shipping']})")
                if o.get("origin") == "local" and o.get("shipping"): err(f"{ow}.shipping", 'must be 0 for a "local" option')
                text(f"{ow}.basis", o.get("basis"))
                if "remote" in o and not isinstance(o["remote"], bool): err(f"{ow}.remote", "must be true or false")
                if o.get("source") not in src_ids: err(f"{ow}.source", f"'{o.get('source')}' is not a source in settings.json")
                if o.get("default") is True: defaults += 1
            if defaults != 1: err(cw, f"must have exactly one option with \"default\": true (found {defaults})")

        if it.get("images") is not None:
            if not isinstance(it["images"], list): err(f"{w}.images", 'must be a list like [{"src": "assets/img/items/..."}]')
            else:
                for k, im in enumerate(it["images"]):
                    src = im.get("src") if isinstance(im, dict) else None
                    if not isinstance(src, str) or not src: err(f"{w}.images[{k}]", 'needs a "src"')
                    elif not os.path.exists(os.path.join(ROOT, src)): err(f"{w}.images[{k}]", f"file not found: {src}")
                    tag = im.get("option") if isinstance(im, dict) else None
                    if tag is not None:
                        cid, _, oid = str(tag).partition("/")
                        cc = next((c for c in comps if c.get("id") == cid), None)
                        if not cc or not any(o.get("id") == oid for o in cc.get("options", [])):
                            err(f"{w}.images[{k}].option", f"'{tag}' is not an option of this item (use '<component-id>/<option-id>')")

        tl = it.get("timeline")
        if tl is not None:
            for k in ("work", "use"):
                a = tl.get(k) if isinstance(tl, dict) else None
                if not (isinstance(a, list) and len(a) == 2 and all(isinstance(m, int) and 1 <= m <= 12 for m in a) and a[0] <= a[1]):
                    err(f"{w}.timeline.{k}", "must be [from-month, to-month], months 1–12, e.g. [4, 10]")
            if isinstance(tl, dict) and tl.get("note") is not None: text(f"{w}.timeline.note", tl.get("note"))
        up = it.get("upkeep")
        if up is not None:
            uw = f"{w}.upkeep"
            if not isinstance(up, dict): err(uw, 'must be {"perYear": ..., "basis": {...}}')
            else:
                text(f"{uw}.basis", up.get("basis"))
                if isinstance(up.get("perYear"), str):
                    val, e = formula(up["perYear"], names)
                    if e: err(f"{uw}.perYear", f"formula '{up['perYear']}' {e}")
                else: num(f"{uw}.perYear", up.get("perYear"), minimum=0)
            if it.get("revenue") is not None: err(w, "has both upkeep and revenue — put running costs in the revenue block's opex instead")
            if it.get("funding") is not None: err(w, "a partner-funded item cannot have upkeep (it is not our cost)")
        rev = it.get("revenue")
        if rev is not None:
            rw = f"{w}.revenue"
            blocks = []
            if rev.get("variants") is not None:
                vs = rev["variants"]
                if not isinstance(vs, list) or len(vs) < 2: err(f"{rw}.variants", "needs at least 2 versions (or leave it out)"); vs = []
                vids = set()
                for k, v in enumerate(vs):
                    vw = f"{rw}.variants[{v.get('id') or k}]"
                    if not isinstance(v.get("id"), str) or not ID.match(v["id"]): err(vw, "id must be lowercase-with-dashes")
                    elif v["id"] in vids: err(vw, "id is used twice")
                    vids.add(v.get("id")); text(f"{vw}.name", v.get("name"))
                    if v.get("note") is not None: text(f"{vw}.note", v.get("note"))
                    blocks.append((vw, v))
                if sum(1 for v in vs if v.get("default") is True) != 1: err(f"{rw}.variants", 'exactly one version needs "default": true')
            else:
                blocks.append((rw, rev))
            for bw, b in blocks:
                text(f"{bw}.unit", b.get("unit"))
                text(f"{bw}.basis", b.get("basis"))
            if not isinstance(rev.get("attachApplies"), bool): err(f"{rw}.attachApplies", "must be true or false")
            num(f"{rw}.capexShare", rev.get("capexShare"), minimum=0)
            if isinstance(rev.get("capexShare"), (int, float)) and rev["capexShare"] > 1:
                err(f"{rw}.capexShare", "is a fraction between 0 and 1")
            for bw, b in blocks:
                sc = b.get("scenarios") or {}
                for s in scen_ids:
                    if s not in sc: err(f"{bw}.scenarios", f"is missing the '{s}' scenario"); continue
                    for k in ("price", "perDay", "days", "opex"):
                        num(f"{bw}.scenarios.{s}.{k}", sc[s].get(k), minimum=0)
                    d = sc[s].get("days")
                    if isinstance(d, (int, float)) and d > 366: err(f"{bw}.scenarios.{s}.days", f"cannot exceed 366 (got {d})")
            if it.get("earns") == "no": err(w, 'has a revenue block but "earns" is "no"')

    for it in items:
        ref = it.get("revenueCountedWith")
        if ref and ref not in item_ids: err(f"item '{it.get('id')}'.revenueCountedWith", f"points to unknown item '{ref}'")

# ---------------------------------------------------------------- translations
if mn and en:
    missing_en, missing_mn = set(mn) - set(en), set(en) - set(mn)
    for k in sorted(missing_en): err("i18n/en.json", f"is missing key '{k}' (present in mn.json)")
    for k in sorted(missing_mn): err("i18n/mn.json", f"is missing key '{k}' (present in en.json)")
    for lang, d in (("mn", mn), ("en", en)):
        for k, v in d.items():
            if not isinstance(v, str) or not v.strip(): err(f"i18n/{lang}.json", f"key '{k}' is empty")

# ---------------------------------------------------------------- report
if ERR:
    print(f"\n[X] Data check FAILED - {len(ERR)} problem(s):\n")
    print("\n".join(ERR))
    print("\nFix these before deploying.\n")
    sys.exit(1)
n = len(items_doc["items"]) if items_doc else 0
sw = sum(1 for it in items_doc["items"] for c in it["components"] if len(c["options"]) > 1) if items_doc else 0
ph = sum(len(it.get("images") or ([1] if it.get("image") else [])) for it in items_doc["items"]) if items_doc else 0
print(f"[OK] Data check passed - {n} items, {sw} swappable, {ph} photos, {len(mn or {})} UI strings in each language.")
