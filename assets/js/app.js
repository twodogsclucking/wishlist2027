/* Nine Pines Lodge — Wishlist 2027
   Reads data/*.json and i18n/*.json, renders everything from one state object.
   No backend: state + saved scenarios live in localStorage; "Share link" encodes state in the URL. */
(function () {
"use strict";

const VER = "16";                                   // bump when app/excel code changes, to dodge stale browser caches
const LSK = "ninepines_wishlist_v2";
const $app = document.getElementById("app");
let SET, RAW, ITEMS, I18N, ORDER, S, FUT;
const UI = { open: new Set(), info: new Set(), edit: new Set(), saving: false, exporting: false, xl: false, lastPath: null,
             photoIdx: {}, photos: false, photoSrv: null, photoMsg: "", photoBusy: 0, photoTarget: {} };
/* "Export as defaults" is a maintainer tool: shown only when previewing locally (preview.bat), never on the live site. */
const IS_LOCAL = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(location.hostname);
const DEFAULT_SHIP = 0.04;                         // used when someone switches a "local" option to imported
const shipDefault = (o) => o.origin === "import" ? o.shipping : DEFAULT_SHIP;

/* ================================================================ boot */
const getJSON = (p) => fetch(p, { cache: "no-cache" }).then(r => { if (!r.ok) throw new Error(p); return r.json(); });
Promise.all([getJSON("data/settings.json"), getJSON("data/items.json"), getJSON("i18n/mn.json"), getJSON("i18n/en.json"),
             getJSON("data/future.json").catch(() => null)])          // optional: the site works without it
  .then(([set, items, mn, en, fut]) => {
    SET = set; RAW = items; ITEMS = items.items; I18N = { mn, en }; FUT = fut;
    const catOrder = SET.categories.map(c => c.id);
    ORDER = ITEMS.slice().sort((a, b) => catOrder.indexOf(a.category) - catOrder.indexOf(b.category)).map(i => i.id);
    S = loadState();
    window.addEventListener("hashchange", render);
    render();
  })
  .catch(() => {
    $app.innerHTML = '<div class="state"><p><b>Мэдээллийг ачаалж чадсангүй.</b><br>Хэрэв файлыг компьютер дээрээ шууд нээсэн бол preview.bat-аар ажиллуулна уу.</p>'
      + '<p style="margin-top:10px">Couldn\'t load the data. If you opened the file directly, run preview.bat instead.</p></div>';
  });

/* ================================================================ i18n + format */
const t = (k, vars) => {
  let s = (I18N[S ? S.lang : "mn"] || {})[k] ?? I18N.en[k] ?? k;
  if (vars) for (const v in vars) s = s.replace("{" + v + "}", vars[v]);
  return s;
};
const tx = (o) => (o ? (o[S.lang] || o.mn || o.en || "") : "");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nf = (n, d = 0) => Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

function moneyParts(v) {
  const a = Math.abs(v);
  if (a >= 1e9) return [(v / 1e9).toFixed(2).replace(/0$/, ""), t("unit.bn")];
  if (a >= 1e7) return [nf(Math.round(v / 1e6)), t("unit.m")];
  if (a >= 1e6) return [(v / 1e6).toFixed(1), t("unit.m")];
  return [nf(Math.round(v)), t("unit.mnt")];
}
const money = (v) => { const [n, u] = moneyParts(v); return `<span class="num">${n}</span><span class="unit"> ${u}</span>`; };
const moneyText = (v) => moneyParts(v).join(" ");
const pct = (v) => (v * 100).toFixed(v > 0 && v < 0.1 ? 1 : 0) + "%";
const rate = (v) => fmtIn(v * 100) + "%";                       // 0.04 → 4%, 0.125 → 12.5%
const yrs = (y) => y == null ? `<span class="num">—</span>` : `<span class="num">${y.toFixed(1)}</span><span class="unit"> ${t("unit.years")}</span>`;
const fmtIn = (v) => Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 });
const parseIn = (s) => parseFloat(String(s).replace(/[^0-9.]/g, ""));
const okNum = (v, lo = 0, hi = Infinity) => v != null && v !== "" && typeof v !== "boolean" && Number.isFinite(Number(v)) && Number(v) >= lo && Number(v) <= hi;

/* ================================================================ state */
function defaultState() {
  const sel = {};
  ITEMS.forEach(it => it.components.forEach(c => { sel[it.id + "/" + c.id] = c.options.find(o => o.default).id; }));
  return { lang: "mn", scenario: SET.defaultScenario, customBase: null, fx: SET.fx, duty: SET.customsDuty, vat: SET.vat, remote: SET.remotePremium,
           guests: SET.guestNights, sel, custom: {}, qty: {}, opt: {}, par: {}, inc: {}, rvar: {}, upk: {} };
}
const scenarioIds = () => SET.scenarios.map(s => s.id);
const findItem = (id) => ITEMS.find(i => i.id === id);
function compByKey(k) { const [i, c] = k.split("/"); const it = findItem(i); return it && it.components.find(x => x.id === c); }
function parByKey(k) { const [i, p] = k.split("/"); const it = findItem(i); return it && (it.params || []).find(x => x.id === p); }
function optByKey(k) { const [i, c, o] = k.split("/"); const cc = compByKey(i + "/" + c); return cc && cc.options.find(x => x.id === o); }

/* Accept anything (localStorage, a share link, a saved preset) and return a state that is valid
   against the CURRENT data — so editing items.json can never break an old link or saved scenario.
   Cost overrides are kept only where they differ from the data, so they stay small. */
function sanitize(src) {
  const d = defaultState(), s = src && typeof src === "object" ? src : {};
  const out = { ...d };
  if (s.lang === "mn" || s.lang === "en") out.lang = s.lang;
  if (s.scenario === "custom" || scenarioIds().includes(s.scenario)) out.scenario = s.scenario;
  if (scenarioIds().includes(s.customBase)) out.customBase = s.customBase;
  if (Number(s.fx) > 0) out.fx = Number(s.fx);
  if (okNum(s.duty, 0, 1)) out.duty = Number(s.duty);
  if (okNum(s.vat, 0, 1)) out.vat = Number(s.vat);
  if (okNum(s.remote, 0, 1)) out.remote = Number(s.remote);
  if (Number(s.guests) > 0) out.guests = Number(s.guests);
  if (s.sel) for (const k in s.sel) {
    if (!(k in d.sel)) continue;
    const c = compByKey(k);
    if (c && c.options.some(o => o.id === s.sel[k])) out.sel[k] = s.sel[k];
  }
  out.custom = {};
  if (s.custom) for (const iid in s.custom) {
    const it = findItem(iid);
    if (!it || !it.revenue) continue;
    const row = {};
    for (const f of ["price", "perDay", "days", "opex"]) if (okNum(s.custom[iid][f])) row[f] = Number(s.custom[iid][f]);
    if (Object.keys(row).length) out.custom[iid] = row;
  }
  out.rvar = {};
  if (s.rvar && typeof s.rvar === "object") for (const id in s.rvar) {
    const it = findItem(id), vs = it && it.revenue && it.revenue.variants;
    if (vs && vs.some(v => v.id === s.rvar[id]) && s.rvar[id] !== vs.find(v => v.default).id) out.rvar[id] = s.rvar[id];
  }
  out.inc = {};
  if (s.inc && typeof s.inc === "object") for (const id in s.inc) {
    const it = findItem(id);
    if (it && typeof s.inc[id] === "boolean" && s.inc[id] !== (it.included !== false)) out.inc[id] = s.inc[id];
  }
  out.upk = {};
  if (s.upk && typeof s.upk === "object") for (const k in s.upk) {
    const it = findItem(k.split("/")[0]);
    if (it && it.upkeep && k === it.id + "/upkeep" && okNum(s.upk[k])) out.upk[k] = Number(s.upk[k]);
  }
  out.par = {};
  if (s.par && typeof s.par === "object") for (const k in s.par) {
    const p = parByKey(k);
    if (p && okNum(s.par[k]) && Number(s.par[k]) !== p.value) out.par[k] = Number(s.par[k]);
  }
  out.qty = {};
  if (s.qty && typeof s.qty === "object") for (const k in s.qty) {
    const c = compByKey(k);
    if (c && okNum(s.qty[k]) && Number(s.qty[k]) !== c.quantity) out.qty[k] = Number(s.qty[k]);
  }
  out.opt = {};
  if (s.opt && typeof s.opt === "object") for (const k in s.opt) {
    const o = optByKey(k), x = s.opt[k];
    if (!o || !x || typeof x !== "object") continue;
    const r = {};
    if (okNum(x.a) && Number(x.a) !== o.price.amount) r.a = Number(x.a);
    if ((x.or === "local" || x.or === "import") && x.or !== o.origin) r.or = x.or;
    if (okNum(x.sh, 0, 5) && Number(x.sh) !== shipDefault(o)) r.sh = Number(x.sh);
    if (typeof x.rm === "boolean" && x.rm !== (o.remote !== false)) r.rm = x.rm;
    if (Object.keys(r).length) out.opt[k] = r;
  }
  if (out.scenario === "custom" && !out.customBase) out.customBase = SET.defaultScenario;
  return out;
}
function loadState() { try { return sanitize(JSON.parse(localStorage.getItem(LSK + ":state"))); } catch (e) { return sanitize(null); } }
function persist() { try { localStorage.setItem(LSK + ":state", JSON.stringify(S)); } catch (e) {} }
function presets() { try { return JSON.parse(localStorage.getItem(LSK + ":presets")) || []; } catch (e) { return []; } }
function setPresets(p) { try { localStorage.setItem(LSK + ":presets", JSON.stringify(p)); } catch (e) {} }

/* share links: only non-default values travel, so URLs stay short */
function encodeShare(st) {
  const d = defaultState(), sel = {};
  for (const k in st.sel) if (st.sel[k] !== d.sel[k]) sel[k] = st.sel[k];
  const cu = {}, base = st.customBase || SET.defaultScenario;
  for (const id in st.custom) { const it = findItem(id); if (!it) continue;
    for (const f in st.custom[id]) if (st.custom[id][f] !== revOf(st, it).scenarios[base][f]) (cu[id] = cu[id] || {})[f] = st.custom[id][f]; }
  const pack = { l: st.lang, sc: st.scenario, cb: st.customBase, fx: st.fx, g: st.guests, sel, cu };
  if (st.duty !== SET.customsDuty) pack.du = st.duty;
  if (st.vat !== SET.vat) pack.va = st.vat;
  if (st.remote !== SET.remotePremium) pack.rp = st.remote;
  if (Object.keys(st.qty).length) pack.q = st.qty;
  if (Object.keys(st.par).length) pack.pa = st.par;
  if (Object.keys(st.upk).length) pack.uk = st.upk;
  if (Object.keys(st.inc).length) pack.in = st.inc;
  if (Object.keys(st.rvar).length) pack.rv = st.rvar;
  if (Object.keys(st.opt).length) pack.o = st.opt;
  return btoa(unescape(encodeURIComponent(JSON.stringify(pack)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function decodeShare(str) {
  try {
    const p = JSON.parse(decodeURIComponent(escape(atob(str.replace(/-/g, "+").replace(/_/g, "/")))));
    return sanitize({ lang: p.l, scenario: p.sc, customBase: p.cb, fx: p.fx, guests: p.g, duty: p.du, vat: p.va, remote: p.rp,
                      sel: { ...defaultState().sel, ...p.sel }, custom: p.cu, qty: p.q, opt: p.o, par: p.pa, inc: p.in, rvar: p.rv, upk: p.uk });
  } catch (e) { return null; }
}

/* ================================================================ maths (pure: always takes a state) */
const selOpt = (st, it, c) => c.options.find(o => o.id === st.sel[it.id + "/" + c.id]) || c.options.find(o => o.default);
/* a tiny, safe formula reader for quantities like "length * width" or "ceil(length / 5)" */
const FN = { ceil: Math.ceil, floor: Math.floor, round: Math.round, max: Math.max, min: Math.min };
function calc(expr, vars) {
  const tk = String(expr).match(/[0-9]*\.?[0-9]+|[A-Za-z_]\w*|[-+*\/(),]/g) || [];
  let i = 0;
  const peek = () => tk[i], next = () => tk[i++];
  const prim = () => {
    const x = next();
    if (x === "(") { const v = add(); next(); return v; }
    if (x === "-") return -prim();
    if (/^[0-9.]/.test(x)) return parseFloat(x);
    if (FN[x]) { next(); const a = [add()]; while (peek() === ",") { next(); a.push(add()); } next(); return FN[x](...a); }
    if (Object.prototype.hasOwnProperty.call(vars, x)) return vars[x];
    throw new Error("unknown " + x);
  };
  const mul = () => { let v = prim(); while (peek() === "*" || peek() === "/") { const o = next(), r = prim(); v = o === "*" ? v * r : v / r; } return v; };
  const add = () => { let v = mul(); while (peek() === "+" || peek() === "-") { const o = next(), r = mul(); v = o === "+" ? v + r : v - r; } return v; };
  const v = add();
  if (i !== tk.length || !Number.isFinite(v)) throw new Error("bad formula " + expr);
  return v;
}
const parVal = (st, it, p) => st.par[it.id + "/" + p.id] ?? p.value;
const parVals = (st, it) => Object.fromEntries((it.params || []).map(p => [p.id, parVal(st, it, p)]));
const isFormula = (c) => typeof c.quantity === "string";
const baseQty = (st, it, c) => isFormula(c) ? Math.max(0, Math.round(calc(c.quantity, parVals(st, it)) * 100) / 100) : c.quantity;
const qtyOf = (st, it, c) => st.qty[it.id + "/" + c.id] ?? baseQty(st, it, c);
/* an option's price inputs, with any edits applied */
function optVals(st, it, c, o) {
  const x = st.opt[it.id + "/" + c.id + "/" + o.id] || {};
  const origin = x.or || o.origin;
  const shipping = origin !== "import" ? 0 : (x.sh ?? shipDefault(o));
  return { amount: x.a ?? o.price.amount, currency: o.price.currency, origin, shipping, remote: x.rm ?? (o.remote !== false) };
}
/* cost of one unit at the lodge: price → (imports: + shipping → + customs duty → + VAT, each on all before it)
   → + remote-site premium (UB → Dadal transport and remote labour) on all of that, unless switched off */
function landedUnit(st, v) {
  const p = v.currency === "USD" ? v.amount * st.fx : v.amount;
  let ship = 0, duty = 0, vat = 0;
  if (v.origin === "import") { ship = p * v.shipping; duty = (p + ship) * st.duty; vat = (p + ship + duty) * st.vat; }
  const sub = p + ship + duty + vat, rem = v.remote ? sub * st.remote : 0;
  return { p, ship, duty, vat, rem, total: sub + rem };
}
function landed(st, it, c, o) {
  o = o || selOpt(st, it, c);
  const v = optVals(st, it, c, o), q = qtyOf(st, it, c), u = landedUnit(st, v);
  return { o, v, q, u, base: q * u.p, ship: q * u.ship, duty: q * u.duty, vat: q * u.vat, rem: q * u.rem, total: q * u.total };
}
const compCost = (st, it, c, o) => landed(st, it, c, o).total;
const itemCost = (st, it) => it.components.reduce((s, c) => s + compCost(st, it, c), 0);
const editKeys = (st, it) => Object.keys(st.qty).concat(Object.keys(st.opt), Object.keys(st.par), Object.keys(st.upk)).filter(k => k.startsWith(it.id + "/"));
/* yearly running cost of a cost-only item (heating, fuel, supplies); a number or a formula of the item's dimensions */
const upkBase = (st, it) => !it.upkeep ? 0 : typeof it.upkeep.perYear === "string" ? Math.max(0, Math.round(calc(it.upkeep.perYear, parVals(st, it)))) : it.upkeep.perYear;
const upkOf = (st, it) => !it.upkeep ? 0 : (st.upk[it.id + "/upkeep"] ?? upkBase(st, it));
const itemEdited = (st, it) => editKeys(st, it).length > 0;

/* the sales numbers in use: the item's own, or the chosen variant's (e.g. self-drive / guided) */
function revOf(st, it) {
  const r = it.revenue, vs = r && r.variants;
  if (!vs) return r;
  return vs.find(v => v.id === st.rvar[it.id]) || vs.find(v => v.default) || vs[0];
}
function rv(st, it, f) {
  if (!it.revenue) return 0;
  const sc = revOf(st, it).scenarios;
  if (st.scenario === "custom") {
    const c = st.custom[it.id];
    return c && c[f] != null ? c[f] : sc[st.customBase || SET.defaultScenario][f];
  }
  return sc[st.scenario][f];
}
function econ(st, it) {
  if (!it.revenue) return null;
  const units = rv(st, it, "perDay") * rv(st, it, "days");
  const gross = rv(st, it, "price") * units;
  const opex = rv(st, it, "opex"), net = gross - opex;
  const capex = itemCost(st, it) * it.revenue.capexShare;
  return { units, gross, opex, net, capex, payback: net > 0 ? capex / net : null, loss: net <= 0,
           attach: it.revenue.attachApplies ? units / st.guests : null };
}
const isIn = (st, it) => st.inc[it.id] ?? (it.included !== false);
/* partner-funded items (e.g. Unitel's antenna): listed for the bosses to ask for, never in our numbers */
const ours = (it) => !it.funding;
const nOurs = () => ITEMS.filter(ours).length;
function totals(st) {
  const T = { all: 0, cat: {}, status: { yes: 0, partial: 0, no: 0 }, gross: 0, opex: 0, net: 0, capex: 0, nRev: 0, nIn: 0 };
  ITEMS.forEach(it => {
    if (!ours(it) || !isIn(st, it)) return;
    T.nIn++;
    const v = itemCost(st, it);
    T.all += v;
    T.cat[it.category] = (T.cat[it.category] || 0) + v;
    T.status[it.earns] += v;
    const e = econ(st, it);
    if (e) { T.gross += e.gross; T.opex += e.opex; T.net += e.net; T.capex += e.capex; T.nRev++; }
  });
  T.payback = T.net > 0 ? T.capex / T.net : null;
  T.upkeep = ITEMS.filter(it => ours(it) && isIn(st, it)).reduce((s, it) => s + upkOf(st, it), 0);
  return T;
}
const scenarioName = (st) => st.scenario === "custom" ? t("scen.custom") : tx(SET.scenarios.find(s => s.id === st.scenario).name);

/* ================================================================ shared bits */
const ico = {
  chev: '<svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>',
  left: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  right: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>',
  xl: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M12 3v12m0 0l-5-5m5 5l5-5M4 19h16"/></svg>',
};
function pill(it) {
  if (it.funding) return `<span class="pill partner"><i></i>${esc(t("partner.pill", { by: tx(it.funding.by) }))}</span>`;
  if (it.earns === "yes") return `<span class="pill yes"><i></i>${t("status.yes")}</span>`;
  if (it.earns === "partial") return `<span class="pill partial"><i></i>${t("status.partial")}</span>`;
  return `<span class="pill no"><i></i>${t("status.no")}</span>`;
}
function conf(srcId) {
  const s = SET.sources.find(x => x.id === srcId) || { confidence: "medium", name: { mn: srcId, en: srcId } };
  return `<span class="conf ${s.confidence}" title="${esc(tx(s.name))}"><i><b></b><b></b><b></b></i>${t("conf." + s.confidence)}</span>`;
}

/* ⓘ: a small button that opens a plain-language explanation right below the number */
function ib(key) {
  const on = UI.info.has(key);
  return `<button type="button" class="ib${on ? " on" : ""}" data-info="${esc(key)}" aria-expanded="${on}" title="${esc(t("why.label"))}">`
    + `<span aria-hidden="true">i</span><span class="sr">${esc(t("why.label"))}</span></button>`;
}
const why = (key, html) => `<div class="why" data-why="${esc(key)}"${UI.info.has(key) ? "" : " hidden"}>${html}</div>`;
const P = (s) => `<p>${esc(s)}</p>`;
/* "length × width" in words, for the ⓘ */
function formulaWords(it, f) {
  let s = String(f);
  (it.params || []).forEach(p => { s = s.replace(new RegExp("\\b" + p.id + "\\b", "g"), tx(p.name).toLowerCase()); });
  return s.replace(/\*/g, "×").replace(/\//g, "÷").replace(/ceil\(/g, t("why.roundUp") + "(");
}
const qtyWhy = (it, c) => P(c.quantityBasis ? tx(c.quantityBasis) : t("why.qtyDefault"))
  + (isFormula(c) ? `<p class="m">${esc(t("why.qtyFormula", { f: formulaWords(it, c.quantity) }))}</p>` : "");
function paramFields(it) {
  if (!(it.params || []).length) return "";
  return `<div class="params">${it.params.map(p => {
    const k = it.id + "/" + p.id;
    return field(`pa-${k}`, tx(p.name), p.unit ? tx(p.unit) : "", parVal(S, it, p), `data-par="${esc(k)}"`, { k: "pa:" + k, h: P(p.basis ? tx(p.basis) : t("why.param")) });
  }).join("")}</div>`;
}
function paramLines(it) {
  if (!(it.params || []).length) return "";
  return `<div class="comp params">${it.params.map(p => { const k = "pa:" + it.id + "/" + p.id;
    return `<div class="ln"><span>${esc(tx(p.name))}${ib(k)}</span><b>${fmtIn(parVal(S, it, p))}${p.unit ? " " + esc(tx(p.unit)) : ""}</b></div>${why(k, P(p.basis ? tx(p.basis) : t("why.param")))}`; }).join("")}</div>`;
}
function priceWhy(o) {
  const s = SET.sources.find(x => x.id === o.source);
  return P(tx(o.basis)) + `<div class="wsrc">${esc(t("why.source", { name: s ? tx(s.name) : o.source }))} ${conf(o.source)}</div>`;
}
function originWhy(L) {
  const u = L.u, imp = L.v.origin === "import", row = (a, b, cls = "") => `<tr class="${cls}"><td>${a}</td><td>${b}</td></tr>`;
  const usd = L.v.currency === "USD" ? ` <small>($${nf(L.v.amount)} × ${nf(S.fx)})</small>` : "";
  let rows = row(esc(t("why.wfPrice")) + usd, moneyText(u.p));
  if (imp) rows += row(`+ ${esc(t("cost.shipping"))} ${rate(L.v.shipping)}`, moneyText(u.ship))
    + row(`+ ${esc(t("cost.duty"))} ${rate(S.duty)}`, moneyText(u.duty))
    + row(`+ ${esc(t("cost.vat"))} ${rate(S.vat)}`, moneyText(u.vat));
  if (L.v.remote) rows += row(`+ ${esc(t("cost.remote"))} ${rate(S.remote)}`, moneyText(u.rem));
  const intro = P(t(imp ? "why.import" : "why.local"));
  return imp || L.v.remote ? intro + `<table class="wf"><tbody>${rows}${row(`= ${esc(t("why.wfLanded"))}`, moneyText(u.total), "tot")}</tbody></table>` : intro;
}
const remoteWhy = () => P(t("why.remote", { pct: rate(S.remote) }));
function revWhy(it) { return `<p><b>${esc(t("why.sales"))}</b></p>` + P(tx(revOf(S, it).basis)) + `<p class="m">${esc(t("why.salesNote"))}</p>`; }
function rvarSeg(it) {
  const vs = it.revenue && it.revenue.variants;
  if (!vs) return "";
  const cur = revOf(S, it);
  return `<div class="rvar"><span class="lb">${t("rvar.label")}</span><div class="seg sm" role="group" aria-label="${esc(t("rvar.label"))}">`
    + vs.map(v => `<button type="button" data-rvar="${esc(v.id)}" data-item="${it.id}" class="${v === cur ? "on" : ""}" aria-pressed="${v === cur}">${esc(tx(v.name))}</button>`).join("")
    + `</div>${cur.note ? `<p>${esc(tx(cur.note))}</p>` : ""}</div>`;
}
const upkWhy = (it) => P(tx(it.upkeep.basis)) + (typeof it.upkeep.perYear === "string" ? `<p class="m">${esc(t("why.qtyFormula", { f: formulaWords(it, it.upkeep.perYear) }))}</p>` : "")
  + `<p class="m">${esc(t("why.upkNote"))}</p>`;
function kpiWhy(T, which) {
  if (which === "upk") {
    const list = ITEMS.filter(it => ours(it) && isIn(S, it) && upkOf(S, it) > 0).map(it => `${tx(it.name)} ${moneyText(upkOf(S, it))}`).join(", ");
    return P(t("why.kpiUpkeep", { list: list || "—" }));
  }
  if (which === "total") return P(t("why.kpiTotal", { n: T.nIn, duty: rate(S.duty), vat: rate(S.vat), remote: rate(S.remote) }));
  if (which === "net") return P(t("why.kpiNet", { k: T.nRev, gross: moneyText(T.gross), opex: moneyText(T.opex), scenario: scenarioName(S) }));
  return P(t("why.kpiPayback", { capex: moneyText(T.capex), net: moneyText(T.net), nc: moneyText(T.status.no) }));
}

function scenarioSeg() {
  const presets = SET.scenarios.map(s =>
    `<button type="button" data-sc="${s.id}" class="${S.scenario === s.id ? "on" : ""}" aria-pressed="${S.scenario === s.id}">${esc(tx(s.name))}</button>`).join("");
  const hasCustom = Object.keys(S.custom).length > 0;
  const cust = hasCustom ? `<button type="button" data-sc="custom" class="cust ${S.scenario === "custom" ? "on" : ""}" aria-pressed="${S.scenario === "custom"}">${t("scen.custom")}</button>` : "";
  return `<div class="seg" role="group" aria-label="${esc(t("assum.scenario"))}">${presets}${cust}</div>`;
}
function customBanner() {
  if (S.scenario !== "custom") return "";
  const base = tx((SET.scenarios.find(s => s.id === S.customBase) || SET.scenarios[0]).name);
  return `<div class="banner" role="status">${esc(t("custom.banner", { base }))}<button type="button" data-act="undo-custom">${t("custom.reset")}</button></div>`;
}
/* one labelled number input; `info` = { k: key, h: html } adds an ⓘ */
function field(id, label, sub, val, attrs, info) {
  return `<div class="field"><div class="fl"><label for="${esc(id)}">${esc(label)}</label>${info ? ib(info.k) : ""}${sub ? `<small>${esc(sub)}</small>` : ""}</div>`
    + `<input id="${esc(id)}" type="text" inputmode="decimal" autocomplete="off" value="${fmtIn(val)}" ${attrs}>${info ? why(info.k, info.h) : ""}</div>`;
}
function revFields(it) {
  const u = tx(revOf(S, it).unit), k = "r:" + it.id + ":";
  return field(`f-${it.id}-price`, t("item.price"), u, rv(S, it, "price"), `data-rev="price" data-item="${it.id}"`, { k: k + "price", h: P(t("why.price", { unit: u })) })
    + field(`f-${it.id}-perDay`, t("item.perDay"), "", rv(S, it, "perDay"), `data-rev="perDay" data-item="${it.id}"`, { k: k + "perDay", h: P(t("why.perDay")) })
    + field(`f-${it.id}-days`, t("item.days"), "", rv(S, it, "days"), `data-rev="days" data-item="${it.id}"`, { k: k + "days", h: P(t("why.days")) })
    + field(`f-${it.id}-opex`, t("item.opex"), "₮", rv(S, it, "opex"), `data-rev="opex" data-item="${it.id}"`, { k: k + "opex", h: P(t("why.opex")) });
}
function econOuts(it) {
  const e = econ(S, it), k = "e:" + it.id + ":";
  const whys = [];
  const out = (key, label, v, html, cls = "", s = "") => { whys.push(why(k + key, html));
    return `<div class="out"><div class="l">${label}${ib(k + key)}</div><div class="v ${cls}">${v}</div>${s ? `<div class="s">${s}</div>` : ""}</div>`; };
  const gH = P(t("why.gross", { price: moneyText(rv(S, it, "price")), perDay: fmtIn(rv(S, it, "perDay")), days: fmtIn(rv(S, it, "days")), gross: moneyText(e.gross) }));
  const nH = P(t("why.net", { gross: moneyText(e.gross), opex: moneyText(e.opex), net: moneyText(e.net) }));
  const pH = (e.loss ? P(t("why.paybackLoss")) : P(t("why.payback", { capex: moneyText(e.capex), net: moneyText(e.net), y: e.payback.toFixed(1) })))
    + (it.revenue.capexShare < 1 ? P(t("why.capexShare", { p: pct(it.revenue.capexShare) })) : "");
  const aH = e.attach == null ? P(t("why.attachNa")) : P(t("why.attach", { units: fmtIn(e.units), guests: nf(S.guests), pct: pct(e.attach) }));
  return `<div class="outs">
    ${out("gross", t("item.gross"), money(e.gross), gH)}
    ${out("net", t("item.net"), money(e.net), nH, e.net < 0 ? "bad" : "")}
    ${out("pb", t("item.payback"), e.loss ? esc(t("pb.loss")) : yrs(e.payback), pH, e.loss ? "bad" : "")}
    ${out("att", t("item.attach"), e.attach == null ? '<span class="num">—</span>' : `<span class="num">${pct(e.attach)}</span>`, aH, "", e.attach == null ? "" : esc(t("item.attachNote")))}
  </div>${whys.join("")}`;
}
function acc(key, title, meta, body) {
  const open = UI.open.has(key);
  return `<div class="acc ${open ? "open" : ""}" data-acc="${esc(key)}"><button type="button" aria-expanded="${open}">${ico.chev}`
    + `<span class="ttl">${title}</span><span class="meta ${key.startsWith("rev:") ? "stack" : ""}">${meta}</span></button><div class="body">${body}</div></div>`;
}
const offTag = (it) => isIn(S, it) ? "" : `<em class="offtag">${t("inc.off")}</em>`;
function incSwitch(it) {
  const on = isIn(S, it);
  return `<div class="incsw ${on ? "" : "off"}"><span class="lb">${t("inc.label")}</span><div class="seg sm" role="group" aria-label="${esc(t("inc.label"))}">`
    + `<button type="button" data-inc="1" data-item="${it.id}" class="${on ? "on" : ""}" aria-pressed="${on}">${t("cost.yes")}</button>`
    + `<button type="button" data-inc="0" data-item="${it.id}" class="${on ? "" : "on"}" aria-pressed="${!on}">${t("inc.no")}</button></div>`
    + `${on ? "" : `<p>${esc(t("inc.offNote"))}</p>`}</div>`;
}
const edTag = (it) => itemEdited(S, it) ? `<em class="edtag">${t("cost.edited")}</em>` : "";
const restoreBtn = (it) => itemEdited(S, it) ? `<button type="button" class="btn sm" data-act="restore" data-item="${it.id}">${t("cost.restore")}</button>` : "";
const excelBtn = () => `<button type="button" class="btn gold" data-act="excel" ${UI.xl ? "disabled" : ""}>${ico.xl}<span>${t(UI.xl ? "act.excelBusy" : "act.excel")}</span></button>`;

/* cost inputs for every part of an item (Assumptions page, and item page in Edit mode) */
function upkField(it) {
  if (!it.upkeep) return "";
  const k = it.id + "/upkeep";
  return `<div class="upkf">${field(`u-${k}`, t("upk.label"), "₮ / " + t("upk.year"), upkOf(S, it), `data-upk="${esc(k)}"`, { k: "u:" + k, h: upkWhy(it) })}</div>`;
}
function upkLine(it) {
  if (!it.upkeep) return "";
  const k = "ul:" + it.id;
  return `<div class="upkline"><span>${t("upk.label")}${ib(k)}</span><b>${money(upkOf(S, it))}<span class="unit"> / ${t("upk.year")}</span></b></div>${why(k, upkWhy(it))}`;
}
function costEditor(it, withSelect) {
  return paramFields(it) + upkField(it) + it.components.map(c => {
    const L = landed(S, it, c), o = L.o, v = L.v, ck = it.id + "/" + c.id, ok = ck + "/" + o.id;
    const sel = withSelect && c.options.length > 1
      ? `<div class="field"><div class="fl"><label for="s-${esc(ck)}">${t("cost.option")}</label></div><select id="s-${esc(ck)}" class="sel" data-selkey="${esc(ck)}">`
        + c.options.map(x => `<option value="${esc(x.id)}" ${x.id === o.id ? "selected" : ""}>${esc(tx(x.name))}</option>`).join("") + `</select></div>` : "";
    const seg = `<div class="seg sm" role="group" aria-label="${esc(t("cost.origin"))}">` + ["local", "import"].map(x =>
      `<button type="button" data-origin="${x}" data-key="${esc(ok)}" class="${v.origin === x ? "on" : ""}" aria-pressed="${v.origin === x}">${t("cost." + x)}</button>`).join("") + `</div>`;
    const rseg = `<div class="seg sm" role="group" aria-label="${esc(t("cost.remoteAdd"))}">` + [["1", true, "cost.yes"], ["0", false, "cost.no"]].map(([val, on, lab]) =>
      `<button type="button" data-remote="${val}" data-key="${esc(ok)}" class="${v.remote === on ? "on" : ""}" aria-pressed="${v.remote === on}">${t(lab)}</button>`).join("") + `</div>`;
    return `<div class="comp">${it.components.length > 1 ? `<h4>${esc(tx(c.name))}</h4>` : ""}${sel}
      ${field(`c-${ck}-q`, t("item.qty"), c.unit ? tx(c.unit) : "", L.q, `data-cost="q" data-key="${esc(ck)}"`, { k: "q:" + ck, h: qtyWhy(it, c) })}
      ${field(`c-${ok}-a`, t("item.unitPrice"), v.currency === "USD" ? "USD ($)" : "₮", v.amount, `data-cost="a" data-key="${esc(ok)}"`, { k: "p:" + ok, h: priceWhy(o) })}
      <div class="field"><div class="fl"><span class="lb">${t("cost.origin")}</span>${ib("o:" + ok)}</div>${seg}${why("o:" + ok, originWhy(L))}</div>
      ${v.origin === "import" ? field(`c-${ok}-sh`, t("cost.shipPct"), t("cost.shipPctSub"), v.shipping * 100, `data-cost="sh" data-key="${esc(ok)}"`, { k: "s:" + ok, h: P(t("why.shipping")) }) : ""}
      <div class="field"><div class="fl"><span class="lb">${t("cost.remoteAdd")} (${rate(S.remote)})</span>${ib("r:" + ok)}</div>${rseg}${why("r:" + ok, remoteWhy())}</div>
      <div class="ln sum"><span>${t("item.subtotal")}${ib("t:" + ck)}</span><b>${moneyText(L.total)}</b></div>${why("t:" + ck, P(t("why.subtotal")))}</div>`;
  }).join("");
}
/* read-only breakdown (item page) */
function breakdown(it) {
  return paramLines(it) + it.components.map(c => {
    const L = landed(S, it, c), o = L.o, v = L.v, ck = it.id + "/" + c.id, ok = ck + "/" + o.id, imp = v.origin === "import";
    const ln = (label, key, val, html) => `<div class="ln"><span>${label}${key ? ib(key) : ""}</span><b>${val}</b></div>${key ? why(key, html) : ""}`;
    return `<div class="comp">${it.components.length > 1 ? `<h4>${esc(tx(c.name))}</h4>` : ""}
      ${ln(t("item.qty"), "q:" + ck, fmtIn(L.q) + (c.unit ? " " + esc(tx(c.unit)) : ""), qtyWhy(it, c))}
      ${ln(t("item.unitPrice"), "p:" + ok, v.currency === "USD" ? `$${nf(v.amount)}` : moneyText(v.amount), priceWhy(o))}
      ${ln(t("cost.origin"), "o:" + ok, t(imp ? "cost.import" : "cost.local"), originWhy(L))}
      ${imp ? ln(`+ ${t("cost.shipping")} ${rate(v.shipping)}`, "", moneyText(L.ship)) + ln(`+ ${t("cost.duty")} ${rate(S.duty)}`, "", moneyText(L.duty))
            + ln(`+ ${t("cost.vat")} ${rate(S.vat)}`, "", moneyText(L.vat)) : ""}
      ${v.remote ? ln(`+ ${t("cost.remote")} ${rate(S.remote)}`, "rm:" + ok, moneyText(L.rem), remoteWhy()) : ""}
      <div class="ln sum"><span>${t("item.subtotal")}</span><b>${moneyText(L.total)}</b></div>
      <div class="src">${conf(o.source)}</div></div>`;
  }).join("");
}

/* ================================================================ TIMELINE (home page) */
function timeline() {
  const tl = SET.timeline;
  if (!tl) return "";
  const M = t("tl.months").split(","), rows = [];
  const span = (a) => `${M[a[0] - 1]}${a[1] !== a[0] ? "–" + M[a[1] - 1] : ""}`;
  const bar = (kind, a, label) => `<i class="tb ${kind}" style="grid-column:${a[0] + 1}/${a[1] + 2}" title="${esc(label)}"></i>`;
  const row = (it) => {
    const x = it.timeline, partner = !ours(it);
    const tip = `${tx(it.name)} — ${t(partner ? "tl.partner" : "tl.work")}: ${span(x.work)} · ${t("tl.use")}: ${span(x.use)}. ${tx(x.note)}`;
    return `<a class="tr" href="#/item/${it.id}" title="${esc(tip)}"><span class="tn">${esc(tx(it.name))}</span>`
      + bar(partner ? "partner" : "work", x.work, tip) + bar("use", x.use, tip) + `</a>`;
  };
  const items = ORDER.map(findItem).filter(it => it.timeline && ours(it) && isIn(S, it));   // partner items are not our work
  const cats = SET.categories.filter(c => items.some(i => i.category === c.id));
  cats.forEach(c => {
    rows.push(`<div class="tg">${esc(tx(c.name))}</div>`);
    items.filter(i => i.category === c.id).sort((a, b) => a.timeline.work[0] - b.timeline.work[0] || a.timeline.use[0] - b.timeline.use[0]).forEach(i => rows.push(row(i)));
  });
  const MS = t("tl.monthsShort").split(",");
  const head = `<div class="th"><span></span>${M.map((m, i) => `<b class="${i >= 5 && i <= 8 ? "summer" : i >= 10 ? "winter" : ""}"><span class="ml">${m}</span><span class="ms">${MS[i]}</span></b>`).join("")}</div>`;
  const miles = `<div class="miles">${tl.milestones.map(m => `<div class="mile"><b>${esc(tx(m.when))}</b><span>${esc(tx(m.text))}</span></div>`).join("")}</div>`;
  return `<section id="timeline"><div class="sec-h"><h2>${t("tl.title", { year: tl.year })}</h2><p>${t("tl.sub")}</p></div>
    ${acc("tl:miles", t("tl.miles"), `<span class="c">${tl.milestones.length}</span>`, `<div class="pad">${miles}</div>`)}
    ${acc("tl:chart", t("tl.chart"), `<span class="c">${items.length}</span>`, `<div class="tl-card"><div class="tl-legend">
      <span><i class="tb work"></i>${t("tl.work")}</span><span><i class="tb use"></i>${t("tl.use")}</span>
      <em>${t("tl.hint")}</em></div>
      <div class="tbl tl-scroll"><div class="tl">${head}${rows.join("")}</div></div></div>`)}</section>`;
}

/* ================================================================ FURTHER OUT (home page)
   Possible later projects, for expectations only: never part of totals, Excel or share links. */
function future() {
  if (!FUT || !FUT.groups) return "";
  const card = (x) => `<div class="fut"><div class="fut-h"><b>${esc(tx(x.title))}</b><span class="fut-pl">${esc(tx(FUT.places[x.place]))}</span></div>`
    + `<p>${esc(tx(x.text))}</p>`
    + (x.if ? `<p class="fut-if"><b>${t("fut.if")}:</b> ${esc(tx(FUT.triggers[x.if]))}</p>` : "")
    + (x.showWishlistTotal ? `<p class="fut-ref">${esc(t("fut.ref", { v: moneyText(totals(S).all) }))}</p>` : "")
    + `</div>`;
  return `<section id="future"><div class="sec-h"><h2>${t("fut.title")}</h2><p>${t("fut.sub")}</p></div>
    ${FUT.groups.map((g, i) => acc("fut:" + i, esc(tx(g.when)), `<span class="c">${g.items.length}</span>`,
      `<div class="pad"><div class="futs">${g.items.map(card).join("")}</div></div>`)).join("")}</section>`;
}

/* ================================================================ HOME */
function viewHome() {
  const T = totals(S);
  const cats = SET.categories.filter(c => T.cat[c.id]).sort((a, b) => T.cat[b.id] - T.cat[a.id]);
  const maxCat = Math.max(...cats.map(c => T.cat[c.id]));
  const st = T.status;

  const ranked = ITEMS.filter(i => i.revenue && ours(i) && isIn(S, i)).map(i => ({ it: i, e: econ(S, i) }));
  const listCats = SET.categories.filter(c => ITEMS.some(i => i.category === c.id && ours(i))).sort((a, b) => (T.cat[b.id] || 0) - (T.cat[a.id] || 0));
  const fast = ranked.filter(r => !r.e.loss).sort((a, b) => a.e.payback - b.e.payback).slice(0, 3);
  const slow = ranked.slice().sort((a, b) => (b.e.loss - a.e.loss) || (b.e.payback - a.e.payback)).slice(0, 3);
  const pbRow = (r, good) => `<a class="pbr" href="#/item/${r.it.id}"><span class="nm">${esc(tx(r.it.name))}</span>`
    + `<span class="yr ${good ? "good" : "bad"}">${r.e.loss ? esc(t("pb.loss")) : `${r.e.payback.toFixed(1)}<small>${t("unit.years")}</small>`}</span></a>`;
  const kpi = (key, cls, v, label) => `<div class="kpi ${cls}"><div class="v">${v}</div><div class="l">${label}${key ? ib("k:" + key) : ""}</div></div>`;

  return `
  <div class="hero"><div class="wrap">
    <h1>${t("home.title")}</h1>
    <p>${esc(t("home.subtitle", { n: nOurs() }))}</p>
    <div class="chip">${esc(t("home.scenario", { name: "" }))}<b>${esc(scenarioName(S))}</b><a href="#/assumptions">${t("home.change")}</a></div>
    <div class="kpis">
      ${kpi("total", "", money(T.all), t("kpi.total"))}
      ${kpi("", "", `<span class="num">${T.nIn}</span>${T.nIn < nOurs() ? `<span class="unit"> / ${nOurs()}</span>` : ""}`, t("kpi.items"))}
      ${kpi("net", "gold", money(T.net), t("kpi.net"))}
      ${kpi("pb", "gold", yrs(T.payback), t("kpi.payback"))}
    </div>${["total", "net", "pb"].map(k => why("k:" + k, kpiWhy(T, k))).join("")}
    ${T.upkeep ? `<div class="upkbar"><span>${t("upk.kpi")}${ib("k:upk")}</span><b>${money(T.upkeep)}<span class="unit"> / ${t("upk.year")}</span></b></div>${why("k:upk", kpiWhy(T, "upk"))}` : ""}
    <div class="split">
      <h3>${t("split.title")}${ib("k:split")}</h3>${why("k:split", P(t("why.split")))}
      <div class="bar" role="img" aria-label="${esc(`${t("status.yes")} ${pct(st.yes / T.all)}, ${st.partial ? `${t("status.partial")} ${pct(st.partial / T.all)}, ` : ""}${t("status.no")} ${pct(st.no / T.all)}`)}">
        <i class="y" style="flex:${st.yes}"></i>${st.partial ? `<i class="p" style="flex:${st.partial}"></i>` : ""}<i class="n" style="flex:${st.no}"></i></div>
      <div class="legend">
        <span><i style="background:var(--earn-d)"></i>${t("status.yes")} <b>${pct(st.yes / T.all)}</b></span>
        ${st.partial ? `<span><i style="background:repeating-linear-gradient(135deg,var(--earn-d) 0 3px,#0F6E62 3px 6px)"></i>${t("status.partial")} <b>${pct(st.partial / T.all)}</b></span>` : ""}
        <span><i style="background:var(--cost-d)"></i>${t("status.no")} <b>${pct(st.no / T.all)}</b></span>
      </div>
    </div>
  </div></div>

  <div class="wrap">
    <section><div class="sec-h"><h2>${t("cats.title")}</h2><p>${t("cats.sub")}</p></div>
      <div class="card pad"><div class="bars">${cats.map(c =>
        `<div class="brow"><div class="t"><span>${esc(tx(c.name))}</span><b>${moneyText(T.cat[c.id])}</b></div>`
        + `<div class="track"><i style="width:${(T.cat[c.id] / maxCat * 100).toFixed(1)}%"></i></div></div>`).join("")}</div></div></section>

    <section><div class="sec-h"><h2>${t("pb.sub")}</h2></div>
      <div class="pbgrid">
        <div class="card pad pbl"><h3>${t("pb.fast")}</h3><div class="s">${esc(scenarioName(S))}</div>${fast.map(r => pbRow(r, true)).join("")}</div>
        <div class="card pad pbl"><h3>${t("pb.slow")}</h3><div class="s">${esc(scenarioName(S))}</div>${slow.map(r => pbRow(r, false)).join("")}</div>
      </div></section>

    <section id="list"><div class="sec-h"><h2>${t("list.title")}</h2><p>${t("list.sub")}</p></div>
      ${listCats.map(c => {
        const its = ORDER.map(findItem).filter(i => i.category === c.id && ours(i));
        const rows = its.map(it => {
          const sw = it.components.filter(x => x.options.length > 1);
          const sub = sw.length === 1 ? tx(selOpt(S, it, sw[0]).name) : sw.length > 1 ? t("list.choices", { n: sw.length }) : "";
          return `<a class="irow ${isIn(S, it) ? "" : "off"}" href="#/item/${it.id}"><span class="nm">${esc(tx(it.name))}${edTag(it)}${offTag(it)}${sub ? `<small>${esc(sub)}</small>` : ""}</span>`
            + `${pill(it)}<span class="amt">${moneyText(itemCost(S, it))}</span>${ico.chev}</a>`;
        }).join("");
        return acc("cat:" + c.id, esc(tx(c.name)), `<span class="c">${its.length}</span><b>${moneyText(T.cat[c.id] || 0)}</b>`, rows);
      }).join("")}
    </section>
    ${ITEMS.some(i => !ours(i)) ? `<section id="partners"><div class="sec-h"><h2>${t("partner.title")}</h2><p>${t("partner.sub")}</p></div>
      <div class="card">${ORDER.map(findItem).filter(i => !ours(i)).map(it => `<a class="irow partner" href="#/item/${it.id}"><span class="nm">${esc(tx(it.name))}`
        + `<small>${esc(t("partner.est", { by: tx(it.funding.by) }))}: ${moneyText(itemCost(S, it))}</small></span>${pill(it)}<span class="amt"></span>${ico.chev}</a>`).join("")}</div></section>` : ""}
    ${timeline()}
    ${future()}
  </div>`;
}

/* ================================================================ PHOTOS
   An item can have any number of photos ("images": [{ "src": ... }], first = cover).
   The "Photos" panel is a maintainer tool: only when previewing locally with preview.bat,
   whose server (scripts/preview_server.py) saves the files. It never appears on the live site. */
const photosOf = (it) => it.images || (it.image ? [{ src: it.image }] : []);
/* a photo may be tagged to one option ("option": "<component>/<option>"); untagged = the whole item */
const tagOk = (st, it, im) => {
  if (!im.option) return true;
  const [cid, oid] = im.option.split("/"), c = it.components.find(x => x.id === cid);
  return !c || selOpt(st, it, c).id === oid;
};
/* what the gallery shows: photos of the selected option(s) first, then whole-item photos */
const photosFor = (it) => { const all = photosOf(it).filter(im => tagOk(S, it, im)); return all.filter(im => im.option).concat(all.filter(im => !im.option)); };
const optPhoto = (it, c, o) => photosOf(it).find(im => im.option === c.id + "/" + o.id);
function photoTargets(it) {
  const out = [];
  it.components.forEach(c => { if (it.components.length > 1 || c.options.length > 1) c.options.forEach(o =>
    out.push([c.id + "/" + o.id, (it.components.length > 1 ? tx(c.name) + ": " : "") + tx(o.name)])); });
  return out;
}
const tagSelect = (it, cur, attrs) => `<select class="sel phsel" ${attrs}><option value="">${esc(t("ph.whole"))}</option>`
  + photoTargets(it).map(([k, l]) => `<option value="${esc(k)}" ${k === cur ? "selected" : ""}>${esc(l)}</option>`).join("") + `</select>`;
function gallery(it) {
  const ims = photosFor(it), n = ims.length;
  const i = Math.min(UI.photoIdx[it.id] || 0, Math.max(n - 1, 0));
  const nav = n > 1 ? `<button type="button" class="gnav l" data-ph="${(i - 1 + n) % n}" data-item="${it.id}" aria-label="${t("item.prev")}">${ico.left}</button>`
    + `<button type="button" class="gnav r" data-ph="${(i + 1) % n}" data-item="${it.id}" aria-label="${t("item.next")}">${ico.right}</button>`
    + `<span class="gcount">${i + 1} / ${n}</span>` : "";
  const thumbs = n > 1 ? `<div class="thumbs">${ims.map((im, k) =>
    `<button type="button" class="${k === i ? "on" : ""}" data-ph="${k}" data-item="${it.id}" aria-label="${k + 1} / ${n}"><img src="${esc(im.src)}" alt="" loading="lazy"></button>`).join("")}</div>` : "";
  return `<div class="photo" data-photo>
      ${n ? `<img src="${esc(ims[i].src)}" alt="${esc(tx(it.name))}">` : ""}
      <div class="ph"><img src="assets/img/logo.png" alt=""><div><b>${esc(tx(it.name))}</b><span>${t("item.photo")}</span></div></div>
      ${nav}</div>${thumbs}`;
}
function photoPanel(it) {
  const ims = photosOf(it);
  const btn = `<button type="button" class="btn sm" data-act="photos" aria-expanded="${UI.photos}">📷 ${t("ph.manage")} (${ims.length})</button>`;
  if (!UI.photos) return `<div class="phbar">${btn}</div>`;
  if (UI.photoSrv === false) return `<div class="phbar">${btn}</div><div class="phpanel"><p class="warn">${esc(t("ph.noServer"))}</p></div>`;
  return `<div class="phbar">${btn}</div><div class="phpanel">
    <p class="loc">${esc(t("ph.localOnly"))}</p>
    <label class="drop" data-drop="${it.id}" tabindex="0"><input type="file" accept="image/*,.heic,.heif,.tif,.tiff" multiple data-photo-file="${it.id}" hidden>
      <b>${esc(t("ph.drop"))}</b><span>${esc(t("ph.dropSub"))}</span></label>
    <form class="phurl" data-form="photo-url" data-item="${it.id}"><input name="u" type="url" placeholder="${esc(t("ph.url"))}" aria-label="${esc(t("ph.url"))}" autocomplete="off">
      <button class="btn sm" type="submit">${esc(t("ph.urlAdd"))}</button></form>
    ${photoTargets(it).length ? `<div class="phtarget"><label for="pt-${it.id}">${esc(t("ph.target"))}</label>${tagSelect(it, UI.photoTarget[it.id] || "", `id="pt-${it.id}" data-phtarget="${it.id}"`)}</div>` : ""}
    ${UI.photoBusy ? `<p class="busy">${esc(t("ph.busy", { n: UI.photoBusy }))}</p>` : ""}
    ${UI.photoMsg ? `<p class="msg">${UI.photoMsg}</p>` : ""}
    ${ims.length ? `<div class="phgrid">${ims.map((im, k) => `<div class="phc"><img src="${esc(im.src)}" alt="" loading="lazy">
      ${k === 0 ? `<span class="cov">${esc(t("ph.cover"))}</span>` : `<button type="button" class="mini" data-phact="cover" data-src="${esc(im.src)}" data-item="${it.id}">★ ${esc(t("ph.makeCover"))}</button>`}
      <button type="button" class="mini x" data-phact="delete" data-src="${esc(im.src)}" data-item="${it.id}">✕ ${esc(t("ph.removeShort"))}</button>
      ${photoTargets(it).length ? tagSelect(it, im.option || "", `data-phtag="${it.id}" data-src="${esc(im.src)}" aria-label="${esc(t("ph.target"))}"`) : ""}</div>`).join("")}</div>` : ""}
  </div>`;
}

/* ---- talking to the local preview server */
const phFetch = (url, opt = {}) => fetch(url, { ...opt, headers: { "X-NinePines": "1", ...(opt.headers || {}) } });
async function photoServerCheck() {
  if (UI.photoSrv !== null) return;
  try { const r = await phFetch("__photo/ping"); UI.photoSrv = r.ok && (await r.json()).ok === true; } catch (e) { UI.photoSrv = false; }
}
/* turn any picture the browser can read into a JPEG, longest side <= 1600 px; null if the browser can't read it */
async function toJpeg(blob) {
  let src, w, h, url;
  try { src = await createImageBitmap(blob); w = src.width; h = src.height; }
  catch (e) {
    url = URL.createObjectURL(blob);
    src = await new Promise(ok => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = url; });
    if (!src) { URL.revokeObjectURL(url); return null; }
    w = src.naturalWidth || 1600; h = src.naturalHeight || 1200;
  }
  const k = Math.min(1, 1600 / Math.max(w, h)), cw = Math.max(1, Math.round(w * k)), chh = Math.max(1, Math.round(h * k));
  const cv = document.createElement("canvas"); cv.width = cw; cv.height = chh;
  const g = cv.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, cw, chh); g.imageSmoothingQuality = "high"; g.drawImage(src, 0, 0, cw, chh);
  if (url) URL.revokeObjectURL(url);
  const out = await new Promise(ok => cv.toBlob(ok, "image/jpeg", 0.86));
  return out ? { blob: out, w, h } : null;
}
const phNote = (html) => { UI.photoMsg = html; };
function setImages(id, images) { const it = findItem(id); if (it) { it.images = images; delete it.image; } }
async function addPhotos(id, blobs, source) {
  await photoServerCheck();
  if (!UI.photoSrv) { rerender(); return; }
  const notes = [];
  UI.photoBusy += blobs.length; phNote(""); rerender();
  for (const b of blobs) {
    try {
      const j = await toJpeg(b);
      const tgt = UI.photoTarget[id] || "";
      const r = await phFetch(`__photo/add?item=${encodeURIComponent(id)}${source ? "&source=" + encodeURIComponent(source) : ""}${tgt ? "&option=" + encodeURIComponent(tgt) : ""}`,
        { method: "POST", headers: { "X-Kind": j ? "jpeg" : "raw" }, body: j ? j.blob : b });
      const res = await r.json();
      if (r.ok) { setImages(id, res.images); UI.lastAdded = res.images[res.images.length - 1].src; if (j && Math.max(j.w, j.h) < 800) notes.push(esc(t("ph.small", { w: j.w, h: j.h }))); }
      else notes.push(esc(t(res.error === "unreadable" ? "ph.unreadable" : "ph.failed", { name: b.name || "" })));
    } catch (e) { notes.push(esc(t("ph.failed", { name: b.name || "" }))); }
    UI.photoBusy--; rerender();
  }
  UI.photoIdx[id] = Math.max(0, photosFor(findItem(id)).findIndex(im => im.src === UI.lastAdded));
  phNote(notes.join("<br>") || esc(t("ph.added"))); rerender();
}
async function addFromUrl(id, link) {
  link = (link || "").trim();
  if (!/^https?:\/\//i.test(link)) { phNote(esc(t("ph.badUrl"))); rerender(); return; }
  await photoServerCheck();
  if (!UI.photoSrv) { rerender(); return; }
  UI.photoBusy++; phNote(""); rerender();
  let blob = null, err = "ph.dlFailed";
  try {
    const r = await phFetch("__photo/fetch?url=" + encodeURIComponent(link));
    if (r.ok) blob = await r.blob(); else { const j = await r.json().catch(() => ({})); if (j.error === "is-webpage") err = "ph.isPage"; }
  } catch (e) {}
  UI.photoBusy--;
  if (!blob) { phNote(esc(t(err))); rerender(); return; }
  await addPhotos(id, [blob], link);
}
async function photoAction(act, id, src, option) {
  if (act === "delete" && !confirm(t("ph.confirmDel"))) return;
  try {
    const r = await phFetch(`__photo/${act}?item=${encodeURIComponent(id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ src, option }) });
    const res = await r.json();
    if (r.ok) { setImages(id, res.images); UI.photoIdx[id] = 0; phNote(""); }
  } catch (e) { phNote(esc(t("ph.failed", { name: "" }))); }
  rerender();
}

/* ================================================================ ITEM */
function viewItem(id) {
  const it = findItem(id);
  if (!it) return `<div class="wrap"><div class="state">${t("item.notFound")} <a href="#/">←</a></div></div>`;
  const idx = ORDER.indexOf(id), prev = ORDER[idx - 1], next = ORDER[idx + 1];
  const total = itemCost(S, it);
  const swaps = it.components.filter(c => c.options.length > 1);
  const subline = swaps.length === 1 ? tx(selOpt(S, it, swaps[0]).name) : "";
  const editing = UI.edit.has(it.id);

  /* options */
  const opts = swaps.map(c => {
    const cur = compCost(S, it, c);
    return `<section><div class="sec-h"><h2>${t("item.options")}${it.components.length > 1 ? " — " + esc(tx(c.name)) : ""}</h2><p>${t("item.optionsSub")}</p></div>
      <div class="opts">${c.options.map(o => {
        const on = o.id === selOpt(S, it, c).id, L = landed(S, it, c, o), d = L.total - cur;
        const delta = on ? "" : `<span class="delta">${d < 0 ? "▼ " + esc(t("item.cheaper", { v: moneyText(-d) })) : "▲ " + esc(t("item.dearer", { v: moneyText(d) }))}</span>`;
        const op = optPhoto(it, c, o);
        return `<button type="button" class="opt ${on ? "on" : ""}${op ? " hasimg" : ""}" data-opt="${esc(o.id)}" data-key="${esc(it.id + "/" + c.id)}" aria-pressed="${on}">
          ${on ? `<span class="tag">${t("item.selected")}</span>` : ""}
          ${op ? `<span class="othumb"><img src="${esc(op.src)}" alt="" loading="lazy"></span>` : ""}
          <h4>${esc(tx(o.name))}</h4><div class="p">${money(L.total)}</div>
          <div class="eq">${L.v.currency === "USD" ? "$" + nf(L.v.amount) : moneyText(L.v.amount)} × ${fmtIn(L.q)} · ${t(L.v.origin === "import" ? "cost.import" : "cost.local")}</div>
          ${o.note ? `<div class="note" style="background:none;padding:0;margin-top:10px">${esc(tx(o.note))}</div>` : ""}
          <div class="ft">${conf(o.source)}${delta}${on ? "" : `<span class="pick">${t("item.select")} →</span>`}</div></button>`;
      }).join("")}</div></section>`;
  }).join("");

  /* revenue */
  let rev;
  if (it.revenue) {
    rev = `<section><div class="sec-h"><h2>${t("item.sales")}</h2>${ib("rb:" + it.id)}<p>${t("item.salesSub")}</p></div>${why("rb:" + it.id, revWhy(it))}
      ${rvarSeg(it)}${scenarioSeg()}${customBanner()}
      <div class="card pad" style="margin-top:12px">${revFields(it)}</div>${econOuts(it)}</section>`;
  } else if (it.revenueCountedWith) {
    const w = findItem(it.revenueCountedWith);
    rev = `<section><div class="note">${esc(t("item.revenueWith", { name: tx(w.name) }))} <a href="#/item/${w.id}">${esc(tx(w.name))} →</a></div></section>`;
  } else {
    rev = `<section><div class="note">${t("item.noRevenue")}</div></section>`;
  }

  return `<div class="wrap">
    <div class="ibar">
      <a class="back" href="#/">${ico.left}${t("item.back")}</a>
      <div class="pn">
        <a class="icon-btn" href="${prev ? "#/item/" + prev : "#/"}" aria-label="${t("item.prev")}" aria-disabled="${!prev}">${ico.left}</a>
        <span>${t("item.of", { i: idx + 1, n: ORDER.length })}</span>
        <a class="icon-btn" href="${next ? "#/item/" + next : "#/"}" aria-label="${t("item.next")}" aria-disabled="${!next}">${ico.right}</a>
      </div>
    </div>
    <div class="ihead">
      <div>${gallery(it)}${IS_LOCAL ? photoPanel(it) : ""}</div>
      <div>
        <div class="pills">${pill(it)}${edTag(it)}${offTag(it)}</div>
        <h1>${esc(tx(it.name))}</h1>
        ${subline ? `<div class="sub">${esc(subline)}</div>` : ""}
        <p class="desc">${esc(tx(it.summary))}</p>
        <div class="bigtotal ${isIn(S, it) ? "" : "off"} ${it.funding ? "partner" : ""}"><span>${it.funding ? esc(t("partner.est", { by: tx(it.funding.by) })) : t("item.total")}</span><b>${money(total)}</b></div>
        ${upkLine(it)}
        ${it.funding ? `<p class="partnernote">${esc(t("partner.note", { by: tx(it.funding.by) }))}</p>` : incSwitch(it)}
      </div>
    </div>
    <section><div class="sec-h"><h2>${t("item.cost")}</h2>
        <div class="sec-act">${restoreBtn(it)}<button type="button" class="btn sm ${editing ? "pri" : ""}" data-act="edit-cost" data-item="${it.id}" aria-pressed="${editing}">${t(editing ? "cost.done" : "cost.edit")}</button></div></div>
      <div class="card pad bd">${editing ? `<p class="hint">${esc(t("cost.editHint"))}</p>${costEditor(it, false)}` : breakdown(it)}
        ${it.components.length > 1 ? `<div class="grand"><span>${t("item.total")}</span><b>${moneyText(total)}</b></div>` : ""}</div></section>
    ${opts}${rev}
  </div>`;
}

/* ================================================================ ASSUMPTIONS */
function viewAssumptions() {
  const T = totals(S);
  const slots = SET.scenarios.map(s => `<option value="${s.id}" ${s.id === (S.scenario === "custom" ? S.customBase : S.scenario) ? "selected" : ""}>${esc(tx(s.name))}</option>`).join("");
  const items = ORDER.map(findItem), revItems = items.filter(i => i.revenue && ours(i)), costItems = items.filter(i => !i.revenue && ours(i)),
        partnerItems = items.filter(i => !ours(i));
  const costBlock = (it) => `<div class="subh"><h4>${t("assum.costs")}</h4>${restoreBtn(it)}</div><div class="bd">${costEditor(it, true)}`
    + `${it.components.length > 1 ? `<div class="grand"><span>${t("item.total")}</span><b>${moneyText(itemCost(S, it))}</b></div>` : ""}</div>`;
  const link = (it) => `<div style="margin-top:14px"><a class="btn sm" href="#/item/${it.id}">${t("assum.open")} →</a></div>`;
  const out = (key, label, v) => `<div class="out"><div class="l">${label}${ib("a:" + key)}</div><div class="v">${v}</div></div>`;

  return `<div class="wrap">
  <section><div class="sec-h"><h2>${t("assum.title")}</h2><p>${t("assum.sub")}</p></div>
    <div class="card pad">
      <div class="field stack"><div class="fl"><span class="lb">${t("assum.scenario")}</span>${ib("g:sc")}</div>${scenarioSeg()}${why("g:sc", P(t("why.scenario")))}</div>
      ${customBanner()}
      ${field("g-fx", t("assum.fx"), t("assum.fxNote"), S.fx, 'data-glob="fx"', { k: "g:fx", h: P(t("why.fx")) })}
      ${field("g-duty", t("assum.duty") + " (%)", t("assum.importNote"), S.duty * 100, 'data-glob="duty" data-pct="1"', { k: "g:duty", h: P(t("why.duty")) })}
      ${field("g-vat", t("assum.vat") + " (%)", t("assum.importNote"), S.vat * 100, 'data-glob="vat" data-pct="1"', { k: "g:vat", h: P(t("why.vat")) })}
      ${field("g-remote", t("assum.remote") + " (%)", t("assum.remoteNote"), S.remote * 100, 'data-glob="remote" data-pct="1"', { k: "g:remote", h: remoteWhy() })}
      ${field("g-guests", t("assum.guests"), t("assum.guestsNote"), S.guests, 'data-glob="guests"', { k: "g:guests", h: P(t("why.guests")) })}
    </div>
    <div class="outs" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
      ${out("total", t("kpi.total"), money(T.all))}${out("net", t("kpi.net"), money(T.net))}${out("pb", t("kpi.payback"), yrs(T.payback))}${out("upk", t("upk.kpi"), money(T.upkeep))}
    </div>${["total", "net", "pb", "upk"].map(k => why("a:" + k, kpiWhy(T, k))).join("")}
    <div class="btns" style="margin-top:14px">
      <button type="button" class="btn pri" data-act="save-open">${t("act.save")}</button>
      <button type="button" class="btn" data-act="share">${t("act.share")}</button>
      ${excelBtn()}
      ${IS_LOCAL ? `<button type="button" class="btn" data-act="export-open">${t("act.export")}</button>` : ""}
      <button type="button" class="btn warn" data-act="reset">${t("act.reset")}</button>
    </div>
    ${UI.saving ? `<form class="saveform" data-form="save"><input name="nm" maxlength="60" required placeholder="${esc(t("act.saveName"))}" aria-label="${esc(t("act.saveName"))}">
      <button class="btn pri" type="submit">${t("act.save")}</button><button class="btn" type="button" data-act="save-close">${t("act.cancel")}</button></form>` : ""}
    ${IS_LOCAL && UI.exporting ? `<div class="card pad" style="margin-top:12px">
      <p style="font-size:12.5px;font-weight:700;color:var(--cost-ink);margin-bottom:10px">${t("act.exportLocal")}</p>
      <div class="field" style="border:0;padding-top:0"><label for="x-slot">${t("act.exportInto")}</label><select id="x-slot" class="btn sm">${slots}</select></div>
      <div class="btns"><button type="button" class="btn gold sm" data-act="export-items">${t("act.exportItems")}</button>
      <button type="button" class="btn sm" data-act="export-settings">${t("act.exportSettings")}</button></div>
      <p style="font-size:13px;color:var(--ink-2);margin-top:10px">${t("act.exportHelp")}</p></div>` : ""}
  </section>
  <section><div class="sec-h"><h2>${t("assum.perItem")}</h2><p>${t("assum.revSub")}</p></div>
    ${revItems.map(it => {
      const e = econ(S, it);
      return acc("rev:" + it.id, esc(tx(it.name)) + edTag(it) + offTag(it),
        `<b>${moneyText(itemCost(S, it))}</b><span class="c">${e.loss ? esc(t("pb.loss")) : e.payback.toFixed(1) + " " + t("unit.years")}</span>`,
        `<div class="pad">${incSwitch(it)}${costBlock(it)}<div class="subh"><h4>${t("assum.sales")}</h4>${ib("rb:" + it.id)}</div>${why("rb:" + it.id, revWhy(it))}`
        + `${rvarSeg(it)}<div class="fields">${revFields(it)}</div>${econOuts(it)}${link(it)}</div>`);
    }).join("")}
  </section>
  <section><div class="sec-h"><h2>${t("assum.costItems")}</h2><p>${t("assum.costSub")}</p></div>
    ${costItems.map(it => acc("cost:" + it.id, esc(tx(it.name)) + edTag(it) + offTag(it), `<b>${moneyText(itemCost(S, it))}</b>`,
      `<div class="pad">${incSwitch(it)}${costBlock(it)}${it.revenueCountedWith ? `<div class="note" style="margin-top:12px">${esc(t("item.revenueWith", { name: tx(findItem(it.revenueCountedWith).name) }))}</div>` : ""}${link(it)}</div>`)).join("")}
  </section>
  ${partnerItems.length ? `<section><div class="sec-h"><h2>${t("partner.title")}</h2><p>${t("partner.sub")}</p></div>
    ${partnerItems.map(it => acc("partner:" + it.id, esc(tx(it.name)) + edTag(it), `<span class="c">${esc(tx(it.funding.by))}</span><b>${moneyText(itemCost(S, it))}</b>`,
      `<div class="pad"><p class="partnernote" style="margin:0 0 12px">${esc(t("partner.note", { by: tx(it.funding.by) }))}</p>${costBlock(it)}${link(it)}</div>`)).join("")}
  </section>` : ""}</div>`;
}

/* ================================================================ COMPARE */
function compareCols() {
  const ps = presets();
  const base = sanitize({ lang: S.lang });
  return [{ name: t("cmp.baseline"), st: base }, { name: t("cmp.current"), st: S, cur: true }]
    .concat(ps.map(p => ({ name: p.name, st: sanitize({ ...p.state, lang: S.lang }) })));
}
function viewCompare() {
  const ps = presets(), cols = compareCols(), base = cols[0].st;
  const Ts = cols.map(c => totals(c.st));
  const swapKeys = [];
  ITEMS.forEach(it => it.components.forEach(c => { if (c.options.length > 1) swapKeys.push([it, c]); }));
  const diffs = swapKeys.filter(([it, c]) => cols.some(col => selOpt(col.st, it, c).id !== selOpt(base, it, c).id));
  const edited = ORDER.map(findItem).filter(it => cols.some(col => itemEdited(col.st, it)));
  const varies = (f) => cols.some(c => c.st[f] !== base[f]);
  const rvDiffs = ITEMS.filter(it => it.revenue && it.revenue.variants && cols.some(col => revOf(col.st, it) !== revOf(base, it)));
  const leftOut = (st) => ORDER.map(findItem).filter(it => !isIn(st, it)).map(it => tx(it.name));
  const anyOut = cols.some(c => leftOut(c.st).length);

  const head = `<tr><th></th>${cols.map(c => `<th class="${c.cur ? "cur" : ""}">${esc(c.name)}</th>`).join("")}</tr>`;
  const row = (label, f) => `<tr><td><b>${label}</b></td>${cols.map((c, i) => `<td>${f(c, i)}</td>`).join("")}</tr>`;
  const rows = [
    row(t("cmp.scenario"), c => esc(scenarioName(c.st))),
    row(t("kpi.total"), (c, i) => money(Ts[i].all)),
    row(t("kpi.net"), (c, i) => money(Ts[i].net)),
    row(t("kpi.payback"), (c, i) => yrs(Ts[i].payback)),
    row(t("upk.kpi"), (c, i) => money(Ts[i].upkeep)),
    row(t("assum.fx"), c => `<span class="num">${nf(c.st.fx)}</span>`),
    varies("duty") ? row(t("cmp.duty"), c => `<span class="num">${rate(c.st.duty)}</span>`) : "",
    varies("vat") ? row(t("cmp.vat"), c => `<span class="num">${rate(c.st.vat)}</span>`) : "",
    varies("remote") ? row(t("cmp.remote"), c => `<span class="num">${rate(c.st.remote)}</span>`) : "",
    varies("guests") ? row(t("cmp.guests"), c => `<span class="num">${nf(c.st.guests)}</span>`) : "",
    anyOut ? row(t("cmp.left"), c => leftOut(c.st).length ? `<small style="color:var(--cost-ink);font-weight:700">${esc(leftOut(c.st).join(", "))}</small>` : "—") : "",
  ].join("");
  const choiceRows = diffs.length ? `<tr class="grp"><td colspan="${cols.length + 1}">${t("cmp.choices")}</td></tr>`
    + diffs.map(([it, c]) => `<tr><td>${esc(tx(it.name))}</td>${cols.map(col => {
        const o = selOpt(col.st, it, c), same = o.id === selOpt(base, it, c).id;
        return `<td class="${same ? "" : "diff"}">${same && col !== cols[0] ? `<small>${t("cmp.same")}</small>` : esc(tx(o.name))}</td>`;
      }).join("")}</tr>`).join("") : "";
  const rvRows = rvDiffs.map(it => `<tr><td>${esc(tx(it.name))} — ${t("rvar.label")}</td>${cols.map(col =>
    `<td class="${revOf(col.st, it) !== revOf(base, it) ? "diff" : ""}">${esc(tx(revOf(col.st, it).name))}</td>`).join("")}</tr>`).join("");
  const costRows = edited.length ? `<tr class="grp"><td colspan="${cols.length + 1}">${t("cmp.costs")}</td></tr>`
    + edited.map(it => `<tr><td>${esc(tx(it.name))}</td>${cols.map(col =>
        `<td class="${itemEdited(col.st, it) ? "diff" : ""}">${moneyText(itemCost(col.st, it))}</td>`).join("")}</tr>`).join("") : "";

  const delta = (v, b) => { const d = v - b; return Math.abs(d) < 1 ? "" : `<small>${d < 0 ? "▼" : "▲"} ${moneyText(Math.abs(d))}</small>`; };
  const cards = cols.map((c, i) => {
    const ch = diffs.filter(([it, cc]) => selOpt(c.st, it, cc).id !== selOpt(base, it, cc).id)
      .map(([it, cc]) => `<div><b>${esc(tx(it.name))}:</b> ${esc(tx(selOpt(c.st, it, cc).name))}</div>`).join("");
    const ce = edited.filter(it => itemEdited(c.st, it)).map(it => `<div><b>${esc(tx(it.name))}:</b> ${moneyText(itemCost(c.st, it))}</div>`).join("");
    const box = (title, body) => body ? `<div class="ch"><div style="font-size:12px;font-weight:800;color:var(--ink-2);margin-bottom:4px">${title}</div>${body}</div>` : "";
    return `<div class="card pad ccard"><h3>${esc(c.name)}</h3><div class="sc">${t("cmp.scenario")}: ${esc(scenarioName(c.st))}</div>
      <div class="m"><span>${t("kpi.total")}</span><div><b>${moneyText(Ts[i].all)}</b>${i ? delta(Ts[i].all, Ts[0].all) : ""}</div></div>
      <div class="m"><span>${t("kpi.net")}</span><div><b>${moneyText(Ts[i].net)}</b>${i ? delta(Ts[i].net, Ts[0].net) : ""}</div></div>
      <div class="m"><span>${t("kpi.payback")}</span><div><b>${Ts[i].payback ? Ts[i].payback.toFixed(1) + " " + t("unit.years") : "—"}</b></div></div>
      <div class="m"><span>${t("upk.kpi")}</span><div><b>${moneyText(Ts[i].upkeep)}</b>${i ? delta(Ts[i].upkeep, Ts[0].upkeep) : ""}</div></div>
      ${box(t("cmp.choices"), ch)}${box(t("cmp.costs"), ce)}${box(t("cmp.left"), leftOut(c.st).map(n => `<div>${esc(n)}</div>`).join(""))}</div>`;
  }).join("");

  return `<div class="wrap"><section>
    <div class="sec-h"><h2>${t("cmp.title")}</h2><p>${t("cmp.sub")}</p><div class="sec-act">${excelBtn()}</div></div>
    ${ps.length ? "" : `<div class="note" style="margin-bottom:12px">${t("cmp.empty")}</div>`}
    <div class="cmp-cards">${cards}</div>
    <div class="card tbl cmp-table"><table><thead>${head}</thead><tbody>${rows}${choiceRows}${rvRows}${costRows}</tbody></table></div>
    ${ps.length ? `<section><div class="sec-h"><h2>${t("cmp.saved")}</h2></div><div class="card pad">${ps.map((p, i) =>
      `<div class="field"><label>${esc(p.name)}<small>${esc(p.when)}</small></label><div class="btns">`
      + `<button type="button" class="btn sm" data-load="${i}">${t("cmp.load")}</button>`
      + `<button type="button" class="btn sm warn" data-del="${i}">${t("cmp.delete")}</button></div></div>`).join("")}</div></section>` : ""}
  </section></div>`;
}

/* ================================================================ render + router */
function route() {
  const h = location.hash.replace(/^#/, "") || "/";
  const qi = h.indexOf("?"), path = qi < 0 ? h : h.slice(0, qi), q = new URLSearchParams(qi < 0 ? "" : h.slice(qi + 1));
  return { path, q };
}
function render() {
  const r = route();
  if (r.q.get("s")) {
    const st = decodeShare(r.q.get("s"));
    history.replaceState(null, "", location.pathname + location.search + "#" + r.path);
    if (st) { S = st; persist(); setTimeout(() => toast(S.lang === "en" ? "Shared scenario loaded" : "Хуваалцсан хувилбарыг нээлээ"), 50); }
  }
  if (UI.lastPath !== r.path) { UI.saving = false; UI.exporting = false; UI.info.clear(); UI.edit.clear(); UI.photoMsg = ""; }
  let html, title = t("site.title");
  if (r.path.startsWith("/item/")) { html = viewItem(r.path.slice(6)); const it = findItem(r.path.slice(6)); if (it) title = tx(it.name) + " · " + title; }
  else if (r.path === "/assumptions") { html = viewAssumptions(); title = t("nav.assumptions") + " · " + title; }
  else if (r.path === "/compare") { html = viewCompare(); title = t("nav.compare") + " · " + title; }
  else html = viewHome();
  $app.innerHTML = html;

  document.title = title + " · Nine Pines Lodge";
  document.documentElement.lang = S.lang;
  const navKey = r.path.startsWith("/item/") ? "/" : r.path;
  document.querySelectorAll("[data-nav]").forEach(a => {
    a.textContent = t({ "/": "nav.home", "/assumptions": "nav.assumptions", "/compare": "nav.compare" }[a.dataset.nav]);
    a.classList.toggle("on", a.dataset.nav === navKey);
    a.toggleAttribute("aria-current", a.dataset.nav === navKey);
  });
  document.querySelectorAll("[data-lang]").forEach(b => { b.classList.toggle("on", b.dataset.lang === S.lang); b.setAttribute("aria-pressed", b.dataset.lang === S.lang); });
  document.getElementById("brand-sub").textContent = t("site.title");
  document.getElementById("burger").setAttribute("aria-label", t("nav.menu"));
  document.getElementById("foot").innerHTML = `<b>${esc(t("foot.lodge"))}</b> · <a href="${esc(SET.lodge.url)}" target="_blank" rel="noopener">ninepines.mn</a>`;
  document.getElementById("nav").classList.remove("open");

  const ph = document.querySelector("[data-photo] > img");
  if (ph) { ph.addEventListener("load", () => ph.parentElement.classList.add("has")); ph.addEventListener("error", () => ph.remove()); if (ph.complete && ph.naturalWidth) ph.parentElement.classList.add("has"); }

  if (UI.lastPath !== r.path) window.scrollTo({ top: 0, behavior: "instant" });   // only on navigation, never on edits
  UI.lastPath = r.path;
  const f = document.querySelector('[data-form="save"] input'); if (f) f.focus();
}
function rerender() { const y = window.scrollY; render(); window.scrollTo({ top: y, behavior: "instant" }); }

function toast(msg) {
  let el = document.getElementById("toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; el.className = "toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
  el.textContent = msg; el.classList.add("show");
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("show"), 2200);
}
function download(name, data, type = "application/json") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/* ================================================================ Excel (loaded only when someone asks for it) */
const loadScript = (src) => new Promise((ok, fail) => {
  const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = fail; document.head.appendChild(s);
});
async function downloadExcel() {
  if (UI.xl) return;
  UI.xl = true; rerender();
  try {
    if (!window.ExcelJS) await loadScript("assets/js/vendor/exceljs.min.js");
    if (!window.NPExcel) await loadScript("assets/js/excel.js?v=" + VER);
    const api = { S, SET, ITEMS, ORDER, t, tx, findItem, selOpt, qtyOf, parVal, isIn, revOf, upkOf, landed, itemCost, itemEdited, econ, rv, totals, scenarioName, compareCols, rate };
    const blob = await window.NPExcel.build(api);
    const d = new Date(), ymd = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    download(`NinePines-Wishlist-2027-${ymd}.xlsx`, blob);
  } catch (e) {
    console.error(e); toast(t("act.excelFail"));
  } finally { UI.xl = false; rerender(); }
}

/* ================================================================ events */
function setCostOverride(k, field, value) {
  if (field === "q") { const c = compByKey(k); if (value === c.quantity) delete S.qty[k]; else S.qty[k] = value; return; }
  const o = optByKey(k), r = S.opt[k] = S.opt[k] || {};
  const dataVal = { a: o.price.amount, or: o.origin, sh: shipDefault(o), rm: o.remote !== false }[field];
  if (value === dataVal) delete r[field]; else r[field] = value;
  if (!Object.keys(r).length) delete S.opt[k];
}

document.addEventListener("click", (e) => {
  const el = e.target.closest("button, a");
  if (!el) return;
  if (el.id === "burger") { const n = document.getElementById("nav"); n.classList.toggle("open"); el.setAttribute("aria-expanded", n.classList.contains("open")); return; }
  if (el.dataset.nav) document.getElementById("nav").classList.remove("open");
  if (el.dataset.ph != null && el.dataset.item) { UI.photoIdx[el.dataset.item] = +el.dataset.ph; rerender(); return; }
  if (el.dataset.phact) { photoAction(el.dataset.phact, el.dataset.item, el.dataset.src); return; }
  if (el.dataset.info) {
    const k = el.dataset.info, on = !UI.info.has(k);
    on ? UI.info.add(k) : UI.info.delete(k);
    document.querySelectorAll(".why").forEach(w => { if (w.dataset.why === k) w.hidden = !on; });
    el.classList.toggle("on", on); el.setAttribute("aria-expanded", on); return;
  }
  if (el.dataset.lang) { S.lang = el.dataset.lang; persist(); rerender(); return; }
  if (el.parentElement && el.parentElement.dataset.acc) {
    const k = el.parentElement.dataset.acc;
    UI.open.has(k) ? UI.open.delete(k) : UI.open.add(k);
    el.parentElement.classList.toggle("open"); el.setAttribute("aria-expanded", UI.open.has(k)); return;
  }
  if (el.dataset.sc) { S.scenario = el.dataset.sc; persist(); rerender(); return; }
  if (el.dataset.opt) { S.sel[el.dataset.key] = el.dataset.opt; UI.photoIdx[el.dataset.key.split("/")[0]] = 0; persist(); rerender(); return; }
  if (el.dataset.origin) { setCostOverride(el.dataset.key, "or", el.dataset.origin); persist(); rerender(); return; }
  if (el.dataset.rvar) {
    const it = findItem(el.dataset.item);
    if (it) {
      if (el.dataset.rvar === it.revenue.variants.find(v => v.default).id) delete S.rvar[it.id]; else S.rvar[it.id] = el.dataset.rvar;
      delete S.custom[it.id];                       // the other version's own numbers apply
      if (S.scenario === "custom") S.custom[it.id] = { price: rv(S, it, "price"), perDay: rv(S, it, "perDay"), days: rv(S, it, "days"), opex: rv(S, it, "opex") };
      persist(); rerender();
    }
    return;
  }
  if (el.dataset.inc) {
    const it = findItem(el.dataset.item), want = el.dataset.inc === "1";
    if (it) { if (want === (it.included !== false)) delete S.inc[it.id]; else S.inc[it.id] = want; persist(); rerender(); }
    return;
  }
  if (el.dataset.remote) { setCostOverride(el.dataset.key, "rm", el.dataset.remote === "1"); persist(); rerender(); return; }
  if (el.dataset.load != null) {
    const p = presets()[+el.dataset.load];
    if (p) { S = sanitize({ ...p.state, lang: S.lang }); persist(); toast(p.name); location.hash = "#/"; }
    return;
  }
  if (el.dataset.del != null) { const ps = presets(); ps.splice(+el.dataset.del, 1); setPresets(ps); rerender(); return; }
  const act = el.dataset.act;
  if (!act) return;
  if (act === "undo-custom") { S.scenario = S.customBase || SET.defaultScenario; S.custom = {}; S.customBase = null; persist(); rerender(); }
  else if (act === "edit-cost") { const id = el.dataset.item; UI.edit.has(id) ? UI.edit.delete(id) : UI.edit.add(id); rerender(); }
  else if (act === "restore") {
    const it = findItem(el.dataset.item);
    if (it) { editKeys(S, it).forEach(k => { delete S.qty[k]; delete S.opt[k]; delete S.par[k]; delete S.upk[k]; }); persist(); rerender(); }
  }
  else if (act === "excel") downloadExcel();
  else if (act === "photos") { UI.photos = !UI.photos; phNote(""); if (UI.photos) photoServerCheck().then(rerender); rerender(); }
  else if (act === "save-open") { UI.saving = !UI.saving; UI.exporting = false; rerender(); }
  else if (act === "save-close") { UI.saving = false; rerender(); }
  else if (act === "export-open" && IS_LOCAL) { UI.exporting = !UI.exporting; UI.saving = false; rerender(); }
  else if (act === "reset") {
    if (confirm(t("act.resetConfirm"))) { const lang = S.lang; S = sanitize({ lang }); persist(); rerender(); }
  }
  else if (act === "share") {
    const url = location.origin + location.pathname + "#/?s=" + encodeShare(S);
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(url).then(() => toast(t("act.copied")), () => prompt("", url));
    else prompt("", url);
  }
  else if (act === "export-items" && IS_LOCAL) {
    const slot = document.getElementById("x-slot").value;
    const doc = JSON.parse(JSON.stringify(RAW));
    doc.items.forEach(it => {
      const pv = parVals(S, it);
      it.components.forEach(c => {
        const id = selOpt(S, it, c).id;
        if (!isFormula(c) || S.qty[it.id + "/" + c.id] != null) c.quantity = qtyOf(S, it, c);
        c.options.forEach(o => {
          const v = optVals(S, it, c, o);
          o.default = o.id === id; o.price.amount = v.amount; o.origin = v.origin; o.shipping = v.shipping;
          if (v.remote) delete o.remote; else o.remote = false;
        });
      });
      (it.params || []).forEach(p => { p.value = pv[p.id]; });
      if (isIn(S, findItem(it.id))) delete it.included; else it.included = false;
      if (it.upkeep && S.upk[it.id + "/upkeep"] != null) it.upkeep.perYear = S.upk[it.id + "/upkeep"];
      if (it.revenue) {
        const cur = revOf(S, it);                    // it is the exported copy; revOf only reads ids, so this finds the copy's variant
        cur.scenarios[slot] = { price: rv(S, it, "price"), perDay: rv(S, it, "perDay"), days: rv(S, it, "days"), opex: rv(S, it, "opex") };
        if (it.revenue.variants) it.revenue.variants.forEach(v => { if (v === cur) v.default = true; else delete v.default; });
      }
    });
    download("items.json", JSON.stringify(doc, null, 2) + "\n");
  }
  else if (act === "export-settings" && IS_LOCAL) {
    const doc = JSON.parse(JSON.stringify(SET)); doc.fx = S.fx; doc.customsDuty = S.duty; doc.vat = S.vat; doc.remotePremium = S.remote; doc.guestNights = S.guests;
    download("settings.json", JSON.stringify(doc, null, 2) + "\n");
  }
});

document.addEventListener("submit", (e) => {
  if (e.target.dataset.form === "photo-url") { e.preventDefault(); addFromUrl(e.target.dataset.item, e.target.u.value); return; }
  if (e.target.dataset.form !== "save") return;
  e.preventDefault();
  const name = e.target.nm.value.trim(); if (!name) return;
  const ps = presets();
  ps.push({ name, when: new Date().toLocaleDateString(S.lang === "mn" ? "mn-MN" : "en-GB"), state: JSON.parse(JSON.stringify(S)) });
  setPresets(ps); UI.saving = false; toast(t("act.saved") + ": " + name); location.hash = "#/compare";
});

document.addEventListener("change", (e) => {
  const el = e.target, v = parseIn(el.value);
  if (el.dataset.phtarget) { UI.photoTarget[el.dataset.phtarget] = el.value; return; }
  if (el.dataset.phtag) { photoAction("tag", el.dataset.phtag, el.dataset.src, el.value); return; }
  if (el.dataset.photoFile) { const fs = [...el.files]; el.value = ""; if (fs.length) addPhotos(el.dataset.photoFile, fs); return; }
  if (el.dataset.selkey) { S.sel[el.dataset.selkey] = el.value; persist(); rerender(); return; }
  if (el.dataset.glob) {
    if (el.dataset.pct) { if (v >= 0 && v <= 100) { S[el.dataset.glob] = v / 100; persist(); } }
    else if (v > 0) { S[el.dataset.glob] = v; persist(); }
    rerender(); return;
  }
  if (el.dataset.upk) {
    const it = findItem(el.dataset.upk.split("/")[0]);
    if (it && v >= 0) { if (v === upkBase(S, it)) delete S.upk[el.dataset.upk]; else S.upk[el.dataset.upk] = v; persist(); }
    rerender(); return;
  }
  if (el.dataset.par) {
    const p = parByKey(el.dataset.par);
    if (p && v >= 0) { if (v === p.value) delete S.par[el.dataset.par]; else S.par[el.dataset.par] = v; persist(); }
    rerender(); return;
  }
  if (el.dataset.cost) {
    if (v >= 0) { setCostOverride(el.dataset.key, el.dataset.cost, el.dataset.cost === "sh" ? v / 100 : v); persist(); }
    rerender(); return;
  }
  if (el.dataset.rev) {
    if (!(v >= 0)) { rerender(); return; }
    if (S.scenario !== "custom") {        // seed Custom from whatever is showing, so nothing jumps
      const from = S.scenario;
      ITEMS.filter(i => i.revenue).forEach(i => {
        S.custom[i.id] = { price: rv(S, i, "price"), perDay: rv(S, i, "perDay"), days: rv(S, i, "days"), opex: rv(S, i, "opex") };
      });
      S.customBase = from; S.scenario = "custom";
    }
    S.custom[el.dataset.item][el.dataset.rev] = v;
    persist(); rerender();
  }
});
/* photos: drag & drop onto the panel, or paste an image / an image link anywhere while the panel is open */
const dropItem = (e) => { const z = e.target.closest && e.target.closest("[data-drop]"); return z ? z.dataset.drop : null; };
document.addEventListener("dragover", (e) => { if (dropItem(e)) { e.preventDefault(); e.target.closest("[data-drop]").classList.add("over"); } });
document.addEventListener("dragleave", (e) => { const z = e.target.closest && e.target.closest("[data-drop]"); if (z) z.classList.remove("over"); });
document.addEventListener("drop", (e) => {
  const id = dropItem(e); if (!id) return;
  e.preventDefault();
  const fs = [...(e.dataTransfer.files || [])].filter(f => f.size);
  if (fs.length) { addPhotos(id, fs); return; }
  const link = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
  if (link) addFromUrl(id, link.split("\n")[0]);
});
document.addEventListener("paste", (e) => {
  if (!UI.photos || !IS_LOCAL) return;
  const m = route().path.match(/^\/item\/(.+)$/); if (!m) return;
  if (e.target.matches && e.target.matches("input:not([data-photo-file]), textarea")) return;
  const fs = [...(e.clipboardData.files || [])];
  if (fs.length) { e.preventDefault(); addPhotos(m[1], fs); return; }
  const txt = e.clipboardData.getData("text"); if (/^https?:\/\//i.test(txt.trim())) { e.preventDefault(); addFromUrl(m[1], txt); }
});
document.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("[data-drop]")) e.target.querySelector("input").click(); });
document.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches(".field input")) e.target.blur(); });
})();
