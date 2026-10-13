# Nine Pines Lodge — Wishlist 2027 website

A small static website presenting the 2027 wishlist to management: an executive summary,
a page per item (with swappable options and editable sales numbers), a master assumptions
page, and side-by-side comparison of saved scenarios. Mongolian and English.

No server code, no build step, no database. It is just files.

---

## Folder map

```
index.html                 the page shell
assets/css/site.css        styling (Nine Pines brand colours + fonts)
assets/js/app.js           all the logic
assets/js/excel.js         builds the "Download Excel" workbook (loaded only when someone presses it)
assets/js/vendor/          ExcelJS 4.4 (MIT licence) — the library excel.js uses
assets/img/                logo, and item photos in assets/img/items/
data/items.json            ★ EVERY ITEM — the master data. Edit this.
data/settings.json         exchange rate, customs duty, VAT, guest-nights, scenarios, categories, price sources
data/*.schema.json         rules VS Code uses to autocomplete and underline mistakes
i18n/mn.json, en.json      every piece of on-screen wording
scripts/validate.py        checks the data — run before publishing
scripts/preview_server.py  the local preview server (what preview.bat runs)
scripts/migrate_from_excel.py   one-time script that first built items.json from Wishlist.xlsx (kept for the record)
preview.bat                double-click to preview on this computer (also turns on photo upload)
.htaccess, robots.txt      keep internal files private and the site out of search engines
```

`Wishlist.xlsx` is the original workbook. It is **deliberately not in git** — anything in the
repo is served publicly. `data/items.json` is now the source of truth; the workbook is an archive.

---

## Preview on your computer

Double-click **`preview.bat`**. It opens `http://localhost:8000`. Close the black window to stop.

(Opening `index.html` directly won't work — browsers block a page from reading data files
straight off the disk. That's why the preview runs a tiny local server.)

---

## Common edits

Open the folder in **VS Code**. While editing `data/items.json` you get suggestions and
red underlines from the schema.

### Change a price
Find the item, find the option, change `amount`. Prices are **per unit**; quantity is separate.
If the reasoning changed too, update its `basis` — that's the text people see behind the ⓘ.

```json
"price": { "amount": 210000000, "currency": "MNT" },
"origin": "local",
"shipping": 0,
"basis": { "mn": "…", "en": "Real quotation from the Fregat dealer — VAT included and delivered in Mongolia." }
```

`USD` prices follow the exchange rate on the Assumptions page. `MNT` prices (real local
quotes) never move.

### How import costs work
Every option is either `"origin": "local"` (price used as it is) or `"origin": "import"`.
For imports the site adds, in this order, each on everything before it:

1. `shipping` — a fraction of the price: `0.04` normal goods, `0.125` bulky/dangerous goods
2. customs duty — `customsDuty` in settings.json (5 %)
3. VAT — `vat` in settings.json (10 %)

So an imported $1,000 item costs $1,000 × 1.04 × 1.05 × 1.10 ≈ $1,201 at the lodge.

### Make a fixed item swappable
A fixed item is a component with **one** option. Add a second option — that's all.
Give it a `note`, and make sure exactly one option has `"default": true`.

```json
"options": [
  { "id": "pacojet-4", "name": {"mn": "Pacojet 4", "en": "Pacojet 4"},
    "note": {"mn": "Мэргэжлийн загвар.", "en": "Professional model."},
    "source": "research-global", "price": {"amount": 7299, "currency": "USD"},
    "origin": "import", "shipping": 0.04,
    "basis": {"mn": "…", "en": "Pacojet 4 US retail price."}, "default": true },
  { "id": "ninja-creami", "name": {"mn": "Ninja Creami", "en": "Ninja Creami"},
    "note": {"mn": "Хямд, гэрийн загвар.", "en": "Cheaper home model."},
    "source": "research-global", "price": {"amount": 230, "currency": "USD"},
    "origin": "import", "shipping": 0.04,
    "basis": {"mn": "…", "en": "US retail price."} }
]
```

The item page automatically shows the comparison cards once there are two or more options.

### Add a new item
Copy an existing item block of the same kind and change it. Required: `id`, `category`,
`earns`, `name`, `summary`, `components`. Every option needs a `basis` (why that price);
a component may add a `quantityBasis` (why that quantity). Add a `revenue` block (with its own
`basis`) only if it earns money.
The new item appears on the home page, in its category, with its own page — no code changes.

### Change wording on screen
Edit `i18n/mn.json` and `i18n/en.json`. Both files must have the same keys.

### Add photos
Double-click **`preview.bat`**, open an item, press **📷 Photos**. Then either drop pictures on the
box, click it to choose files, paste a copied picture with Ctrl+V, or paste an image link.
Any size/format works: pictures are converted to JPG and shrunk to 1600 px, saved in
`assets/img/items/<item-id>/`, and listed in that item's `"images"` in `data/items.json`
(first one = cover; use ★ to change it, ✕ to remove). An item can have as many photos as you like.

The Photos button only exists when previewing on your own computer — never on the live site.
iPhone HEIC photos need `pip install pillow-heif` once (or save them as JPG first).

### Update the default numbers from the browser
This button only appears when you run `preview.bat` — it is hidden on the live site so
management never sees it.

1. Run `preview.bat` and change numbers on the site (Assumptions page or any item page) —
   costs, option choices, duty/VAT and sales numbers are all carried over.
2. Assumptions → **Export as defaults** → choose which scenario to overwrite → download both files.
3. Replace `data/items.json` and `data/settings.json` with the downloads, check, and commit.

---

## What management can do on the site

- Switch scenario (Conservative / Base / Aggressive), change any sales number → "Custom".
- Change any cost: on the Assumptions page directly, or on an item page via **Edit costs**.
  Edited items get an "Edited" tag and a **Restore original** button. Cost edits don't depend on the scenario.
- Tap ⓘ next to any number to see how it was worked out.
- **Save** a version and see it side by side on **Compare**; **Share link** sends the exact model.
- **Download Excel**: their current model as a workbook — gold cells are inputs, every total is a live
  formula, explanations included. Adds a Comparison sheet when they have saved versions.

These all live in each person's own browser; nothing is sent anywhere.

## Rules that keep things working

- **Never change an existing `id`.** Share links and saved scenarios refer to items by id.
  Renaming the *display name* is always safe.
- `shipping`, `customsDuty` and `vat` are fractions: `0.04` = 4 %. A `local` option must have `shipping: 0`.
- Explanations (`basis`, `quantityBasis`) need both `mn` and `en`.
- Exactly **one** `"default": true` per component.
- Every `name`, `summary` and `note` needs both `mn` and `en`.
- `source` drives the confidence badge: `quote` and `given` are shown as firm,
  `construction-benchmark` as "rough estimate — needs a quote".

If a saved scenario or old share link refers to something you later remove, the site quietly
falls back to the default for that item — it never breaks.

---

## Check before publishing

```
python scripts/validate.py
```

It lists every problem in plain words (missing translation, two defaults, unknown category,
`4` instead of `0.04`, …) and fails if anything is wrong. The same check runs automatically:

- **On every push**, via GitHub Actions (`.github/workflows/validate.yml`).
- **On every commit**, if you turn on the hook once per computer:
  `git config core.hooksPath .githooks`

---

## Deploying

See `DEPLOY.md` (Hostinger Git deploy, subdomain, auto-deploy webhook, optional password).
