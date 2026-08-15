const INDEX_TICKERS = [
  { symbol: "SPY", name: "SPDR S&P 500", color: "#0D9488" },
  { symbol: "QQQ", name: "Invesco QQQ", color: "#2563EB" },
  { symbol: "IWM", name: "iShares Russell", color: "#0F172A" },
  { symbol: "GLD", name: "SPDR Gold", color: "#D97706" },
  { symbol: "SPX", name: "S&P 500 Index", color: "#7C3AED" },
];

const STOCKS_TICKERS = [
  { symbol: "AAPL", name: "Apple", color: "#A2AAAD" },
  { symbol: "MSFT", name: "Microsoft", color: "#00A4EF" },
  { symbol: "NVDA", name: "NVIDIA", color: "#76B900" },
  { symbol: "TSLA", name: "Tesla", color: "#E31937" },
  { symbol: "AMZN", name: "Amazon", color: "#FF9900" },
  { symbol: "META", name: "Meta", color: "#0668E1" },
  { symbol: "GOOGL", name: "Alphabet", color: "#4285F4" },
  { symbol: "AVGO", name: "Broadcom", color: "#E31937" },
  { symbol: "MSTR", name: "MicroStrategy", color: "#F7931A" },
  { symbol: "AMD", name: "AMD", color: "#ED1C24" },
  { symbol: "MU", name: "Micron", color: "#111827" },
  { symbol: "COHR", name: "Coherent", color: "#00A3E0" },
];

/** كل الرموز للبحث/العرض */
const TICKERS = INDEX_TICKERS.concat(STOCKS_TICKERS);

const state = {
  ticker: "SPY", days: "2", strikes: "30",
  expiration: null, showDelta: false, showGrowth: false, growthDays: 3,
  dark: false, cache: {}, livePrice: null, mapRange: "ALL",
};

const $ = (sel) => document.querySelector(sel);

function formatUpdatedAt(s) {
  try {
    var d = new Date(s);
    if (isNaN(d.getTime())) return String(s);
    // ميلادي دائمًا + أرقام لاتينية (وليس هجري)
    return d.toLocaleString("en-GB", {
      timeZone: "Asia/Riyadh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch (e) {
    return String(s);
  }
}


function dataBases() {
  var preferred = (document.body && document.body.dataset && document.body.dataset.dataBase) || "/data";
  preferred = String(preferred).replace(/\/$/, "");
  // جذر Worker + web/data + نسبي — توافق نشر Git والرفع اليدوي
  var list = [
    preferred,
    "/data",
    "data",
    "./data",
    "../data",
    "/web/data",
    "web/data",
    "."
  ];
  var out = [];
  for (var i = 0; i < list.length; i++) {
    if (list[i] && out.indexOf(list[i]) === -1) out.push(list[i]);
  }
  return out;
}

function dataUrl(ticker) {
  var base = dataBases()[0];
  return base + "/" + ticker + ".json?t=" + Date.now();
}

async function loadTicker(ticker) {
  if (state.cache[ticker]) return state.cache[ticker];
  var bases = dataBases();
  var lastStatus = 0;
  for (var i = 0; i < bases.length; i++) {
    try {
      var res = await fetch(bases[i] + "/" + ticker + ".json?t=" + Date.now());
      lastStatus = res.status;
      if (res.ok) {
        var json = await res.json();
        state.cache[ticker] = json;
        return json;
      }
    } catch (e) {}
  }
  throw new Error("تعذر تحميل بيانات " + ticker);
}

/** قبل 7 ص الرياض يُبقى انتهاء أمس للمراجعة الليلية؛ بعد 7 ص يُحذف */
function expirationCutoffDate() {
  try {
    var parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Riyadh",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", hour12: false,
    }).formatToParts(new Date());
    var get = function (t) {
      for (var i = 0; i < parts.length; i++) if (parts[i].type === t) return parts[i].value;
      return "0";
    };
    var y = parseInt(get("year"), 10);
    var m = parseInt(get("month"), 10);
    var d = parseInt(get("day"), 10);
    var h = parseInt(get("hour"), 10);
    var cutoff = new Date(y, m - 1, d);
    cutoff.setHours(0, 0, 0, 0);
    if (h < 7) cutoff.setDate(cutoff.getDate() - 1);
    return cutoff;
  } catch (e) {
    var t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }
}

function futureExpirations(list) {
  const cutoff = expirationCutoffDate();
  return (list || []).filter(function (exp) {
    const d = new Date(String(exp) + "T00:00:00");
    return !isNaN(d.getTime()) && d >= cutoff;
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

/** نمو السترايك: أحدث قيمة − قيمة قبل growthDays أعمدة (موجب فقط) */
function positiveGrowth(arr, daysBack) {
  if (!arr || !arr.length) return null;
  var n = Number(daysBack) || 0;
  if (n < 1) return null;
  var lastI = arr.length - 1;
  var prevI = lastI - n;
  if (prevI < 0) return null;
  return positiveDelta(arr[lastI], arr[prevI]);
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

function isIndexTicker(sym) {
  return INDEX_TICKERS.some(function (t) { return t.symbol === sym; });
}

function renderTickers() {
  const box = $("#tickers");
  if (!box) return;
  box.innerHTML = "";

  // بطاقات المؤشرات الخمسة فقط
  INDEX_TICKERS.forEach(function (t) {
    const el = document.createElement("div");
    el.className = "tcard" + (t.symbol === state.ticker ? " active" : "");
    el.innerHTML =
      '<div class="dot" style="background:' + t.color + '">' + t.symbol.slice(0, 3) + "</div>" +
      "<div><b>" + t.symbol + "</b><span>" + t.name + "</span></div>";
    el.onclick = function () {
      state.ticker = t.symbol;
      state.expiration = null;
      state.livePrice = null;
      const dd = $("#stocksSelect");
      if (dd) dd.value = "";
      renderTickers();
      refresh();
      refreshLivePrice();
    };
    box.appendChild(el);
  });

  renderStocksDropdown();
}

function renderStocksDropdown() {
  const host = $("#stocksRow");
  if (!host) return;
  const cur = isIndexTicker(state.ticker) ? "" : state.ticker;
  let opts = '<option value="">----</option>';
  STOCKS_TICKERS.forEach(function (t) {
    opts +=
      '<option value="' +
      t.symbol +
      '"' +
      (t.symbol === cur ? " selected" : "") +
      ">" +
      t.symbol +
      "</option>";
  });
  host.innerHTML =
    '<label class="stocks-label" for="stocksSelect">STOCKS</label>' +
    '<select id="stocksSelect" class="stocks-select" title="اختر سهمًا">' +
    opts +
    "</select>";

  const dd = $("#stocksSelect");
  if (!dd) return;
  dd.onchange = function () {
    const v = dd.value;
    if (!v) return;
    state.ticker = v;
    state.expiration = null;
    state.livePrice = null;
    renderTickers();
    refresh();
    refreshLivePrice();
  };
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
      ? "آخر تحديث: " + formatUpdatedAt(data.updated_at)
      : "لا يوجد تحديث بعد — شغّل Actions أولاً";
    renderTable();
    setStatus("جاهز", "ok");
  } catch (e) {
    setStatus(String(e.message || e), "err");
    $("#tableHost").innerHTML = '<p class="status err">' + (e.message || e) + "</p>";
  }
}

function greenBarRow(canDelta, canGrowth, n, close) {
  const sideExtra = (canDelta ? 1 : 0) + (canGrowth ? 1 : 0);
  const cols = sideExtra + n + 1 + n + sideExtra;
  const strikeAt = sideExtra + n;
  let html = "<tr>";
  for (let i = 0; i < cols; i++) {
    html +=
      '<td class="green">' +
      (i === strikeAt
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
  const gDays = Math.max(1, parseInt(state.growthDays, 10) || 3);
  const canGrowth = state.showGrowth && pullDates.length > gDays;
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

  // ترتيب الطرف: G (خارج) ثم Δ ثم التواريخ — نفس المنطق لكلا الجهتين
  if (canGrowth) html += '<th class="growth">G<br><span class="subh">' + gDays + "d</span></th>";
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
  if (canGrowth) html += '<th class="growth">G<br><span class="subh">' + gDays + "d</span></th>";
  html += "</tr></thead><tbody>";

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
  let growthCallMax = 0, growthPutMax = 0;
  if (canGrowth) {
    rows.forEach(function (r) {
      const gc = positiveGrowth(r.calls, gDays);
      const gp = positiveGrowth(r.puts, gDays);
      if (gc != null && gc > growthCallMax) growthCallMax = gc;
      if (gp != null && gp > growthPutMax) growthPutMax = gp;
    });
  }

  let barDone = false;
  rows.forEach(function (r, ri) {
    if (close != null && !barDone && r.strike > close) {
      html += greenBarRow(canDelta, canGrowth, pullDates.length, close);
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
    if (canGrowth) {
      const g = positiveGrowth(r.calls, gDays);
      const maxCls = g != null && growthCallMax > 0 && g === growthCallMax ? " max-oi" : "";
      html +=
        '<td class="growth' + maxCls + '">' +
        (g != null ? g.toLocaleString() : "") +
        "</td>";
    }
    if (canDelta) {
      const d = positiveDelta(r.calls[lastI], r.calls[prevI]);
      const maxCls = d != null && deltaCallMax > 0 && d === deltaCallMax ? " max-oi" : "";
      html +=
        '<td class="delta' + maxCls + '">' +
        (d != null ? d.toLocaleString() : "") +
        "</td>";
    }
    for (let i = pullDates.length - 1; i >= 0; i--) {
      const cv = r.calls[i] || 0;
      const maxCls = callMax[i] > 0 && cv === callMax[i] ? " max-oi" : "";
      html +=
        '<td class="' + callCls + maxCls + '">' +
        cv.toLocaleString() +
        "</td>";
    }
    html += '<td class="strike">' + r.strike + "</td>";
    for (let i = 0; i < pullDates.length; i++) {
      const pv = r.puts[i] || 0;
      const maxCls = putMax[i] > 0 && pv === putMax[i] ? " max-oi" : "";
      html +=
        '<td class="' + putCls + maxCls + '">' +
        pv.toLocaleString() +
        "</td>";
    }
    if (canDelta) {
      const d = positiveDelta(r.puts[lastI], r.puts[prevI]);
      const maxCls = d != null && deltaPutMax > 0 && d === deltaPutMax ? " max-oi" : "";
      html +=
        '<td class="delta' + maxCls + '">' +
        (d != null ? d.toLocaleString() : "") +
        "</td>";
    }
    if (canGrowth) {
      const g = positiveGrowth(r.puts, gDays);
      const maxCls = g != null && growthPutMax > 0 && g === growthPutMax ? " max-oi" : "";
      html +=
        '<td class="growth' + maxCls + '">' +
        (g != null ? g.toLocaleString() : "") +
        "</td>";
    }
    html += "</tr>";
  });
  if (close != null && !barDone) {
    html += greenBarRow(canDelta, canGrowth, pullDates.length, close);
  }
  html += "</tbody></table></div>";
  host.innerHTML = html;
}


function getViewRowsFor(data, expiration, daysLimit, strikesLimit) {
  if (!data || !expiration) return null;
  const block = data.by_expiration[expiration];
  if (!block) return null;
  const pullDates = lastN(data.pull_dates || [], daysLimit);
  if (!pullDates.length) return null;
  const fullDates = data.pull_dates || [];
  const idx = pullDates.map(function (d) { return fullDates.indexOf(d); });
  let rows = (block.rows || []).map(function (r) {
    return {
      strike: r.strike,
      calls: idx.map(function (i) { return i >= 0 ? r.calls[i] : 0; }),
      puts: idx.map(function (i) { return i >= 0 ? r.puts[i] : 0; }),
    };
  });
  rows = filterStrikes(rows, data.close, strikesLimit);
  if (!rows.length) return null;
  return { pullDates: pullDates, rows: rows, close: data.close, expiration: expiration };
}


/** يكتب جدول انتهاء بنفس تنسيق الديسكتوب (B2، pad=2، تواريخ 13-8، هيدر ناعم) */
function writeOiTableToSheet(ws, startRow, startCol, view, ticker, showDelta, showGrowth, growthDays) {
  const arabicMonths = {
    1: "يناير", 2: "فبراير", 3: "مارس", 4: "أبريل",
    5: "مايو", 6: "يونيو", 7: "يوليو", 8: "أغسطس",
    9: "سبتمبر", 10: "أكتوبر", 11: "نوفمبر", 12: "ديسمبر",
  };
  const pullDates = view.pullDates.slice();
  const rows = view.rows;
  const n = pullDates.length;
  const hasDelta = !!(showDelta && n >= 2);
  const gDays = Math.max(1, parseInt(growthDays, 10) || 3);
  const hasGrowth = !!(showGrowth && n > gDays);
  const lastI = n - 1;
  const prevI = n - 2;
  const pad = 2;

  const fillTicker = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE7E6E6" } };
  const fillPutCall = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2EFDA" } };
  const fillRow3 = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEECE1" } };
  const fillRow4 = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDD9C4" } };
  const fillDelta = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE4E4D2" } };
  const fillGrowth = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD8E7E7" } };
  const fillMax = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEECE1" } };
  const fontB = { name: "Calibri", size: 11, bold: true, color: { argb: "FF000000" } };
  const fontN = { name: "Calibri", size: 11, color: { argb: "FF000000" } };
  const alignC = { horizontal: "center", vertical: "middle" };
  const border = {
    top: { style: "thin", color: { argb: "FFD9D9D9" } },
    bottom: { style: "thin", color: { argb: "FFD9D9D9" } },
    left: { style: "thin", color: { argb: "FFD9D9D9" } },
    right: { style: "thin", color: { argb: "FFD9D9D9" } },
  };

  let headerDate = view.expiration || "";
  try {
    const p = String(view.expiration).split("-").map(Number);
    if (p.length >= 3) headerDate = p[2] + "-" + (arabicMonths[p[1]] || "");
  } catch (e) {}

  const rTitle = startRow;
  const rSection = startRow + 1;
  const rDates = startRow + 2;
  const rExp = startRow + 3;
  const dataStart = startRow + 4;

  // Put side (تواريخ تنازلي في العرض RTL): G ثم Δ ثم تواريخ
  let col = startCol + pad;
  let putGrowthCol = null;
  let putDeltaCol = null;
  if (hasGrowth) {
    putGrowthCol = col;
    col += 1;
  }
  if (hasDelta) {
    putDeltaCol = col;
    col += 1;
  }
  const putDateCols = [];
  for (let j = n - 1; j >= 0; j--) {
    putDateCols.push({ c: col, idx: j, d: pullDates[j] });
    col += 1;
  }
  const strikeCol = col;
  col += 1;
  const callDateCols = [];
  for (let j = 0; j < n; j++) {
    callDateCols.push({ c: col, idx: j, d: pullDates[j] });
    col += 1;
  }
  let callDeltaCol = null;
  let callGrowthCol = null;
  if (hasDelta) {
    callDeltaCol = col;
    col += 1;
  }
  if (hasGrowth) {
    callGrowthCol = col;
    col += 1;
  }
  const contentEnd = col - 1;
  const headerEnd = contentEnd + pad;

  for (let c = startCol; c <= headerEnd; c++) {
    for (const r of [rTitle, rSection, rDates, rExp]) {
      const cell = ws.getCell(r, c);
      cell.border = border;
      cell.alignment = alignC;
      cell.font = fontB;
    }
    ws.getCell(rTitle, c).fill = fillTicker;
    ws.getCell(rSection, c).fill = fillPutCall;
    ws.getCell(rDates, c).fill = fillRow3;
    ws.getCell(rExp, c).fill = fillRow4;
  }

  // Title = ticker only on strike column (rest soft gray)
  ws.getCell(rTitle, strikeCol).value = ticker;

  // Section labels Put / Strike / Call
  const putCols = []
    .concat(putGrowthCol ? [putGrowthCol] : [])
    .concat(putDeltaCol ? [putDeltaCol] : [])
    .concat(putDateCols.map(function (x) { return x.c; }));
  const callCols = callDateCols
    .map(function (x) { return x.c; })
    .concat(callDeltaCol ? [callDeltaCol] : [])
    .concat(callGrowthCol ? [callGrowthCol] : []);
  if (putCols.length) {
    ws.mergeCells(rSection, Math.min.apply(null, putCols), rSection, Math.max.apply(null, putCols));
    const cell = ws.getCell(rSection, Math.min.apply(null, putCols));
    cell.value = "Put";
    cell.fill = fillPutCall;
    cell.font = fontB;
    cell.alignment = alignC;
  }
  if (callCols.length) {
    ws.mergeCells(rSection, Math.min.apply(null, callCols), rSection, Math.max.apply(null, callCols));
    const cell = ws.getCell(rSection, Math.min.apply(null, callCols));
    cell.value = "Call";
    cell.fill = fillPutCall;
    cell.font = fontB;
    cell.alignment = alignC;
  }
  try {
    ws.mergeCells(rSection, strikeCol, rDates, strikeCol);
  } catch (e) {}
  const strikeHdr = ws.getCell(rSection, strikeCol);
  strikeHdr.value = "Strike";
  strikeHdr.fill = fillRow3;
  strikeHdr.font = fontB;
  strikeHdr.alignment = alignC;

  // Dates row: 10-8 style (pull_date as stored)
  putDateCols.forEach(function (x) {
    const cell = ws.getCell(rDates, x.c);
    cell.value = x.d;
    cell.fill = fillRow3;
    cell.font = fontB;
    cell.alignment = alignC;
  });
  callDateCols.forEach(function (x) {
    const cell = ws.getCell(rDates, x.c);
    cell.value = x.d;
    cell.fill = fillRow3;
    cell.font = fontB;
    cell.alignment = alignC;
  });

  // Exp row: Arabic date under strike
  ws.getCell(rExp, strikeCol).value = headerDate;
  ws.getCell(rExp, strikeCol).font = fontB;
  ws.getCell(rExp, strikeCol).alignment = alignC;

  // Max per column
  const putMax = {};
  const callMax = {};
  putDateCols.forEach(function (x) {
    let m = 0;
    rows.forEach(function (r) {
      const v = r.puts[x.idx] || 0;
      if (v > m) m = v;
    });
    putMax[x.c] = m;
  });
  callDateCols.forEach(function (x) {
    let m = 0;
    rows.forEach(function (r) {
      const v = r.calls[x.idx] || 0;
      if (v > m) m = v;
    });
    callMax[x.c] = m;
  });

  // ترويسة G / Δ
  if (hasGrowth && putGrowthCol) {
    const cell = ws.getCell(rDates, putGrowthCol);
    cell.value = "G·" + gDays;
    cell.fill = fillGrowth;
    cell.font = fontB;
    cell.alignment = alignC;
  }
  if (hasDelta && putDeltaCol) {
    const cell = ws.getCell(rDates, putDeltaCol);
    cell.value = "Δ";
    cell.fill = fillDelta;
    cell.font = fontB;
    cell.alignment = alignC;
  }
  if (hasDelta && callDeltaCol) {
    const cell = ws.getCell(rDates, callDeltaCol);
    cell.value = "Δ";
    cell.fill = fillDelta;
    cell.font = fontB;
    cell.alignment = alignC;
  }
  if (hasGrowth && callGrowthCol) {
    const cell = ws.getCell(rDates, callGrowthCol);
    cell.value = "G·" + gDays;
    cell.fill = fillGrowth;
    cell.font = fontB;
    cell.alignment = alignC;
  }

  rows.forEach(function (r, ri) {
    const rowIdx = dataStart + ri;
    if (hasGrowth && putGrowthCol) {
      const g = positiveGrowth(r.puts, gDays);
      const cell = ws.getCell(rowIdx, putGrowthCol);
      cell.value = g != null ? g : "";
      cell.numFmt = "#,##0";
      cell.font = fontN;
      cell.alignment = alignC;
      cell.border = border;
      cell.fill = fillGrowth;
    }
    if (hasDelta && putDeltaCol) {
      const dlt = positiveDelta(r.puts[lastI], r.puts[prevI]);
      const cell = ws.getCell(rowIdx, putDeltaCol);
      cell.value = dlt != null ? dlt : "";
      cell.numFmt = "#,##0";
      cell.font = fontN;
      cell.alignment = alignC;
      cell.border = border;
      cell.fill = fillDelta;
    }
    putDateCols.forEach(function (x) {
      const val = r.puts[x.idx] || 0;
      const cell = ws.getCell(rowIdx, x.c);
      cell.value = val;
      cell.numFmt = "#,##0";
      cell.font = fontN;
      cell.alignment = alignC;
      cell.border = border;
      if (putMax[x.c] > 0 && val === putMax[x.c]) cell.fill = fillMax;
    });
    const sc = ws.getCell(rowIdx, strikeCol);
    const s = Number(r.strike);
    if (Math.abs(s - Math.round(s)) < 1e-9) {
      sc.value = Math.round(s);
      sc.numFmt = "0";
    } else {
      sc.value = Math.round(s * 100) / 100;
      sc.numFmt = "0.0";
    }
    sc.font = fontB;
    sc.alignment = alignC;
    sc.border = border;
    callDateCols.forEach(function (x) {
      const val = r.calls[x.idx] || 0;
      const cell = ws.getCell(rowIdx, x.c);
      cell.value = val;
      cell.numFmt = "#,##0";
      cell.font = fontN;
      cell.alignment = alignC;
      cell.border = border;
      if (callMax[x.c] > 0 && val === callMax[x.c]) cell.fill = fillMax;
    });
    if (hasDelta && callDeltaCol) {
      const dlt = positiveDelta(r.calls[lastI], r.calls[prevI]);
      const cell = ws.getCell(rowIdx, callDeltaCol);
      cell.value = dlt != null ? dlt : "";
      cell.numFmt = "#,##0";
      cell.font = fontN;
      cell.alignment = alignC;
      cell.border = border;
      cell.fill = fillDelta;
    }
    if (hasGrowth && callGrowthCol) {
      const g = positiveGrowth(r.calls, gDays);
      const cell = ws.getCell(rowIdx, callGrowthCol);
      cell.value = g != null ? g : "";
      cell.numFmt = "#,##0";
      cell.font = fontN;
      cell.alignment = alignC;
      cell.border = border;
      cell.fill = fillGrowth;
    }
  });

  for (let c = startCol; c <= headerEnd; c++) {
    ws.getColumn(c).width = c === strikeCol ? 12 : 9;
  }
  return headerEnd;
}

function openExportDialog() {
  const data = state.cache[state.ticker];
  if (!data) {
    setStatus("لا بيانات — اختر مؤشرًا وحدّث العرض", "err");
    return;
  }
  if (typeof ExcelJS === "undefined") {
    setStatus("مكتبة Excel لم تُحمّل — تحقق من الإنترنت", "err");
    return;
  }
  const modal = $("#exportModal");
  const body = $("#exportBody");
  if (!modal || !body) {
    setStatus("نافذة التصدير غير متوفرة", "err");
    return;
  }
  const allExps = Object.keys(data.by_expiration || {}).sort();
  const exps = futureExpirations(allExps);
  if (!exps.length) {
    setStatus("لا تواريخ انتهاء متاحة من اليوم فصاعدًا", "err");
    return;
  }
  const curExp = state.expiration;
  let html = "";
  html += '<div class="exp-export-block">';
  html += '<div class="exp-export-head"><b>تواريخ الانتهاء</b>';
  html += '<button type="button" class="btn btn-sm" id="expSelectAll">تحديد الكل</button></div>';
  html += '<div class="exp-checks">';
  exps.forEach(function (exp) {
    const chk = exp === curExp ? " checked" : "";
    html +=
      '<label class="exp-check"><input type="checkbox" data-exp="' +
      exp +
      '"' +
      chk +
      "/> " +
      exp +
      "</label>";
  });
  html += "</div></div>";
  html += '<div class="exp-export-row"><span>الوضع</span>';
  html += '<button type="button" class="chip on" data-emode="single">صفحة واحدة</button>';
  html += '<button type="button" class="chip" data-emode="multi">صفحات متعددة</button></div>';
  html += '<div class="exp-export-row"><span>Days</span>';
  ["2", "3", "5", "10", "ALL"].forEach(function (d) {
    const on = String(state.days) === d ? " on" : "";
    html += '<button type="button" class="chip' + on + '" data-edays="' + d + '">' + d + "</button>";
  });
  html += "</div>";
  html += '<div class="exp-export-row"><span>Strikes</span>';
  ["50", "100", "ALL"].forEach(function (s) {
    const curS = ["50", "100", "ALL"].indexOf(String(state.strikes)) >= 0 ? String(state.strikes) : "50";
    const on = curS === s ? " on" : "";
    html += '<button type="button" class="chip' + on + '" data-estrikes="' + s + '">' + s + "</button>";
  });
  html += "</div>";
  html += '<p class="exp-export-note">صفحة واحدة = الجداول جنب بعض · متعددة = كل انتهاء في ورقة</p>';
  html += '<div class="exp-footer">';
  html += '<p id="expStatus" class="exp-status"></p>';
  html += '<div class="exp-export-actions">';
  html += '<button type="button" class="btn btn-teal" id="expDoBtn">تصدير Excel</button>';
  html += '<button type="button" class="btn" id="expCancelBtn">إلغاء</button></div>';
  html += '</div>';
  body.innerHTML = html;
  modal.classList.remove("hidden");

  let emode = "single";
  let edays = String(state.days || "2");
  let estrikes = ["50", "100", "ALL"].indexOf(String(state.strikes)) >= 0 ? String(state.strikes) : "50";

  body.querySelectorAll("[data-emode]").forEach(function (btn) {
    btn.onclick = function () {
      emode = btn.getAttribute("data-emode");
      body.querySelectorAll("[data-emode]").forEach(function (b) {
        b.classList.toggle("on", b === btn);
      });
    };
  });
  body.querySelectorAll("[data-edays]").forEach(function (btn) {
    btn.onclick = function () {
      edays = btn.getAttribute("data-edays");
      body.querySelectorAll("[data-edays]").forEach(function (b) {
        b.classList.toggle("on", b === btn);
      });
    };
  });
  body.querySelectorAll("[data-estrikes]").forEach(function (btn) {
    btn.onclick = function () {
      estrikes = btn.getAttribute("data-estrikes");
      body.querySelectorAll("[data-estrikes]").forEach(function (b) {
        b.classList.toggle("on", b === btn);
      });
    };
  });
  const selAll = $("#expSelectAll");
  if (selAll) {
    selAll.onclick = function () {
      body.querySelectorAll("input[data-exp]").forEach(function (cb) {
        cb.checked = true;
      });
    };
  }
  const cancel = $("#expCancelBtn");
  if (cancel) cancel.onclick = closeExportDialog;
  const doBtn = $("#expDoBtn");
  if (doBtn) {
    doBtn.onclick = function () {
      runExportFromDialog(emode, edays, estrikes);
    };
  }
}

function closeExportDialog() {
  const modal = $("#exportModal");
  if (modal) modal.classList.add("hidden");
}

function runExportFromDialog(emode, edays, estrikes) {
  const data = state.cache[state.ticker];
  const body = $("#exportBody");
  const st = $("#expStatus");
  const chosen = [];
  if (body) {
    body.querySelectorAll("input[data-exp]:checked").forEach(function (cb) {
      chosen.push(cb.getAttribute("data-exp"));
    });
  }
  if (!chosen.length) {
    if (st) st.textContent = "اختر تاريخ انتهاء واحدًا على الأقل";
    return;
  }
  if (st) st.textContent = "جاري إنشاء الملف…";

  try {
    const wb = new ExcelJS.Workbook();
    const GAP = 4;
    const showDelta = !!state.showDelta;
    const showGrowth = !!state.showGrowth;
    const growthDays = state.growthDays;

    if (emode === "multi") {
      chosen.forEach(function (exp, i) {
        const view = getViewRowsFor(data, exp, edays, estrikes);
        if (!view) return;
        const ws = wb.addWorksheet(String(exp).slice(0, 31), {
          views: [{ rightToLeft: true, state: "frozen", ySplit: 5 }],
        });
        writeOiTableToSheet(ws, 2, 2, view, state.ticker, showDelta, showGrowth, growthDays);
      });
    } else {
      const ws = wb.addWorksheet("Export", {
        views: [{ rightToLeft: true, state: "frozen", ySplit: 5 }],
      });
      let col = 2;
      chosen.forEach(function (exp) {
        const view = getViewRowsFor(data, exp, edays, estrikes);
        if (!view) return;
        const last = writeOiTableToSheet(ws, 2, col, view, state.ticker, showDelta, showGrowth, growthDays);
        col = last + 1 + GAP;
      });
    }

    if (wb.worksheets.length === 0) {
      if (st) st.textContent = "لا بيانات للجداول المختارة";
      return;
    }

    const fname =
      state.ticker +
      "_Exp_D" +
      edays +
      "_S" +
      estrikes +
      "_" +
      new Date().toISOString().slice(0, 10) +
      ".xlsx";

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
      if (st) st.textContent = "✅ تم التصدير: " + fname;
      setStatus("✅ تم التصدير: " + fname, "ok");
    }).catch(function (err) {
      if (st) st.textContent = "خطأ: " + (err && err.message ? err.message : err);
      setStatus("خطأ تصدير: " + (err && err.message ? err.message : err), "err");
    });
  } catch (err) {
    if (st) st.textContent = "خطأ: " + (err && err.message ? err.message : err);
  }
}


function exportExcel() {
  openExportDialog();
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
  if ($("#growthBtn")) {
    $("#growthBtn").onclick = function () {
      if (!state.showGrowth) {
        var ans = window.prompt("كم يومًا للرجوع للخلف لحساب النمو؟", String(state.growthDays || 3));
        if (ans == null || ans === "") return;
        var n = parseInt(ans, 10);
        if (!n || n < 1) {
          setStatus("أدخلي رقم أيام صحيح (1 فأكثر)", "err");
          return;
        }
        state.growthDays = n;
        state.showGrowth = true;
      } else {
        state.showGrowth = false;
      }
      $("#growthBtn").classList.toggle("active", state.showGrowth);
      $("#growthBtn").title = state.showGrowth
        ? "النمو نشط — " + state.growthDays + " يوم (اضغطي لإيقاف)"
        : "النمو — مقارنة بعدة أيام";
      renderTable();
    };
  }
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
  if ($("#exportClose")) $("#exportClose").onclick = closeExportDialog;
  if ($("#reportsBtn")) $("#reportsBtn").onclick = function () {
    try { openReports(); } catch (err) {
      setStatus("Reports: " + (err && err.message ? err.message : err), "err");
      console.error(err);
    }
  };
  if ($("#reportsClose")) $("#reportsClose").onclick = closeReports;
  if ($("#reportsModal")) $("#reportsModal").addEventListener("click", function (e) {
    if (e.target.id === "reportsModal") closeReports();
  });
  if ($("#feedbackBtn")) $("#feedbackBtn").onclick = openFeedback;
  if ($("#feedbackClose")) $("#feedbackClose").onclick = closeFeedback;
  if ($("#fbCancel")) $("#fbCancel").onclick = closeFeedback;
  if ($("#feedbackForm")) $("#feedbackForm").onsubmit = submitFeedback;
  if ($("#feedbackModal")) $("#feedbackModal").addEventListener("click", function (e) {
    if (e.target.id === "feedbackModal") closeFeedback();
  });
  if ($("#exportModal")) $("#exportModal").addEventListener("click", function (e) {
    if (e.target.id === "exportModal") closeExportDialog();
  });
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
let mapRawL = null;

async function loadLevels() {
  if (levelsCache) return levelsCache;
  var bases = dataBases();
  for (var i = 0; i < bases.length; i++) {
    try {
      var res = await fetch(bases[i] + "/levels.json?t=" + Date.now());
      if (res.ok) {
        levelsCache = await res.json();
        return levelsCache;
      }
    } catch (e) {}
  }
  throw new Error("لا يوجد levels.json بعد — شغّل Actions أولًا");
}

function fmtNum(v, d) {
  if (v == null || isNaN(v)) return "—";
  return Number(v).toLocaleString(undefined, { maximumFractionDigits: d == null ? 2 : d });
}

/** يحافظ على نصف السترايك (212.5) بدون تقريب لعدد صحيح */
function fmtStrike(v) {
  if (v == null || isNaN(Number(v))) return "—";
  var n = Number(v);
  var r2 = Math.round(n * 100) / 100;
  if (Math.abs(r2 - Math.round(r2)) < 1e-9) return String(Math.round(r2));
  return String(r2);
}

function strikeKey(v) {
  // مفتاح تجميع بدقة 0.01 (يدعم 212.5)
  return Math.round(Number(v) * 100) / 100;
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
      fmtStrike(r) +
      "</span></div>";
    html +=
      '<div class="map-row"><span style="opacity:.7;font-size:11px">→ للقمة</span><span>' +
      dr.txt +
      "</span></div>";
    html +=
      '<div class="map-row"><span>' +
      b.label +
      '</span><span class="tag-sup">قاع ' +
      fmtStrike(s) +
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
    { key: "tomorrow", label: "يوم بعد" },
    { key: "weekly", label: "الأسبوع" },
    { key: "opx", label: "OPX" },
    { key: "next_opx", label: "OPX+" },
  ];

  // price -> { sup: [labels], res: [labels] }
  const byPrice = {};
  function add(price, kind, lab) {
    if (price == null || isNaN(price)) return;
    const k = Math.round(Number(price));
    if (!byPrice[k]) byPrice[k] = { sup: [], res: [] };
    const arr = byPrice[k][kind];
    if (arr.indexOf(lab) < 0) arr.push(lab);
  }
  bandDefs.forEach(function (b) {
    const block = L[b.key] || {};
    add(block.support, "sup", b.label);
    add(block.resistance, "res", b.label);
  });

  const levels = Object.keys(byPrice)
    .map(Number)
    .sort(function (a, b) { return b - a; });

  const nums = levels.slice();
  if (price != null) nums.push(Number(price));
  path.forEach(function (p) {
    if (p.close != null) nums.push(Number(p.close));
  });
  if (!nums.length) {
    return '<p style="color:#94a3b8;padding:20px;text-align:center">لا بيانات رسم بعد</p>';
  }

  let minV = Math.min.apply(null, nums);
  let maxV = Math.max.apply(null, nums);
  const pad = (maxV - minV) * 0.12 || 10;
  minV -= pad;
  maxV += pad;

  const W = 760, H = 380, ML = 150, MR = 150, MT = 16, MB = 20;
  const iw = W - ML - MR, ih = H - MT - MB;

  function yScale(v) {
    return MT + ((maxV - v) / (maxV - minV)) * ih;
  }
  function xScale(i, n) {
    if (n <= 1) return ML + iw * 0.92;
    return ML + (i / (n - 1)) * iw;
  }

  function joinNames(names) {
    return names.join("+");
  }

  function spread(sideItems) {
    sideItems.sort(function (a, b) { return b.v - a.v; });
    const out = [];
    const gap = 16;
    sideItems.forEach(function (it) {
      let y = yScale(it.v);
      if (out.length) {
        const prev = out[out.length - 1];
        if (y - prev.y < gap) y = prev.y + gap;
      }
      if (y > MT + ih) y = MT + ih;
      if (y < MT + 8) y = MT + 8;
      out.push({ v: it.v, text: it.text, y: y, lineY: yScale(it.v) });
    });
    return out;
  }

  const leftItems = [];
  const rightItems = [];
  levels.forEach(function (v) {
    const info = byPrice[v];
    if (info.sup.length) {
      leftItems.push({
        v: v,
        text: v + " قاع " + joinNames(info.sup),
      });
    }
    if (info.res.length) {
      rightItems.push({
        v: v,
        text: v + " قمة " + joinNames(info.res),
      });
    }
  });
  const leftPlaced = spread(leftItems);
  const rightPlaced = spread(rightItems);

  let svg = '<svg viewBox="0 0 ' + W + " " + H + '" xmlns="http://www.w3.org/2000/svg">';

  for (let g = 0; g < 5; g++) {
    const yy = MT + (ih * g) / 4;
    svg +=
      '<line x1="' + ML + '" x2="' + (W - MR) + '" y1="' + yy + '" y2="' + yy +
      '" stroke="#1e293b" stroke-width="1"/>';
  }

  // خطوط: قاع تركواز | قمة بنفسجي | الاثنان معًا رمادي محايد
  levels.forEach(function (v) {
    const info = byPrice[v];
    const isSup = info.sup.length > 0;
    const isRes = info.res.length > 0;
    const y = yScale(v);
    let stroke = "#94a3b8";
    if (isSup && isRes) stroke = "#94a3b8"; // محايد
    else if (isSup) stroke = "#2dd4bf";
    else if (isRes) stroke = "#a78bfa";
    const width = isSup && isRes ? 2.2 : 1.8;
    svg +=
      '<line x1="' + ML + '" x2="' + (W - MR) + '" y1="' + y + '" y2="' + y +
      '" stroke="' + stroke + '" stroke-dasharray="6 4" stroke-width="' + width + '" opacity="0.95"/>';
  });

  if (path.length) {
    let d = "";
    path.forEach(function (p, i) {
      d += (i === 0 ? "M" : "L") + xScale(i, path.length) + " " + yScale(p.close) + " ";
    });
    svg +=
      '<path d="' + d + '" fill="none" stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>';
    path.forEach(function (p, i) {
      svg +=
        '<circle cx="' + xScale(i, path.length) + '" cy="' + yScale(p.close) +
        '" r="3" fill="#38bdf8"/>';
    });
  }

  leftPlaced.forEach(function (it) {
    svg +=
      '<text x="' + (ML - 8) + '" y="' + (it.y + 4) +
      '" fill="#5eead4" font-size="11" font-weight="600" text-anchor="end">' +
      it.text +
      "</text>";
  });
  rightPlaced.forEach(function (it) {
    svg +=
      '<text x="' + (W - MR + 8) + '" y="' + (it.y + 4) +
      '" fill="#c4b5fd" font-size="11" font-weight="600" text-anchor="start">' +
      it.text +
      "</text>";
  });

  if (price != null) {
    const y = yScale(price);
    const x = path.length ? xScale(path.length - 1, Math.max(path.length, 1)) : ML + iw * 0.92;
    svg +=
      '<line x1="' + ML + '" x2="' + (W - MR) + '" y1="' + y + '" y2="' + y +
      '" stroke="#f8fafc" stroke-width="1.3" opacity="0.45"/>';
    svg +=
      '<circle cx="' + x + '" cy="' + y + '" r="6" fill="#22d3ee" stroke="#f8fafc" stroke-width="2"/>';
    svg +=
      '<text x="' + x + '" y="' + (y - 14) +
      '" fill="#f8fafc" font-size="13" font-weight="700" text-anchor="middle">' +
      fmtNum(price, 2) +
      "</text>";
  }

  svg += "</svg>";
  return svg;
}



/* ===== Map helpers: arrows + internal chart zoom (TradingView-style) ===== */
var mapZoom = 1;
var mapDragY = null;
var mapDragZoom = null;
var mapLastL = null;

function levelArrow(curr, prev) {
  if (curr == null || prev == null || isNaN(Number(curr)) || isNaN(Number(prev))) return "";
  var c = Number(curr), p = Number(prev);
  // تسامح كسور السترايك
  if (Math.abs(c - p) < 0.001)
    return '<span class="lvl-arrow flat" title="ثابت عند ' + fmtStrike(p) + '">·</span>';
  if (c > p)
    return '<span class="lvl-arrow up" title="رُفع من ' + fmtStrike(p) + ' → ' + fmtStrike(c) + '">↑</span>';
  return '<span class="lvl-arrow down" title="نُزّل من ' + fmtStrike(p) + ' → ' + fmtStrike(c) + '">↓</span>';
}

function readPrevLevels(ticker) {
  try {
    var raw = localStorage.getItem("oi-levels-prev-" + ticker);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function savePrevLevels(ticker, L) {
  try {
    var snap = { as_of: L.as_of || L.updated_at || "", bands: {} };
    ["daily", "tomorrow", "weekly", "opx", "next_opx"].forEach(function (k) {
      var b = L[k] || {};
      snap.bands[k] = { support: b.support, resistance: b.resistance };
    });
    var curKey = "oi-levels-cur-" + ticker;
    var prevKey = "oi-levels-prev-" + ticker;
    var cur = null;
    try { cur = JSON.parse(localStorage.getItem(curKey) || "null"); } catch (e) {}
    if (cur && cur.as_of && snap.as_of && cur.as_of !== snap.as_of) {
      localStorage.setItem(prevKey, JSON.stringify(cur));
    }
    localStorage.setItem(curKey, JSON.stringify(snap));
  } catch (e) {}
}

function getCompareBands(ticker, L) {
  // مصدر وحيد: levels.json من السيرفر (لكل رمز على حدة)
  // لا localStorage — كان يخلط بين SPY وQQQ ويقلب الأسهم
  var out = {};
  ["daily", "tomorrow", "weekly", "opx", "next_opx"].forEach(function (k) {
    var b = L[k] || {};
    out[k] = {
      prev_support: b.prev_support != null ? b.prev_support : null,
      prev_resistance: b.prev_resistance != null ? b.prev_resistance : null,
    };
  });
  return out;
}

function mapScale(L) {
  var bands = ["daily", "tomorrow", "weekly", "opx", "next_opx"];
  var nums = [];
  bands.forEach(function (k) {
    var b = L[k] || {};
    if (b.support != null) nums.push(Number(b.support));
    if (b.resistance != null) nums.push(Number(b.resistance));
  });
  var price = L.close;
  if (price != null && !isNaN(Number(price))) nums.push(Number(price));
  if (!nums.length) return null;
  var minV0 = Math.min.apply(null, nums);
  var maxV0 = Math.max.apply(null, nums);
  var mid = price != null && !isNaN(Number(price)) ? Number(price) : (minV0 + maxV0) / 2;
  var half0 = Math.max((maxV0 - minV0) / 2, 2);
  var half = half0 / Math.max(mapZoom, 0.35);
  return { lo: mid - half, hi: mid + half, mid: mid, minV0: minV0, maxV0: maxV0, price: price };
}


/** يوم بعد يوافق الجمعة/نفس انتهاء الأسبوع → نكتفي ببطاقة الأسبوع */

/** ترتيب بطاقات الماب حسب اليوم (جمعة الأسبوع vs باقي الأيام) */
function getMapBandDefs(L) {
  var daily = L.daily || {};
  var weekly = L.weekly || {};
  var opx = L.opx || {};
  var nextOpx = L.next_opx || {};
  var weeklyIsOpx = !!(weekly.exp && opx.exp && weekly.exp === opx.exp);
  var dailyIsWeekly = !!(daily.exp && weekly.exp && daily.exp === weekly.exp);

  // الجمعة = اليوم والأسبوع معًا → بطاقة موحّدة "اليوم · الأسبوع"
  if (dailyIsWeekly) {
    var bands = [
      { key: "weekly", label: weeklyIsOpx ? "اليوم · الأسبوع · OPX" : "اليوم · الأسبوع" },
    ];
    if (!weeklyIsOpx) {
      bands.push({ key: "tomorrow", label: "يوم بعد" });
      bands.push({ key: "opx", label: "OPX" });
    } else {
      // اليوم=أسبوع=OPX: يوم بعد فقط + OPX التالي
      bands.push({ key: "tomorrow", label: "يوم بعد" });
    }
    if (nextOpx.exp && nextOpx.exp !== opx.exp) {
      bands.push({ key: "next_opx", label: "OPX+" });
    }
    return bands;
  }

  // الأسبوع = OPX (ثالث جمعة) بدون أن يكون اليوم جمعة الانتهاء
  if (weeklyIsOpx) {
    return [
      { key: "daily", label: "اليوم" },
      { key: "tomorrow", label: "يوم بعد" },
      { key: "weekly", label: "الأسبوع · OPX" },
      { key: "next_opx", label: "OPX+" },
    ];
  }

  return [
    { key: "daily", label: "اليوم" },
    { key: "tomorrow", label: "يوم بعد" },
    { key: "weekly", label: "الأسبوع" },
    { key: "opx", label: "OPX" },
    { key: "next_opx", label: "OPX+" },
  ];
}

function shouldSkipOpx(L) {
  if (!L) return false;
  var w = L.weekly || {};
  var o = L.opx || {};
  if (w.exp && o.exp && w.exp === o.exp) return true;
  return false;
}

function shouldSkipTomorrow(L) {
  if (!L) return false;
  if (L.meta && L.meta.tomorrow_merged_weekly) return true;
  var t = L.tomorrow || {};
  var w = L.weekly || {};
  if (t.merged_into === "weekly") return true;
  if (t.exp && w.exp && t.exp === w.exp) return true;
  if (t.support == null && t.resistance == null && !t.exp) return true;
  // احتياط: إذا نفس القمة والقاع ونفس الانتهاء
  if (
    t.exp &&
    w.exp &&
    t.exp === w.exp &&
    t.support === w.support &&
    t.resistance === w.resistance
  )
    return true;
  return false;
}

function renderMapPanel(L) {
  mapLastL = L;
  const price = L.close;
  const bands = getMapBandDefs(L);

  // قارن أولًا ثم احفظ — حتى لا تُستبدل لقطة الأمس قبل المقارنة
  const cmp = getCompareBands(state.ticker, L);
  savePrevLevels(state.ticker, L);

  const byPrice = {};
  function add(v, kind, lab) {
    if (v == null || isNaN(Number(v))) return;
    const k = strikeKey(v);
    if (!byPrice[k]) byPrice[k] = { sup: false, res: false, labels: [] };
    if (kind === "sup") byPrice[k].sup = true;
    if (kind === "res") byPrice[k].res = true;
    if (lab && byPrice[k].labels.indexOf(lab) < 0) byPrice[k].labels.push(lab);
  }
  bands.forEach(function (b) {
    // تخطي يوم بعد إذا اندمجت مع الأسبوع
    if (b.key === "tomorrow" && shouldSkipTomorrow(L)) return;
    if (b.key === "opx" && shouldSkipOpx(L)) return;
    const block = L[b.key] || {};
    add(block.support, "sup", b.label);
    add(block.resistance, "res", b.label);
  });

  const sc = mapScale(L);
  if (!sc) {
    return '<div class="map-h1"><p style="color:#94a3b8;text-align:center;padding:20px">لا مستويات متاحة</p></div>';
  }
  const lo = sc.lo, hi = sc.hi, span = hi - lo || 1;
  function pct(v) {
    return ((Number(v) - lo) / span) * 100;
  }

  // axis ticks inside chart (TradingView-style)
  var tickCount = 8;
  var ticksHtml = "";
  for (var ti = 0; ti <= tickCount; ti++) {
    var tv = lo + (span * ti) / tickCount;
    var tPct = (ti / tickCount) * 100;
    ticksHtml +=
      '<div class="axis-tick" style="bottom:' + tPct.toFixed(2) + '%">' +
      '<span>' + (Math.round(tv * 100) / 100) + "</span></div>";
  }

  let levelsHtml = "";
  Object.keys(byPrice)
    .map(Number)
    .sort(function (a, b) { return a - b; })
    .forEach(function (strike) {
      if (strike < lo || strike > hi) return;
      const info = byPrice[strike];
      const isDual = info.sup && info.res;
      const cls = isDual ? "dual" : info.res ? "res" : "sup";
      const label = isDual ? fmtStrike(strike) + " قاع+قمة" : fmtStrike(strike);
      levelsHtml +=
        '<div class="level ' + cls + '" style="bottom:' + pct(strike).toFixed(2) + '%">' +
        '<div class="line"></div><div class="end"></div><div class="num">' + label + "</div></div>";
    });

  let pxHtml = "";
  if (price != null && !isNaN(Number(price)) && Number(price) >= lo && Number(price) <= hi) {
    pxHtml =
      '<div class="px" style="bottom:' + pct(price).toFixed(2) + '%"><span>' +
      fmtNum(price, 2) +
      "</span></div>";
  }

  let cards = "";
  bands.forEach(function (b) {
    if (b.key === "tomorrow" && shouldSkipTomorrow(L)) return;
    if (b.key === "opx" && shouldSkipOpx(L)) return;
    const block = L[b.key] || {};
    const peak = block.resistance;
    const floor = block.support;
    // إخفاء بطاقة بلا بيانات
    if (peak == null && floor == null && !block.exp) return;
    const c = cmp[b.key] || {};
    const aR = levelArrow(peak, c.prev_resistance);
    const aS = levelArrow(floor, c.prev_support);
    cards +=
      '<div class="card"><div class="t">' + b.label + "</div>" +
      '<div class="r res"><span>قمة ' + aR + "</span><b>" + (peak != null ? fmtStrike(peak) : "—") + "</b></div>" +
      '<div class="r sup"><span>قاع ' + aS + "</span><b>" + (floor != null ? fmtStrike(floor) : "—") + "</b></div></div>";
  });

  return (
    '<div class="map-h1">' +
    '<div class="price-card">' +
    '<div class="close-label">الإغلاق</div>' +
    '<b>' + (price != null ? fmtNum(price, 2) : "—") + "</b>" +
    '<div class="map-range-row">' +
      mapRangeChip("50", state.mapRange) +
      mapRangeChip("100", state.mapRange) +
      mapRangeChip("ALL", state.mapRange) +
    "</div>" +
    "</div>" +
    '<div class="grid-wrap">' +
    '<div class="stage" id="mapStage">' +
    '<div class="track"></div>' +
    levelsHtml +
    pxHtml +
    '<div class="price-axis" id="mapPriceAxis" title="اسحب للتكبير أو التصغير">' +
    ticksHtml +
    '<div class="axis-grip"></div>' +
    "</div>" +
    '<div class="zoom-badge" id="mapZoomBadge">' + mapZoom.toFixed(1) + "×</div>" +
    "</div>" +
    '<div class="cards">' + cards + "</div>" +
    "</div></div>"
  );
}

function bindMapRangeChips() {
  document.querySelectorAll("[data-map-range]").forEach(function (btn) {
    btn.onclick = function (e) {
      e.preventDefault();
      e.stopPropagation();
      setMapRange(btn.getAttribute("data-map-range"));
    };
  });
}

function bindMapZoom(L) {
  bindMapRangeChips();

  mapLastL = L;
  var stage = document.getElementById("mapStage");
  var axis = document.getElementById("mapPriceAxis");
  if (!stage) return;

  function fullRedraw() {
    var body = document.getElementById("mapBody");
    if (!body || !mapLastL) return;
    body.innerHTML = renderMapPanel(mapLastL);
    bindMapZoom(mapLastL);
  }

  function setZoom(next) {
    if (next < 0.5) next = 0.5;
    if (next > 8) next = 8;
    next = Math.round(next * 20) / 20;
    if (next === mapZoom) return false;
    mapZoom = next;
    return true;
  }

  // Wheel → zoom (spread/compress levels around price)
  function onWheel(e) {
    e.preventDefault();
    e.stopPropagation();
    if (setZoom(mapZoom + (e.deltaY > 0 ? -0.3 : 0.3))) fullRedraw();
  }
  stage.addEventListener("wheel", onWheel, { passive: false });
  if (axis) axis.addEventListener("wheel", onWheel, { passive: false });

  // Drag on price axis (window-level move so redraw won't kill drag)
  var dragTarget = axis || stage;
  var dragging = false;
  var startY = 0;
  var startZoom = 1;

  function onWinMove(e) {
    if (!dragging) return;
    var clientY = e.clientY != null ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : null);
    if (clientY == null) return;
    var dy = startY - clientY;
    var next = startZoom + dy / 60;
    if (!setZoom(next)) return;
    // re-render chart while keeping window listeners
    var body = document.getElementById("mapBody");
    if (!body) return;
    body.innerHTML = renderMapPanel(mapLastL);
    // re-get elements (listeners stay on window)
    stage = document.getElementById("mapStage");
    axis = document.getElementById("mapPriceAxis");
    if (stage) stage.addEventListener("wheel", onWheel, { passive: false });
    if (axis) {
      axis.addEventListener("wheel", onWheel, { passive: false });
      axis.style.cursor = "ns-resize";
    }
  }
  function onWinUp() {
    if (!dragging) return;
    dragging = false;
    window.removeEventListener("pointermove", onWinMove);
    window.removeEventListener("pointerup", onWinUp);
    window.removeEventListener("pointercancel", onWinUp);
    window.removeEventListener("mousemove", onWinMove);
    window.removeEventListener("mouseup", onWinUp);
    window.removeEventListener("touchmove", onWinMove);
    window.removeEventListener("touchend", onWinUp);
    fullRedraw();
  }

  function startDrag(clientY) {
    dragging = true;
    startY = clientY;
    startZoom = mapZoom;
    window.addEventListener("pointermove", onWinMove);
    window.addEventListener("pointerup", onWinUp);
    window.addEventListener("pointercancel", onWinUp);
    window.addEventListener("mousemove", onWinMove);
    window.addEventListener("mouseup", onWinUp);
    window.addEventListener("touchmove", onWinMove, { passive: false });
    window.addEventListener("touchend", onWinUp);
  }

  if (dragTarget) {
    dragTarget.style.cursor = "ns-resize";
    dragTarget.onpointerdown = function (e) {
      e.preventDefault();
      e.stopPropagation();
      startDrag(e.clientY);
    };
    dragTarget.onmousedown = function (e) {
      e.preventDefault();
      startDrag(e.clientY);
    };
    dragTarget.ontouchstart = function (e) {
      if (!e.touches || !e.touches[0]) return;
      startDrag(e.touches[0].clientY);
    };
    dragTarget.ondblclick = function (e) {
      e.preventDefault();
      mapZoom = 1;
      fullRedraw();
    };
  }
}




function mapRangeN(range) {
  if (range === "50") return 50;
  if (range === "100") return 100;
  return null;
}

function maxOiNearClose(data, exp, close, nEach, dateIdx) {
  var block = data && data.by_expiration && data.by_expiration[exp];
  if (!block || !block.rows || !block.rows.length || dateIdx < 0) {
    return { support: null, resistance: null };
  }
  var rows = block.rows.map(function (r) {
    return {
      strike: Number(r.strike),
      call: Number((r.calls && r.calls[dateIdx]) || 0),
      put: Number((r.puts && r.puts[dateIdx]) || 0),
    };
  });
  // نفس منطق filterStrikes في الجدول: أقرب n*2 سترايك من الإغلاق بالمسافة
  if (close != null && !isNaN(Number(close)) && nEach != null) {
    var c = Number(close);
    rows = rows
      .map(function (r) { return { r: r, dist: Math.abs(r.strike - c) }; })
      .sort(function (a, b) { return a.dist - b.dist; })
      .slice(0, nEach * 2)
      .map(function (x) { return x.r; })
      .sort(function (a, b) { return a.strike - b.strike; });
  } else {
    rows.sort(function (a, b) { return a.strike - b.strike; });
  }
  var maxPut = -1, maxCall = -1, sup = null, res = null;
  rows.forEach(function (r) {
    if (r.put > maxPut) { maxPut = r.put; sup = r.strike; }
    if (r.call > maxCall) { maxCall = r.call; res = r.strike; }
  });
  return { support: sup, resistance: res };
}

async function levelsForMapRange(baseL, range) {
  if (!baseL) return baseL;
  if (!range || range === "ALL") return baseL;
  var data;
  try { data = await loadTicker(state.ticker); } catch (e) { return baseL; }
  var nEach = mapRangeN(range);
  var close = baseL.close != null ? baseL.close : data.close;
  var pullDates = data.pull_dates || [];
  var lastIdx = pullDates.length - 1;
  var prevIdx = pullDates.length > 1 ? pullDates.length - 2 : -1;
  var L2 = JSON.parse(JSON.stringify(baseL));
  L2.mapRange = range;
  L2.close = close;
  ["daily", "tomorrow", "weekly", "opx", "next_opx"].forEach(function (key) {
    var band = L2[key] || {};
    var exp = band.exp;
    if (!exp) return;
    var cur = maxOiNearClose(data, exp, close, nEach, lastIdx);
    var old = prevIdx >= 0 ? maxOiNearClose(data, exp, close, nEach, prevIdx) : {};
    L2[key] = Object.assign({}, band, {
      support: cur.support,
      resistance: cur.resistance,
      prev_support: old.support != null ? old.support : null,
      prev_resistance: old.resistance != null ? old.resistance : null,
      range: range,
    });
  });
  return L2;
}

function mapRangeChip(val, cur) {
  var active = (cur || "ALL") === val ? " active" : "";
  return (
    '<button type="button" class="map-range-chip' + active + '" data-map-range="' + val + '">' +
    val + "</button>"
  );
}

function mapRangeHint(range) {
  if (range === "50") return "50 سترايك تحت الإغلاق + 50 فوق";
  if (range === "100") return "100 سترايك تحت الإغلاق + 100 فوق";
  return "ALL — القاع والقمة على كل السترايكات";
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
    const raw = (all.tickers || {})[state.ticker];
    if (!raw) throw new Error("لا مستويات لـ " + state.ticker);
    mapZoom = 1;
    mapRawL = raw;
    const L = await levelsForMapRange(raw, state.mapRange || "ALL");
    title.textContent = state.ticker;
    if (sub) {
      sub.textContent = "";
      sub.style.display = "none";
    }
    body.innerHTML = renderMapPanel(L);
    bindMapZoom(L);
  } catch (e) {
    body.innerHTML =
      '<p style="color:#f87171">' + (e.message || e) + "</p>" +
      '<p style="color:#94a3b8;font-size:12px">بعد دمج الكود، شغّل Actions مرة لينشأ data/levels.json</p>';
  }
}

async function setMapRange(range) {
  state.mapRange = range || "ALL";
  if (!$("#mapModal") || $("#mapModal").classList.contains("hidden")) return;
  const body = $("#mapBody");
  if (!body) return;
  body.innerHTML = '<p style="color:#94a3b8">جاري تحديث النطاق…</p>';
  try {
    var raw = mapRawL;
    if (!raw) {
      const all = await loadLevels();
      raw = (all.tickers || {})[state.ticker];
      mapRawL = raw;
    }
    if (!raw) throw new Error("لا بيانات");
    mapZoom = 1;
    const L = await levelsForMapRange(raw, state.mapRange);
    body.innerHTML = renderMapPanel(L);
    bindMapZoom(L);
  } catch (e) {
    body.innerHTML = '<p style="color:#f87171">' + (e.message || e) + "</p>";
  }
}

function closeMap() {
  const modal = $("#mapModal");
  if (modal) modal.classList.add("hidden");
}



// —— تعليقات خاصة (Web3Forms) ——
// ضعي مفتاحك من https://web3forms.com بعد التسجيل (Access Key)
const FEEDBACK_ACCESS_KEY = "53716803-35b4-4c15-a27e-0cde07f2e555";

function openFeedback() {
  const modal = $("#feedbackModal");
  if (!modal) return;
  const st = $("#fbStatus");
  if (st) st.textContent = "";
  modal.classList.remove("hidden");
}
function closeFeedback() {
  const modal = $("#feedbackModal");
  if (modal) modal.classList.add("hidden");
}
async function submitFeedback(e) {
  if (e && e.preventDefault) e.preventDefault();
  const st = $("#fbStatus");
  const msg = ($("#fbMsg") && $("#fbMsg").value || "").trim();
  const name = ($("#fbName") && $("#fbName").value || "").trim();
  if (!msg) {
    if (st) st.textContent = "اكتبي التعليق أولًا";
    return;
  }
  if (!FEEDBACK_ACCESS_KEY) {
    if (st) st.textContent = "لم يُضبط مفتاح الإرسال بعد (Web3Forms)";
    setStatus("أضيفي FEEDBACK_ACCESS_KEY في app.js", "err");
    return;
  }
  if (st) st.textContent = "جاري الإرسال…";
  try {
    const res = await fetch("https://api.web3forms.com/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        access_key: FEEDBACK_ACCESS_KEY,
        subject: "Oi Web — تعليق جديد",
        from_name: name || "زائر Oi",
        message: msg,
        ticker: state.ticker || "",
      }),
    });
    const data = await res.json();
    if (data.success) {
      if (st) st.textContent = "✅ تم الإرسال — شكرًا لك";
      if ($("#fbMsg")) $("#fbMsg").value = "";
      if ($("#fbName")) $("#fbName").value = "";
      setStatus("✅ وصل تعليقك", "ok");
      setTimeout(closeFeedback, 1200);
    } else {
      if (st) st.textContent = data.message || "تعذر الإرسال";
    }
  } catch (err) {
    if (st) st.textContent = "خطأ شبكة — حاولي لاحقًا";
  }
}

document.addEventListener("DOMContentLoaded", init);

// ========== Reports ==========
function getViewForExp(data, expiration, daysLimit, strikesLimit) {
  var block = data.by_expiration[expiration];
  if (!block) return null;
  var pullDates = lastN(data.pull_dates || [], daysLimit);
  if (!pullDates.length) return null;
  var fullDates = data.pull_dates || [];
  var idx = pullDates.map(function (d) { return fullDates.indexOf(d); });
  var rows = block.rows.map(function (r) {
    return {
      strike: r.strike,
      calls: idx.map(function (i) { return i >= 0 ? (r.calls[i] || 0) : 0; }),
      puts: idx.map(function (i) { return i >= 0 ? (r.puts[i] || 0) : 0; }),
    };
  });
  rows = filterStrikes(rows, data.close, strikesLimit);
  return { pullDates: pullDates, rows: rows, close: data.close, expiration: expiration };
}

function topNMetric(rows, side, metric, gDays, limit) {
  var items = [];
  rows.forEach(function (r) {
    var arr = side === "call" ? r.calls : r.puts;
    if (!arr || arr.length < 2) return;
    var val = metric === "delta"
      ? positiveDelta(arr[arr.length - 1], arr[arr.length - 2])
      : positiveGrowth(arr, gDays);
    if (val != null && val > 0) {
      items.push({ strike: r.strike, value: val, side: side });
    }
  });
  items.sort(function (a, b) { return b.value - a.value; });
  return items.slice(0, limit);
}

function peakTroughOfView(view) {
  var lastI = view.pullDates.length - 1;
  var prevI = lastI - 1;
  var maxCall = -1, maxCallStrike = null;
  var maxPut = -1, maxPutStrike = null;
  var prevMaxCallStrike = null, prevMaxPutStrike = null;
  view.rows.forEach(function (r) {
    var c = r.calls[lastI] || 0;
    var p = r.puts[lastI] || 0;
    if (c > maxCall) { maxCall = c; maxCallStrike = r.strike; }
    if (p > maxPut) { maxPut = p; maxPutStrike = r.strike; }
  });
  if (prevI >= 0) {
    var pc = -1, pp = -1;
    view.rows.forEach(function (r) {
      var c = r.calls[prevI] || 0;
      var p = r.puts[prevI] || 0;
      if (c > pc) { pc = c; prevMaxCallStrike = r.strike; }
      if (p > pp) { pp = p; prevMaxPutStrike = r.strike; }
    });
  }
  function move(cur, prev) {
    if (cur == null || prev == null) return "—";
    if (Number(cur) === Number(prev)) return "ثابت";
    if (Number(cur) > Number(prev)) return "↑";
    return "↓";
  }
  return {
    trough: {
      strike: maxCallStrike,
      oi: maxCall > 0 ? maxCall : null,
      move: move(maxCallStrike, prevMaxCallStrike),
      exp: view.expiration,
    },
    peak: {
      strike: maxPutStrike,
      oi: maxPut > 0 ? maxPut : null,
      move: move(maxPutStrike, prevMaxPutStrike),
      exp: view.expiration,
    },
  };
}

function buildStrikeScores(deltaCall, deltaPut, growthCall, growthPut, troughs, peaks, close) {
  var map = {};
  function bump(strike, pts, reason) {
    if (strike == null) return;
    var k = String(strike);
    if (!map[k]) map[k] = { strike: Number(strike), score: 0, reasons: [] };
    map[k].score += pts;
    if (reason) map[k].reasons.push(reason);
  }
  deltaCall.forEach(function (x, i) {
    bump(x.strike, Math.max(1, 6 - i), "Δ Call #" + (i + 1));
  });
  deltaPut.forEach(function (x, i) {
    bump(x.strike, Math.max(1, 6 - i), "Δ Put #" + (i + 1));
  });
  growthCall.forEach(function (x, i) {
    bump(x.strike, Math.max(1, 5 - i), "G Call #" + (i + 1));
  });
  growthPut.forEach(function (x, i) {
    bump(x.strike, Math.max(1, 5 - i), "G Put #" + (i + 1));
  });
  troughs.forEach(function (t) {
    if (t.oi) bump(t.strike, 4, "قاع " + t.exp);
  });
  peaks.forEach(function (p) {
    if (p.oi) bump(p.strike, 4, "قمة " + p.exp);
  });
  if (close != null) {
    Object.keys(map).forEach(function (k) {
      var dist = Math.abs(map[k].strike - close);
      if (dist <= close * 0.02) { map[k].score += 3; map[k].reasons.push("قرب الإغلاق"); }
      else if (dist <= close * 0.05) { map[k].score += 1; map[k].reasons.push("قريب من السعر"); }
    });
  }
  var list = Object.keys(map).map(function (k) { return map[k]; });
  list.sort(function (a, b) { return b.score - a.score; });
  return list.slice(0, 8);
}

function repeatedStrikes(items) {
  // items: [{strike, exp}]
  var dict = {};
  items.forEach(function (it) {
    if (it.strike == null) return;
    var k = String(it.strike);
    if (!dict[k]) dict[k] = [];
    if (dict[k].indexOf(it.exp) < 0) dict[k].push(it.exp);
  });
  var out = [];
  Object.keys(dict).forEach(function (k) {
    if (dict[k].length > 1) {
      out.push({ strike: Number(k), days: dict[k].slice().sort() });
    }
  });
  out.sort(function (a, b) { return b.strike - a.strike; });
  return out;
}

function confidenceOf(top) {
  if (!top) return { level: "low", label: "منخفضة" };
  if (top.score >= 12) return { level: "high", label: "عالية" };
  if (top.score >= 7) return { level: "mid", label: "متوسطة" };
  return { level: "low", label: "منخفضة" };
}

function computeReports(data, selectedExps, daysLimit, strikesLimit, topN, gDays) {
  var deltaCall = [], deltaPut = [], growthCall = [], growthPut = [];
  var troughs = [], peaks = [];
  selectedExps.forEach(function (exp) {
    var view = getViewForExp(data, exp, daysLimit, strikesLimit);
    if (!view || !view.rows.length) return;
    topNMetric(view.rows, "call", "delta", gDays, topN).forEach(function (x) {
      x.exp = exp; deltaCall.push(x);
    });
    topNMetric(view.rows, "put", "delta", gDays, topN).forEach(function (x) {
      x.exp = exp; deltaPut.push(x);
    });
    topNMetric(view.rows, "call", "growth", gDays, topN).forEach(function (x) {
      x.exp = exp; growthCall.push(x);
    });
    topNMetric(view.rows, "put", "growth", gDays, topN).forEach(function (x) {
      x.exp = exp; growthPut.push(x);
    });
    var pt = peakTroughOfView(view);
    troughs.push(pt.trough);
    peaks.push(pt.peak);
  });
  // merge top across exps by value
  function mergeTop(arr, limit) {
    var copy = arr.slice();
    copy.sort(function (a, b) { return b.value - a.value; });
    return copy.slice(0, limit);
  }
  deltaCall = mergeTop(deltaCall, topN);
  deltaPut = mergeTop(deltaPut, topN);
  growthCall = mergeTop(growthCall, topN);
  growthPut = mergeTop(growthPut, topN);

  var scores = buildStrikeScores(
    deltaCall, deltaPut, growthCall, growthPut, troughs, peaks, data.close
  );
  var top = scores[0] || null;
  var conf = confidenceOf(top);
  var insight = "لا إشارات كافية بعد — جرّبي تواريخ/أيام أكثر أو Top أعلى.";
  if (top) {
    var bias = "";
    var putHints = deltaPut.length + growthPut.length;
    var callHints = deltaCall.length + growthCall.length;
    if (putHints > callHints + 1) bias = "ميل Put (ضغط هابط)";
    else if (callHints > putHints + 1) bias = "ميل Call (اهتمام صاعد)";
    else bias = "متوازن بين الجهتين";
    insight =
      "أقوى مستوى عند " +
      top.strike +
      " — نقاط " +
      top.score +
      " · " +
      bias +
      (top.reasons && top.reasons.length
        ? " · (" + top.reasons.slice(0, 4).join("، ") + ")"
        : "");
  }
  return {
    deltaCall: deltaCall,
    deltaPut: deltaPut,
    growthCall: growthCall,
    growthPut: growthPut,
    troughs: troughs,
    peaks: peaks,
    repTrough: repeatedStrikes(troughs.map(function (t) { return { strike: t.strike, exp: t.exp }; })),
    repPeak: repeatedStrikes(peaks.map(function (p) { return { strike: p.strike, exp: p.exp }; })),
    scores: scores,
    top: top,
    conf: conf,
    insight: insight,
    close: data.close,
    gDays: gDays,
    topN: topN,
  };
}

function repRowsHtml(items, valueLabel) {
  if (!items || !items.length) {
    return '<tr><td colspan="4" style="color:var(--gray)">لا نتائج</td></tr>';
  }
  return items
    .map(function (x, i) {
      return (
        "<tr><td>" +
        (i + 1) +
        "</td><td>" +
        x.strike +
        "</td><td>" +
        Number(x.value).toLocaleString() +
        "</td><td>" +
        (x.exp || "") +
        "</td></tr>"
      );
    })
    .join("");
}


function formatExpAr(iso) {
  if (!iso) return "";
  var p = String(iso).split("-");
  if (p.length < 3) return iso;
  var months = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
  var m = parseInt(p[1], 10);
  var d = parseInt(p[2], 10);
  if (!m || !d) return iso;
  return d + " " + months[m - 1];
}

function buildInsightSentence(rep, ticker) {
  if (!rep.top) {
    return "لا يظهر مستوى بارز على " + ticker + " ضمن التواريخ المختارة.";
  }
  var t0 = rep.top.strike;
  var conf = rep.conf.label;
  var putN = (rep.deltaPut || []).length + (rep.growthPut || []).length;
  var callN = (rep.deltaCall || []).length + (rep.growthCall || []).length;
  var side =
    putN > callN + 1 ? "Put" : callN > putN + 1 ? "Call" : "متوازن";
  var near = "";
  if (rep.close != null) {
    var dist = Math.abs(t0 - rep.close);
    var pct = rep.close ? (dist / rep.close) * 100 : 0;
    if (pct <= 2) near = "قريب جدًا من الإغلاق";
    else if (pct <= 5) near = "في محيط السعر";
    else near = "أبعد نسبيًا عن الإغلاق";
  }
  return {
    line1: "أبرز مستوى: " + t0 + " · ثقة " + conf,
    line2: "الميل: " + side + (near ? " · " + near : ""),
    line3: "النقاط تجمع إشارات Call و Put معًا (Δ + G + قمم/قيعان).",
    side: side,
    strike: t0,
    conf: conf,
  };
}

function moveIcon(move) {
  if (move === "↑") return '<span class="mv-up">↑</span>';
  if (move === "↓") return '<span class="mv-down">↓</span>';
  if (move === "ثابت") return '<span class="mv-flat">●</span>';
  return move || "—";
}

function renderReportsResult(rep, ticker) {
  var insight = buildInsightSentence(rep, ticker || state.ticker);
  if (typeof insight === "string") {
    insight = { line1: insight, line2: "", line3: "", side: "", strike: null, conf: "" };
  }
  rep.insightText =
    insight.line1 +
    (insight.line2 ? " — " + insight.line2 : "") +
    (insight.line3 ? " " + insight.line3 : "");

  var html = "";
  html += '<div class="rep-insight rep-insight-soft">';
  html += '<div class="rep-insight-title">الملخص</div>';
  html += '<div class="rep-insight-main">🎯 ' + insight.line1 + "</div>";
  if (insight.line2) html += '<div class="rep-insight-sub">📊 ' + insight.line2 + "</div>";
  if (insight.line3) html += '<div class="rep-insight-note">ℹ️ ' + insight.line3 + "</div>";
  html += '<div class="rep-insight-meta">';
  html += "G = " + rep.gDays + " · أعلى " + rep.topN;
  if (rep.close != null) {
    html +=
      " · الإغلاق " +
      Number(rep.close).toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  if (insight.strike != null) {
    html +=
      ' · <span class="rep-badge ' +
      rep.conf.level +
      '">' +
      rep.conf.label +
      "</span>";
  }
  html += "</div></div>";

  function metricCard(title, tagClass, tagText, items) {
    var h =
      '<div class="rep-card"><div class="rep-card-title">' +
      title +
      ' <span class="tag ' +
      tagClass +
      '">' +
      tagText +
      "</span></div>";
    h +=
      '<table class="rep-table" dir="ltr"><thead><tr><th>الترتيب</th><th>Strike</th><th>القيمة</th><th>اليوم</th></tr></thead><tbody>';
    if (!items || !items.length) {
      h += '<tr><td colspan="4" class="rep-empty">لا نتائج</td></tr>';
    } else {
      items.forEach(function (x, i) {
        h +=
          "<tr><td>" +
          (i + 1) +
          "</td><td><b>" +
          x.strike +
          "</b></td><td>" +
          Number(x.value).toLocaleString() +
          "</td><td>" +
          formatExpAr(x.exp) +
          "</td></tr>";
      });
    }
    h += "</tbody></table></div>";
    return h;
  }

  // يمين = تزايد، يسار = نمو → مع dir=rtl على الشبكة
  html += '<div class="rep-section-label">Call</div>';
  html += '<div class="rep-grid rep-grid-rtl">';
  html += metricCard("التزايد", "tag-delta", "Δ", rep.deltaCall);
  html += metricCard("النمو", "tag-growth", "G", rep.growthCall);
  html += "</div>";

  html += '<div class="rep-section-label">Put</div>';
  html += '<div class="rep-grid rep-grid-rtl">';
  html += metricCard("التزايد", "tag-delta", "Δ", rep.deltaPut);
  html += metricCard("النمو", "tag-growth", "G", rep.growthPut);
  html += "</div>";

  function levelCard(kind, list, repeated) {
    var isPeak = kind === "peak";
    var title = isPeak ? "القمم" : "القيعان";
    var cls = isPeak ? "rep-card-peak" : "rep-card-trough";
    var repLabel = isPeak ? "قمم متكررة" : "قيعان متكررة";
    var h = '<div class="rep-card ' + cls + '">';
    h += '<div class="rep-card-title center">' + title + "</div>";
    h +=
      '<table class="rep-table" dir="ltr"><thead><tr><th>Strike</th><th>OI</th><th>الحركة</th><th>اليوم</th></tr></thead><tbody>';
    if (!list || !list.length) {
      h += '<tr><td colspan="4" class="rep-empty">—</td></tr>';
    } else {
      list.forEach(function (x) {
        h +=
          "<tr><td><b>" +
          (x.strike != null ? x.strike : "—") +
          "</b></td><td>" +
          (x.oi != null ? Number(x.oi).toLocaleString() : "—") +
          "</td><td>" +
          moveIcon(x.move) +
          "</td><td>" +
          formatExpAr(x.exp) +
          "</td></tr>";
      });
    }
    h += "</tbody></table>";
    if (repeated && repeated.length) {
      h += '<div class="rep-repeat-title">' + repLabel + "</div>";
      h += '<div class="rep-repeat-list">';
      repeated.forEach(function (r) {
        h +=
          '<div class="rep-repeat-line"><b>' +
          r.strike +
          "</b> — " +
          r.days.map(formatExpAr).join(" · ") +
          "</div>";
      });
      h += "</div>";
    }
    h += "</div>";
    return h;
  }

  html += '<div class="rep-grid rep-grid-rtl">';
  html += levelCard("trough", rep.troughs, rep.repTrough);
  html += levelCard("peak", rep.peaks, rep.repPeak);
  html += "</div>";

  html += '<div class="rep-card rep-score-card">';
  html += '<div class="rep-card-title center">سكور</div>';
  html +=
    '<p class="rep-score-hint">النقاط من Call و Put معًا (تزايد + نمو + ظهور كقمة/قاع). الرقم الأعلى = أقوى مرشح.</p>';
  html +=
    '<table class="rep-table" dir="ltr"><thead><tr><th></th><th>Strike</th><th>النقاط</th><th>لماذا</th></tr></thead><tbody>';
  if (!rep.scores || !rep.scores.length) {
    html += '<tr><td colspan="4" class="rep-empty">—</td></tr>';
  } else {
    rep.scores.forEach(function (s, i) {
      html +=
        "<tr class='" +
        (i === 0 ? "rep-top-row" : "") +
        "'><td>" +
        (i + 1) +
        "</td><td><b>" +
        s.strike +
        "</b></td><td><b>" +
        s.score +
        "</b></td><td class='rep-reasons'>" +
        (s.reasons || []).join(" · ") +
        "</td></tr>";
    });
  }
  html += "</tbody></table></div>";
  return html;
}

function paintCell(cell, argb, bold, align) {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb } };
  cell.font = { name: "Calibri", size: 11, bold: !!bold };
  cell.alignment = {
    horizontal: align || "center",
    vertical: "middle",
    wrapText: true,
  };
}

async function exportReportsExcel(rep, ticker) {
  if (typeof ExcelJS === "undefined") throw new Error("ExcelJS غير محمّل");
  var insight = buildInsightSentence(rep, ticker);
  var insightText =
    typeof insight === "string"
      ? insight
      : [insight.line1, insight.line2, insight.line3].filter(Boolean).join(" | ");
  rep.insightText = insightText;

  var wb = new ExcelJS.Workbook();
  var ws = wb.addWorksheet("Reports");
  for (var c = 1; c <= 13; c++) ws.getColumn(c).width = 12;

  ws.getCell(2, 2).value = String(ticker) + " · Reports";
  ws.getCell(2, 2).font = { name: "Calibri", size: 16, bold: true };
  ws.getCell(2, 2).alignment = { horizontal: "center", vertical: "middle" };
  try {
    ws.mergeCells(2, 2, 2, 11);
  } catch (e) {}

  ws.getCell(3, 2).value = insightText;
  ws.getCell(3, 2).font = { name: "Calibri", size: 11 };
  ws.getCell(3, 2).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  try {
    ws.mergeCells(3, 2, 4, 11);
  } catch (e) {}
  ws.getRow(3).height = 36;

  var fillD = "FFE4E4D2";
  var fillG = "FFD8E7E7";
  var headD = "FFD4D0B8";
  var headG = "FFB8D4D4";
  var fillPeak = "FFE6FFFA";
  var headPeak = "FF99F6E4";
  var fillTrough = "FFF3E8FF";
  var headTrough = "FFE9D5FF";
  var headS = "FFC8C4D6";

  function writeMetricBlock(r, col, title, items, headFill, bodyFill) {
    ws.getCell(r, col).value = title;
    for (var i = 0; i < 4; i++) paintCell(ws.getCell(r, col + i), headFill, true);
    try {
      ws.mergeCells(r, col, r, col + 3);
    } catch (e) {}
    r++;
    ["الترتيب", "Strike", "القيمة", "اليوم"].forEach(function (h, idx) {
      ws.getCell(r, col + idx).value = h;
      paintCell(ws.getCell(r, col + idx), "FFF1F5F9", true);
    });
    r++;
    var list = items || [];
    if (!list.length) {
      ws.getCell(r, col).value = "—";
      for (var z = 0; z < 4; z++) paintCell(ws.getCell(r, col + z), bodyFill, false);
      r++;
    } else {
      for (var k = 0; k < list.length; k++) {
        var x = list[k];
        ws.getCell(r, col).value = k + 1;
        ws.getCell(r, col + 1).value = x.strike;
        ws.getCell(r, col + 2).value = x.value;
        ws.getCell(r, col + 2).numFmt = "#,##0";
        ws.getCell(r, col + 3).value = formatExpAr(x.exp);
        for (var z2 = 0; z2 < 4; z2++) paintCell(ws.getCell(r, col + z2), bodyFill, false);
        r++;
      }
    }
    return r;
  }

  function writeLevels(r, col, title, list, repeated, headFill, bodyFill, repTitle) {
    ws.getCell(r, col).value = title;
    for (var i = 0; i < 4; i++) paintCell(ws.getCell(r, col + i), headFill, true);
    try {
      ws.mergeCells(r, col, r, col + 3);
    } catch (e) {}
    r++;
    ["Strike", "OI", "الحركة", "اليوم"].forEach(function (h, idx) {
      ws.getCell(r, col + idx).value = h;
      paintCell(ws.getCell(r, col + idx), "FFF8FAFC", true);
    });
    r++;
    (list || []).forEach(function (x) {
      ws.getCell(r, col).value = x.strike != null ? x.strike : "";
      ws.getCell(r, col + 1).value = x.oi != null ? x.oi : "";
      if (x.oi != null) ws.getCell(r, col + 1).numFmt = "#,##0";
      ws.getCell(r, col + 2).value = x.move || "";
      ws.getCell(r, col + 3).value = formatExpAr(x.exp);
      for (var z = 0; z < 4; z++) paintCell(ws.getCell(r, col + z), bodyFill, false);
      r++;
    });
    if (repeated && repeated.length) {
      ws.getCell(r, col).value = repTitle;
      for (var i2 = 0; i2 < 4; i2++) paintCell(ws.getCell(r, col + i2), headFill, true);
      try {
        ws.mergeCells(r, col, r, col + 3);
      } catch (e) {}
      r++;
      repeated.forEach(function (rp) {
        ws.getCell(r, col).value = rp.strike;
        ws.getCell(r, col + 1).value = rp.days.map(formatExpAr).join(" · ");
        try {
          ws.mergeCells(r, col + 1, r, col + 3);
        } catch (e) {}
        for (var z3 = 0; z3 < 4; z3++) paintCell(ws.getCell(r, col + z3), bodyFill, false);
        r++;
      });
    }
    return r;
  }

  var row = 6;
  // يمين التزايد (أعمدة 7-10) يسار النمو (2-5) في ملف LTR: نضع التزايد على 7 والنمو على 2
  // المستخدم: يمين تزايد يسار نمو → في Excel LTR: نمو col2، تزايد col7
  var r1 = writeMetricBlock(row, 2, "النمو · Call · G", rep.growthCall, headG, fillG);
  var r2 = writeMetricBlock(row, 7, "التزايد · Call · Δ", rep.deltaCall, headD, fillD);
  row = Math.max(r1, r2) + 1;

  r1 = writeMetricBlock(row, 2, "النمو · Put · G", rep.growthPut, headG, fillG);
  r2 = writeMetricBlock(row, 7, "التزايد · Put · Δ", rep.deltaPut, headD, fillD);
  row = Math.max(r1, r2) + 1;

  r1 = writeLevels(row, 2, "القيعان", rep.troughs, rep.repTrough, headTrough, fillTrough, "قيعان متكررة");
  r2 = writeLevels(row, 7, "القمم", rep.peaks, rep.repPeak, headPeak, fillPeak, "قمم متكررة");
  row = Math.max(r1, r2) + 1;

  ws.getCell(row, 2).value = "سكور";
  for (var s = 2; s <= 11; s++) paintCell(ws.getCell(row, s), headS, true);
  try {
    ws.mergeCells(row, 2, row, 11);
  } catch (e) {}
  row++;
  ws.getCell(row, 2).value = "";
  ws.getCell(row, 3).value = "Strike";
  ws.getCell(row, 4).value = "النقاط";
  ws.getCell(row, 5).value = "لماذا";
  for (var h = 2; h <= 5; h++) paintCell(ws.getCell(row, h), "FFEDE9FE", true);
  try {
    ws.mergeCells(row, 5, row, 11);
  } catch (e) {}
  row++;
  (rep.scores || []).forEach(function (s, i) {
    ws.getCell(row, 2).value = i + 1;
    ws.getCell(row, 3).value = s.strike;
    ws.getCell(row, 4).value = s.score;
    ws.getCell(row, 5).value = (s.reasons || []).join(" · ");
    try {
      ws.mergeCells(row, 5, row, 11);
    } catch (e) {}
    var bg = i === 0 ? "FFE0E7FF" : "FFF5F3FF";
    for (var c2 = 2; c2 <= 11; c2++) paintCell(ws.getCell(row, c2), bg, i === 0);
    ws.getCell(row, 5).alignment = { horizontal: "right", vertical: "middle", wrapText: true };
    row++;
  });

  var buf = await wb.xlsx.writeBuffer();
  var blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  try {
    if (typeof saveAs === "function") saveAs(blob, String(ticker) + "_Reports.xlsx");
    else throw new Error("no saveAs");
  } catch (e1) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = String(ticker) + "_Reports.xlsx";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      try {
        URL.revokeObjectURL(url);
      } catch (e) {}
      try {
        a.remove();
      } catch (e) {}
    }, 1500);
  }
}

function openReports() {
  var data = state.cache[state.ticker];
  if (!data) {
    setStatus("لا بيانات — انتظر التحميل أو حدد مؤشرًا", "err");
    return;
  }
  var modal = document.getElementById("reportsModal");
  var body = document.getElementById("reportsBody");
  var sub = document.getElementById("reportsSub");
  if (!modal || !body) {
    setStatus("نافذة Reports غير موجودة", "err");
    return;
  }
  if (sub) sub.textContent = state.ticker + " · حدد التواريخ ثم توليد التقرير";

  var allExps = Object.keys(data.by_expiration || {}).sort();
  var exps = futureExpirations(allExps);
  if (!exps.length) {
    setStatus("لا تواريخ انتهاء متاحة", "err");
    return;
  }
  var curExp = state.expiration;
  var html = "";
  html += '<div class="rep-controls">';
  html += '<div class="exp-export-block"><div class="exp-export-head"><b>تواريخ الانتهاء</b>';
  html += '<button type="button" class="btn btn-sm" id="repSelectAll">تحديد الكل</button></div>';
  html += '<div class="exp-checks">';
  exps.forEach(function (exp) {
    var chk = exp === curExp ? " checked" : "";
    html +=
      '<label class="exp-check"><input type="checkbox" data-rexp="' +
      exp +
      '"' +
      chk +
      "/> " +
      exp +
      "</label>";
  });
  html += "</div></div>";

  html += '<div class="exp-export-row"><span>Days</span>';
  ["2", "3", "5", "10", "ALL"].forEach(function (d) {
    var on = String(state.days) === d ? " on" : "";
    html +=
      '<button type="button" class="chip' + on + '" data-rdays="' + d + '">' + d + "</button>";
  });
  html += "</div>";

  html += '<div class="exp-export-row"><span>Strikes</span>';
  ["30", "50", "100", "ALL"].forEach(function (s) {
    var on = String(state.strikes) === s ? " on" : "";
    html +=
      '<button type="button" class="chip' + on + '" data-rstrikes="' + s + '">' + s + "</button>";
  });
  html += "</div>";

  html += '<div class="exp-export-row rep-input-row"><span>N</span>';
  html +=
    '<input id="repTopInput" class="rep-input" type="number" min="1" max="50" value="5" />';
  html += "</div>";

  html += '<div class="exp-export-row rep-input-row"><span>G</span>';
  html +=
    '<input id="repGrowthInput" class="rep-input" type="number" min="1" max="30" value="' +
    (parseInt(state.growthDays, 10) || 3) +
    '" />';
  html += "</div>";

  html += '<div class="rep-actions">';
  html += '<button type="button" class="btn btn-teal" id="repRunBtn">توليد التقرير</button>';
  html +=
    '<button type="button" class="btn btn-excel" id="repExcelBtn" disabled>تصدير Excel</button>';
  html += "</div></div>";
  html += '<div id="repResult" class="rep-result"></div>';
  body.innerHTML = html;
  modal.classList.remove("hidden");

  var rdays = String(state.days || "2");
  var rstrikes = String(state.strikes || "30");
  var lastRep = null;

  body.querySelectorAll("[data-rdays]").forEach(function (btn) {
    btn.onclick = function () {
      rdays = btn.getAttribute("data-rdays");
      body.querySelectorAll("[data-rdays]").forEach(function (b) {
        b.classList.toggle("on", b === btn);
      });
    };
  });
  body.querySelectorAll("[data-rstrikes]").forEach(function (btn) {
    btn.onclick = function () {
      rstrikes = btn.getAttribute("data-rstrikes");
      body.querySelectorAll("[data-rstrikes]").forEach(function (b) {
        b.classList.toggle("on", b === btn);
      });
    };
  });

  var selAll = document.getElementById("repSelectAll");
  if (selAll) {
    selAll.onclick = function () {
      body.querySelectorAll("input[data-rexp]").forEach(function (cb) {
        cb.checked = true;
      });
    };
  }

  var runBtn = document.getElementById("repRunBtn");
  var excelBtn = document.getElementById("repExcelBtn");
  var resultHost = document.getElementById("repResult");

  if (runBtn) {
    runBtn.onclick = function () {
      try {
        var selected = [];
        body.querySelectorAll("input[data-rexp]:checked").forEach(function (cb) {
          selected.push(cb.getAttribute("data-rexp"));
        });
        if (!selected.length) {
          if (resultHost)
            resultHost.innerHTML = '<p class="status err">حدد تاريخ انتهاء واحد على الأقل</p>';
          setStatus("حدد تاريخ انتهاء واحد على الأقل", "err");
          return;
        }
        var topEl = document.getElementById("repTopInput");
        var gEl = document.getElementById("repGrowthInput");
        var rtop = parseInt(topEl && topEl.value, 10) || 5;
        var rgrowth = parseInt(gEl && gEl.value, 10) || 3;
        if (rtop < 1) rtop = 5;
        if (rgrowth < 1) rgrowth = 3;
        lastRep = computeReports(data, selected, rdays, rstrikes, rtop, rgrowth);
        if (resultHost) {
          resultHost.innerHTML = renderReportsResult(lastRep, state.ticker);
          try {
            resultHost.scrollIntoView({ behavior: "smooth", block: "start" });
          } catch (e) {}
        }
        if (excelBtn) excelBtn.disabled = false;
        if (sub)
          sub.textContent = state.ticker + " · " + selected.length + " انتهاء · N " + rtop;
        setStatus("تم توليد التقرير", "ok");
      } catch (err) {
        console.error(err);
        if (resultHost)
          resultHost.innerHTML =
            '<p class="status err">خطأ: ' + (err && err.message ? err.message : err) + "</p>";
        setStatus("خطأ في التقرير: " + (err && err.message ? err.message : err), "err");
      }
    };
  }
  if (excelBtn) {
    excelBtn.onclick = async function () {
      if (!lastRep) {
        setStatus("ولّد التقرير أولًا قبل التصدير", "err");
        return;
      }
      excelBtn.disabled = true;
      try {
        await exportReportsExcel(lastRep, state.ticker);
        setStatus("تم تصدير Excel", "ok");
      } catch (err) {
        console.error(err);
        setStatus("فشل التصدير: " + (err && err.message ? err.message : err), "err");
      } finally {
        excelBtn.disabled = false;
      }
    };
  }
}

function closeReports() {
  var modal = document.getElementById("reportsModal");
  if (modal) modal.classList.add("hidden");
}


