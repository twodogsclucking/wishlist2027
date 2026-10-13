/* Nine Pines Lodge — Wishlist 2027: "Download Excel".
   Loaded on demand (with vendor/exceljs.min.js) the first time someone presses the button.
   Builds the person's current model as a workbook: gold cells are inputs, every total is a live formula,
   so it keeps working when they change numbers in Excel. Language = whatever the site is showing. */
(function () {
"use strict";

const C = { green: "FF112D16", green3: "FF2A5532", gold: "FFC4B741", goldBg: "FFF8F2CD", linen: "FFE6E2D6", linen2: "FFF6F4EE",
            line: "FFDCD7C8", ink: "FF333333", ink2: "FF5C6157", ink3: "FF8A8D83", white: "FFFFFFFF", earn: "FF0A6A5F", cost: "FF97500F" };
const fill = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const side = (argb, style = "thin") => ({ style, color: { argb } });
const box = (argb) => ({ top: side(argb), left: side(argb), bottom: side(argb), right: side(argb) });
const qs = (s) => `"${String(s).replace(/"/g, '""')}"`;           // a text literal inside a formula
const ref = (ws) => `'${ws.name.replace(/'/g, "''")}'!`;            // sheet prefix, always quoted (Cyrillic names)

window.NPExcel = { build };

/* "ceil(length / 5)" → "ROUNDUP(boardwalk_length/5,0)" using the item's named dimension cells */
function xlFormula(it, f, PNAME) {
  const tk = String(f).match(/[0-9]*\.?[0-9]+|[A-Za-z_]\w*|[-+*\/(),]/g) || [];
  const MAP = { ceil: ["ROUNDUP", ",0"], floor: ["ROUNDDOWN", ",0"], round: ["ROUND", ",0"], max: ["MAX", ""], min: ["MIN", ""] };
  const stack = []; let out = "";
  for (let i = 0; i < tk.length; i++) {
    const x = tk[i];
    if (MAP[x] && tk[i + 1] === "(") { out += MAP[x][0] + "("; stack.push(MAP[x][1]); i++; continue; }
    if (x === "(") { out += "("; stack.push(""); continue; }
    if (x === ")") { out += stack.pop() + ")"; continue; }
    if (/^[A-Za-z_]/.test(x)) { out += PNAME[it.id + "/" + x]; continue; }
    out += x;
  }
  return "MAX(0," + out + ")";
}

async function build(A) {
  const { S, SET, t, tx } = A;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Nine Pines Lodge"; wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;

  const F = { mnt: '#,##0" ₮"', usd: '"$"#,##0', pct: "0.0%", int: "#,##0", dec: "#,##0.0#", yrs: `0.0" ${t("unit.years").replace(/"/g, "")}"` };
  const IMP = t("cost.import"), LOC = t("cost.local"), LOSS = t("pb.loss"), YES = t("cost.yes"), NO = t("cost.no");
  const T = A.totals(S);
  const ORD = A.ORDER.filter(id => !A.findItem(id).funding);          // partner-funded items are not ours: left out of the workbook
  const d0 = new Date(), today = d0.getFullYear() + "-" + String(d0.getMonth() + 1).padStart(2, "0") + "-" + String(d0.getDate()).padStart(2, "0");

  const cols = A.compareCols();
  const withCmp = cols.length > 2;
  const sh = {
    sum: wb.addWorksheet(t("xl.sSummary"), { properties: { tabColor: { argb: C.green } } }),
    asm: wb.addWorksheet(t("xl.sAssum"), { properties: { tabColor: { argb: C.gold } } }),
    cst: wb.addWorksheet(t("xl.sCosts"), { properties: { tabColor: { argb: C.green3 } } }),
    rev: wb.addWorksheet(t("xl.sRev"), { properties: { tabColor: { argb: C.green3 } } }),
  };
  if (withCmp) sh.cmp = wb.addWorksheet(t("xl.sCmp"), { properties: { tabColor: { argb: C.gold } } });
  Object.values(sh).forEach(ws => {
    ws.views = [{ showGridLines: false }];
    ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: .4, right: .4, top: .5, bottom: .5, header: .3, footer: .3 } };
    ws.properties.defaultRowHeight = 18;
  });

  /* ---------- shared styling helpers ---------- */
  function titleBlock(ws, title, lastCol) {
    ws.getCell("A1").value = title;
    ws.getCell("A1").font = { size: 17, bold: true, color: { argb: C.green } };
    ws.getRow(1).height = 28;
    ws.getCell("A2").value = t("xl.made", { date: today, sc: A.scenarioName(S) });
    ws.getCell("A2").font = { size: 10, color: { argb: C.ink2 } };
    const h = ws.getCell("A3");
    h.value = "  " + t("xl.howto");
    h.font = { size: 10, italic: true, color: { argb: "FF6B5F10" } };
    for (let c = 1; c <= lastCol; c++) ws.getRow(3).getCell(c).fill = fill(C.goldBg);
  }
  function header(ws, r, labels) {
    const row = ws.getRow(r);
    labels.forEach((l, i) => {
      const c = row.getCell(i + 1);
      c.value = l;
      c.font = { bold: true, size: 10.5, color: { argb: C.white } };
      c.fill = fill(C.green);
      c.alignment = { vertical: "middle", horizontal: i ? "center" : "left", wrapText: true, indent: i ? 0 : 1 };
      c.border = { bottom: side(C.gold, "medium") };
    });
    row.height = 36;
  }
  function band(ws, r, n, zebra) {
    for (let c = 1; c <= n; c++) {
      const cell = ws.getRow(r).getCell(c);
      if (zebra) cell.fill = fill(C.linen2);
      cell.border = { bottom: side(C.line) };
      cell.alignment = Object.assign({ vertical: "top" }, cell.alignment || {});
    }
  }
  function input(cell, fmt) {
    cell.fill = fill(C.goldBg);
    cell.border = box(C.gold);
    cell.font = { bold: true, color: { argb: C.green } };
    if (fmt) cell.numFmt = fmt;
  }
  function totalRow(ws, r, n) {
    for (let c = 1; c <= n; c++) {
      const cell = ws.getRow(r).getCell(c);
      cell.fill = fill(C.linen);
      cell.font = { bold: true, color: { argb: C.green } };
      cell.border = { top: side(C.green, "medium"), bottom: side(C.green, "medium") };
    }
    ws.getRow(r).height = 22;
  }
  const fx = (formula, result, fmt) => ({ v: { formula, result }, fmt });
  const put = (row, col, val, fmt, extra) => {
    const c = row.getCell(col);
    c.value = val && val.v ? val.v : val;
    if (fmt || (val && val.fmt)) c.numFmt = fmt || val.fmt;
    if (extra) Object.assign(c, extra);
    return c;
  };
  const wrapTop = { alignment: { wrapText: true, vertical: "top" } };

  /* ================= Assumptions ================= */
  const as = sh.asm;
  titleBlock(as, t("xl.sAssum"), 3);
  header(as, 5, [t("assum.global"), t("xl.value"), t("xl.notes")]);
  const aRows = [
    ["scenario", t("assum.scenario"), A.scenarioName(S), null, t("why.scenario")],
    ["FX", t("assum.fx"), S.fx, F.int, t("why.fx")],
    ["Duty", t("assum.duty"), S.duty, F.pct, t("why.duty")],
    ["VAT", t("assum.vat"), S.vat, F.pct, t("why.vat")],
    ["Remote", t("assum.remote"), S.remote, F.pct, t("why.remote", { pct: A.rate(S.remote) })],
    ["Guests", t("assum.guests"), S.guests, F.int, t("why.guests")],
    ["ship", t("cost.shipping"), t("xl.sCosts") + " →", null, t("why.shipping")],
  ];
  const NAME = {};
  aRows.forEach((d, i) => {
    const r = 6 + i, row = as.getRow(r);
    put(row, 1, d[1], null, { font: { bold: true, color: { argb: C.ink } } });
    const v = put(row, 2, d[2], d[3]);
    put(row, 3, d[4], null, wrapTop);
    band(as, r, 3, i % 2 === 1);
    if (["FX", "Duty", "VAT", "Remote", "Guests"].includes(d[0])) {
      input(v, d[3]);
      v.name = d[0];                                     // defined name used by every formula: FX, Duty, VAT, Guests
      NAME[d[0]] = `${ref(as)}$B$${r}`;
    } else v.font = { bold: true, color: { argb: C.ink2 } };
    v.alignment = { horizontal: "right", vertical: "top" };
  });
  /* item dimensions: one named input cell each, used by the quantity formulas on the Costs sheet */
  const PNAME = {};
  const parItems = ORD.map(A.findItem).filter(it => (it.params || []).length);
  if (parItems.length) {
    let pr = 6 + aRows.length + 1;
    header(as, pr, [t("xl.dims"), t("xl.value"), t("xl.notes")]); pr++;
    let zz = 0;
    parItems.forEach(it => it.params.forEach(p => {
      const row = as.getRow(pr), nm = (it.id + "_" + p.id).replace(/-/g, "_");
      put(row, 1, tx(it.name) + " — " + tx(p.name) + (p.unit ? " (" + tx(p.unit) + ")" : ""), null, { font: { bold: true, color: { argb: C.ink } } });
      const v = put(row, 2, A.parVal(S, it, p), Number.isInteger(A.parVal(S, it, p)) ? F.int : F.dec);
      put(row, 3, p.basis ? tx(p.basis) : "", null, wrapTop);
      band(as, pr, 3, zz++ % 2 === 1);
      input(v, Number.isInteger(A.parVal(S, it, p)) ? F.int : F.dec); v.alignment = { horizontal: "right", vertical: "top" };
      v.name = nm; PNAME[it.id + "/" + p.id] = nm;
      pr++;
    }));
  }
  as.getColumn(1).width = 30; as.getColumn(2).width = 16; as.getColumn(3).width = 100;

  /* ================= Costs ================= */
  const cs = sh.cst;
  const CC = 22;
  titleBlock(cs, t("xl.sCosts"), CC);
  const cH = 5;
  header(cs, cH, [t("xl.item"), t("xl.category"), t("xl.status"), t("xl.component"), t("xl.option"), t("item.qty"), t("xl.unit"),
    t("item.unitPrice"), t("xl.currency"), t("cost.origin"), t("cost.shipPct"), t("cost.remoteAdd"), t("xl.priceMNT"), t("cost.shipping") + " ₮",
    t("cost.duty") + " ₮", t("cost.vat") + " ₮", t("cost.remote") + " ₮", t("xl.total"), t("xl.included"), t("xl.conf"), t("xl.priceBasis"), t("xl.qtyBasis")]);
  let r = cH + 1;
  const cFirst = r;
  let zi = 0;
  ORD.forEach(id => {
    const it = A.findItem(id), cat = SET.categories.find(c => c.id === it.category);
    it.components.forEach(c => {
      const L = A.landed(S, it, c), o = L.o, v = L.v, row = cs.getRow(r), imp = v.origin === "import";
      const src = SET.sources.find(s => s.id === o.source);
      put(row, 1, tx(it.name), null, { font: { bold: true, color: { argb: C.green } } });
      put(row, 2, tx(cat.name)); put(row, 3, t("status." + it.earns));
      put(row, 4, it.components.length > 1 ? tx(c.name) : "");
      put(row, 5, tx(o.name), null, wrapTop);
      const qf = typeof c.quantity === "string" && S.qty[it.id + "/" + c.id] == null ? xlFormula(it, c.quantity, PNAME) : null;
      put(row, 6, qf ? fx(qf, L.q) : L.q, Number.isInteger(L.q) ? F.int : F.dec);
      put(row, 7, c.unit ? tx(c.unit) : "");
      put(row, 8, v.amount, v.currency === "USD" ? F.usd : F.mnt);
      put(row, 9, v.currency);
      put(row, 10, imp ? IMP : LOC);
      put(row, 11, v.shipping, F.pct);
      put(row, 12, v.remote ? YES : NO);
      put(row, 13, fx(`F${r}*H${r}*IF(I${r}="USD",FX,1)`, L.base), F.mnt);
      put(row, 14, fx(`IF(J${r}=${qs(IMP)},M${r}*K${r},0)`, L.ship), F.mnt);
      put(row, 15, fx(`IF(J${r}=${qs(IMP)},(M${r}+N${r})*Duty,0)`, L.duty), F.mnt);
      put(row, 16, fx(`IF(J${r}=${qs(IMP)},(M${r}+N${r}+O${r})*VAT,0)`, L.vat), F.mnt);
      put(row, 17, fx(`IF(L${r}=${qs(YES)},(M${r}+N${r}+O${r}+P${r})*Remote,0)`, L.rem), F.mnt);
      const inc = A.isIn(S, it);
      put(row, 18, fx(`IF(S${r}=${qs(YES)},SUM(M${r}:Q${r}),0)`, inc ? L.total : 0), F.mnt, { font: { bold: true, color: { argb: C.green } } });
      put(row, 19, inc ? YES : NO);
      put(row, 20, src ? t("conf." + src.confidence) : "");
      put(row, 21, tx(o.basis), null, wrapTop);
      put(row, 22, c.quantityBasis ? tx(c.quantityBasis) : "", null, wrapTop);
      band(cs, r, CC, zi++ % 2 === 1);
      [6, 8, 10, 11, 12, 19].forEach(k => input(row.getCell(k)));
      row.getCell(19).dataValidation = { type: "list", allowBlank: false, formulae: [qs(YES + "," + NO)],
        showErrorMessage: true, errorTitle: t("xl.included"), error: YES + " / " + NO };
      row.getCell(10).dataValidation = { type: "list", allowBlank: false, formulae: [qs(LOC + "," + IMP)],
        showErrorMessage: true, errorTitle: t("cost.origin"), error: LOC + " / " + IMP };
      row.getCell(12).dataValidation = { type: "list", allowBlank: false, formulae: [qs(YES + "," + NO)],
        showErrorMessage: true, errorTitle: t("cost.remoteAdd"), error: YES + " / " + NO };
      r++;
    });
  });
  const cLast = r - 1, cTot = r;
  const cT = cs.getRow(cTot);
  put(cT, 1, t("xl.totalRow"));
  const sums = { M: 0, N: 0, O: 0, P: 0, Q: 0, R: 0 };
  ORD.forEach(id => { const it = A.findItem(id); it.components.forEach(c => { const L = A.landed(S, it, c);
    sums.M += L.base; sums.N += L.ship; sums.O += L.duty; sums.P += L.vat; sums.Q += L.rem; sums.R += A.isIn(S, it) ? L.total : 0; }); });
  ["M", "N", "O", "P", "Q", "R"].forEach((col, i) => put(cT, 13 + i, fx(`SUM(${col}${cFirst}:${col}${cLast})`, sums[col]), F.mnt));
  totalRow(cs, cTot, CC);
  [32, 16, 15, 16, 30, 8, 7, 13, 8, 11, 10, 12, 15, 13, 13, 13, 13, 16, 11, 15, 70, 48].forEach((w, i) => { cs.getColumn(i + 1).width = w; });
  cs.views = [{ state: "frozen", xSplit: 1, ySplit: cH, showGridLines: false }];
  cs.autoFilter = { from: { row: cH, column: 1 }, to: { row: cLast, column: CC } };
  const CR = (col) => `${ref(cs)}$${col}$${cFirst}:$${col}$${cLast}`;   // a whole data column on the Costs sheet

  /* ================= Revenue ================= */
  const rs = sh.rev;
  const RC = 14;
  titleBlock(rs, t("xl.sRev"), RC);
  const rH = 5;
  header(rs, rH, [t("xl.item"), t("xl.unit"), t("item.price") + " ₮", t("item.perDay"), t("item.days"), t("item.opex") + " ₮",
    t("item.gross") + " ₮", t("item.net") + " ₮", t("xl.capexShare"), t("xl.invest"), t("item.payback"), t("item.attach"), t("xl.included"), t("xl.salesBasis")]);
  r = rH + 1;
  const rFirst = r;
  const revItems = ORD.map(A.findItem).filter(i => i.revenue);
  revItems.forEach((it, i) => {
    const e = A.econ(S, it), row = rs.getRow(r);
    put(row, 1, tx(it.name), null, { font: { bold: true, color: { argb: C.green } } });
    const rvo = A.revOf(S, it);
    put(row, 2, tx(rvo.unit) + (it.revenue.variants ? " (" + tx(rvo.name) + ")" : ""), null, wrapTop);
    put(row, 3, A.rv(S, it, "price"), F.mnt);
    put(row, 4, A.rv(S, it, "perDay"), F.dec);
    put(row, 5, A.rv(S, it, "days"), F.int);
    put(row, 6, A.rv(S, it, "opex"), F.mnt);
    const inc = A.isIn(S, it);
    put(row, 7, fx(`IF(M${r}=${qs(YES)},C${r}*D${r}*E${r},0)`, inc ? e.gross : 0), F.mnt);
    put(row, 8, fx(`IF(M${r}=${qs(YES)},G${r}-F${r},0)`, inc ? e.net : 0), F.mnt, { font: { bold: true, color: { argb: e.net < 0 ? C.cost : C.green } } });
    put(row, 9, it.revenue.capexShare, "0%");
    put(row, 10, fx(`SUMIF(${CR("A")},A${r},${CR("R")})*I${r}`, inc ? e.capex : 0), F.mnt);
    put(row, 11, fx(`IF(M${r}<>${qs(YES)},"—",IF(H${r}>0,J${r}/H${r},${qs(LOSS)}))`, !inc ? "—" : e.loss ? LOSS : e.payback), F.yrs, { font: { bold: true, color: { argb: C.green } } });
    put(row, 12, it.revenue.attachApplies ? fx(`IF(M${r}=${qs(YES)},D${r}*E${r}/Guests,"—")`, inc ? e.attach : "—") : "—", F.pct);
    put(row, 13, fx(`IF(COUNTIFS(${CR("A")},A${r},${CR("S")},${qs(YES)})>0,${qs(YES)},${qs(NO)})`, inc ? YES : NO));
    put(row, 14, tx(rvo.basis), null, wrapTop);
    band(rs, r, RC, i % 2 === 1);
    [3, 4, 5, 6].forEach(k => input(row.getCell(k)));
    [11, 12, 13].forEach(k => { row.getCell(k).alignment = { horizontal: "right", vertical: "top" }; });
    r++;
  });
  const rLast = r - 1, rTot = r, rT = rs.getRow(rTot);
  put(rT, 1, t("xl.totalRow"));
  put(rT, 6, fx(`SUMIF(M${rFirst}:M${rLast},${qs(YES)},F${rFirst}:F${rLast})`, T.opex), F.mnt);
  put(rT, 7, fx(`SUM(G${rFirst}:G${rLast})`, T.gross), F.mnt);
  put(rT, 8, fx(`SUM(H${rFirst}:H${rLast})`, T.net), F.mnt);
  put(rT, 10, fx(`SUM(J${rFirst}:J${rLast})`, T.capex), F.mnt);
  put(rT, 11, fx(`IF(H${rTot}>0,J${rTot}/H${rTot},${qs(LOSS)})`, T.payback == null ? LOSS : T.payback), F.yrs);
  totalRow(rs, rTot, RC);
  rT.getCell(11).alignment = { horizontal: "right" };
  [30, 18, 13, 11, 11, 15, 16, 16, 10, 16, 12, 11, 11, 90].forEach((w, i) => { rs.getColumn(i + 1).width = w; });
  rs.views = [{ state: "frozen", xSplit: 1, ySplit: rH, showGridLines: false }];
  /* yearly running costs of cost-only items: gold inputs, counted only if the item is included (Costs sheet) */
  const upItems = ORD.map(A.findItem).filter(it => it.upkeep);
  let uTot = null;
  if (upItems.length) {
    let ur = rTot + 3;
    header(rs, ur, [t("upk.title"), t("upk.label") + " ₮", t("upk.counted") + " ₮", t("xl.notes")]);
    const uFirst = ++ur;
    upItems.forEach((it, i) => {
      const row = rs.getRow(ur), v = A.upkOf(S, it), inc = A.isIn(S, it);
      put(row, 1, tx(it.name), null, { font: { bold: true, color: { argb: C.green } } });
      input(put(row, 2, v, F.mnt), F.mnt);
      put(row, 3, fx(`IF(COUNTIFS(${CR("A")},A${ur},${CR("S")},${qs(YES)})>0,B${ur},0)`, inc ? v : 0), F.mnt);
      put(row, 4, tx(it.upkeep.basis), null, wrapTop);
      band(rs, ur, 4, i % 2 === 1);
      ur++;
    });
    const row = rs.getRow(ur);
    put(row, 1, t("xl.totalRow"));
    put(row, 3, fx(`SUM(C${uFirst}:C${ur - 1})`, T.upkeep), F.mnt);
    totalRow(rs, ur, 4);
    uTot = ur;
  }

  /* ================= Summary ================= */
  const ss = sh.sum;
  titleBlock(ss, t("xl.title"), 3);
  header(ss, 5, [t("site.title"), t("xl.value"), ""]);
  const kpis = [
    [t("kpi.total"), fx(`${ref(cs)}R${cTot}`, T.all), F.mnt],
    [t("kpi.items"), T.nIn, F.int],
    [t("xl.grossYr"), fx(`${ref(rs)}G${rTot}`, T.gross), F.mnt],
    [t("xl.opexYr"), fx(`${ref(rs)}F${rTot}`, T.opex), F.mnt],
    ...(uTot ? [[t("upk.kpi"), fx(`${ref(rs)}C${uTot}`, T.upkeep), F.mnt]] : []),
    [t("kpi.net"), fx(`${ref(rs)}H${rTot}`, T.net), F.mnt],
    [t("xl.investRev"), fx(`${ref(rs)}J${rTot}`, T.capex), F.mnt],
    [t("kpi.payback"), fx(`${ref(rs)}K${rTot}`, T.payback == null ? LOSS : T.payback), F.yrs],
    [t("assum.scenario"), A.scenarioName(S), null],
  ];
  kpis.forEach((k, i) => {
    const row = ss.getRow(6 + i);
    put(row, 1, k[0], null, { font: { bold: true, color: { argb: C.ink } } });
    const c = put(row, 2, k[1], k[2]);
    c.font = { bold: true, size: [t("kpi.total"), t("kpi.net"), t("kpi.payback")].includes(k[0]) ? 13 : 11, color: { argb: C.green } };
    c.alignment = { horizontal: "right" };
    band(ss, 6 + i, 3, i % 2 === 1);
    row.height = 21;
  });
  const sumTotal = `$B$6`;
  let sr = 6 + kpis.length + 1;
  function breakdownTable(title, rows, critCol) {
    header(ss, sr, [title, t("xl.total"), t("xl.share")]);
    const first = ++sr;
    rows.forEach((d, i) => {
      const row = ss.getRow(sr);
      put(row, 1, d.label);
      put(row, 2, fx(`SUMIF(${CR(critCol)},A${sr},${CR("R")})`, d.value), F.mnt);
      put(row, 3, fx(`IF(${sumTotal}=0,0,B${sr}/${sumTotal})`, T.all ? d.value / T.all : 0), F.pct);
      band(ss, sr, 3, i % 2 === 1);
      sr++;
    });
    const row = ss.getRow(sr);
    put(row, 1, t("xl.totalRow"));
    put(row, 2, fx(`SUM(B${first}:B${sr - 1})`, rows.reduce((s, d) => s + d.value, 0)), F.mnt);
    put(row, 3, fx(`IF(${sumTotal}=0,0,B${sr}/${sumTotal})`, 1), F.pct);
    totalRow(ss, sr, 3);
    sr += 2;
  }
  const cats = SET.categories.filter(c => T.cat[c.id]).sort((a, b) => T.cat[b.id] - T.cat[a.id]);
  breakdownTable(t("xl.byCat"), cats.map(c => ({ label: tx(c.name), value: T.cat[c.id] })), "B");
  breakdownTable(t("xl.byStatus"), ["yes", "partial", "no"].filter(k => T.status[k]).map(k => ({ label: t("status." + k), value: T.status[k] })), "C");
  ss.getColumn(1).width = 40; ss.getColumn(2).width = 20; ss.getColumn(3).width = 12;

  /* ================= Comparison (only when there are saved scenarios) ================= */
  if (withCmp) {
    const ws = sh.cmp, n = cols.length + 1;
    titleBlock(ws, t("xl.sCmp"), n);
    ws.getCell("A3").value = "  " + t("xl.cmpNote");
    for (let c = 1; c <= n; c++) ws.getRow(3).getCell(c).fill = fill(C.linen2);
    ws.getCell("A3").font = { size: 10, italic: true, color: { argb: C.ink2 } };
    header(ws, 5, [""].concat(cols.map(c => c.name)));
    const Ts = cols.map(c => A.totals(c.st));
    let cr = 6, zi2 = 0;
    const line = (label, vals, fmt, diffOf) => {
      const row = ws.getRow(cr);
      put(row, 1, label, null, { font: { bold: true, color: { argb: C.ink } } });
      vals.forEach((v, i) => {
        const c = put(row, i + 2, v, fmt);
        c.alignment = { horizontal: "right", vertical: "top", wrapText: true };
      });
      band(ws, cr, n, zi2++ % 2 === 1);
      if (diffOf) vals.forEach((v, i) => { if (i > 0 && diffOf(i)) ws.getRow(cr).getCell(i + 2).fill = fill(C.goldBg); });
      cr++;
    };
    const group = (label) => {
      const row = ws.getRow(cr);
      put(row, 1, label);
      for (let c = 1; c <= n; c++) { row.getCell(c).fill = fill(C.linen); row.getCell(c).font = { bold: true, size: 10, color: { argb: C.ink2 } }; }
      cr++; zi2 = 0;
    };
    line(t("cmp.scenario"), cols.map(c => A.scenarioName(c.st)));
    line(t("kpi.total"), Ts.map(x => Math.round(x.all)), F.mnt, i => Math.abs(Ts[i].all - Ts[0].all) >= 1);
    line(t("kpi.net"), Ts.map(x => Math.round(x.net)), F.mnt, i => Math.abs(Ts[i].net - Ts[0].net) >= 1);
    line(t("kpi.payback"), Ts.map(x => x.payback == null ? LOSS : x.payback), F.yrs);
    line(t("upk.kpi"), Ts.map(x => Math.round(x.upkeep)), F.mnt, i => Math.abs(Ts[i].upkeep - Ts[0].upkeep) >= 1);
    line(t("assum.fx"), cols.map(c => c.st.fx), F.int, i => cols[i].st.fx !== cols[0].st.fx);
    line(t("cmp.duty"), cols.map(c => c.st.duty), F.pct, i => cols[i].st.duty !== cols[0].st.duty);
    line(t("cmp.vat"), cols.map(c => c.st.vat), F.pct, i => cols[i].st.vat !== cols[0].st.vat);
    line(t("cmp.remote"), cols.map(c => c.st.remote), F.pct, i => cols[i].st.remote !== cols[0].st.remote);
    line(t("cmp.guests"), cols.map(c => c.st.guests), F.int, i => cols[i].st.guests !== cols[0].st.guests);
    const left = (st) => ORD.map(A.findItem).filter(it => !A.isIn(st, it)).map(it => tx(it.name)).join(", ");
    if (cols.some(c => left(c.st))) line(t("cmp.left"), cols.map(c => left(c.st) || "—"), null, i => left(cols[i].st) !== left(cols[0].st));
    const base = cols[0].st, swaps = [];
    ORD.map(A.findItem).forEach(it => it.components.forEach(c => { if (c.options.length > 1) swaps.push([it, c]); }));
    const diffs = swaps.filter(([it, c]) => cols.some(col => A.selOpt(col.st, it, c).id !== A.selOpt(base, it, c).id));
    if (diffs.length) {
      group(t("cmp.choices"));
      diffs.forEach(([it, c]) => line(tx(it.name), cols.map(col => tx(A.selOpt(col.st, it, c).name)), null,
        i => A.selOpt(cols[i].st, it, c).id !== A.selOpt(base, it, c).id));
    }
    const edited = ORD.map(A.findItem).filter(it => cols.some(col => A.itemEdited(col.st, it)));
    if (edited.length) {
      group(t("cmp.costs"));
      edited.forEach(it => line(tx(it.name), cols.map(col => Math.round(A.itemCost(col.st, it))), F.mnt, i => A.itemEdited(cols[i].st, it)));
    }
    ws.getColumn(1).width = 34;
    for (let c = 2; c <= n; c++) ws.getColumn(c).width = 24;
    ws.views = [{ state: "frozen", xSplit: 1, ySplit: 5, showGridLines: false }];
  }

  wb.views = [{ activeTab: 0 }];
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
})();
