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
  expiration: null, showDelta: false, dark: false, cache: {}, livePrice: null, mapRange: "ALL",
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

/** يكتب جدول انتهاء واحد في ورقة ExcelJS بدءًا من (startRow, startCol) — يعيد lastCol */
function writeOiTableToSheet(ws, startRow, startCol, view, ticker, showDelta) {
  const pullDates = view.pullDates;
  const rows = view.rows;
  const n = pullDates.length;
  const canDelta = showDelta && n >= 2;
  const lastI = n - 1;
  const prevI = n - 2;

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
  const fontHeader = { name: "Calibri", size: 11, bold: true };
  const fontBody = { name: "Calibri", size: 11 };
  const alignC = { horizontal: "center", vertical: "middle" };
  const border = {
    top: { style: "thin", color: { argb: "FFCBD5E1" } },
    bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
    left: { style: "thin", color: { argb: "FFCBD5E1" } },
    right: { style: "thin", color: { argb: "FFCBD5E1" } },
  };
  // ألوان هيدر مطابقة للديسكتوب
  const fillTitle = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE7E6E6" } };
  const fillSec = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2EFDA" } };
  const fillDates = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEECE1" } };
  const fillExp = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDD9C4" } };
  const fillDelta = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE4E4D2" } };
  const fontTitle = { name: "Calibri", size: 12, bold: true, color: { argb: "FF0F172A" } };

  const visual = [];
  if (canDelta) visual.push({ kind: "deltaCall" });
  for (let j = n - 1; j >= 0; j--) visual.push({ kind: "call", idx: j, label: pullDates[j] });
  visual.push({ kind: "strike" });
  for (let j = 0; j < n; j++) visual.push({ kind: "put", idx: j, label: pullDates[j] });
  if (canDelta) visual.push({ kind: "deltaPut" });
  const colDefs = visual.slice().reverse();
  const total = colDefs.length;
  const strikeCol = startCol + colDefs.findIndex(function (d) { return d.kind === "strike"; });

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
  const r0 = startRow;

  ws.mergeCells(r0, startCol, r0, endCol);
  ws.getCell(r0, startCol).value = ticker + "  |  " + view.expiration;
  styleRange(r0, startCol, endCol, { font: fontTitle, fill: fillTitle, align: alignC });

  // row 2: PUT | CALL labels simplified
  colDefs.forEach(function (def, i) {
    const c = startCol + i;
    const cell = ws.getCell(r0 + 1, c);
    cell.alignment = alignC;
    cell.font = fontHeader;
    cell.fill = fillSec;
    cell.border = border;
    if (def.kind === "strike") cell.value = "STRIKE";
    else if (def.kind === "call" || def.kind === "deltaCall") cell.value = "CALL";
    else if (def.kind === "put" || def.kind === "deltaPut") cell.value = "PUT";
  });

  // row 3 weekdays
  colDefs.forEach(function (def, i) {
    const c = startCol + i;
    const cell = ws.getCell(r0 + 2, c);
    cell.alignment = alignC;
    cell.font = fontBody;
    cell.fill = fillDates;
    cell.border = border;
    if (def.kind === "call" || def.kind === "put") {
      try {
        const p = def.label.split("-").map(Number);
        const dt = new Date(new Date().getFullYear(), p[1] - 1, p[0]);
        cell.value = dt.toLocaleString("en", { weekday: "short" });
      } catch (e) {
        cell.value = "";
      }
    } else if (def.kind === "deltaCall" || def.kind === "deltaPut") cell.value = "Δ";
    else cell.value = "";
  });

  // row 4 dates
  colDefs.forEach(function (def, i) {
    const c = startCol + i;
    const cell = ws.getCell(r0 + 3, c);
    cell.alignment = alignC;
    cell.font = fontHeader;
    cell.fill = fillExp;
    cell.border = border;
    if (def.kind === "call" || def.kind === "put") {
      const f = formatPullDate(def.label);
      cell.value = f.top || def.label;
    } else if (def.kind === "strike") cell.value = view.expiration;
    else if (def.kind === "deltaCall" || def.kind === "deltaPut") cell.value = "Δ";
  });

  rows.forEach(function (r, ri) {
    const rowIdx = r0 + 4 + ri;
    colDefs.forEach(function (def, i) {
      const cell = ws.getCell(rowIdx, startCol + i);
      cell.alignment = alignC;
      cell.font = fontBody;
      cell.border = border;
      if (def.kind === "strike") {
        const s = Number(r.strike);
        // عدد صحيح بلا نقطة · نصف سترايك إن وُجد بدون أصفار زائدة
        if (Math.abs(s - Math.round(s)) < 1e-9) {
          cell.value = Math.round(s);
          cell.numFmt = "0";
        } else {
          cell.value = Math.round(s * 100) / 100;
          cell.numFmt = "0.0";
        }
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

  for (let i = 0; i < total; i++) ws.getColumn(startCol + i).width = 11;
  ws.getColumn(strikeCol).width = 12;
  return endCol;
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
  const exps = Object.keys(data.by_expiration || {}).sort();
  if (!exps.length) {
    setStatus("لا تواريخ انتهاء للتصدير", "err");
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
  ["30", "50", "ALL"].forEach(function (s) {
    const on = String(state.strikes) === s ? " on" : "";
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
  let estrikes = String(state.strikes || "30");

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

    if (emode === "multi") {
      chosen.forEach(function (exp, i) {
        const view = getViewRowsFor(data, exp, edays, estrikes);
        if (!view) return;
        const ws = wb.addWorksheet(String(exp).slice(0, 31), {
          views: [{ rightToLeft: true, state: "frozen", ySplit: 4 }],
        });
        writeOiTableToSheet(ws, 1, 2, view, state.ticker, showDelta);
      });
    } else {
      const ws = wb.addWorksheet("Export", {
        views: [{ rightToLeft: true, state: "frozen", ySplit: 4 }],
      });
      let col = 2;
      chosen.forEach(function (exp) {
        const view = getViewRowsFor(data, exp, edays, estrikes);
        if (!view) return;
        const last = writeOiTableToSheet(ws, 1, col, view, state.ticker, showDelta);
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
    { key: "tomorrow", label: "بكرا" },
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


/** بكرا يوافق الجمعة/نفس انتهاء الأسبوع → نكتفي ببطاقة الأسبوع */

/** ترتيب بطاقات الماب حسب اليوم (جمعة الأسبوع vs باقي الأيام) */
function getMapBandDefs(L) {
  var meta = (L && L.meta) || {};
  var daily = (L && L.daily) || {};
  var weekly = (L && L.weekly) || {};
  var todayWeekly =
    meta.today_is_weekly === true ||
    (daily.exp && weekly.exp && daily.exp === weekly.exp);
  if (todayWeekly) {
    // يوم الجمعة / يوم الأوبكس الأسبوعي: الأسبوع أولًا ثم بكرا (الإثنين) ثم OPX
    return [
      { key: "weekly", label: "الأسبوع" },
      { key: "tomorrow", label: "بكرا" },
      { key: "opx", label: "OPX" },
      { key: "next_opx", label: "OPX+" },
    ];
  }
  return [
    { key: "daily", label: "اليوم" },
    { key: "tomorrow", label: "بكرا" },
    { key: "weekly", label: "الأسبوع" },
    { key: "opx", label: "OPX" },
    { key: "next_opx", label: "OPX+" },
  ];
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
    // تخطي بكرا إذا اندمجت مع الأسبوع
    if (b.key === "tomorrow" && shouldSkipTomorrow(L)) return;
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
    '<p class="map-range-intro">تُحدد القمم والقيعان بناءً على نطاق السترايكات المُختار<br><span class="map-range-sub" dir="rtl">(حيث ALL يمثل النطاق العام)</span></p>' +
    '<div class="map-range-row">' +
      mapRangeChip("50", state.mapRange) +
      mapRangeChip("100", state.mapRange) +
      mapRangeChip("ALL", state.mapRange) +
    "</div>" +
    '<p class="map-range-hint">' + mapRangeHint(state.mapRange || "ALL") + "</p>" +
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
  rows.sort(function (a, b) { return a.strike - b.strike; });
  if (close != null && !isNaN(Number(close)) && nEach != null) {
    var c = Number(close);
    var below = rows.filter(function (r) { return r.strike <= c; }).slice(-nEach);
    var above = rows.filter(function (r) { return r.strike >= c; }).slice(0, nEach);
    var keep = {};
    below.concat(above).forEach(function (r) { keep[r.strike] = true; });
    rows = rows.filter(function (r) { return keep[r.strike]; });
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
