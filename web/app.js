const INDEX_TICKERS = [
  { symbol: "SPY", name: "SPDR S&P 500", color: "#0D9488" },
  { symbol: "QQQ", name: "Invesco QQQ", color: "#2563EB" },
  { symbol: "IWM", name: "iShares Russell", color: "#0F172A" },
  { symbol: "GLD", name: "SPDR Gold", color: "#D97706" },
  { symbol: "SPX", name: "S&P 500 Index", color: "#7C3AED" },
  { symbol: "NDX", name: "Nasdaq 100", color: "#0EA5E9" },
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
  { symbol: "SNDK", name: "SanDisk", color: "#6366F1" },
];

/** كل الرموز للبحث/العرض */
const TICKERS = INDEX_TICKERS.concat(STOCKS_TICKERS);

const state = {
  ticker: "SPY", days: "2", strikes: "30",
  expiration: null, showDelta: false, seriesMode: false, dark: false, cache: {}, livePrice: null, sessionClose: null, mapRange: "ALL",
  archDays: "2", archStrikes: "30", archShowDelta: false, archExportMode: "multi", archSelected: [],
};

const $ = (sel) => document.querySelector(sel);

function placeFixedDropdown(btn, list) {
  if (!btn || !list) return;
  try {
    if (!list._ddHome) list._ddHome = list.parentElement;
    if (list.parentElement !== document.body) document.body.appendChild(list);
    var r = btn.getBoundingClientRect();
    var w = Math.max(1, Math.round(r.width));
    var left = r.left;
    if (left + w > window.innerWidth - 8) left = Math.max(8, window.innerWidth - w - 8);
    if (left < 8) left = 8;
    var top = r.bottom + 4;
    if (top + 120 > window.innerHeight) {
      top = Math.max(8, r.top - 4 - Math.min(320, window.innerHeight * 0.5));
    }
    list.classList.add("dd-fixed");
    list.hidden = false;
    list.removeAttribute("hidden");
    list.style.setProperty("display", "block", "important");
    list.style.setProperty("visibility", "visible", "important");
    list.style.setProperty("pointer-events", "auto", "important");
    list.style.setProperty("opacity", "1", "important");
    list.style.setProperty("position", "fixed", "important");
    list.style.setProperty("top", Math.round(top) + "px", "important");
    list.style.setProperty("left", Math.round(left) + "px", "important");
    list.style.setProperty("width", Math.round(w) + "px", "important");
    list.style.setProperty("right", "auto", "important");
    list.style.setProperty("bottom", "auto", "important");
    list.style.setProperty("z-index", "10050", "important");
    list.style.setProperty("max-height", "min(420px, 70vh)", "important");
    list.style.setProperty("overflow-y", "auto", "important");
  } catch (e) {}
}
function clearFixedDropdown(list) {
  if (!list) return;
  try {
    list.classList.remove("dd-fixed");
    ["display","visibility","pointer-events","opacity","position","top","left","width","right","bottom","z-index","max-height","overflow-y"].forEach(function (p) {
      try { list.style.removeProperty(p); } catch (e0) {}
    });
    list.hidden = true;
    list.setAttribute("hidden", "");
    if (list._ddHome && list.parentElement === document.body) list._ddHome.appendChild(list);
  } catch (e) {}
}
function positionDdList(btn, list) {
  placeFixedDropdown(btn, list);
}


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
  var text = await res.text();
  // ملفات قديمة قد تحتوي NaN (غير صالح في JSON) — صلّحها قبل parse
  text = String(text)
    .replace(/:\s*NaN\b/g, ":null")
    .replace(/:\s*-?Infinity\b/g, ":null");
  var json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error("بيانات تالفة لـ " + ticker + " — شغّل Actions لإعادة التوليد");
  }
  if (json && (json.close == null || (typeof json.close === "number" && isNaN(json.close)))) {
    json.close = null;
  }
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

function isThirdFridayExp(exp) {
  try {
    var d = new Date(String(exp) + "T12:00:00");
    if (isNaN(d.getTime()) || d.getDay() !== 5) return false;
    var day = d.getDate();
    return day >= 15 && day <= 21;
  } catch (e) {
    return false;
  }
}


/** أدنى يوم سحب نظيف لـ SPX ثالث جمعة AM — ما قبله مخفي لأنه مخلوط */
var SPX_AM_PULL_CUTOFF = "17-8";

function pullDateSortKey(pd) {
  try {
    var parts = String(pd).split("-").map(Number);
    var day = parts[0], month = parts[1];
    if (!day || !month) return 0;
    var now = new Date();
    var year = now.getFullYear();
    // لو الشهر أكبر بكثير من الحالي قد يكون من سنة سابقة في نهاية العام
    if (month > now.getMonth() + 1 + 6) year -= 1;
    return new Date(year, month - 1, day).getTime();
  } catch (e) {
    return 0;
  }
}

function filterSpxMonthlyPullDates(pullDates) {
  var all = (pullDates || []).slice();
  var cut = pullDateSortKey(SPX_AM_PULL_CUTOFF);
  var filtered = all.filter(function (pd) {
    return pullDateSortKey(pd) >= cut;
  });
  // إن لم يبقَ شيء (بيانات قديمة فقط) أظهر آخر يوم فقط كاحتياط
  if (!filtered.length && all.length) return [all[all.length - 1]];
  return filtered;
}



/** آخر يوم بيانات فعلي من pull_dates (لا يعتمد على منتصف الليل) */
function dataSessionFromPull(data) {
  try {
    var pulls = (data && data.pull_dates) || [];
    if (!pulls.length && state.cache[state.ticker]) {
      pulls = state.cache[state.ticker].pull_dates || [];
    }
    if (!pulls.length) return null;
    var last = String(pulls[pulls.length - 1]);
    var parts = last.split("-").map(Number);
    var day = parts[0], month = parts[1];
    if (!day || !month) return null;
    var year = new Date().getFullYear();
    // نهاية السنة: لو الشهر أكبر بكثير من الحالي اعتبر السنة السابقة
    var nowM = new Date().getMonth() + 1;
    if (month > nowM + 6) year -= 1;
    return { year: year, month: month, day: day, label: last };
  } catch (e) {
    return null;
  }
}

function dataSessionYmd(data) {
  var s = dataSessionFromPull(data);
  if (!s) return riyadhYmd();
  return (
    s.year +
    "-" +
    String(s.month).padStart(2, "0") +
    "-" +
    String(s.day).padStart(2, "0")
  );
}

function dataSessionCutoffDate(data) {
  var s = dataSessionFromPull(data);
  if (s) {
    var d = new Date(s.year, s.month - 1, s.day);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  return expirationCutoffDate();
}

function filterTickerExpirations(ticker, list) {
  var data = state.cache[ticker] || state.cache[state.ticker] || null;
  var cutoff = dataSessionCutoffDate(data);
  return (list || []).filter(function (exp) {
    var d = new Date(String(exp) + "T00:00:00");
    return !isNaN(d.getTime()) && d >= cutoff;
  });
}



function ensureExpDropdownUI() {
  var sel = $("#expSelect");
  if (!sel) return null;
  var parent = sel.parentNode;
  if (!parent) return null;
  var dd = document.getElementById("expDropdown");
  if (dd) return dd;
  try {
    sel.classList.add("exp-select-hidden");
    sel.setAttribute("aria-hidden", "true");
    sel.tabIndex = -1;
  } catch (e) {}
  dd = document.createElement("div");
  dd.id = "expDropdown";
  dd.className = "exp-dd";
  dd.innerHTML =
    '<button type="button" class="exp-dd-btn" id="expDdBtn" aria-haspopup="listbox">' +
    '<span id="expDdLabel">—</span></button>' +
    '<div class="exp-dd-list" id="expDdList" role="listbox" hidden></div>';
  parent.appendChild(dd);

  document.addEventListener("click", function (e) {
    var list = $("#expDdList");
    var btn = $("#expDdBtn");
    var wrap = document.getElementById("expDropdown");
    if (!list || !btn) return;
    if (btn.contains(e.target) || list.contains(e.target)) return;
    if (wrap && wrap.contains(e.target)) return;
    list.hidden = true;
    list.setAttribute("hidden", "");
    btn.classList.remove("open");
    if (wrap) wrap.classList.remove("open");
    clearFixedDropdown(list);
  });
  return dd;
}

function formatExpDisplay(exp) {
  try {
    var s = String(exp || "");
    var p = s.split("-");
    if (p.length < 3) return s;
    var y = parseInt(p[0], 10), m = parseInt(p[1], 10), d = parseInt(p[2], 10);
    if (!y || !m || !d) return s;
    var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return months[m - 1] + " " + d + ", " + y;
  } catch (e) {
    return String(exp || "");
  }
}
function isAmSettlementTicker(ticker) {
  var t = String(ticker || state.ticker || "").toUpperCase();
  return t === "SPX" || t === "NDX";
}
function expOptionLabelHtml(exp) {
  var label = formatExpDisplay(exp);
  var showAm =
    isAmSettlementTicker(state.ticker) &&
    typeof isThirdFridayExp === "function" &&
    isThirdFridayExp(exp);
  if (showAm) {
    return '<span class="exp-date">' + label + '</span> <span class="exp-am">AM</span>';
  }
  return '<span class="exp-date">' + label + "</span>";
}

function syncExpDropdownLabel() {
  var lab = $("#expDdLabel");
  if (!lab) return;
  var exp = state.expiration;
  if (!exp) {
    lab.textContent = "—";
    return;
  }
  lab.innerHTML = expOptionLabelHtml(exp);
}

function safeSetSelectValue(sel, value) {
  if (!sel) return;
  try {
    var v = value == null ? "" : String(value);
    // لا تعيّن قيمة غير موجودة ضمن options (Safari: pattern error)
    if (v) {
      var ok = false;
      for (var i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === v) {
          ok = true;
          break;
        }
      }
      if (!ok) {
        sel.selectedIndex = sel.options.length ? 0 : -1;
        return;
      }
    }
    sel.value = v;
  } catch (e) {
    try {
      sel.selectedIndex = 0;
    } catch (e2) {}
  }
}

function fillExpDropdown(exps) {
  try {
    ensureExpDropdownUI();
  } catch (e) {}
  var sel = $("#expSelect");
  var list = $("#expDdList");
  var btn = $("#expDdBtn");
  if (!sel) return;

  var listExps = (exps || []).slice();
  try {
    sel.innerHTML = "";
  } catch (e) {}
  if (list) list.innerHTML = "";

  listExps.forEach(function (exp) {
    try {
      var o = document.createElement("option");
      o.value = String(exp);
      o.text = String(exp);
      sel.appendChild(o);
    } catch (e) {}

    if (list) {
      var item = document.createElement("button");
      item.type = "button";
      item.className =
        "exp-dd-item" + (exp === state.expiration ? " active" : "");
      item.setAttribute("role", "option");
      item.setAttribute("data-value", String(exp));
      item.innerHTML = expOptionLabelHtml(exp);
      item.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        state.expiration = exp;
        safeSetSelectValue(sel, exp);
        if (list) {
          list.hidden = true;
          list.setAttribute("hidden", "");
          clearFixedDropdown(list);
        }
        if (btn) btn.classList.remove("open");
        var wrap = document.getElementById("expDropdown");
        if (wrap) wrap.classList.remove("open");
        if (list && list.parentElement) list.parentElement.classList.remove("open");
        syncExpDropdownLabel();
        try {
          var nodes = list.querySelectorAll(".exp-dd-item");
          for (var i = 0; i < nodes.length; i++) {
            nodes[i].classList.toggle(
              "active",
              nodes[i].getAttribute("data-value") === String(exp)
            );
          }
        } catch (e3) {}
        renderTable();
      };
      list.appendChild(item);
    }
  });

  if (!state.expiration || listExps.indexOf(state.expiration) < 0) {
    state.expiration = listExps[0] || null;
  }
  safeSetSelectValue(sel, state.expiration || "");
  syncExpDropdownLabel();

  if (btn && list) {
    btn.onclick = function (e) {
      e.preventDefault();
      e.stopPropagation();
      var wrap = document.getElementById("expDropdown") || (list.parentElement);
      var isOpen = wrap && wrap.classList.contains("open");
      // أغلق STOCKS إن كانت مفتوحة
      try {
        var sWrap = document.getElementById("stocksDd");
        var sBtn = document.getElementById("stocksDdBtn");
        var sList = document.getElementById("stocksDdList");
        if (sWrap) sWrap.classList.remove("open");
        if (sBtn) sBtn.classList.remove("open");
        if (sList) { sList.hidden = true; sList.setAttribute("hidden", ""); clearFixedDropdown(sList); }
      } catch (eS) {}
      if (isOpen) {
        if (wrap) wrap.classList.remove("open");
        btn.classList.remove("open");
        list.hidden = true;
        list.setAttribute("hidden", "");
        clearFixedDropdown(list);
      } else {
        if (wrap) wrap.classList.add("open");
        btn.classList.add("open");
        list.hidden = false;
        list.removeAttribute("hidden");
        placeFixedDropdown(btn, list);
      }
    };
  }
  // تأكد أنها مغلقة بعد إعادة البناء
  try {
    var wrap0 = document.getElementById("expDropdown");
    if (wrap0) wrap0.classList.remove("open");
    if (btn) btn.classList.remove("open");
    if (list) { list.hidden = true; list.setAttribute("hidden", ""); }
  } catch (eClose) {}
}

function riyadhYmd() {
  try {
    var parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Riyadh",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date());
    var get = function (t) {
      for (var i = 0; i < parts.length; i++) if (parts[i].type === t) return parts[i].value;
      return "01";
    };
    return get("year") + "-" + get("month") + "-" + get("day");
  } catch (e) {
    return new Date().toISOString().slice(0, 10);
  }
}

function expIsoDay(iso) {
  return String(iso).slice(0, 10);
}

function isFridayIso(iso) {
  var d = new Date(String(iso) + "T12:00:00");
  return !isNaN(d.getTime()) && d.getDay() === 5;
}

function pickX3Targets(exps, data) {
  var list = (exps || []).slice().sort();
  if (!list.length) return [];
  var todayStr = dataSessionYmd(data);
  var iToday = 0;
  for (var i = 0; i < list.length; i++) {
    if (expIsoDay(list[i]) >= todayStr) {
      iToday = i;
      break;
    }
    iToday = i;
  }
  var expToday = list[iToday];
  var expTomorrow = list[iToday + 1] || null;
  var expWeek = null;
  for (var j = iToday; j < list.length; j++) {
    if (isFridayIso(list[j])) {
      expWeek = list[j];
      break;
    }
  }
  if (!expWeek) expWeek = list[list.length - 1];

  var out = [];
  var todayIsWeek = expToday && expWeek && expIsoDay(expToday) === expIsoDay(expWeek);
  var tomIsWeek = expTomorrow && expWeek && expIsoDay(expTomorrow) === expIsoDay(expWeek);

  if (todayIsWeek) {
    out.push({ exp: expToday, label: "اليوم · الأسبوع" });
    if (expTomorrow && expIsoDay(expTomorrow) !== expIsoDay(expToday)) {
      out.push({ exp: expTomorrow, label: "يوم بعد" });
    }
  } else if (tomIsWeek) {
    out.push({ exp: expToday, label: "اليوم" });
    out.push({ exp: expWeek, label: "يوم بعد · الأسبوع" });
  } else {
    out.push({ exp: expToday, label: "اليوم" });
    if (expTomorrow) out.push({ exp: expTomorrow, label: "يوم بعد" });
    if (
      expWeek &&
      expIsoDay(expWeek) !== expIsoDay(expToday) &&
      (!expTomorrow || expIsoDay(expWeek) !== expIsoDay(expTomorrow))
    ) {
      var wlab = isThirdFridayExp(expWeek) ? "الأسبوع · OPX" : "الأسبوع";
      out.push({ exp: expWeek, label: wlab });
    }
  }
  return out;
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
      state.sessionClose = null;
      if (typeof renderStocksDropdown === "function") renderStocksDropdown();
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
  const cur = typeof isIndexTicker === "function" && isIndexTicker(state.ticker) ? "" : state.ticker;
  var itemsHtml =
    '<button type="button" class="stocks-dd-item' + (!cur ? " active" : "") +
    '" data-value="" role="option">----</button>';
  STOCKS_TICKERS.forEach(function (t) {
    itemsHtml +=
      '<button type="button" class="stocks-dd-item' +
      (t.symbol === cur ? " active" : "") +
      '" data-value="' + t.symbol + '" role="option">' + t.symbol + "</button>";
  });
  host.innerHTML =
    '<label class="stocks-label">STOCKS</label>' +
    '<div class="stocks-dd" id="stocksDd">' +
    '<button type="button" class="stocks-dd-btn" id="stocksDdBtn" aria-haspopup="listbox">' +
    '<span id="stocksDdLabel">' + (cur || "----") + "</span></button>" +
    '<div class="stocks-dd-list" id="stocksDdList" role="listbox" hidden>' + itemsHtml + "</div></div>";
  var btn = $("#stocksDdBtn");
  var list = $("#stocksDdList");
  if (!btn || !list) return;
  btn.onclick = function (e) {
    e.preventDefault();
    e.stopPropagation();
    var wrap = document.getElementById("stocksDd");
    var isOpen = wrap && wrap.classList.contains("open");
    // أغلق قائمة التواريخ
    try {
      var eWrap = document.getElementById("expDropdown");
      var eBtn = document.getElementById("expDdBtn");
      var eList = document.getElementById("expDdList");
      if (eWrap) eWrap.classList.remove("open");
      if (eBtn) eBtn.classList.remove("open");
      if (eList) { eList.hidden = true; eList.setAttribute("hidden", ""); clearFixedDropdown(eList); }
    } catch (eE) {}
    if (isOpen) {
      if (wrap) wrap.classList.remove("open");
      btn.classList.remove("open");
      list.hidden = true;
      list.setAttribute("hidden", "");
        clearFixedDropdown(list);
      } else {
      if (wrap) wrap.classList.add("open");
      btn.classList.add("open");
      list.hidden = false;
      list.removeAttribute("hidden");
      placeFixedDropdown(btn, list);
    }
  };
  list.querySelectorAll(".stocks-dd-item").forEach(function (item) {
    item.onclick = function (e) {
      e.preventDefault();
      e.stopPropagation();
      var v = item.getAttribute("data-value") || "";
      list.hidden = true;
      list.setAttribute("hidden", "");
      btn.classList.remove("open");
      var sWrap = document.getElementById("stocksDd");
      if (sWrap) sWrap.classList.remove("open");
      clearFixedDropdown(list);
      if (!v) return;
      state.ticker = v;
      state.expiration = null;
      state.livePrice = null;
      var lab = $("#stocksDdLabel");
      if (lab) lab.textContent = v;
      renderTickers();
      refresh();
      if (typeof refreshLivePrice === "function") refreshLivePrice();
    };
  });
  if (!window.__stocksDdOutsideBound) {
    window.__stocksDdOutsideBound = true;
    document.addEventListener("click", function (e) {
      var listEl = $("#stocksDdList");
      var btnEl = $("#stocksDdBtn");
      var wrap = $("#stocksDd");
      if (!listEl || !btnEl) return;
      if (btnEl.contains(e.target) || listEl.contains(e.target)) return;
      if (wrap && wrap.contains(e.target)) return;
      listEl.hidden = true;
      listEl.setAttribute("hidden", "");
      btnEl.classList.remove("open");
      if (wrap) wrap.classList.remove("open");
      clearFixedDropdown(listEl);
    });
  }
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


function trimLeadingZeroColumns(pullDates, rows) {
  if (!pullDates || !pullDates.length || !rows || !rows.length) {
    return { pullDates: pullDates || [], rows: rows || [] };
  }
  var n = pullDates.length, first = 0, found = false;
  for (var i = 0; i < n; i++) {
    for (var r = 0; r < rows.length; r++) {
      var c = rows[r].calls && rows[r].calls[i] != null ? rows[r].calls[i] : 0;
      var p = rows[r].puts && rows[r].puts[i] != null ? rows[r].puts[i] : 0;
      if (Number(c) > 0 || Number(p) > 0) { first = i; found = true; break; }
    }
    if (found) break;
  }
  if (!found) first = Math.max(0, n - 1);
  if (first === 0) return { pullDates: pullDates, rows: rows };
  return {
    pullDates: pullDates.slice(first),
    rows: rows.map(function (row) {
      return { strike: row.strike, calls: (row.calls || []).slice(first), puts: (row.puts || []).slice(first) };
    }),
  };
}
function getViewRows(data) {
  const block = data.by_expiration[state.expiration];
  if (!block) return null;
  var basePull = (block.pull_dates && block.pull_dates.length)
    ? block.pull_dates.slice()
    : (data.pull_dates || []).slice();
  if (
    String(state.ticker).toUpperCase() === "SPX" &&
    state.expiration &&
    typeof isThirdFridayExp === "function" &&
    isThirdFridayExp(state.expiration)
  ) {
    // من 17-8 فصاعدًا فقط — ما قبله مخفي؛ غدًا 18-8 يتراكم بجانب 17-8
    basePull = filterSpxMonthlyPullDates(basePull);
  }
  var fullDates = (block.pull_dates && block.pull_dates.length)
    ? block.pull_dates
    : (data.pull_dates || []);
  var idxFull = basePull.map(function (d) { return fullDates.indexOf(d); });
  var rowsAligned = (block.rows || []).map(function (r) {
    return {
      strike: r.strike,
      calls: idxFull.map(function (i) { return i >= 0 ? (r.calls[i] || 0) : 0; }),
      puts: idxFull.map(function (i) { return i >= 0 ? (r.puts[i] || 0) : 0; }),
    };
  });
  var trimmed = trimLeadingZeroColumns(basePull, rowsAligned);
  basePull = trimmed.pullDates;
  rowsAligned = trimmed.rows;
  var pullDates = lastN(basePull, state.days);
  if (!pullDates.length) return null;
  const idx = pullDates.map(function (d) { return basePull.indexOf(d); });
  let rows = rowsAligned.map(function (r) {
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
    const exps = filterTickerExpirations(state.ticker, data.expirations || []);
    try {
      fillExpDropdown(exps);
    } catch (eFill) {
      // احتياط: تعبئة select العادي إن فشلت القائمة المخصّصة
      var sel = $("#expSelect");
      if (sel) {
        sel.innerHTML = "";
        (exps || []).forEach(function (exp) {
          var o = document.createElement("option");
          o.value = exp;
          o.textContent = exp;
          sel.appendChild(o);
        });
        if (!state.expiration || exps.indexOf(state.expiration) < 0) {
          state.expiration = exps[0] || null;
        }
        try { sel.value = state.expiration || ""; } catch (e2) {}
      }
    }
    var up = $("#updatedAt");
    if (up) {
      up.textContent = data.updated_at
        ? "آخر تحديث: " + formatUpdatedAt(data.updated_at)
        : "لا يوجد تحديث بعد — شغّل Actions أولاً";
    }
    renderTable();
    setStatus("جاهز", "ok");
    // حدّث إغلاق آخر جلسة مكتملة من Yahoo (لا يعتمد على JSON القديم)
    fetchSessionClose(state.ticker).then(function (px) {
      if (px != null) {
        state.sessionClose = px;
        if (state.cache[state.ticker]) state.cache[state.ticker].close = px;
        renderTable();
      }
    });
  } catch (e) {
    setStatus(String(e.message || e), "err");
    var host = $("#tableHost");
    if (host) host.innerHTML = '<p class="status err">' + (e.message || e) + "</p>";
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


function arabicDayMonth(exp) {
  try {
    var parts = String(exp).split("-");
    if (parts.length < 3) return String(exp);
    var d = parseInt(parts[2], 10);
    var m = parseInt(parts[1], 10);
    var months = {
      1: "يناير", 2: "فبراير", 3: "مارس", 4: "أبريل", 5: "مايو", 6: "يونيو",
      7: "يوليو", 8: "أوغست", 9: "سبتمبر", 10: "أكتوبر", 11: "نوفمبر", 12: "ديسمبر",
    };
    return d + " " + (months[m] || parts[1]);
  } catch (e) {
    return String(exp);
  }
}

function x3PanelTitle(label, exp) {
  var dm = arabicDayMonth(exp);
  var lab = String(label || "").replace(/\d{4}-\d{2}-\d{2}/g, "").trim();
  if (/اليوم|يوم بعد|الأسبوع|OPX/i.test(lab)) return lab + " " + dm;
  return lab + " " + dm;
}

function renderOneMiniTable(data, expiration, label, opts) {
  opts = opts || {};
  var saved = {
    expiration: state.expiration,
    days: state.days,
    showDelta: state.showDelta,
  };
  state.expiration = expiration;
  state.days = "2";
  var view = getViewRows(data);
  state.expiration = saved.expiration;
  state.days = saved.days;
  state.showDelta = saved.showDelta;

  var title = x3PanelTitle(label, expiration);
  if (!view || !view.rows.length) {
    return (
      '<div class="x3-col' + (opts.active ? " active" : "") + '">' +
      '<div class="x3-col-h">' + title + "</div>" +
      '<p class="status" style="padding:12px">لا بيانات</p></div>'
    );
  }
  var pullDates = view.pullDates;
  var rows = view.rows;
  if (opts.sharedStrikes && opts.sharedStrikes.length) {
    var byS = {};
    rows.forEach(function (r) { byS[String(r.strike)] = r; });
    rows = opts.sharedStrikes.map(function (sk) {
      if (byS[String(sk)]) return byS[String(sk)];
      return {
        strike: sk,
        calls: pullDates.map(function () { return 0; }),
        puts: pullDates.map(function () { return 0; }),
      };
    });
  }
  var close = effectiveClose(data);
  var canDelta = state.showDelta && pullDates.length >= 2;
  var lastI = pullDates.length - 1;
  var prevI = pullDates.length - 2;

  var callMax = [], putMax = [];
  for (var i = 0; i < pullDates.length; i++) {
    var mc = 0, mp = 0;
    rows.forEach(function (r) {
      var cv = r.calls[i] || 0;
      var pv = r.puts[i] || 0;
      if (cv > mc) mc = cv;
      if (pv > mp) mp = pv;
    });
    callMax.push(mc);
    putMax.push(mp);
  }
  var deltaCallMax = 0, deltaPutMax = 0;
  if (canDelta) {
    rows.forEach(function (r) {
      var dc = positiveDelta(r.calls[lastI], r.calls[prevI]);
      var dp = positiveDelta(r.puts[lastI], r.puts[prevI]);
      if (dc != null && dc > deltaCallMax) deltaCallMax = dc;
      if (dp != null && dp > deltaPutMax) deltaPutMax = dp;
    });
  }

  var closeStrike = null;
  if (close != null && !isNaN(Number(close)) && rows.length) {
    var best = rows[0].strike, bestD = Math.abs(rows[0].strike - close);
    rows.forEach(function (r) {
      var d = Math.abs(r.strike - close);
      if (d < bestD) { bestD = d; best = r.strike; }
    });
    closeStrike = best;
  }

  var html =
    '<div class="x3-col' + (opts.active ? " active" : "") + '">' +
    '<div class="x3-col-h">' + title + "</div>" +
    '<div class="x3-table-wrap"><table class="oi x3-table"><thead><tr>';
  if (canDelta) html += '<th class="delta">Δ</th>';
  for (var hi = pullDates.length - 1; hi >= 0; hi--) {
    var f = formatPullDate(pullDates[hi]);
    html += "<th>" + f.top + '<br><span class="subh">' + f.sub + "</span></th>";
  }
  html += '<th class="strike">STRIKE</th>';
  for (var hj = 0; hj < pullDates.length; hj++) {
    var f2 = formatPullDate(pullDates[hj]);
    html += "<th>" + f2.top + '<br><span class="subh">' + f2.sub + "</span></th>";
  }
  if (canDelta) html += '<th class="delta">Δ</th>';
  html += "</tr></thead><tbody>";

  rows.forEach(function (r, ri) {
    var isCloseRow = closeStrike != null && Number(r.strike) === Number(closeStrike);
    var above = close != null && r.strike > close;
    var below = close != null && r.strike < close;
    var callCls = below || (close != null && r.strike === close) ? "itm" : "otm";
    var putCls = above || (close != null && r.strike === close) ? "itm" : "otm";
    var zebra = ri % 2 === 1 ? " zebra" : "";
    html += '<tr class="' + (isCloseRow ? "close-bar" : "") + zebra + '">';
    if (canDelta) {
      var dc = positiveDelta(r.calls[lastI], r.calls[prevI]);
      var maxD = dc != null && deltaCallMax > 0 && dc === deltaCallMax ? " max-oi" : "";
      html += '<td class="delta' + maxD + '">' + (dc != null ? dc.toLocaleString() : "") + "</td>";
    }
    for (var ci = pullDates.length - 1; ci >= 0; ci--) {
      var cv = r.calls[ci] || 0;
      var maxC = callMax[ci] > 0 && cv === callMax[ci] ? " max-oi" : "";
      html += '<td class="' + callCls + maxC + '">' + cv.toLocaleString() + "</td>";
    }
    if (isCloseRow && close != null) {
      html +=
        '<td class="strike close-strike">' +
        Number(close).toLocaleString(undefined, { maximumFractionDigits: 2 }) +
        "</td>";
    } else {
      html += '<td class="strike">' + r.strike + "</td>";
    }
    for (var pi = 0; pi < pullDates.length; pi++) {
      var pv = r.puts[pi] || 0;
      var maxP = putMax[pi] > 0 && pv === putMax[pi] ? " max-oi" : "";
      html += '<td class="' + putCls + maxP + '">' + pv.toLocaleString() + "</td>";
    }
    if (canDelta) {
      var dp = positiveDelta(r.puts[lastI], r.puts[prevI]);
      var maxDp = dp != null && deltaPutMax > 0 && dp === deltaPutMax ? " max-oi" : "";
      html += '<td class="delta' + maxDp + '">' + (dp != null ? dp.toLocaleString() : "") + "</td>";
    }
    html += "</tr>";
  });
  html += "</tbody></table></div></div>";
  return html;
}

function renderX3() {
  var data = state.cache[state.ticker];
  var host = $("#tableHost");
  if (!data) {
    host.innerHTML = '<p class="status">لا بيانات</p>';
    return;
  }
  var exps = filterTickerExpirations(state.ticker, data.expirations || []);
  var targets = pickX3Targets(exps, data);
  if (!targets.length) {
    host.innerHTML = '<p class="status">لا تواريخ لوضع ×3</p>';
    return;
  }
  var tl = '<div class="x3-timeline">';
  targets.forEach(function (t, i) {
    if (i > 0) tl += '<div class="x3-line"></div>';
    tl +=
      '<div class="x3-node">' +
      '<div class="x3-dot' + (i === 0 ? " on" : "") + '"></div>' +
      '<div class="x3-lab">' + x3PanelTitle(t.label, t.exp) + "</div>" +
      "</div>";
  });
  tl += "</div>";
  var cols = '<div class="x3-cols">';
  var sharedStrikes = null;
  try {
    var t0 = targets[0];
    if (t0) {
      var savedExp = state.expiration, savedDays = state.days;
      state.expiration = t0.exp;
      state.days = "2";
      var masterView = getViewRows(data);
      state.expiration = savedExp;
      state.days = savedDays;
      if (masterView && masterView.rows && masterView.rows.length) {
        sharedStrikes = masterView.rows.map(function (r) { return r.strike; });
      }
    }
  } catch (e0) {}
  targets.forEach(function (t, i) {
    cols += renderOneMiniTable(data, t.exp, t.label, {
      active: i === 0,
      sharedStrikes: sharedStrikes,
    });
  });
  cols += "</div>";
  host.innerHTML = '<div class="x3-board' + (state.showDelta ? ' with-delta' : '') + '">' + tl + cols + "</div>";
}




/** تحويل انتهاء ISO → مفتاح سحب d-m مثل 25-8 */
function expToPullDateLabel(exp) {
  try {
    var p = String(exp).split("-");
    if (p.length < 3) return null;
    return parseInt(p[2], 10) + "-" + parseInt(p[1], 10);
  } catch (e) {
    return null;
  }
}

function expSortKey(exp) {
  try {
    return new Date(String(exp) + "T12:00:00").getTime();
  } catch (e) {
    return 0;
  }
}

/** مفتاح سحب d-m + سنة → ISO انتهاء YYYY-MM-DD */
function pullLabelToExpIso(label, year) {
  try {
    var parts = String(label).split("-").map(Number);
    var day = parts[0], month = parts[1];
    if (!day || !month) return null;
    var y = year || new Date().getFullYear();
    return (
      y +
      "-" +
      String(month).padStart(2, "0") +
      "-" +
      String(day).padStart(2, "0")
    );
  } catch (e) {
    return null;
  }
}

function findExpBlockForPullDay(data, pullLabel, yearHint) {
  var y = yearHint || new Date().getFullYear();
  var tries = [y, y - 1, y + 1];
  for (var i = 0; i < tries.length; i++) {
    var exp = pullLabelToExpIso(pullLabel, tries[i]);
    if (exp && data.by_expiration && data.by_expiration[exp]) {
      return { exp: exp, block: data.by_expiration[exp] };
    }
  }
  return null;
}

/**
 * جدول «اليوم بالسابق»:
 * الأعمدة = أيام السحب الفعلية (10-8، 11-8، … 25-8).
 * كل عمود يأخذ أرقام عقد الانتهاء الذي ينتهي في نفس ذلك اليوم (0DTE لذلك اليوم).
 * مثال: عمود 25-8 ← انتهاء 2026-08-25 | عمود 26-8 ← انتهاء 2026-08-26
 * لا يُدرج يناير/يونيو البعيدة لأنها ليست أيام سحب في السلسلة.
 */
function getSeriesPrevDayView(data) {
  if (!data || !data.by_expiration) return null;

  var pulls = (data.pull_dates || []).slice();
  if (!pulls.length) {
    // احتياط: اجمع أيام السحب من كل الانتهاءات
    var seen = {};
    Object.keys(data.by_expiration).forEach(function (exp) {
      var bp = data.by_expiration[exp].pull_dates || [];
      bp.forEach(function (pd) {
        seen[pd] = true;
      });
    });
    pulls = Object.keys(seen);
  }
  if (!pulls.length) return null;

  pulls.sort(function (a, b) {
    return pullDateSortKey(a) - pullDateSortKey(b);
  });

  var session = dataSessionFromPull(data);
  var yearHint = session ? session.year : new Date().getFullYear();

  var columns = [];
  pulls.forEach(function (pd) {
    var found = findExpBlockForPullDay(data, pd, yearHint);
    if (!found) return; // لا عقد ينتهي في هذا اليوم ضمن البيانات
    var block = found.block;
    var exp = found.exp;
    if (!block.rows || !block.rows.length) return;

    var bpulls =
      block.pull_dates && block.pull_dates.length
        ? block.pull_dates
        : data.pull_dates || [];
    var idx = bpulls.indexOf(pd);
    // نفس يوم السحب إن وُجد؛ وإلا آخر سحب لهذا الانتهاء
    if (idx < 0) idx = bpulls.length - 1;
    if (idx < 0) return;

    var strikeMap = {};
    (block.rows || []).forEach(function (r) {
      var c = (r.calls && r.calls[idx]) || 0;
      var p = (r.puts && r.puts[idx]) || 0;
      strikeMap[String(r.strike)] = { c: c, p: p, strike: r.strike };
    });
    columns.push({ exp: exp, label: pd, strikeMap: strikeMap });
  });

  if (!columns.length) return null;

  // Days: آخر N أيام سحب (آخرها = اليوم الحالي في البيانات، مثل 25-8)
  columns = lastN(columns, state.days);
  var pullDates = columns.map(function (c) {
    return c.label;
  });

  var strikeSet = {};
  columns.forEach(function (col) {
    Object.keys(col.strikeMap).forEach(function (k) {
      strikeSet[k] = col.strikeMap[k].strike;
    });
  });
  var strikes = Object.keys(strikeSet)
    .map(Number)
    .sort(function (a, b) {
      return a - b;
    });

  var rows = strikes.map(function (s) {
    var key = String(s);
    return {
      strike: s,
      calls: columns.map(function (col) {
        var m = col.strikeMap[key];
        return m ? m.c : 0;
      }),
      puts: columns.map(function (col) {
        var m = col.strikeMap[key];
        return m ? m.p : 0;
      }),
    };
  });

  var closePx =
    data.close != null
      ? data.close
      : typeof effectiveClose === "function"
        ? effectiveClose(data)
        : null;
  rows = filterStrikes(rows, closePx, state.strikes);
  return {
    pullDates: pullDates,
    rows: rows,
    close: closePx,
    seriesExps: columns.map(function (c) {
      return c.exp;
    }),
  };
}

/** جدول «اليوم بالسابق»: أعمدة = تواريخ انتهاء يومية متتالية (25 ثم 26 ثم…) وليس أيام سحب لنفس الانتهاء */
function renderSeriesTable() {
  const data = state.cache[state.ticker];
  const host = $("#tableHost");
  if (!data) {
    host.innerHTML = '<p class="status">لا بيانات</p>';
    return;
  }
  const view = getSeriesPrevDayView(data);
  if (!view || !view.pullDates.length) {
    host.innerHTML =
      '<p class="status">لا تواريخ انتهاء يومية متاحة للمقارنة بعد</p>';
    return;
  }
  const pullDates = view.pullDates;
  const rows = view.rows;
  const close = view.close != null ? view.close : effectiveClose(data);
  const canDelta = state.showDelta && pullDates.length >= 2;
  const lastI = pullDates.length - 1;
  const prevI = pullDates.length - 2;

  let html =
    '<div class="table-title">' +
    "<div>" +
    state.ticker +
    " | اليوم بالسابق</div>";
  if (close != null) {
    const liveTag = state.livePrice != null ? " · مباشر" : "";
    html +=
      '<div class="close-pill">الإغلاق: ' +
      Number(close).toLocaleString(undefined, { maximumFractionDigits: 2 }) +
      liveTag +
      "</div>";
  }
  html += '</div><div class="table-scroll"><table class="oi series-oi"><thead><tr>';

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
      if (typeof greenBarRow === "function") {
        html += greenBarRow(canDelta, pullDates.length, close);
      } else {
        html +=
          '<tr class="close-bar-row"><td colspan="99"><div class="close-bar-line">' +
          Number(close).toLocaleString(undefined, { maximumFractionDigits: 2 }) +
          "</div></td></tr>";
      }
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
      const maxCls =
        d != null && deltaCallMax > 0 && d === deltaCallMax ? " max-oi" : "";
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
      const maxCls =
        d != null && deltaPutMax > 0 && d === deltaPutMax ? " max-oi" : "";
      html +=
        '<td class="delta' +
        maxCls +
        '">' +
        (d != null ? d.toLocaleString() : "") +
        "</td>";
    }
    html += "</tr>";
  });
  if (close != null && !barDone && typeof greenBarRow === "function") {
    html += greenBarRow(canDelta, pullDates.length, close);
  }
  html += "</tbody></table></div>";
  host.innerHTML = html;
}


function renderTable() {
  const data = state.cache[state.ticker];
  const host = $("#tableHost");
  if (state.x3Mode) {
    renderX3();
    return;
  }
  if (state.seriesMode) {
    renderSeriesTable();
    return;
  }
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
  /* نفس منطق getViewRows: فهرسة على block.pull_dates وليس data.pull_dates العامة
     (بعد قص أعمدة الأصفار لكل انتهاء تختلف أطوال المصفوفات) */
  if (!data || !expiration) return null;
  const block = data.by_expiration[expiration];
  if (!block) return null;
  var basePull = (block.pull_dates && block.pull_dates.length)
    ? block.pull_dates.slice()
    : (data.pull_dates || []).slice();
  if (
    String(state.ticker).toUpperCase() === "SPX" &&
    expiration &&
    typeof isThirdFridayExp === "function" &&
    isThirdFridayExp(expiration)
  ) {
    basePull = filterSpxMonthlyPullDates(basePull);
  }
  if (
    String(state.ticker).toUpperCase() === "NDX" &&
    expiration &&
    typeof isThirdFridayExp === "function" &&
    isThirdFridayExp(expiration) &&
    typeof filterSpxMonthlyPullDates === "function"
  ) {
    basePull = filterSpxMonthlyPullDates(basePull);
  }
  var fullDates = (block.pull_dates && block.pull_dates.length)
    ? block.pull_dates
    : (data.pull_dates || []);
  var idxFull = basePull.map(function (d) { return fullDates.indexOf(d); });
  var rowsAligned = (block.rows || []).map(function (r) {
    return {
      strike: r.strike,
      calls: idxFull.map(function (i) { return i >= 0 ? (r.calls[i] || 0) : 0; }),
      puts: idxFull.map(function (i) { return i >= 0 ? (r.puts[i] || 0) : 0; }),
    };
  });
  if (typeof trimLeadingZeroColumns === "function") {
    var trimmed = trimLeadingZeroColumns(basePull, rowsAligned);
    basePull = trimmed.pullDates;
    rowsAligned = trimmed.rows;
  }
  var pullDates = lastN(basePull, daysLimit);
  if (!pullDates.length) return null;
  const idx = pullDates.map(function (d) { return basePull.indexOf(d); });
  let rows = rowsAligned.map(function (r) {
    return {
      strike: r.strike,
      calls: idx.map(function (i) { return i >= 0 ? (r.calls[i] || 0) : 0; }),
      puts: idx.map(function (i) { return i >= 0 ? (r.puts[i] || 0) : 0; }),
    };
  });
  rows = filterStrikes(rows, data.close, strikesLimit);
  if (!rows.length) return null;
  return { pullDates: pullDates, rows: rows, close: data.close, expiration: expiration };
}


/** يكتب جدول انتهاء بنفس تنسيق الديسكتوب (B2، pad=2، تواريخ 13-8، هيدر ناعم) */
function writeOiTableToSheet(ws, startRow, startCol, view, ticker, showDelta) {
  const arabicMonths = {
    1: "يناير", 2: "فبراير", 3: "مارس", 4: "أبريل",
    5: "مايو", 6: "يونيو", 7: "يوليو", 8: "أغسطس",
    9: "سبتمبر", 10: "أكتوبر", 11: "نوفمبر", 12: "ديسمبر",
  };
  const pullDates = view.pullDates.slice();
  const rows = view.rows;
  const n = pullDates.length;
  const hasDelta = !!(showDelta && n >= 2);
  const lastI = n - 1;
  const prevI = n - 2;
  const pad = 2;

  const fillTicker = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE7E6E6" } };
  const fillPutCall = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2EFDA" } };
  const fillRow3 = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEECE1" } };
  const fillRow4 = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDD9C4" } };
  const fillDelta = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE4E4D2" } };
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

  let col = startCol + pad;
  let putDeltaCol = null;
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
  if (hasDelta) {
    callDeltaCol = col;
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
  const putCols = (putDeltaCol ? [putDeltaCol] : []).concat(putDateCols.map(function (x) { return x.c; }));
  const callCols = callDateCols.map(function (x) { return x.c; }).concat(callDeltaCol ? [callDeltaCol] : []);
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

  rows.forEach(function (r, ri) {
    const rowIdx = dataStart + ri;
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
  });

  for (let c = startCol; c <= headerEnd; c++) {
    ws.getColumn(c).width = c === strikeCol ? 12 : 9;
  }
  return headerEnd;
}

function formatExpExportChip(exp) {
  try {
    var d = new Date(String(exp) + "T12:00:00");
    var monthsAr = {
      0: "يناير", 1: "فبراير", 2: "مارس", 3: "أبريل", 4: "مايو", 5: "يونيو",
      6: "يوليو", 7: "أغسطس", 8: "سبتمبر", 9: "أكتوبر", 10: "نوفمبر", 11: "ديسمبر"
    };
    var isOpx = typeof isThirdFridayExp === "function" && isThirdFridayExp(exp);
    return {
      day: d.getDate(),
      monShort: d.toLocaleString("en", { month: "short" }),
      weekday: d.toLocaleString("en", { weekday: "short" }),
      monthKey: d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"),
      monthLabel: (monthsAr[d.getMonth()] || "") + " " + d.getFullYear(),
      sub: isOpx ? "OPX" : d.toLocaleString("en", { weekday: "short" }),
    };
  } catch (e) {
    return { day: exp, monShort: "", weekday: "", monthKey: "x", monthLabel: "", sub: "" };
  }
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

  // تجميع حسب الشهر
  const groups = {};
  const order = [];
  exps.forEach(function (exp) {
    const meta = formatExpExportChip(exp);
    if (!groups[meta.monthKey]) {
      groups[meta.monthKey] = { label: meta.monthLabel, items: [] };
      order.push(meta.monthKey);
    }
    groups[meta.monthKey].items.push({ exp: exp, meta: meta });
  });

  let html = "";
  html += '<div class="exp-export-top">';
  html += '<div class="exp-export-title">Excel — ' + (state.ticker || "") + "</div>";
  html += '<button type="button" class="btn-sm exp-select-all" id="expSelectAll">تحديد الكل</button>';
  html += "</div>";

  html += '<div class="exp-month-list">';
  order.forEach(function (key) {
    const g = groups[key];
    html += '<div class="exp-month">';
    html += '<div class="exp-month-title">' + (g.label || key) + "</div>";
    html += '<div class="exp-month-dates">';
    g.items.forEach(function (it) {
      const on = it.exp === curExp ? " on" : "";
      html +=
        '<button type="button" class="exp-date-chip' +
        on +
        '" data-exp="' +
        it.exp +
        '">' +
        '<span class="d">' +
        it.meta.day +
        (it.meta.monShort ? " " + it.meta.monShort : "") +
        "</span>" +
        '<span class="s">' +
        it.meta.sub +
        "</span></button>";
    });
    html += "</div></div>";
  });
  html += "</div>";

  // شريط موحّد: Days + Strikes + الوضع + Excel
  html += '<div class="exp-unified-bar">';
  html += '<span class="lab">Days</span>';
  ["2", "3", "5", "10", "ALL"].forEach(function (d) {
    const on = String(state.days) === d ? " on" : "";
    html +=
      '<button type="button" class="chip' +
      on +
      '" data-edays="' +
      d +
      '">' +
      d +
      "</button>";
  });
  html += '<span class="lab">Strikes</span>';
  ["50", "100", "ALL"].forEach(function (s) {
    const curS =
      ["50", "100", "ALL"].indexOf(String(state.strikes)) >= 0
        ? String(state.strikes)
        : "50";
    const on = curS === s ? " on" : "";
    html +=
      '<button type="button" class="chip' +
      on +
      '" data-estrikes="' +
      s +
      '">' +
      s +
      "</button>";
  });
  html +=
    '<button type="button" class="chip on" data-emode="single">صفحة واحدة</button>';
  html +=
    '<button type="button" class="chip" data-emode="multi">متعددة</button>';
  html +=
    '<button type="button" class="btn btn-teal exp-do-inline" id="expDoBtn">Excel</button>';
  html += "</div>";
  html += '<p id="expStatus" class="exp-status"></p>';

  body.innerHTML = html;
  modal.classList.remove("hidden");

  let emode = "single";
  let edays = String(state.days || "2");
  let estrikes =
    ["50", "100", "ALL"].indexOf(String(state.strikes)) >= 0
      ? String(state.strikes)
      : "50";

  body.querySelectorAll(".exp-date-chip").forEach(function (btn) {
    btn.onclick = function () {
      btn.classList.toggle("on");
    };
  });

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
      const chips = body.querySelectorAll(".exp-date-chip");
      const allOn = Array.prototype.every.call(chips, function (c) {
        return c.classList.contains("on");
      });
      chips.forEach(function (c) {
        c.classList.toggle("on", !allOn);
      });
    };
  }

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
    body.querySelectorAll(".exp-date-chip.on").forEach(function (chip) {
      chosen.push(chip.getAttribute("data-exp"));
    });
    // توافق قديم إن وُجدت checkboxes
    if (!chosen.length) {
      body.querySelectorAll("input[data-exp]:checked").forEach(function (cb) {
        chosen.push(cb.getAttribute("data-exp"));
      });
    }
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
          views: [{ rightToLeft: true, state: "frozen", ySplit: 5 }],
        });
        writeOiTableToSheet(ws, 2, 2, view, state.ticker, showDelta);
      });
    } else {
      const ws = wb.addWorksheet("Export", {
        views: [{ rightToLeft: true, state: "frozen", ySplit: 5 }],
      });
      let col = 2;
      chosen.forEach(function (exp) {
        const view = getViewRowsFor(data, exp, edays, estrikes);
        if (!view) return;
        const last = writeOiTableToSheet(ws, 2, col, view, state.ticker, showDelta);
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
      if (st) st.textContent = "تم التصدير";
      setStatus("تم التصدير", "ok");
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


async function fetchSessionClose(ticker) {
  /**
   * إغلاق آخر جلسة مكتملة من Yahoo (مع وكيل CORS عند الحاجة):
   * - يقرأ الشموع اليومية
   * - إن كان آخر يوم close=null يستخدم regularMarketPrice
   * - يعيد آخر إغلاق ≤ أمس (جلسة مكتملة)
   */
  try {
    var symbol = (typeof YAHOO_MAP !== "undefined" && YAHOO_MAP[ticker]) ? YAHOO_MAP[ticker] : ticker;
    if (ticker === "SPX") symbol = "^GSPC";
    if (ticker === "NDX") symbol = "^NDX";
    var url =
      "https://query1.finance.yahoo.com/v8/finance/chart/" +
      encodeURIComponent(symbol) +
      "?range=15d&interval=1d";
    async function loadJson(u) {
      try {
        var r = await fetch(u);
        if (!r.ok) return null;
        return await r.json();
      } catch (e) {
        return null;
      }
    }
    var j = await loadJson(url);
    if (!j) {
      j = await loadJson("https://api.allorigins.win/raw?url=" + encodeURIComponent(url));
    }
    if (!j) return null;
    var result = j && j.chart && j.chart.result && j.chart.result[0];
    if (!result) return null;
    var ts = result.timestamp || [];
    var quotes = (result.indicators && result.indicators.quote && result.indicators.quote[0]) || {};
    var closes = quotes.close || [];
    var meta = result.meta || {};
    var rmp = meta.regularMarketPrice;
    var rows = [];
    for (var i = 0; i < ts.length; i++) {
      var c = closes[i];
      // تاريخ تقريبي من timestamp (Yahoo daily عادةً بتوقيت السوق)
      var d = new Date(ts[i] * 1000);
      // استخدم تاريخ تقويم محلي UTC-date من الـ timestamp
      var y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
      var key = y + "-" + String(m + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0");
      var val = (c != null && !isNaN(Number(c)) && Number(c) > 0) ? Number(c) : null;
      rows.push({ key: key, date: new Date(Date.UTC(y, m, day)), val: val });
    }
    // املأ آخر شريط الناقص
    if (rows.length && rows[rows.length - 1].val == null && rmp != null && !isNaN(Number(rmp)) && Number(rmp) > 0) {
      rows[rows.length - 1].val = Number(rmp);
    }
    var valid = rows.filter(function (r) { return r.val != null; });
    if (!valid.length) {
      if (rmp != null && !isNaN(Number(rmp)) && Number(rmp) > 0) return Number(rmp);
      return null;
    }
    // آخر جلسة مكتملة: آخر شريط صالح
    // (إذا السوق مفتوح اليوم وآخر شريط = اليوم بسعر لحظي، نفضّل الشريط السابق إن وُجد)
    var last = valid[valid.length - 1];
    var today = new Date();
    var todayKey =
      today.getUTCFullYear() +
      "-" +
      String(today.getUTCMonth() + 1).padStart(2, "0") +
      "-" +
      String(today.getUTCDate()).padStart(2, "0");
    // إن كان آخر شريط هو "اليوم" وما زال الجلسة جارية، خذ السابق
    if (last.key === todayKey && valid.length >= 2) {
      // أثناء الجلسة: الإغلاق المعروض = إغلاق أمس
      return valid[valid.length - 2].val;
    }
    return last.val;
  } catch (e) {
    return null;
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

function estimateCloseFromRows(data) {
  try {
    if (!data || !data.by_expiration) return null;
    var exp = state.expiration || (data.expirations && data.expirations[0]);
    if (!exp) return null;
    var block = data.by_expiration[exp];
    if (!block || !block.rows || !block.rows.length) return null;
    var bestS = null, bestT = -1;
    var lastIdx = (data.pull_dates || []).length - 1;
    if (lastIdx < 0) lastIdx = 0;
    block.rows.forEach(function (r) {
      var c = 0, p = 0;
      if (r.calls && r.calls.length) c = r.calls[Math.min(lastIdx, r.calls.length - 1)] || 0;
      if (r.puts && r.puts.length) p = r.puts[Math.min(lastIdx, r.puts.length - 1)] || 0;
      var tot = c + p;
      if (tot > bestT) {
        bestT = tot;
        bestS = r.strike;
      }
    });
    return bestS != null ? Number(bestS) : null;
  } catch (e) {
    return null;
  }
}

function effectiveClose(data) {
  if (state.livePrice != null && !isNaN(Number(state.livePrice))) {
    return Number(state.livePrice);
  }
  if (state.sessionClose != null && !isNaN(Number(state.sessionClose))) {
    return Number(state.sessionClose);
  }
  if (data && data.close != null && !isNaN(Number(data.close)) && Number(data.close) > 0) {
    return Number(data.close);
  }
  if (data && data.closes && typeof data.closes === "object") {
    var keys = Object.keys(data.closes);
    for (var i = keys.length - 1; i >= 0; i--) {
      var v = Number(data.closes[keys[i]]);
      if (!isNaN(v) && v > 0) return v;
    }
  }
  var est = estimateCloseFromRows(data);
  if (est != null && !isNaN(est)) return est;
  return null;
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
  
  if ($("#seriesBtn")) {
    $("#seriesBtn").onclick = function () {
      state.seriesMode = !state.seriesMode;
      if (state.seriesMode) {
        state.x3Mode = false;
        var xb = $("#x3Btn");
        if (xb) xb.classList.remove("active");
      }
      $("#seriesBtn").classList.toggle("active", state.seriesMode);
      renderTable();
    };
  }

if ($("#expSelect")) {
    $("#expSelect").onchange = function (e) {
      try {
        state.expiration = e.target.value || null;
        syncExpDropdownLabel();
        renderTable();
      } catch (err) {}
    };
  }
  if ($("#x3Btn")) {
    $("#x3Btn").onclick = function () {
      state.x3Mode = !state.x3Mode;
      if (state.x3Mode) { state.seriesMode = false; var sb = $("#seriesBtn"); if (sb) sb.classList.remove("active"); }
      $("#x3Btn").classList.toggle("active", state.x3Mode);
      renderTable();
    };
  }
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

  if ($("#archiveBtn")) $("#archiveBtn").onclick = function () { openArchive(); };
  if ($("#archiveClose")) $("#archiveClose").onclick = closeArchive;
  if ($("#archiveModal")) $("#archiveModal").addEventListener("click", function (e) {
    if (e.target.id === "archiveModal") closeArchive();
  });
  if ($("#archDeltaBtn")) $("#archDeltaBtn").onclick = function () {
    state.archShowDelta = !state.archShowDelta;
    renderArchChips();
  };
  if ($("#archExportBtn")) $("#archExportBtn").onclick = function () {
    try { exportArchiveExcel(); } catch (err) {
      setStatus("خطأ تصدير الأرشيف: " + (err && err.message ? err.message : err), "err");
    }
  };
  if ($("#archExportMode")) $("#archExportMode").onchange = function (e) {
    state.archExportMode = e.target.value || "multi";
  };

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




// ========== أرشيف الأسبوع (جداول الانتهاء الأساسية) ==========
function isoFromDate(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function getArchiveWeekBounds(data) {
  var s = dataSessionFromPull(data);
  var d;
  if (s) {
    d = new Date(s.year, s.month - 1, s.day);
  } else {
    d = dataSessionCutoffDate(data);
  }
  d.setHours(12, 0, 0, 0);
  var day = d.getDay(); // 0 Sun .. 5 Fri
  var toMon = day === 0 ? -6 : 1 - day;
  var mon = new Date(d);
  mon.setDate(d.getDate() + toMon);
  mon.setHours(0, 0, 0, 0);
  var fri = new Date(mon);
  fri.setDate(mon.getDate() + 4);
  fri.setHours(23, 59, 59, 999);
  return { mon: mon, fri: fri, monIso: isoFromDate(mon), friIso: isoFromDate(fri) };
}

function archiveExpirations(data) {
  if (!data) return [];
  var bounds = getArchiveWeekBounds(data);
  var by = data.by_expiration || {};
  var all = (data.expirations || Object.keys(by) || []).slice();
  var out = [];
  all.forEach(function (exp) {
    var dt = new Date(String(exp) + "T12:00:00");
    if (isNaN(dt.getTime())) return;
    if (dt < bounds.mon || dt > bounds.fri) return;
    if (!by[exp]) return;
    out.push(exp);
  });
  out.sort();
  return out;
}

function formatArchDayTitle(exp) {
  try {
    var d = new Date(String(exp) + "T12:00:00");
    var top = d.getDate() + " " + d.toLocaleString("en", { month: "short" });
    var sub = d.toLocaleString("en", { weekday: "short" });
    return { top: top, sub: sub };
  } catch (e) {
    return { top: exp, sub: "" };
  }
}

function getViewRowsForExp(data, exp, daysLimit, strikesLimit) {
  if (!data || !exp || !data.by_expiration || !data.by_expiration[exp]) return null;
  var block = data.by_expiration[exp];
  var basePull = (block.pull_dates && block.pull_dates.length)
    ? block.pull_dates.slice()
    : (data.pull_dates || []).slice();
  if (
    String(state.ticker).toUpperCase() === "SPX" &&
    typeof isThirdFridayExp === "function" &&
    isThirdFridayExp(exp)
  ) {
    basePull = filterSpxMonthlyPullDates(basePull);
  }
  var fullDates = (block.pull_dates && block.pull_dates.length)
    ? block.pull_dates
    : (data.pull_dates || []);
  var idxFull = basePull.map(function (d) { return fullDates.indexOf(d); });
  var rowsAligned = (block.rows || []).map(function (r) {
    return {
      strike: r.strike,
      calls: idxFull.map(function (i) { return i >= 0 ? (r.calls[i] || 0) : 0; }),
      puts: idxFull.map(function (i) { return i >= 0 ? (r.puts[i] || 0) : 0; }),
    };
  });
  var trimmed = trimLeadingZeroColumns(basePull, rowsAligned);
  basePull = trimmed.pullDates;
  rowsAligned = trimmed.rows;
  var pullDates = lastN(basePull, daysLimit);
  if (!pullDates.length) return null;
  var idx = pullDates.map(function (d) { return basePull.indexOf(d); });
  var rows = rowsAligned.map(function (r) {
    return {
      strike: r.strike,
      calls: idx.map(function (i) { return i >= 0 ? r.calls[i] : 0; }),
      puts: idx.map(function (i) { return i >= 0 ? r.puts[i] : 0; }),
    };
  });
  var close = effectiveClose(data);
  rows = filterStrikes(rows, close, strikesLimit);
  return { pullDates: pullDates, rows: rows, close: close };
}

function buildOneArchiveTableHtml(exp, view, showDelta) {
  if (!view || !view.rows || !view.rows.length) {
    return '<div class="archive-empty">لا بيانات</div>';
  }
  var pullDates = view.pullDates;
  var rows = view.rows;
  var close = view.close;
  var canDelta = showDelta && pullDates.length >= 2;
  var lastI = pullDates.length - 1;
  var prevI = pullDates.length - 2;
  var title = formatArchDayTitle(exp);
  var html = '<div class="archive-day">';
  html += '<div class="archive-day-head"><span>' + title.top + '</span><em>' + title.sub + '</em></div>';
  html += '<div class="table-scroll"><table class="oi"><thead><tr>';
  if (canDelta) html += '<th class="delta">Δ</th>';
  for (var i = pullDates.length - 1; i >= 0; i--) {
    var f = formatPullDate(pullDates[i]);
    html += "<th>" + f.top + '<br><span class="subh">' + f.sub + "</span></th>";
  }
  html += '<th class="strike">STRIKE</th>';
  for (var j = 0; j < pullDates.length; j++) {
    var f2 = formatPullDate(pullDates[j]);
    html += "<th>" + f2.top + '<br><span class="subh">' + f2.sub + "</span></th>";
  }
  if (canDelta) html += '<th class="delta">Δ</th>';
  html += "</tr></thead><tbody>";

  var callMax = [], putMax = [];
  for (var ci = 0; ci < pullDates.length; ci++) {
    var mc = 0, mp = 0;
    rows.forEach(function (r) {
      var cv = r.calls[ci] || 0, pv = r.puts[ci] || 0;
      if (cv > mc) mc = cv;
      if (pv > mp) mp = pv;
    });
    callMax.push(mc);
    putMax.push(mp);
  }
  var deltaCallMax = 0, deltaPutMax = 0;
  if (canDelta) {
    rows.forEach(function (r) {
      var dc = positiveDelta(r.calls[lastI], r.calls[prevI]);
      var dp = positiveDelta(r.puts[lastI], r.puts[prevI]);
      if (dc != null && dc > deltaCallMax) deltaCallMax = dc;
      if (dp != null && dp > deltaPutMax) deltaPutMax = dp;
    });
  }
  var barDone = false;
  rows.forEach(function (r, ri) {
    if (close != null && !barDone && r.strike > close) {
      html += greenBarRow(canDelta, pullDates.length, close);
      barDone = true;
    }
    var zebra = ri % 2 === 1 ? " zebra" : "";
    var above = close != null && r.strike > close;
    var below = close != null && r.strike < close;
    var callCls = below || (close != null && r.strike === close) ? "itm" : "otm";
    var putCls = above || (close != null && r.strike === close) ? "itm" : "otm";
    html += '<tr class="' + zebra + '">';
    if (canDelta) {
      var d = positiveDelta(r.calls[lastI], r.calls[prevI]);
      var maxCls = d != null && deltaCallMax > 0 && d === deltaCallMax ? " max-oi" : "";
      html += '<td class="delta' + maxCls + '">' + (d != null ? d.toLocaleString() : "") + "</td>";
    }
    for (var ii = pullDates.length - 1; ii >= 0; ii--) {
      var cv = r.calls[ii] || 0;
      var maxC = callMax[ii] > 0 && cv === callMax[ii] ? " max-oi" : "";
      html += '<td class="' + callCls + maxC + '">' + cv.toLocaleString() + "</td>";
    }
    html += '<td class="strike">' + r.strike + "</td>";
    for (var pi = 0; pi < pullDates.length; pi++) {
      var pv = r.puts[pi] || 0;
      var maxP = putMax[pi] > 0 && pv === putMax[pi] ? " max-oi" : "";
      html += '<td class="' + putCls + maxP + '">' + pv.toLocaleString() + "</td>";
    }
    if (canDelta) {
      var dp2 = positiveDelta(r.puts[lastI], r.puts[prevI]);
      var maxDp = dp2 != null && deltaPutMax > 0 && dp2 === deltaPutMax ? " max-oi" : "";
      html += '<td class="delta' + maxDp + '">' + (dp2 != null ? dp2.toLocaleString() : "") + "</td>";
    }
    html += "</tr>";
  });
  if (close != null && !barDone) {
    html += greenBarRow(canDelta, pullDates.length, close);
  }
  html += "</tbody></table></div></div>";
  return html;
}


function renderArchChips() {
  var daysHost = $("#archDaysRow");
  var strikesHost = $("#archStrikesRow");
  if (daysHost) {
    daysHost.innerHTML = "";
    ["2", "3", "5", "10", "ALL"].forEach(function (opt) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "chip" + (String(state.archDays) === opt ? " active" : "");
      b.textContent = opt;
      b.onclick = function () {
        state.archDays = opt;
        renderArchChips();
      };
      daysHost.appendChild(b);
    });
  }
  if (strikesHost) {
    strikesHost.innerHTML = "";
    ["30", "50", "ALL"].forEach(function (opt) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "chip" + (String(state.archStrikes) === opt ? " active" : "");
      b.textContent = opt;
      b.onclick = function () {
        state.archStrikes = opt;
        renderArchChips();
      };
      strikesHost.appendChild(b);
    });
  }
  var db = $("#archDeltaBtn");
  if (db) db.classList.toggle("active", !!state.archShowDelta);
}

function updateArchSelectHint() {
  /* hint removed by design */
}

function renderArchDateRow(exps) {
  var row = $("#archDateRow");
  if (!row) return;
  row.innerHTML = "";
  if (!exps || !exps.length) {
    row.innerHTML = '<span class="archive-empty-inline">لا تواريخ هذا الأسبوع</span>';
    updateArchSelectHint();
    return;
  }
  // زر تحديد الكل
  var allBtn = document.createElement("button");
  allBtn.type = "button";
  allBtn.className = "arch-date-chip arch-all-chip";
  allBtn.innerHTML = '<span class="d-top">الكل</span><span class="d-sub">تحديد</span>';
  allBtn.onclick = function () {
    var selected = state.archSelected || [];
    if (selected.length === exps.length) {
      state.archSelected = [];
    } else {
      state.archSelected = exps.slice();
    }
    renderArchDateRow(exps);
  };
  if ((state.archSelected || []).length === exps.length && exps.length) {
    allBtn.classList.add("active");
  }
  row.appendChild(allBtn);

  exps.forEach(function (exp) {
    var t = formatArchDayTitle(exp);
    var b = document.createElement("button");
    b.type = "button";
    var on = (state.archSelected || []).indexOf(exp) >= 0;
    b.className = "arch-date-chip" + (on ? " active" : "");
    b.innerHTML = '<span class="d-top">' + t.top + '</span><span class="d-sub">' + t.sub + "</span>";
    b.onclick = function () {
      var arr = (state.archSelected || []).slice();
      var i = arr.indexOf(exp);
      if (i >= 0) arr.splice(i, 1);
      else arr.push(exp);
      arr.sort();
      state.archSelected = arr;
      renderArchDateRow(exps);
    };
    row.appendChild(b);
  });
  updateArchSelectHint();
}

function openArchive() {
  var modal = $("#archiveModal");
  if (!modal) return;
  state.archSelected = [];
  state.archShowDelta = false;
  modal.classList.remove("hidden");
  var data = state.cache[state.ticker];
  var exps = data ? archiveExpirations(data) : [];
  var title = $("#archiveTitle");
  var sub = $("#archiveSub");
  if (title) title.textContent = "أرشيف الأسبوع — " + (state.ticker || "");
  if (sub) sub.textContent = "اختر تاريخًا";
  renderArchChips();
  renderArchDateRow(exps);
  var modeSel = $("#archExportMode");
  if (modeSel) modeSel.value = state.archExportMode || "multi";
  var db = $("#archDeltaBtn");
  if (db) db.classList.remove("active");
  updateArchSelectHint();
}

function closeArchive() {
  var modal = $("#archiveModal");
  if (modal) modal.classList.add("hidden");
  state.archSelected = [];
}


function expIsoSortKey(exp) {
  try {
    var p = String(exp).split("-").map(Number);
    if (p.length < 3) return 0;
    return new Date(p[0], p[1] - 1, p[2]).getTime();
  } catch (e) {
    return 0;
  }
}

/** إزالة أعمدة الأصفار من نهاية الجدول */
function trimTrailingZeroColumns(pullDates, rows) {
  if (!pullDates || !pullDates.length || !rows || !rows.length) {
    return { pullDates: pullDates || [], rows: rows || [] };
  }
  var n = pullDates.length, last = n - 1, found = false;
  for (var i = n - 1; i >= 0; i--) {
    for (var r = 0; r < rows.length; r++) {
      var c = rows[r].calls && rows[r].calls[i] != null ? Number(rows[r].calls[i]) : 0;
      var pt = rows[r].puts && rows[r].puts[i] != null ? Number(rows[r].puts[i]) : 0;
      if (c > 0 || pt > 0) { last = i; found = true; break; }
    }
    if (found) break;
  }
  if (!found) last = 0;
  if (last === n - 1) return { pullDates: pullDates, rows: rows };
  return {
    pullDates: pullDates.slice(0, last + 1),
    rows: rows.map(function (row) {
      return {
        strike: row.strike,
        calls: (row.calls || []).slice(0, last + 1),
        puts: (row.puts || []).slice(0, last + 1),
      };
    }),
  };
}

/**
 * عرض أرشيف لتاريخ انتهاء:
 * - أعمدة السحب فقط حتى يوم الانتهاء (شاملًا) بدون أيام لاحقة
 * - بدون أعمدة أصفار في البداية أو النهاية
 * - Days = آخر N أيام سحب حقيقية لهذا الانتهاء
 * - Δ = آخر عمود مقابل الذي قبله
 */
function getArchiveViewRows(data, exp, daysLimit, strikesLimit) {
  if (!data || !exp) return null;
  var block = data.by_expiration[exp];
  if (!block) return null;

  var basePull = (block.pull_dates && block.pull_dates.length)
    ? block.pull_dates.slice()
    : (data.pull_dates || []).slice();

  if (
    String(state.ticker).toUpperCase() === "SPX" &&
    typeof isThirdFridayExp === "function" &&
    isThirdFridayExp(exp)
  ) {
    basePull = filterSpxMonthlyPullDates(basePull);
  }
  if (
    String(state.ticker).toUpperCase() === "NDX" &&
    typeof isThirdFridayExp === "function" &&
    isThirdFridayExp(exp) &&
    typeof filterSpxMonthlyPullDates === "function"
  ) {
    basePull = filterSpxMonthlyPullDates(basePull);
  }

  // فقط أيام السحب في أو قبل تاريخ الانتهاء
  var expKey = expIsoSortKey(exp);
  basePull = basePull.filter(function (pd) {
    return pullDateSortKey(pd) <= expKey;
  });
  if (!basePull.length) return null;

  var fullDates = (block.pull_dates && block.pull_dates.length)
    ? block.pull_dates
    : (data.pull_dates || []);
  var idxFull = basePull.map(function (d) { return fullDates.indexOf(d); });
  var rowsAligned = (block.rows || []).map(function (r) {
    return {
      strike: r.strike,
      calls: idxFull.map(function (i) { return i >= 0 ? (r.calls[i] || 0) : 0; }),
      puts: idxFull.map(function (i) { return i >= 0 ? (r.puts[i] || 0) : 0; }),
    };
  });

  if (typeof trimLeadingZeroColumns === "function") {
    var t1 = trimLeadingZeroColumns(basePull, rowsAligned);
    basePull = t1.pullDates;
    rowsAligned = t1.rows;
  }
  var t2 = trimTrailingZeroColumns(basePull, rowsAligned);
  basePull = t2.pullDates;
  rowsAligned = t2.rows;
  if (!basePull.length) return null;

  var pullDates = lastN(basePull, daysLimit);
  if (!pullDates.length) return null;
  var idx = pullDates.map(function (d) { return basePull.indexOf(d); });
  var rows = rowsAligned.map(function (r) {
    return {
      strike: r.strike,
      calls: idx.map(function (i) { return i >= 0 ? (r.calls[i] || 0) : 0; }),
      puts: idx.map(function (i) { return i >= 0 ? (r.puts[i] || 0) : 0; }),
    };
  });
  rows = filterStrikes(rows, data.close, strikesLimit);
  if (!rows.length) return null;
  return { pullDates: pullDates, rows: rows, close: data.close, expiration: exp };
}

async function exportArchiveExcel() {
  var data = state.cache[state.ticker];
  if (!data) {
    setStatus("لا بيانات للتصدير", "err");
    return;
  }
  var weekExps = archiveExpirations(data);
  var exps = (state.archSelected && state.archSelected.length)
    ? state.archSelected.filter(function (e) { return weekExps.indexOf(e) >= 0; })
    : [];
  if (!weekExps.length) {
    setStatus("الأرشيف فارغ", "err");
    return;
  }
  if (!exps.length) {
    setStatus("حدّد تاريخًا واحدًا على الأقل من البطاقات", "err");
    return;
  }
  if (typeof ExcelJS === "undefined") {
    setStatus("مكتبة Excel غير محمّلة", "err");
    return;
  }
  if (typeof writeOiTableToSheet !== "function" || typeof getArchiveViewRows !== "function") {
    setStatus("دوال التصدير غير متوفرة", "err");
    return;
  }

  var mode = state.archExportMode || "multi";
  var showDelta = !!state.archShowDelta;
  var edays = state.archDays || "2";
  var estrikes = state.archStrikes || "30";
  var GAP = 4;

  var wb = new ExcelJS.Workbook();
  wb.creator = "Oi Archive";

  if (mode === "multi") {
    exps.forEach(function (exp) {
      var view = getArchiveViewRows(data, exp, edays, estrikes);
      if (!view) return;
      var ws = wb.addWorksheet(String(exp).slice(0, 31), {
        views: [{ rightToLeft: true }],
      });
      writeOiTableToSheet(ws, 2, 2, view, state.ticker, showDelta);
    });
  } else {
    var ws = wb.addWorksheet("Archive", {
      views: [{ rightToLeft: true }],
    });
    var col = 2;
    exps.forEach(function (exp) {
      var view = getArchiveViewRows(data, exp, edays, estrikes);
      if (!view) return;
      var last = writeOiTableToSheet(ws, 2, col, view, state.ticker, showDelta);
      col = last + 1 + GAP;
    });
  }

  if (!wb.worksheets.length) {
    setStatus("لا بيانات للجداول المختارة", "err");
    return;
  }

  var buf = await wb.xlsx.writeBuffer();
  var blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  var stamp = new Date().toISOString().slice(0, 10);
  var fname =
    state.ticker +
    "_Archive_D" +
    edays +
    "_S" +
    estrikes +
    "_" +
    stamp +
    ".xlsx";
  if (typeof saveAs === "function") {
    saveAs(blob, fname);
  } else {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  setStatus("تم التصدير", "ok");
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
  var meta = (L && L.meta) || {};
  var daily = (L && L.daily) || {};
  var weekly = (L && L.weekly) || {};
  var opx = (L && L.opx) || {};
  var nextOpx = (L && L.next_opx) || {};
  var t = (L && L.tomorrow) || {};

  // جمعة هذا الأسبوع عطلة → المرجع الجمعة التالية + تسمية «الأسبوع القادم»
  var weekWord = meta.weekly_is_next_week ? "الأسبوع القادم" : "الأسبوع";

  var weeklyIsOpx = !!(weekly.exp && opx.exp && String(weekly.exp) === String(opx.exp));
  var dailyIsWeekly =
    meta.today_is_weekly === true ||
    !!(daily.exp && weekly.exp && String(daily.exp) === String(weekly.exp));
  var tomorrowIsWeekly =
    meta.tomorrow_merged_weekly === true ||
    t.merged_into === "weekly" ||
    !!(t.exp && weekly.exp && String(t.exp) === String(weekly.exp));

  function addNextOpx(bands) {
    // دائمًا بطاقة OPX+ (حتى على التابلت) — القيم — إن نقصت
    if (!opx.exp || !nextOpx.exp || String(nextOpx.exp) !== String(opx.exp)) {
      bands.push({ key: "next_opx", label: "OPX+" });
    } else if (nextOpx.exp) {
      bands.push({ key: "next_opx", label: "OPX+" });
    }
    return bands;
  }

  // الجمعة: اليوم = الأسبوع
  if (dailyIsWeekly) {
    var lab = weeklyIsOpx
      ? ("اليوم · " + weekWord + " · OPX")
      : ("اليوم · " + weekWord);
    var bands = [
      { key: "weekly", label: lab },
      { key: "tomorrow", label: "يوم بعد" },
    ];
    if (!weeklyIsOpx) bands.push({ key: "opx", label: "OPX" });
    return addNextOpx(bands);
  }

  // الخميس: يوم بعد = الجمعة = الأسبوع
  if (tomorrowIsWeekly) {
    var lab2 = weeklyIsOpx
      ? ("يوم بعد · " + weekWord + " · OPX")
      : ("يوم بعد · " + weekWord);
    var bands2 = [
      { key: "daily", label: "اليوم" },
      { key: "weekly", label: lab2 },
    ];
    if (!weeklyIsOpx) bands2.push({ key: "opx", label: "OPX" });
    return addNextOpx(bands2);
  }

  // إثنين–أربعاء (وأي يوم عادي)
  var wlab = weeklyIsOpx ? (weekWord + " · OPX") : weekWord;
  var bands3 = [
    { key: "daily", label: "اليوم" },
    { key: "tomorrow", label: "يوم بعد" },
    { key: "weekly", label: wlab },
  ];
  if (!weeklyIsOpx) bands3.push({ key: "opx", label: "OPX" });
  return addNextOpx(bands3);
}


function shouldSkipOpx(L) {
  if (!L) return false;
  var w = L.weekly || {};
  var o = L.opx || {};
  return !!(w.exp && o.exp && w.exp === o.exp);
}

function shouldSkipTomorrow(L) {
  if (!L) return false;
  var t = L.tomorrow || {};
  var w = L.weekly || {};
  var d = L.daily || {};
  if (L.meta && L.meta.tomorrow_merged_weekly) return true;
  if (t.merged_into === "weekly") return true;
  // انتهاء يوم بعد = انتهاء الأسبوع → مدمج في بطاقة الأسبوع
  if (t.exp && w.exp && String(t.exp) === String(w.exp)) return true;
  if (t.support == null && t.resistance == null && !t.exp) return true;
  // تطابق تام مع اليوم → لا بطاقة مكررة
  if (
    t.exp && d.exp && String(t.exp) === String(d.exp) &&
    t.support === d.support && t.resistance === d.resistance
  ) return true;
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
    // أظهر البطاقة حتى بدون بيانات (قمة/قاع —) — مهم للتابلت OPX+
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
      mapRangeChip("30", state.mapRange) +
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
  if (range === "30") return 30;
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
  // نفس منطق filterStrikes في الجدول: أقرب n*2 سترايك من الإغلاق
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
  var data;
  try { data = await loadTicker(state.ticker); } catch (e) { return baseL; }
  var nEach = mapRangeN(range);
  var close = baseL.close != null ? baseL.close : data.close;
  var pullDates = data.pull_dates || [];
  var lastIdx = pullDates.length - 1;
  var prevIdx = pullDates.length > 1 ? pullDates.length - 2 : -1;
  var L2 = JSON.parse(JSON.stringify(baseL));
  L2.mapRange = range || "ALL";
  L2.close = close;
  ["daily", "tomorrow", "weekly", "opx", "next_opx"].forEach(function (key) {
    var band = L2[key] || {};
    var exp = band.exp;
    if (!exp) return;
    var useLastOnly =
      String(state.ticker).toUpperCase() === "SPX" && isThirdFridayExp(exp);
    var idx = lastIdx;
    var pidx = useLastOnly ? -1 : prevIdx;
    var cur = maxOiNearClose(data, exp, close, nEach, idx);
    var old = pidx >= 0 ? maxOiNearClose(data, exp, close, nEach, pidx) : {};
    L2[key] = Object.assign({}, band, {
      support: cur.support,
      resistance: cur.resistance,
      prev_support: old.support != null ? old.support : null,
      prev_resistance: old.resistance != null ? old.resistance : null,
      range: range || "ALL",
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
  if (range === "30") return "30 — نفس نطاق الواجهة";
  if (range === "50") return "50 — نفس نطاق الواجهة";
  if (range === "100") return "100 سترايك تحت/فوق الإغلاق (الماب فقط)";
  return "ALL — كل السترايكات";
}

async function openMap() {
  levelsCache = null;

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


(function bindDdReposition() {
  function repo() {
    try {
      var eBtn = document.getElementById("expDdBtn");
      var eList = document.getElementById("expDdList");
      if (eBtn && eList && eBtn.classList.contains("open") && !eList.hidden) placeFixedDropdown(eBtn, eList);
      var sBtn = document.getElementById("stocksDdBtn");
      var sList = document.getElementById("stocksDdList");
      if (sBtn && sList && sBtn.classList.contains("open") && !sList.hidden) placeFixedDropdown(sBtn, sList);
    } catch (e) {}
  }
  window.addEventListener("resize", repo);
  window.addEventListener("scroll", repo, true);
})();

document.addEventListener("DOMContentLoaded", init);