const TICKERS = [
  { symbol: "SPY", name: "SPDR S&P 500", color: "#0D9488" },
  { symbol: "QQQ", name: "Invesco QQQ", color: "#2563EB" },
  { symbol: "IWM", name: "iShares Russell", color: "#0F172A" },
  { symbol: "GLD", name: "SPDR Gold", color: "#D97706" },
  { symbol: "SPX", name: "S&P 500 Index", color: "#7C3AED" },
];

const state = {
  ticker: "SPY", days: "2", strikes: "30",
  expiration: null, showDelta: false, dark: false, cache: {},
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
      renderTickers();
      refresh();
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
    (data.expirations || []).forEach(function (exp) {
      const o = document.createElement("option");
      o.value = exp;
      o.textContent = exp;
      sel.appendChild(o);
    });
    if (!state.expiration || !(data.expirations || []).includes(state.expiration)) {
      state.expiration = (data.expirations && data.expirations[0]) || null;
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
  const close = view.close;
  const canDelta = state.showDelta && pullDates.length >= 2;
  const lastI = pullDates.length - 1;
  const prevI = pullDates.length - 2;

  let html =
    '<div class="table-title">' +
    state.ticker +
    " | Exp: " +
    state.expiration;
  if (close != null) {
    html +=
      '<div class="close-pill">الإغلاق: ' +
      Number(close).toLocaleString(undefined, { maximumFractionDigits: 2 }) +
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
      html +=
        '<td class="' +
        callCls +
        ' delta">' +
        (d != null ? d.toLocaleString() : "") +
        "</td>";
    }
    for (let i = pullDates.length - 1; i >= 0; i--) {
      html +=
        '<td class="' +
        callCls +
        '">' +
        (r.calls[i] || 0).toLocaleString() +
        "</td>";
    }
    html += '<td class="strike">' + r.strike + "</td>";
    for (let i = 0; i < pullDates.length; i++) {
      html +=
        '<td class="' +
        putCls +
        '">' +
        (r.puts[i] || 0).toLocaleString() +
        "</td>";
    }
    if (canDelta) {
      const d = positiveDelta(r.puts[lastI], r.puts[prevI]);
      html +=
        '<td class="' +
        putCls +
        ' delta">' +
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
  const close = view.close;
  const canDelta = state.showDelta && pullDates.length >= 2;
  const lastI = pullDates.length - 1;
  const prevI = pullDates.length - 2;
  const n = pullDates.length;

  const putCols = [];
  for (let j = 0; j < n; j++) putCols.push({ kind: "put", idx: j, label: pullDates[j] });
  if (canDelta) putCols.push({ kind: "deltaPut" });

  const callCols = [];
  if (canDelta) callCols.push({ kind: "deltaCall" });
  for (let i = n - 1; i >= 0; i--) callCols.push({ kind: "call", idx: i, label: pullDates[i] });

  const colDefs = callCols.concat([{ kind: "strike" }], putCols);
  const total = colDefs.length;
  const strikeCol = callCols.length + 1;

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
      if (opts.numFmt) cell.numFmt = opts.numFmt;
    }
  }

  ws.mergeCells(1, 1, 1, total);
  ws.getCell(1, 1).value = state.ticker + "  |  Open Interest";
  styleRange(1, 1, total, { font: fontWhite, fill: fillTitle, align: alignC });
  ws.getRow(1).height = 22;

  ws.getCell(2, 1).value = "Call";
  if (callCols.length > 1) ws.mergeCells(2, 1, 2, callCols.length);
  ws.getCell(2, strikeCol).value = "Strike";
  ws.getCell(2, strikeCol + 1).value = "Put";
  if (putCols.length > 1) ws.mergeCells(2, strikeCol + 1, 2, total);
  styleRange(2, 1, total, { font: fontHeader, fill: fillSec, align: alignC, border: border });
  ws.getRow(2).height = 18;

  for (let c = 0; c < total; c++) {
    const def = colDefs[c];
    let v = "";
    if (def.kind === "call" || def.kind === "put") v = def.label;
    else if (def.kind === "strike") v = "STRIKE";
    else if (def.kind === "deltaCall" || def.kind === "deltaPut") v = "Δ";
    const cell = ws.getCell(3, c + 1);
    cell.value = v;
    cell.font = fontHeader;
    cell.alignment = alignC;
    cell.border = border;
    cell.fill = def.kind.indexOf("delta") === 0 ? fillDelta : fillDates;
  }
  ws.getRow(3).height = 18;

  for (let c = 1; c <= total; c++) {
    ws.getCell(4, c).border = border;
    ws.getCell(4, c).alignment = alignC;
    ws.getCell(4, c).font = fontBody;
    ws.getCell(4, c).fill = fillDates;
  }
  if (close != null) ws.getCell(4, 1).value = "Close " + Number(close).toFixed(2);
  ws.getCell(4, strikeCol).value = state.expiration;
  ws.getRow(4).height = 18;

  rows.forEach(function (r, ri) {
    const rowIdx = 5 + ri;
    colDefs.forEach(function (def, ci) {
      const cell = ws.getCell(rowIdx, ci + 1);
      cell.alignment = alignC;
      cell.font = fontBody;
      cell.border = border;
      if (def.kind === "strike") {
        cell.value = r.strike;
        cell.numFmt = "#,##0.##";
        cell.font = { name: "Calibri", size: 11, bold: true };
      } else if (def.kind === "call") {
        cell.value = r.calls[def.idx] || 0;
        cell.numFmt = "#,##0";
      } else if (def.kind === "put") {
        cell.value = r.puts[def.idx] || 0;
        cell.numFmt = "#,##0";
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

  for (let c = 1; c <= total; c++) {
    ws.getColumn(c).width = 11;
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

function toggleTheme() {
  state.dark = !state.dark;
  applyTheme();
}

function init() {
  try {
    if (localStorage.getItem("oi-theme") === "dark") state.dark = true;
  } catch (e) {}
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
  $("#exportBtn").onclick = exportExcel;
  $("#themeSwitch").onclick = toggleTheme;
  $("#reloadBtn").onclick = function () {
    delete state.cache[state.ticker];
    refresh();
  };
  refresh();
}

document.addEventListener("DOMContentLoaded", init);
