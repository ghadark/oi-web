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
  if (typeof XLSX === "undefined") {
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
  const callCount = n + (canDelta ? 1 : 0);
  const putCount = n + (canDelta ? 1 : 0);
  const totalCols = callCount + 1 + putCount;

  const aoa = [];
  const r1 = new Array(totalCols).fill("");
  r1[0] = state.ticker;
  aoa.push(r1);

  const r2 = new Array(totalCols).fill("");
  r2[0] = "Call";
  r2[callCount] = "Strike";
  r2[callCount + 1] = "Put";
  aoa.push(r2);

  const r3 = [];
  if (canDelta) r3.push("Δ");
  for (let i = n - 1; i >= 0; i--) r3.push(pullDates[i]);
  r3.push("STRIKE");
  for (let j = 0; j < n; j++) r3.push(pullDates[j]);
  if (canDelta) r3.push("Δ");
  aoa.push(r3);

  const r4 = new Array(totalCols).fill("");
  r4[callCount] = state.expiration;
  if (close != null) r4[0] = "Close " + close;
  aoa.push(r4);

  rows.forEach(function (r) {
    const line = [];
    if (canDelta) {
      const d = positiveDelta(r.calls[lastI], r.calls[prevI]);
      line.push(d != null ? d : "");
    }
    for (let i = n - 1; i >= 0; i--) line.push(r.calls[i] || 0);
    line.push(r.strike);
    for (let i = 0; i < n; i++) line.push(r.puts[i] || 0);
    if (canDelta) {
      const d = positiveDelta(r.puts[lastI], r.puts[prevI]);
      line.push(d != null ? d : "");
    }
    aoa.push(line);
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const merges = [];
  if (callCount > 1) merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: callCount - 1 } });
  if (putCount > 1) merges.push({ s: { r: 1, c: callCount + 1 }, e: { r: 1, c: totalCols - 1 } });
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } });
  ws["!merges"] = merges;
  ws["!cols"] = [];
  for (let c = 0; c < totalCols; c++) ws["!cols"].push({ wch: 11 });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "OI");
  const fname =
    state.ticker + "_" + state.expiration + "_D" + state.days + "_S" + state.strikes + ".xlsx";
  XLSX.writeFile(wb, fname);
  setStatus("تم تنزيل ملف Excel (.xlsx)", "ok");
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
