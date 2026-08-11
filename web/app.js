const TICKERS = [
  { symbol: "SPY", name: "SPDR S&P 500", color: "#0D9488" },
  { symbol: "QQQ", name: "Invesco QQQ", color: "#2563EB" },
  { symbol: "IWM", name: "iShares Russell", color: "#0F172A" },
  { symbol: "GLD", name: "SPDR Gold", color: "#D97706" },
  { symbol: "SPX", name: "S&P 500 Index", color: "#7C3AED" },
];

const state = {
  ticker: "SPY", days: "2", strikes: "30",
  expiration: null, showDelta: false, dark: false, cache: {}, livePrice: null,
};

const $ = (sel) => document.querySelector(sel);

function dataUrl(ticker) {
  const base = document.body.dataset.dataBase || "../data";
  return base + "/" + ticker + ".json?t=" + Date.now();
}

async function loadTicker(ticker) {
  if (state.cache[ticker]) return state.cache[ticker];
  const res = await fetch(dataUrl(ticker));
  if (!res.ok) throw new Error("تعذر تحميل بيانات " + ticker);
  const json = await res.json();
  state.cache[ticker] = json;
  return json;
}

function futureExpirations(list) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return (list || []).filter(function (exp) {
    const d = new Date(String(exp) + "T00:00:00");
    return !isNaN(d.getTime()) && d >= today;
  });
}

function formatPullDate(s) {
  try {
    const parts = s.split("-").map(Number);
    const d = parts[0], m = parts[1];
    const dt = new Date(new Date().getFullYear(), m - 1, d);
    return {
      top: d + dt.toLocaleString("en", { month: "short" }),
      sub: dt.toLocaleString("en", { weekday: "short" }),
    };
  } catch (e) {
    return { top: s, sub: "" };
  }
}

function lastN(arr, n) {
  if (!n || n === "ALL") return arr.slice();
  const k = parseInt(n, 10);
  return arr.slice(Math.max(0, arr.length - k));
}

function filterStrikes(rows, close, strikesLimit) {
  if (!strikesLimit || strikesLimit === "ALL" || close == null) return rows.slice();
  const n = parseInt(strikesLimit, 10);
  return rows
    .map(function (r) { return { r: r, dist: Math.abs(r.strike - close) }; })
    .sort(function (a, b) { return a.dist - b.dist; })
    .slice(0, n * 2)
    .map(function (x) { return x.r; })
    .sort(function (a, b) { return a.strike - b.strike; });
}

function positiveDelta(last, prev) {
  const d = (last || 0) - (prev || 0);
  return d > 0 ? d : null;
}

function setStatus(msg, cls) {
  const el = $("#status");
  el.textContent = msg;
  el.className = "status " + (cls || "");
}

function applyTheme() {
  document.documentElement.setAttribute("data-theme", state.dark ? "dark" : "light");
  const sw = $("#themeSwitch");
  if (sw) sw.classList.toggle("on", state.dark);
  try { localStorage.setItem("oi-theme", state.dark ? "dark" : "light"); } catch (e) {}
}

function renderTickers() {
  const box = $("#tickers");
  box.innerHTML = "";
  TICKERS.forEach(function (t) {
    const el = document.createElement("div");
    el.className = "tcard" + (t.symbol === state.ticker ? " active" : "");
    el.innerHTML =
      '<div class="dot" style="background:' + t.color + '">' + t.symbol.slice(0, 3) + "</div>" +
      "<div><b>" + t.symbol + "</b><span>" + t.name + "</span></div>";
    el.onclick = function () {
      state.ticker = t.symbol;
      state.expiration = null;
      state.livePrice = null;
      renderTickers();
      refresh();
      refreshLivePrice();
    };
    box.appendChild(el);
  });
}

function renderChips(rowId, options, key) {
  const row = $(rowId);
  row.innerHTML = "";
  options.forEach(function (opt) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip" + (state[key] === opt ? " active" : "");
    b.textContent = opt;
    b.onclick = function () {
      state[key] = opt;
      renderChips(rowId, options, key);
      renderTable();
    };
    row.appendChild(b);
  });
}

function getViewRows(data) {
  const block = data.by_expiration[state.expiration];
  if (!block) return null;
  const pullDates = lastN(data.pull_dates || [], state.days);
  if (!pullDates.length) return null;
  const fullDates = data.pull_dates || [];
  const idx = pullDates.map(function (d) { return fullDates.indexOf(d); });
  let rows = block.rows.map(function (r) {
    return {
      strike: r.strike,
      calls: idx.map(function (i) { return i >= 0 ? r.calls[i] : 0; }),
      puts: idx.map(function (i) { return i >= 0 ? r.puts[i] : 0; }),
    };
  });
  rows = filterStrikes(rows, data.close, state.strikes);
  return { pullDates: pullDates, rows: rows, close: data.close };
}

async function refresh() {
  setStatus("جاري التحميل...");
  try {
    const data = await loadTicker(state.ticker);
    const sel = $("#expSelect");
    sel.innerHTML = "";
    const exps = futureExpirations(data.expirations || []);
    exps.forEach(function (exp) {
      const o = document.createElement("option");
      o.value = exp;
      o.textContent = exp;
      sel.appendChild(o);
    });
    if (!state.expiration || !exps.includes(state.expiration)) {
      state.expiration = exps[0] || null;
    }
    sel.value = state.expiration || "";
    $("#updatedAt").textContent = data.updated_at
      ? "آخر تحديث بيانات: " + data.updated_at
      : "لا يوجد تحديث بعد — شغّل Actions أولاً";
    renderTable();
    setStatus("جاهز", "ok");
  } catch (e) {
    setStatus(String(e.message || e), "err");
    $("#tableHost").innerHTML = '<p class="status err">' + (e.message || e) + "</p>";
  }
}

function greenBarRow(canDelta, n, close) {
  const cols = (canDelta ? 1 : 0) + n + 1 + n + (canDelta ? 1 : 0);
  let html = "<tr>";
  for (let i = 0; i < cols; i++) {
    const isStrike = i === (canDelta ? 1 : 0) + n;
    html +=
      '<td class="green">' +
      (isStrike
        ? Number(close).toLocaleString(undefined, { maximumFractionDigits: 2 })
        : "") +
      "</td>";
  }
  return html + "</tr>";
}

function renderTable() {
  const data = state.cache[state.ticker];
  const host = $("#tableHost");
  if (!data || !state.expiration) {
    host.innerHTML = '<p class="status">اختر تاريخ انتهاء</p>';
    return;
  }
  const view = getViewRows(data);
  if (!view) {
    host.innerHTML = '<p class="status">لا بيانات لهذا الانتهاء / الأيام</p>';
    return;
  }
  const pullDates = view.pullDates;
  const rows = view.rows;
  const close = effectiveClose(data);
  const canDelta = state.showDelta && pullDates.length >= 2;
  const lastI = pullDates.length - 1;
  const prevI = pullDates.length - 2;

  let html =
    '<div class="table-title">' +
    "<div>" +
    state.ticker +
    " | Exp: " +
    state.expiration +
    "</div>";
  if (close != null) {
    const liveTag = state.livePrice != null ? " · مباشر" : "";
    html +=
      '<div class="close-pill">الإغلاق: ' +
      Number(close).toLocaleString(undefined, { maximumFractionDigits: 2 }) +
      liveTag +
      "</div>";
  }
  html += '</div><div class="table-scroll"><table class="oi"><thead><tr>';

  if (canDelta) html += '<th class="delta">Δ</th>';
  for (let i = pullDates.length - 1; i >= 0; i--) {
    const f = formatPullDate(pullDates[i]);
    html += "<th>" + f.top + '<br><span class="subh">' + f.sub + "</span></th>";
  }
  html += '<th class="strike">STRIKE</th>';
  for (let j = 0; j < pullDates.length; j++) {
    const f = formatPullDate(pullDates[j]);
    html += "<th>" + f.top + '<br><span class="subh">' + f.sub + "</span></th>";
  }
  if (canDelta) html += '<th class="delta">Δ</th>';
  html += "</tr></thead><tbody>";

  // أعلى قيمة لكل عمود Call/Put (بدون Strike)
  const callMax = [];
  const putMax = [];
  for (let i = 0; i < pullDates.length; i++) {
    let mc = 0, mp = 0;
    rows.forEach(function (r) {
      const cv = r.calls[i] || 0;
      const pv = r.puts[i] || 0;
      if (cv > mc) mc = cv;
      if (pv > mp) mp = pv;
    });
    callMax.push(mc);
    putMax.push(mp);
  }
  let deltaCallMax = 0, deltaPutMax = 0;
  if (canDelta) {
    rows.forEach(function (r) {
      const dc = positiveDelta(r.calls[lastI], r.calls[prevI]);
      const dp = positiveDelta(r.puts[lastI], r.puts[prevI]);
      if (dc != null && dc > deltaCallMax) deltaCallMax = dc;
      if (dp != null && dp > deltaPutMax) deltaPutMax = dp;
    });
  }

  let barDone = false;
  rows.forEach(function (r, ri) {
    if (close != null && !barDone && r.strike > close) {
      html += greenBarRow(canDelta, pullDates.length, close);
      barDone = true;
    }
    const zebra = ri % 2 === 1 ? " zebra" : "";
    const above = close != null && r.strike > close;
    const below = close != null && r.strike < close;
    const callCls =
      below || (close != null && r.strike === close) ? "itm" : "otm";
    const putCls =
      above || (close != null && r.strike === close) ? "itm" : "otm";

    html += '<tr class="' + zebra + '">';
    if (canDelta) {
      const d = positiveDelta(r.calls[lastI], r.calls[prevI]);
      const maxCls = d != null && deltaCallMax > 0 && d === deltaCallMax ? " max-oi" : "";
      html +=
        '<td class="delta' +
        maxCls +
        '">' +
        (d != null ? d.toLocaleString() : "") +
        "</td>";
    }
    for (let i = pullDates.length - 1; i >= 0; i--) {
      const cv = r.calls[i] || 0;
      const maxCls = callMax[i] > 0 && cv === callMax[i] ? " max-oi" : "";
      html +=
        '<td class="' +
        callCls +
        maxCls +
        '">' +
        cv.toLocaleString() +
        "</td>";
    }
    html += '<td class="strike">' + r.strike + "</td>";
    for (let i = 0; i < pullDates.length; i++) {
      const pv = r.puts[i] || 0;
      const maxCls = putMax[i] > 0 && pv === putMax[i] ? " max-oi" : "";
      html +=
        '<td class="' +
        putCls +
        maxCls +
        '">' +
        pv.toLocaleString() +
        "</td>";
    }
    if (canDelta) {
      const d = positiveDelta(r.puts[lastI], r.puts[prevI]);
      const maxCls = d != null && deltaPutMax > 0 && d === deltaPutMax ? " max-oi" : "";
      html +=
        '<td class="delta' +
        maxCls +
        '">' +
        (d != null ? d.toLocaleString() : "") +
        "</td>";
    }
    html += "</tr>";
  });
  if (close != null && !barDone) {
    html += greenBarRow(canDelta, pullDates.length, close);
  }
  html += "</tbody></table></div>";
  host.innerHTML = html;
}

function exportExcel() {
  const data = state.cache[state.ticker];
  if (!data || !state.expiration) {
    setStatus("لا بيانات للتصدير", "err");
    return;
  }
  if (typeof ExcelJS === "undefined") {
    setStatus("مكتبة Excel لم تُحمّل — تحقق من الإنترنت", "err");
    return;
  }
  const view = getViewRows(data);
  if (!view) {
    setStatus("لا صفوف للتصدير", "err");
    return;
  }
  const pullDates = view.pullDates;
  const rows = view.rows;
  const canDelta = state.showDelta && pullDates.length >= 2;
  const lastI = pullDates.length - 1;
  const prevI = pullDates.length - 2;
  const n = pullDates.length;

  const callMaxX = [];
  const putMaxX = [];
  for (let i = 0; i < n; i++) {
    let mc = 0, mp = 0;
    rows.forEach(function (r) {
      if ((r.calls[i] || 0) > mc) mc = r.calls[i] || 0;
      if ((r.puts[i] || 0) > mp) mp = r.puts[i] || 0;
    });
    callMaxX.push(mc);
    putMaxX.push(mp);
  }
  const maxFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC7D2FE" } };

  // بناء الترتيب البصري أولاً (يسار→يمين على الشاشة):
  // Δ | Call 10→11→… | STRIKE | Put 10→11→… | Δ
  // مع rightToLeft: true عمود B يظهر يمينًا؛ لذلك نعكس المصفوفة عند الكتابة.
  const visual = [];
  if (canDelta) visual.push({ kind: "deltaCall" });
  for (let j = 0; j < n; j++) visual.push({ kind: "call", idx: j, label: pullDates[j] });
  visual.push({ kind: "strike" });
  for (let j = 0; j < n; j++) visual.push({ kind: "put", idx: j, label: pullDates[j] });
  if (canDelta) visual.push({ kind: "deltaPut" });

  const colDefs = visual.slice().reverse();
  const total = colDefs.length;
  const startCol = 2; // column B
  const strikeCol = startCol + colDefs.findIndex(function (d) { return d.kind === "strike"; });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("OI", {
    views: [{ rightToLeft: true, state: "frozen", ySplit: 4 }],
  });

  const fontHeader = { name: "Calibri", size: 11, bold: true };
  const fontBody = { name: "Calibri", size: 11 };
  const alignC = { horizontal: "center", vertical: "middle" };
  const border = {
    top: { style: "thin", color: { argb: "FFCBD5E1" } },
    bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
    left: { style: "thin", color: { argb: "FFCBD5E1" } },
    right: { style: "thin", color: { argb: "FFCBD5E1" } },
  };
  const fillTitle = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
  const fillSec = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
  const fillDates = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
  const fillDelta = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE4E4D2" } };
  const fontWhite = { name: "Calibri", size: 12, bold: true, color: { argb: "FFFFFFFF" } };

  function styleRange(r, c1, c2, opts) {
    for (let c = c1; c <= c2; c++) {
      const cell = ws.getCell(r, c);
      if (opts.font) cell.font = opts.font;
      if (opts.fill) cell.fill = opts.fill;
      if (opts.align) cell.alignment = opts.align;
      if (opts.border) cell.border = opts.border;
    }
  }

  const endCol = startCol + total - 1;

  // Row 1: title
  ws.mergeCells(1, startCol, 1, endCol);
  ws.getCell(1, startCol).value = state.ticker + "  |  Open Interest";
  styleRange(1, startCol, endCol, { font: fontWhite, fill: fillTitle, align: alignC });
  ws.getRow(1).height = 22;

  // Row 2 labels حسب مواقع colDefs الفعلية
  function spanKind(kindPrefix) {
    let a = -1, b = -1;
    colDefs.forEach(function (d, i) {
      if (d.kind === kindPrefix || (kindPrefix === "call" && d.kind === "call") || (kindPrefix === "put" && d.kind === "put")) {
        if (a < 0) a = i;
        b = i;
      }
    });
    return a < 0 ? null : { a: startCol + a, b: startCol + b };
  }
  const putSpan = spanKind("put");
  const callSpan = spanKind("call");
  if (putSpan) {
    ws.getCell(2, putSpan.a).value = "Put";
    if (putSpan.b > putSpan.a) ws.mergeCells(2, putSpan.a, 2, putSpan.b);
  }
  ws.getCell(2, strikeCol).value = "Strike";
  if (callSpan) {
    ws.getCell(2, callSpan.a).value = "Call";
    if (callSpan.b > callSpan.a) ws.mergeCells(2, callSpan.a, 2, callSpan.b);
  }
  colDefs.forEach(function (d, i) {
    if (d.kind === "deltaCall" || d.kind === "deltaPut") {
      ws.getCell(2, startCol + i).value = "Δ";
    }
  });
  styleRange(2, startCol, endCol, { font: fontHeader, fill: fillSec, align: alignC, border: border });
  ws.getRow(2).height = 18;

  // Row 3: dates
  for (let i = 0; i < total; i++) {
    const def = colDefs[i];
    let v = "";
    if (def.kind === "call" || def.kind === "put") v = def.label;
    else if (def.kind === "strike") v = "STRIKE";
    else if (def.kind === "deltaCall" || def.kind === "deltaPut") v = "Δ";
    const cell = ws.getCell(3, startCol + i);
    cell.value = v;
    cell.font = fontHeader;
    cell.alignment = alignC;
    cell.border = border;
    cell.fill = def.kind.indexOf("delta") === 0 ? fillDelta : fillDates;
  }
  ws.getRow(3).height = 18;

  // Row 4: expiration only (no close)
  for (let c = startCol; c <= endCol; c++) {
    ws.getCell(4, c).border = border;
    ws.getCell(4, c).alignment = alignC;
    ws.getCell(4, c).font = fontBody;
    ws.getCell(4, c).fill = fillDates;
  }
  ws.getCell(4, strikeCol).value = state.expiration;
  ws.getRow(4).height = 18;

  // Data
  rows.forEach(function (r, ri) {
    const rowIdx = 5 + ri;
    colDefs.forEach(function (def, i) {
      const cell = ws.getCell(rowIdx, startCol + i);
      cell.alignment = alignC;
      cell.font = fontBody;
      cell.border = border;
      if (def.kind === "strike") {
        cell.value = Math.round(Number(r.strike));
        cell.numFmt = "0";
        cell.font = { name: "Calibri", size: 11, bold: true };
      } else if (def.kind === "call") {
        const cv = r.calls[def.idx] || 0;
        cell.value = cv;
        cell.numFmt = "#,##0";
        if (callMaxX[def.idx] > 0 && cv === callMaxX[def.idx]) cell.fill = maxFill;
      } else if (def.kind === "put") {
        const pv = r.puts[def.idx] || 0;
        cell.value = pv;
        cell.numFmt = "#,##0";
        if (putMaxX[def.idx] > 0 && pv === putMaxX[def.idx]) cell.fill = maxFill;
      } else if (def.kind === "deltaCall") {
        const d = positiveDelta(r.calls[lastI], r.calls[prevI]);
        cell.value = d != null ? d : "";
        cell.numFmt = "#,##0";
        cell.fill = fillDelta;
      } else if (def.kind === "deltaPut") {
        const d = positiveDelta(r.puts[lastI], r.puts[prevI]);
        cell.value = d != null ? d : "";
        cell.numFmt = "#,##0";
        cell.fill = fillDelta;
      }
    });
  });

  ws.getColumn(1).width = 3;
  for (let i = 0; i < total; i++) {
    ws.getColumn(startCol + i).width = 11;
  }
  ws.getColumn(strikeCol).width = 12;

  const fname =
    state.ticker + "_" + state.expiration + "_D" + state.days + "_S" + state.strikes + ".xlsx";

  wb.xlsx.writeBuffer().then(function (buffer) {
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    if (typeof saveAs === "function") {
      saveAs(blob, fname);
    } else {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fname;
      a.click();
      URL.revokeObjectURL(a.href);
    }
    setStatus("تم تنزيل ملف Excel (.xlsx) بتنسيق كامل", "ok");
  }).catch(function (err) {
    setStatus("خطأ تصدير: " + (err && err.message ? err.message : err), "err");
  });
}


// —— سعر مباشر للشريط الأخضر (ويب فقط، مع قيود الاستضافة الثابتة) ——
const YAHOO_MAP = { SPY: "SPY", QQQ: "QQQ", IWM: "IWM", GLD: "GLD", SPX: "^GSPC" };
let liveTimer = null;

function isUsMarketHours() {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short", hour: "numeric", minute: "numeric", hour12: false,
    }).formatToParts(new Date());
    const map = {};
    parts.forEach(function (p) { map[p.type] = p.value; });
    const wd = map.weekday;
    if (wd === "Sat" || wd === "Sun") return false;
    const h = parseInt(map.hour, 10);
    const m = parseInt(map.minute, 10);
    const mins = h * 60 + m;
    // 9:30–16:00 ET
    return mins >= 9 * 60 + 30 && mins <= 16 * 60;
  } catch (e) {
    return false;
  }
}

async function fetchLivePrice(ticker) {
  const sym = YAHOO_MAP[ticker] || ticker;
  const yahoo =
    "https://query1.finance.yahoo.com/v8/finance/chart/" +
    encodeURIComponent(sym) +
    "?interval=1m&range=1d";
  // محاولة مباشرة ثم عبر وكيل CORS بسيط عند الفشل
  async function fromUrl(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error("http " + res.status);
    return res.json();
  }
  let json;
  try {
    json = await fromUrl(yahoo);
  } catch (e1) {
    try {
      json = await fromUrl(
        "https://api.allorigins.win/raw?url=" + encodeURIComponent(yahoo)
      );
    } catch (e2) {
      return null;
    }
  }
  try {
    const meta = json.chart.result[0].meta;
    const p = meta.regularMarketPrice || meta.postMarketPrice || meta.previousClose;
    return p != null ? Number(p) : null;
  } catch (e) {
    return null;
  }
}

function effectiveClose(data) {
  if (state.livePrice != null && !isNaN(state.livePrice)) return state.livePrice;
  return data && data.close != null ? data.close : null;
}

async function refreshLivePrice() {
  if (!isUsMarketHours()) {
    state.livePrice = null;
    return;
  }
  const p = await fetchLivePrice(state.ticker);
  if (p != null) {
    state.livePrice = p;
    renderTable();
  }
}

function startLivePriceLoop() {
  if (liveTimer) clearInterval(liveTimer);
  refreshLivePrice();
  liveTimer = setInterval(refreshLivePrice, 60000); // كل دقيقة أثناء الجلسة
}


function toggleTheme() {
  state.dark = true;
  applyTheme();
}

function init() {
  state.dark = true;
  try { localStorage.setItem("oi-theme", "dark"); } catch (e) {}
  applyTheme();
  renderTickers();
  renderChips("#daysRow", ["2", "3", "5", "10", "ALL"], "days");
  renderChips("#strikesRow", ["30", "50", "ALL"], "strikes");
  $("#expSelect").onchange = function (e) {
    state.expiration = e.target.value;
    renderTable();
  };
  $("#deltaBtn").onclick = function () {
    state.showDelta = !state.showDelta;
    $("#deltaBtn").classList.toggle("active", state.showDelta);
    renderTable();
  };
  $("#exportBtn").onclick = function () {
    try {
      exportExcel();
    } catch (err) {
      setStatus("خطأ تصدير: " + (err && err.message ? err.message : err), "err");
      console.error(err);
    }
  };
  if ($("#themeSwitch")) $("#themeSwitch").onclick = toggleTheme;
  if ($("#mapBtn")) $("#mapBtn").onclick = function () { openMap(); };
  if ($("#mapClose")) $("#mapClose").onclick = closeMap;
  if ($("#mapModal")) $("#mapModal").addEventListener("click", function (e) {
    if (e.target.id === "mapModal") closeMap();
  });
  if ($("#reloadBtn")) $("#reloadBtn").onclick = function () {
    delete state.cache[state.ticker];
    levelsCache = null;
    refresh();
  };
  refresh();
  startLivePriceLoop();
}



// ========== Levels Map (3 phases) ==========
let levelsCache = null;

async function loadLevels() {
  if (levelsCache) return levelsCache;
  const base = document.body.dataset.dataBase || "../data";
  const res = await fetch(base + "/levels.json?t=" + Date.now());
  if (!res.ok) throw new Error("لا يوجد levels.json بعد — شغّل Actions أولًا");
  levelsCache = await res.json();
  return levelsCache;
}

function fmtNum(v, d) {
  if (v == null || isNaN(v)) return "—";
  return Number(v).toLocaleString(undefined, { maximumFractionDigits: d == null ? 2 : d });
}

function distInfo(price, level) {
  if (price == null || level == null) return { pts: null, pct: null, txt: "—" };
  const pts = level - price;
  const pct = price ? (pts / price) * 100 : null;
  const sign = pts > 0 ? "+" : "";
  return {
    pts: pts,
    pct: pct,
    txt: sign + fmtNum(pts, 1) + " pts (" + sign + fmtNum(pct, 2) + "%)",
  };
}

function levelRowsHtml(L, price) {
  const bands = [
    { key: "daily", label: "يومي Daily" },
    { key: "weekly", label: "أسبوعي Weekly" },
    { key: "opx", label: "OPX شهري" },
    { key: "next_opx", label: "OPX القادم" },
  ];
  let html = "";
  bands.forEach(function (b) {
    const block = L[b.key] || {};
    const s = block.support;
    const r = block.resistance;
    const ds = distInfo(price, s);
    const dr = distInfo(price, r);
    html +=
      '<div class="map-row"><span>' +
      b.label +
      '</span><span class="tag-res">قمة ' +
      fmtNum(r, 0) +
      "</span></div>";
    html +=
      '<div class="map-row"><span style="opacity:.7;font-size:11px">→ للقمة</span><span>' +
      dr.txt +
      "</span></div>";
    html +=
      '<div class="map-row"><span>' +
      b.label +
      '</span><span class="tag-sup">قاع ' +
      fmtNum(s, 0) +
      "</span></div>";
    html +=
      '<div class="map-row"><span style="opacity:.7;font-size:11px">→ للقاع</span><span>' +
      ds.txt +
      "</span></div>";
  });
  return html;
}



function buildMapSvg(L) {
  const path = (L.path || []).slice();
  const price = L.close;
  const bandDefs = [
    { key: "daily", label: "اليوم" },
    { key: "tomorrow", label: "بكرا" },
    { key: "weekly", label: "أسبوع" },
    { key: "opx", label: "OPX" },
    { key: "next_opx", label: "OPX+" },
  ];

  // جمع المستويات مع دمج نفس السعر (حتى لا يتكرر الخط والتسمية)
  const resMap = {};
  const supMap = {};
  bandDefs.forEach(function (b) {
    const block = L[b.key] || {};
    if (block.resistance != null) {
      const k = String(Math.round(Number(block.resistance) * 100) / 100);
      if (!resMap[k]) resMap[k] = [];
      resMap[k].push(b.label);
    }
    if (block.support != null) {
      const k = String(Math.round(Number(block.support) * 100) / 100);
      if (!supMap[k]) supMap[k] = [];
      supMap[k].push(b.label);
    }
  });

  const nums = [];
  if (price != null) nums.push(Number(price));
  path.forEach(function (p) {
    if (p.close != null) nums.push(Number(p.close));
  });
  Object.keys(resMap).forEach(function (k) { nums.push(Number(k)); });
  Object.keys(supMap).forEach(function (k) { nums.push(Number(k)); });
  if (!nums.length) {
    return '<p style="color:#94a3b8;padding:20px;text-align:center">لا بيانات رسم بعد</p>';
  }

  let minV = Math.min.apply(null, nums);
  let maxV = Math.max.apply(null, nums);
  const pad = (maxV - minV) * 0.14 || 10;
  minV -= pad;
  maxV += pad;

  const W = 700, H = 340, ML = 44, MR = 130, MT = 18, MB = 24;
  const iw = W - ML - MR, ih = H - MT - MB;

  function yScale(v) {
    return MT + ((maxV - v) / (maxV - minV)) * ih;
  }
  function xScale(i, n) {
    if (n <= 1) return ML + iw * 0.9;
    return ML + (i / (n - 1)) * iw;
  }

  // ترتيب التسميات وتفريقها عموديًا إذا تقاربت
  function placeLabels(items, side) {
    // items: [{v, text, color}]
    items.sort(function (a, b) { return b.v - a.v; });
    const placed = [];
    const minGap = 14;
    items.forEach(function (it) {
      let y = yScale(it.v);
      if (placed.length) {
        const prev = placed[placed.length - 1];
        if (y - prev.y < minGap) y = prev.y + minGap;
      }
      // لا تخرج من الرسم
      if (y > MT + ih) y = MT + ih;
      if (y < MT) y = MT;
      placed.push({ y: y, v: it.v, text: it.text, color: it.color, lineY: yScale(it.v) });
    });
    return placed;
  }

  const resItems = Object.keys(resMap).map(function (k) {
    return {
      v: Number(k),
      text: "قمة " + Number(k).toFixed(0) + " · " + resMap[k].join("/"),
      color: "#c4b5fd",
    };
  });
  const supItems = Object.keys(supMap).map(function (k) {
    return {
      v: Number(k),
      text: "قاع " + Number(k).toFixed(0) + " · " + supMap[k].join("/"),
      color: "#5eead4",
    };
  });
  const resPlaced = placeLabels(resItems, "right");
  const supPlaced = placeLabels(supItems, "right");

  let svg = '<svg viewBox="0 0 ' + W + " " + H + '" xmlns="http://www.w3.org/2000/svg">';

  for (let g = 0; g < 5; g++) {
    const yy = MT + (ih * g) / 4;
    svg +=
      '<line x1="' + ML + '" x2="' + (W - MR) + '" y1="' + yy + '" y2="' + yy +
      '" stroke="#1e293b" stroke-width="1"/>';
  }

  // خطوط القمم
  resPlaced.forEach(function (it) {
    svg +=
      '<line x1="' + ML + '" x2="' + (W - MR) + '" y1="' + it.lineY + '" y2="' + it.lineY +
      '" stroke="#a78bfa" stroke-dasharray="6 4" stroke-width="1.5" opacity="0.85"/>';
    svg +=
      '<text x="' + (W - MR + 8) + '" y="' + (it.y + 4) +
      '" fill="' + it.color + '" font-size="11">' + it.text + "</text>";
  });
  // خطوط القيعان
  supPlaced.forEach(function (it) {
    svg +=
      '<line x1="' + ML + '" x2="' + (W - MR) + '" y1="' + it.lineY + '" y2="' + it.lineY +
      '" stroke="#2dd4bf" stroke-dasharray="6 4" stroke-width="1.5" opacity="0.85"/>';
    svg +=
      '<text x="' + (W - MR + 8) + '" y="' + (it.y + 4) +
      '" fill="' + it.color + '" font-size="11">' + it.text + "</text>";
  });

  // مسار الإغلاق
  if (path.length) {
    let d = "";
    path.forEach(function (p, i) {
      d += (i === 0 ? "M" : "L") + xScale(i, path.length) + " " + yScale(p.close) + " ";
    });
    svg +=
      '<path d="' + d + '" fill="none" stroke="#38bdf8" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>';
    path.forEach(function (p, i) {
      svg +=
        '<circle cx="' + xScale(i, path.length) + '" cy="' + yScale(p.close) +
        '" r="3" fill="#38bdf8"/>';
    });
  }

  // إغلاق أمس — بارز بدون نص مزدحم
  if (price != null) {
    const y = yScale(price);
    const x = path.length ? xScale(path.length - 1, Math.max(path.length, 1)) : ML + iw * 0.9;
    svg +=
      '<line x1="' + ML + '" x2="' + (W - MR) + '" y1="' + y + '" y2="' + y +
      '" stroke="#f8fafc" stroke-width="1.4" opacity="0.5"/>';
    svg +=
      '<circle cx="' + x + '" cy="' + y + '" r="6" fill="#22d3ee" stroke="#f8fafc" stroke-width="2"/>';
    svg +=
      '<text x="' + (x - 10) + '" y="' + (y - 12) +
      '" fill="#f8fafc" font-size="13" font-weight="700" text-anchor="end">' +
      fmtNum(price, 2) + "</text>";
  }

  svg += "</svg>";
  return svg;
}


function renderMapPanel(L) {
  const price = L.close;
  const bands = [
    { key: "daily", label: "اليوم" },
    { key: "tomorrow", label: "بكرا" },
    { key: "weekly", label: "الأسبوع" },
    { key: "opx", label: "OPX" },
    { key: "next_opx", label: "OPX القادم" },
  ];

  let rows = "";
  bands.forEach(function (b) {
    const block = L[b.key] || {};
    const s = block.support;
    const r = block.resistance;
    const ds = distInfo(price, s);
    const dr = distInfo(price, r);
    const exp = block.exp ? String(block.exp) : "";
    rows +=
      '<div class="map-band">' +
      '<div class="name">' + b.label +
      (exp ? '<div style="font-size:10px;color:#64748b;font-weight:400;margin-top:2px">' + exp + "</div>" : "") +
      "</div>" +
      '<div class="cell res"><b>' + fmtNum(r, 0) + "</b><span>قمة · " + dr.txt + "</span></div>" +
      '<div class="cell sup"><b>' + fmtNum(s, 0) + "</b><span>قاع · " + ds.txt + "</span></div>" +
      "</div>";
  });

  return (
    '<div class="map-simple">' +
    '<div class="map-price"><div class="n">' + fmtNum(price, 2) + "</div>" +
    '<div class="l">إغلاق أمس</div></div>' +
    '<div class="map-card map-chart-wrap">' + buildMapSvg(L) +
    '<div class="map-legend">' +
    '<span><span class="map-dot" style="background:#a78bfa"></span> قمة</span>' +
    '<span><span class="map-dot" style="background:#2dd4bf"></span> قاع</span>' +
    '<span><span class="map-dot" style="background:#22d3ee"></span> إغلاق أمس</span>' +
    '<span><span class="map-dot" style="background:#38bdf8"></span> مسار</span>' +
    "</div></div>" +
    rows +
    '<p class="map-hint">قاع = أعلى Put OI · قمة = أعلى Call OI</p>' +
    "</div>"
  );
}

async function openMap() {
  const modal = $("#mapModal");
  const body = $("#mapBody");
  const title = $("#mapTitle");
  const sub = $("#mapSub");
  if (!modal) return;
  modal.classList.remove("hidden");
  body.innerHTML = '<p style="color:#94a3b8">جاري تحميل المستويات…</p>';
  try {
    const all = await loadLevels();
    const L = (all.tickers || {})[state.ticker];
    if (!L) throw new Error("لا مستويات لـ " + state.ticker);
    title.textContent = "Levels Map — " + state.ticker;
    sub.textContent =
      "as of " +
      (L.as_of || "—") +
      " · close " +
      fmtNum(L.close, 2) +
      " · Put max=قاع · Call max=قمة";
    body.innerHTML = renderMapPanel(L);
  } catch (e) {
    body.innerHTML =
      '<p style="color:#f87171">' + (e.message || e) + "</p>" +
      '<p style="color:#94a3b8;font-size:12px">بعد دمج الكود، شغّل Actions مرة لينشأ data/levels.json</p>';
  }
}

function closeMap() {
  const modal = $("#mapModal");
  if (modal) modal.classList.add("hidden");
}


document.addEventListener("DOMContentLoaded", init);
