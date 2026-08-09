/* Oi Web — display only (shared JSON from GitHub Actions) */

const TICKERS = [
  { symbol: "SPY", name: "SPDR S&P 500", color: "#0D9488" },
  { symbol: "QQQ", name: "Invesco QQQ", color: "#2563EB" },
  { symbol: "IWM", name: "iShares Russell", color: "#0F172A" },
  { symbol: "GLD", name: "SPDR Gold", color: "#D97706" },
  { symbol: "SPX", name: "S&P 500 Index", color: "#7C3AED" },
];

const state = {
  ticker: "SPY",
  days: "2",
  strikes: "30",
  expiration: null,
  showDelta: false,
  dark: false,
  cache: {},
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function dataUrl(ticker) {
  // Works on GitHub Pages when site is served from /web or root with /data
  const base = document.body.dataset.dataBase || "../data";
  return `${base}/${ticker}.json?t=${Date.now()}`;
}

async function loadTicker(ticker) {
  if (state.cache[ticker]) return state.cache[ticker];
  const res = await fetch(dataUrl(ticker));
  if (!res.ok) throw new Error(`تعذر تحميل بيانات ${ticker}`);
  const json = await res.json();
  state.cache[ticker] = json;
  return json;
}

function formatPullDate(s) {
  try {
    const [d, m] = s.split("-").map(Number);
    const dt = new Date(new Date().getFullYear(), m - 1, d);
    const mon = dt.toLocaleString("en", { month: "short" });
    const day = dt.toLocaleString("en", { weekday: "short" });
    return { top: `${d}${mon}`, sub: day };
  } catch {
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
  const sorted = rows
    .map((r) => ({ r, dist: Math.abs(r.strike - close) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, n * 2)
    .map((x) => x.r)
    .sort((a, b) => a.strike - b.strike);
  return sorted;
}

function positiveDelta(last, prev) {
  const d = (last || 0) - (prev || 0);
  return d > 0 ? d : null;
}

function setStatus(msg, cls = "") {
  const el = $("#status");
  el.textContent = msg;
  el.className = "status " + cls;
}

function renderTickers() {
  const box = $("#tickers");
  box.innerHTML = "";
  TICKERS.forEach((t) => {
    const el = document.createElement("div");
    el.className = "tcard" + (t.symbol === state.ticker ? " active" : "");
    el.innerHTML = `
      <div class="dot" style="background:${t.color}">${t.symbol.slice(0, 3)}</div>
      <div><b>${t.symbol}</b><span>${t.name}</span></div>`;
    el.onclick = () => {
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
  options.forEach((opt) => {
    const b = document.createElement("button");
    b.className = "chip" + (state[key] === opt ? " active" : "");
    b.textContent = opt;
    b.onclick = () => {
      state[key] = opt;
      renderChips(rowId, options, key);
      renderTable();
    };
    row.appendChild(b);
  });
}

async function refresh() {
  setStatus("جاري التحميل...");
  try {
    const data = await loadTicker(state.ticker);
    const sel = $("#expSelect");
    sel.innerHTML = "";
    (data.expirations || []).forEach((exp) => {
      const o = document.createElement("option");
      o.value = exp;
      o.textContent = exp;
      sel.appendChild(o);
    });
    if (!state.expiration || !data.expirations.includes(state.expiration)) {
      state.expiration = data.expirations[0] || null;
    }
    sel.value = state.expiration || "";
    $("#updatedAt").textContent = data.updated_at
      ? `آخر تحديث بيانات: ${data.updated_at}`
      : "لا يوجد تحديث بعد — شغّل Actions أولاً";
    renderTable();
    setStatus("جاهز", "ok");
  } catch (e) {
    setStatus(String(e.message || e), "err");
    $("#tableHost").innerHTML = `<p class="status err">${e.message || e}</p>`;
  }
}

function renderTable() {
  const data = state.cache[state.ticker];
  const host = $("#tableHost");
  if (!data || !state.expiration) {
    host.innerHTML = `<p class="status">اختر تاريخ انتهاء</p>`;
    return;
  }
  const block = data.by_expiration[state.expiration];
  if (!block) {
    host.innerHTML = `<p class="status">لا بيانات لهذا الانتهاء</p>`;
    return;
  }

  const pullDates = lastN(data.pull_dates || [], state.days);
  if (!pullDates.length) {
    host.innerHTML = `<p class="status">لا أيام مخزّنة بعد</p>`;
    return;
  }

  // map full index → filtered
  const fullDates = data.pull_dates || [];
  const idx = pullDates.map((d) => fullDates.indexOf(d));

  let rows = block.rows.map((r) => ({
    strike: r.strike,
    calls: idx.map((i) => (i >= 0 ? r.calls[i] : 0)),
    puts: idx.map((i) => (i >= 0 ? r.puts[i] : 0)),
  }));
  rows = filterStrikes(rows, data.close, state.strikes);

  const canDelta = state.showDelta && pullDates.length >= 2;
  const lastI = pullDates.length - 1;
  const prevI = pullDates.length - 2;

  let html = `<div class="table-title">${state.ticker} | Exp: ${state.expiration}`;
  if (data.close != null) {
    html += `<div class="close-pill">الإغلاق: ${Number(data.close).toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>`;
  }
  html += `</div><table class="oi"><thead><tr>`;

  if (canDelta) html += `<th class="delta">Δ</th>`;
  // Call side headers: oldest near strike → so reversed display on left of strike
  for (let i = pullDates.length - 1; i >= 0; i--) {
    const f = formatPullDate(pullDates[i]);
    html += `<th>${f.top}<br><span style="font-weight:500;color:var(--gray)">${f.sub}</span></th>`;
  }
  html += `<th class="strike">STRIKE</th>`;
  for (const d of pullDates) {
    const f = formatPullDate(d);
    html += `<th>${f.top}<br><span style="font-weight:500;color:var(--gray)">${f.sub}</span></th>`;
  }
  if (canDelta) html += `<th class="delta">Δ</th>`;
  html += `</tr></thead><tbody>`;

  const close = data.close;
  let barDone = false;
  rows.forEach((r, ri) => {
    if (close != null && !barDone && r.strike > close) {
      html += greenBarRow(canDelta, pullDates.length, close);
      barDone = true;
    }
    const zebra = ri % 2 === 1 ? " zebra" : "";
    const above = close != null && r.strike > close;
    const below = close != null && r.strike < close;
    // call ITM when below close, put ITM when above close (same as desktop)
    const callCls = below || (close != null && r.strike === close) ? "itm" : "otm";
    const putCls = above || (close != null && r.strike === close) ? "itm" : "otm";

    html += `<tr class="${zebra}">`;
    if (canDelta) {
      const d = positiveDelta(r.calls[lastI], r.calls[prevI]);
      html += `<td class="${callCls} delta">${d != null ? d.toLocaleString() : ""}</td>`;
    }
    for (let i = pullDates.length - 1; i >= 0; i--) {
      html += `<td class="${callCls}">${(r.calls[i] || 0).toLocaleString()}</td>`;
    }
    const st = Number.isInteger(r.strike) ? r.strike : r.strike;
    html += `<td class="strike">${st}</td>`;
    for (let i = 0; i < pullDates.length; i++) {
      html += `<td class="${putCls}">${(r.puts[i] || 0).toLocaleString()}</td>`;
    }
    if (canDelta) {
      const d = positiveDelta(r.puts[lastI], r.puts[prevI]);
      html += `<td class="${putCls} delta">${d != null ? d.toLocaleString() : ""}</td>`;
    }
    html += `</tr>`;
  });
  if (close != null && !barDone) {
    html += greenBarRow(canDelta, pullDates.length, close);
  }
  html += `</tbody></table>`;
  host.innerHTML = html;
}

function greenBarRow(canDelta, n, close) {
  let cols = (canDelta ? 1 : 0) + n + 1 + n + (canDelta ? 1 : 0);
  let html = `<tr>`;
  for (let i = 0; i < cols; i++) {
    const isStrike = i === (canDelta ? 1 : 0) + n;
    html += `<td class="green">${isStrike ? Number(close).toLocaleString(undefined, { maximumFractionDigits: 2 }) : ""}</td>`;
  }
  html += `</tr>`;
  return html;
}

function exportExcel() {
  const data = state.cache[state.ticker];
  if (!data || !state.expiration) {
    setStatus("لا بيانات للتصدير", "err");
    return;
  }
  const block = data.by_expiration[state.expiration];
  const pullDates = lastN(data.pull_dates || [], state.days);
  const fullDates = data.pull_dates || [];
  const idx = pullDates.map((d) => fullDates.indexOf(d));
  let rows = block.rows.map((r) => ({
    strike: r.strike,
    calls: idx.map((i) => (i >= 0 ? r.calls[i] : 0)),
    puts: idx.map((i) => (i >= 0 ? r.puts[i] : 0)),
  }));
  rows = filterStrikes(rows, data.close, state.strikes);

  // CSV is reliable without libraries; Excel opens it
  const lines = [];
  const header = [];
  for (let i = pullDates.length - 1; i >= 0; i--) header.push(`C_${pullDates[i]}`);
  header.push("STRIKE");
  for (const d of pullDates) header.push(`P_${d}`);
  lines.push(header.join(","));
  rows.forEach((r) => {
    const line = [];
    for (let i = pullDates.length - 1; i >= 0; i--) line.push(r.calls[i] || 0);
    line.push(r.strike);
    for (let i = 0; i < pullDates.length; i++) line.push(r.puts[i] || 0);
    lines.push(line.join(","));
  });
  const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${state.ticker}_${state.expiration}_D${state.days}_S${state.strikes}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  setStatus("تم تنزيل الملف", "ok");
}

function toggleTheme() {
  state.dark = !state.dark;
  document.documentElement.setAttribute("data-theme", state.dark ? "dark" : "light");
  $("#themeSwitch").classList.toggle("on", state.dark);
}

function init() {
  renderTickers();
  renderChips("#daysRow", ["2", "3", "5", "10", "ALL"], "days");
  renderChips("#strikesRow", ["30", "50", "ALL"], "strikes");
  $("#expSelect").onchange = (e) => {
    state.expiration = e.target.value;
    renderTable();
  };
  $("#deltaBtn").onclick = () => {
    state.showDelta = !state.showDelta;
    $("#deltaBtn").classList.toggle("active", state.showDelta);
    renderTable();
  };
  $("#exportBtn").onclick = exportExcel;
  $("#themeSwitch").onclick = toggleTheme;
  $("#reloadBtn").onclick = () => {
    delete state.cache[state.ticker];
    refresh();
  };
  refresh();
}

document.addEventListener("DOMContentLoaded", init);
