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
  { symbol: "SNDK", name: "Sandisk", color: "#E31C23" },
  { symbol: "CRWD", name: "CrowdStrike", color: "#FF5A36" },
  { symbol: "VOO", name: "Vanguard S&P 500", color: "#C41230" },
];

/** كل الرموز للبحث/العرض */
const TICKERS = INDEX_TICKERS.concat(STOCKS_TICKERS);

const state = {
  ticker: "SPY", days: "2", strikes: "30",
  expiration: null, showDelta: false, seriesMode: false, showGrowth: false, growthDays: 3, growthAuto: true,
  archDays: "2", archStrikes: "30", archShowDelta: false, archExportMode: "multi", archSelected: [],
  dark: false, cache: {}, livePrice: null, sessionClose: null, mapRange: "ALL", x3Mode: false,
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
        var text = await res.text();
        // NaN غير صالح في JSON — حوّله قبل parse
        text = text.replace(/\bNaN\b/g, "null").replace(/\b-?Infinity\b/g, "null");
        var json;
        try {
          json = JSON.parse(text);
        } catch (e) {
          throw new Error("بيانات تالفة لـ " + ticker);
        }
        if (json && (json.close == null || (typeof json.close === "number" && isNaN(json.close)))) {
          json.close = null;
        }
        state.cache[ticker] = json;
        return json;
      }
    } catch (e) {
      if (e && e.message && e.message.indexOf("بيانات تالفة") === 0) throw e;
    }
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


/** ثالث جمعة من الشهر الميلادي (انتهاء SPX الشهري التقليدي) */
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

/** قائمة الانتهاءات المستقبلية (SPX يبقي الشهري+اليومي حسب مصدر السحب) */

/** أدنى يوم سحب نظيف لـ SPX ثالث جمعة (AM) — ما قبله مخفي لأنه مخلوط */
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
    var nowM = new Date().getMonth() + 1;
    if (month > nowM + 6) year -= 1;
    return { year: year, month: month, day: day, label: last };
  } catch (e) {
    return null;
  }
}
function dataSessionYmd(data) {
  var s = dataSessionFromPull(data);
  if (!s) return (typeof riyadhYmd === "function" ? riyadhYmd() : new Date().toISOString().slice(0, 10));
  return s.year + "-" + String(s.month).padStart(2, "0") + "-" + String(s.day).padStart(2, "0");
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



/** ضع القائمة بـ position:fixed تحت الزر — تخرج من overflow شريط التحكم */

/** قائمة منسدلة خارج الشريط: تُنقل لـ body + position:fixed بأولوية !important */
function placeFixedDropdown(btn, list) {
  if (!btn || !list) return;
  try {
    if (!list.getAttribute("data-dd-home")) {
      var home = list.parentElement;
      if (home) {
        list.setAttribute("data-dd-home", home.id || "");
        list._ddHome = home;
      }
    }
    if (list.parentElement !== document.body) {
      document.body.appendChild(list);
    }
    var r = btn.getBoundingClientRect();
    /* عرض القائمة = عرض الزر؛ للانتهاء حد أدنى حتى لا تُقص التواريخ */
    var w = Math.max(1, Math.round(r.width));
    if (list && list.id === "expDdList") w = Math.max(w, 178);
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
    var home = list._ddHome;
    if (home && list.parentElement === document.body) {
      home.appendChild(list);
    }
  } catch (e) {}
}

function ensureExpDropdownUI() {
  var sel = $("#expSelect");
  if (!sel) return null;
  var parent = sel.parentNode;
  if (!parent) return null;
  var dd = document.getElementById("expDropdown");
  if (dd) return dd;
  sel.classList.add("exp-select-hidden");
  sel.setAttribute("aria-hidden", "true");
  sel.tabIndex = -1;
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

function isAmSettlementTicker(ticker) {
  var t = String(ticker || state.ticker || "").toUpperCase();
  // SPX و NDX: التسوية الصباحية للشهري (ثالث جمعة)
  return t === "SPX" || t === "NDX";
}

function formatExpDisplay(exp) {
  /* مثل OCC: Aug 21, 2026 */
  try {
    var s = String(exp || "");
    var p = s.split("-");
    if (p.length < 3) return s;
    var y = parseInt(p[0], 10);
    var m = parseInt(p[1], 10);
    var d = parseInt(p[2], 10);
    if (!y || !m || !d) return s;
    var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return months[m - 1] + " " + d + ", " + y;
  } catch (e) {
    return String(exp || "");
  }
}

function expOptionLabelHtml(exp) {
  var label = formatExpDisplay(exp);
  var showAm =
    isAmSettlementTicker(state.ticker) &&
    typeof isThirdFridayExp === "function" &&
    isThirdFridayExp(exp);
  if (showAm) {
    return (
      '<span class="exp-date">' +
      label +
      '</span> <span class="exp-am">AM</span>'
    );
  }
  return '<span class="exp-date">' + label + "</span>";
}

function syncExpDropdownLabel() {
  var lab = $("#expDdLabel");
  if (!lab) return;
  var exp = state.expiration;
  if (!exp) {
    lab.innerHTML = "—";
    return;
  }
  lab.innerHTML = expOptionLabelHtml(exp);
}

function fillExpDropdown(exps) {
  ensureExpDropdownUI();
  var sel = $("#expSelect");
  var list = $("#expDdList");
  var btn = $("#expDdBtn");
  if (!sel || !list || !btn) return;

  // أبقِ نص الزر ظاهرًا أثناء إعادة البناء حتى لا ينهار الشريط
  var prevLabelHtml = "";
  try {
    var labKeep = document.getElementById("expDdLabel");
    if (labKeep) prevLabelHtml = labKeep.innerHTML;
  } catch (eL) {}

  sel.innerHTML = "";
  list.innerHTML = "";
  (exps || []).forEach(function (exp) {
    var o = document.createElement("option");
    o.value = exp;
    o.textContent = typeof formatExpDisplay === "function" ? formatExpDisplay(exp) : exp;
    sel.appendChild(o);

    var item = document.createElement("button");
    item.type = "button";
    item.className =
      "exp-dd-item" + (exp === state.expiration ? " active" : "");
    item.setAttribute("role", "option");
    item.dataset.value = exp;
    item.innerHTML = expOptionLabelHtml(exp);
    item.onclick = function (e) {
      e.preventDefault();
      e.stopPropagation();
      state.expiration = exp;
      sel.value = exp;
      list.hidden = true;
      list.setAttribute("hidden", "");
      btn.classList.remove("open");
      var wrap = document.getElementById("expDropdown");
      if (wrap) wrap.classList.remove("open");
      clearFixedDropdown(list);
      syncExpDropdownLabel();
      fillExpDropdown(exps);
      renderTable();
    };
    list.appendChild(item);
  });

  if (!state.expiration || exps.indexOf(state.expiration) < 0) {
    state.expiration = exps[0] || null;
  }
  sel.value = state.expiration || "";
  syncExpDropdownLabel();
  try {
    var lab2 = document.getElementById("expDdLabel");
    if (lab2 && (!lab2.innerHTML || lab2.innerHTML === "—") && prevLabelHtml && prevLabelHtml !== "—") {
      // لا تستبدل بلابل قديم إن صار لدينا انتهاء فعلي
      if (!state.expiration) lab2.innerHTML = prevLabelHtml;
    }
  } catch (eL2) {}

  btn.onclick = function (e) {
    e.preventDefault();
    e.stopPropagation();
    var wrap = document.getElementById("expDropdown") || (list && list.parentElement);
    var isOpen = wrap && wrap.classList.contains("open");
    // أغلق STOCKS
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
  // بعد إعادة البناء أبقِ مغلقة
  try {
    var w0 = document.getElementById("expDropdown");
    if (w0) w0.classList.remove("open");
    btn.classList.remove("open");
    list.hidden = true;
    list.setAttribute("hidden", "");
  } catch (e0) {}
}


/** تاريخ جلسة الرياض (ويكند → الاثنين القادم تقريبًا عبر أول انتهاء متاح) */
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
    var n = new Date();
    return n.toISOString().slice(0, 10);
  }
}

function expIsoDay(iso) {
  return String(iso).slice(0, 10);
}

function isFridayIso(iso) {
  var d = new Date(String(iso) + "T12:00:00");
  return !isNaN(d.getTime()) && d.getDay() === 5;
}

/**
 * ثلاثة انتهاءات لوضع x3: اليوم · يوم بعد · الأسبوع
 * مع دمج التسميات عند التطابق (خميس/جمعة)
 */
function pickX3Targets(exps, data) {
  var list = (exps || []).slice().sort();
  if (!list.length) return [];
  var todayStr = (typeof dataSessionYmd === "function" ? dataSessionYmd(data) : riyadhYmd());
  // أول انتهاء >= اليوم (أو الأول إن كنا بعد السوق/ويكند والبيانات للجلسة القادمة)
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
    if (expWeek && expIsoDay(expWeek) !== expIsoDay(expToday) &&
        (!expTomorrow || expIsoDay(expWeek) !== expIsoDay(expTomorrow))) {
      out.push({ exp: expWeek, label: "الأسبوع" });
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


/** أيام النمو الفعلية: تلقائي = كل الأعمدة المتوفرة − 1، أو يدوي مع سقف حسب المتوفر */
function resolveGrowthDays(nPull, requested, isAuto) {
  var maxG = Math.max(1, (nPull || 0) - 1);
  if (isAuto || requested == null || requested === "" || requested === "auto") {
    return maxG;
  }
  var n = parseInt(requested, 10);
  if (!n || n < 1) return maxG;
  return Math.min(n, maxG);
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
      renderStocksDropdown();
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

  var itemsHtml =
    '<button type="button" class="stocks-dd-item' +
    (!cur ? " active" : "") +
    '" data-value="" role="option">----</button>';
  STOCKS_TICKERS.forEach(function (t) {
    itemsHtml +=
      '<button type="button" class="stocks-dd-item' +
      (t.symbol === cur ? " active" : "") +
      '" data-value="' +
      t.symbol +
      '" role="option">' +
      t.symbol +
      "</button>";
  });

  host.innerHTML =
    '<label class="stocks-label">STOCKS</label>' +
    '<div class="stocks-dd" id="stocksDd">' +
    '<button type="button" class="stocks-dd-btn" id="stocksDdBtn" aria-haspopup="listbox">' +
    '<span id="stocksDdLabel">' +
    (cur || "----") +
    "</span></button>" +
    '<div class="stocks-dd-list" id="stocksDdList" role="listbox" hidden>' +
    itemsHtml +
    "</div></div>";

  var btn = $("#stocksDdBtn");
  var list = $("#stocksDdList");
  if (!btn || !list) return;

  btn.onclick = function (e) {
    e.preventDefault();
    e.stopPropagation();
    var wrap = document.getElementById("stocksDd");
    var isOpen = wrap && wrap.classList.contains("open");
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
      list.querySelectorAll(".stocks-dd-item").forEach(function (el) {
        el.classList.toggle(
          "active",
          (el.getAttribute("data-value") || "") === v
        );
      });
      renderTickers();
      refresh();
      refreshLivePrice();
    };
  });

  if (!window.__stocksDdOutsideBound) {
    window.__stocksDdOutsideBound = true;
    document.addEventListener("click", function (e) {
      var listEl = $("#stocksDdList");
      var btnEl = $("#stocksDdBtn");
      var wrap = $("#stocksDd");
      if (!listEl || !btnEl) return;
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
  var n = pullDates.length;
  var first = 0;
  var found = false;
  for (var i = 0; i < n; i++) {
    for (var r = 0; r < rows.length; r++) {
      var c = rows[r].calls && rows[r].calls[i] != null ? rows[r].calls[i] : 0;
      var p = rows[r].puts && rows[r].puts[i] != null ? rows[r].puts[i] : 0;
      if (Number(c) > 0 || Number(p) > 0) {
        first = i;
        found = true;
        break;
      }
    }
    if (found) break;
  }
  if (!found) first = Math.max(0, n - 1);
  if (first === 0) return { pullDates: pullDates, rows: rows };
  return {
    pullDates: pullDates.slice(first),
    rows: rows.map(function (row) {
      return {
        strike: row.strike,
        calls: (row.calls || []).slice(first),
        puts: (row.puts || []).slice(first),
      };
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
  // ثبّت واجهة الانتهاء أثناء التحميل (لا تفرّغ القائمة فتحدث وميض/انهيار الشريط)
  try {
    if (typeof ensureExpDropdownUI === "function") ensureExpDropdownUI();
  } catch (e0) {}
  try {
    const data = await loadTicker(state.ticker);
    const exps = filterTickerExpirations(state.ticker, data.expirations || []);
    fillExpDropdown(exps);
    $("#updatedAt").textContent = data.updated_at
      ? "آخر تحديث: " + formatUpdatedAt(data.updated_at)
      : "لا يوجد تحديث بعد — شغّل Actions أولاً";
    renderTable();
    setStatus("جاهز", "ok");
    if (typeof fetchSessionClose === "function") {
      fetchSessionClose(state.ticker).then(function (px) {
        if (px != null) {
          state.sessionClose = px;
          if (state.cache[state.ticker]) state.cache[state.ticker].close = px;
          renderTable();
        }
      });
    }
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

/** تسمية بطاقة ×3: «اليوم 17 أوغست» بدون تاريخ ISO كامل */
function x3PanelTitle(label, exp) {
  var dm = arabicDayMonth(exp);
  var lab = String(label || "");
  lab = lab.replace(/\d{4}-\d{2}-\d{2}/g, "").trim();
  var am = "";
  if (
    typeof isAmSettlementTicker === "function" &&
    isAmSettlementTicker(state.ticker) &&
    typeof isThirdFridayExp === "function" &&
    isThirdFridayExp(exp)
  ) {
    am = ' <span class="exp-am">AM</span>';
  }
  if (/اليوم|يوم بعد|الأسبوع|OPX/i.test(lab)) {
    return lab + " " + dm + am;
  }
  return lab + " " + dm + am;
}

function renderOneMiniTable(data, expiration, label, opts) {
  opts = opts || {};
  var saved = {
    expiration: state.expiration,
    days: state.days,
    showDelta: state.showDelta,
    showGrowth: state.showGrowth,
    growthAuto: state.growthAuto,
  };
  state.expiration = expiration;
  state.days = "2";
  var view = getViewRows(data);
  state.expiration = saved.expiration;
  state.days = saved.days;
  state.showDelta = saved.showDelta;
  state.showGrowth = saved.showGrowth;
  if (saved.growthAuto != null) state.growthAuto = !!saved.growthAuto;

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
  // محاذاة صفوف x3: نفس قائمة السترايك في الجداول الثلاثة
  if (opts.sharedStrikes && opts.sharedStrikes.length) {
    var byS = {};
    rows.forEach(function (r) {
      byS[String(Math.round(Number(r.strike) * 100) / 100)] = r;
    });
    rows = opts.sharedStrikes.map(function (s) {
      var k = String(Math.round(Number(s) * 100) / 100);
      if (byS[k]) return byS[k];
      var emptyC = [], emptyP = [];
      for (var ei = 0; ei < pullDates.length; ei++) {
        emptyC.push(0);
        emptyP.push(0);
      }
      return { strike: Number(s), calls: emptyC, puts: emptyP };
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

  // أقرب سترايك للإغلاق لصف الشريط الأخضر
  var closeStrike = null;
  if (close != null && !isNaN(Number(close)) && rows.length) {
    var best = rows[0].strike;
    var bestD = Math.abs(rows[0].strike - close);
    rows.forEach(function (r) {
      var d = Math.abs(r.strike - close);
      if (d < bestD) {
        bestD = d;
        best = r.strike;
      }
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
    var zebra = ri % 2 === 1 ? " zebra" : "";
    var isCloseRow =
      closeStrike != null && Number(r.strike) === Number(closeStrike);
    var rowCls = zebra + (isCloseRow ? " close-bar" : "");
    var above = close != null && r.strike > close;
    var below = close != null && r.strike < close;
    var callCls = below || (close != null && r.strike === close) ? "itm" : "otm";
    var putCls = above || (close != null && r.strike === close) ? "itm" : "otm";
    html += '<tr class="' + rowCls.trim() + '">';
    if (canDelta) {
      var dc = positiveDelta(r.calls[lastI], r.calls[prevI]);
      var maxD = dc != null && deltaCallMax > 0 && dc === deltaCallMax ? " max-oi" : "";
      html +=
        '<td class="delta' + maxD + '">' +
        (dc != null ? dc.toLocaleString() : "") +
        "</td>";
    }
    for (var ci = pullDates.length - 1; ci >= 0; ci--) {
      var cv = r.calls[ci] || 0;
      var maxC = callMax[ci] > 0 && cv === callMax[ci] ? " max-oi" : "";
      html +=
        '<td class="' + callCls + maxC + '">' + cv.toLocaleString() + "</td>";
    }
    // شريط الإغلاق: في عمود السترايك نعرض رقم الإغلاق إن وُجد
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
      html +=
        '<td class="' + putCls + maxP + '">' + pv.toLocaleString() + "</td>";
    }
    if (canDelta) {
      var dp = positiveDelta(r.puts[lastI], r.puts[prevI]);
      var maxDp = dp != null && deltaPutMax > 0 && dp === deltaPutMax ? " max-oi" : "";
      html +=
        '<td class="delta' + maxDp + '">' +
        (dp != null ? dp.toLocaleString() : "") +
        "</td>";
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
    var nodeLab = String(t.label || "");
    // الخط الزمني: اليوم 17 أوغست
    var nodeTitle = x3PanelTitle(nodeLab, t.exp);
    tl +=
      '<div class="x3-node">' +
      '<div class="x3-dot' + (i === 0 ? " on" : "") + '"></div>' +
      '<div class="x3-lab">' + nodeTitle + "</div>" +
      "</div>";
  });
  tl += "</div>";

  // سترايكات موحّدة = قائمة جدول «اليوم» فقط حتى تتطابق الصفوف عموديًا
  var sharedStrikes = [];
  if (targets.length) {
    var saved0 = { expiration: state.expiration, days: state.days };
    state.expiration = targets[0].exp;
    state.days = "2";
    var view0 = getViewRows(data);
    state.expiration = saved0.expiration;
    state.days = saved0.days;
    if (view0 && view0.rows) {
      sharedStrikes = view0.rows.map(function (r) { return Number(r.strike); });
      sharedStrikes.sort(function (a, b) { return a - b; });
    }
  }

  var cols = '<div class="x3-cols">';
  targets.forEach(function (t, i) {
    cols += renderOneMiniTable(data, t.exp, t.label, {
      active: i === 0,
      sharedStrikes: sharedStrikes,
    });
  });
  cols += "</div>";

  host.innerHTML = '<div class="x3-board">' + tl + cols + "</div>";
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
  if (state.seriesMode && typeof renderSeriesTable === 'function') {
    return renderSeriesTable();
  }
  if (state.seriesMode && typeof buildSeriesTableHtml === 'function') {
    var seriesHost = document.getElementById('tableHost');
    if (seriesHost) seriesHost.innerHTML = buildSeriesTableHtml();
    return;
  }
  const data = state.cache[state.ticker];
  const host = $("#tableHost");
  if (state.x3Mode) {
    renderX3();
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
  const gDays = resolveGrowthDays(pullDates.length, state.growthDays, state.growthAuto);
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
  var basePullFor = (block.pull_dates && block.pull_dates.length)
    ? block.pull_dates.slice()
    : (data.pull_dates || []).slice();
  if (
    String(state.ticker).toUpperCase() === "SPX" &&
    expiration &&
    typeof isThirdFridayExp === "function" &&
    isThirdFridayExp(expiration)
  ) {
    basePullFor = filterSpxMonthlyPullDates(basePullFor);
  }
  var fullDates = (block.pull_dates && block.pull_dates.length)
    ? block.pull_dates
    : (data.pull_dates || []);
  var idxFull = basePullFor.map(function (d) { return fullDates.indexOf(d); });
  var rowsAligned = (block.rows || []).map(function (r) {
    return {
      strike: r.strike,
      calls: idxFull.map(function (i) { return i >= 0 ? (r.calls[i] || 0) : 0; }),
      puts: idxFull.map(function (i) { return i >= 0 ? (r.puts[i] || 0) : 0; }),
    };
  });
  var trimmed = trimLeadingZeroColumns(basePullFor, rowsAligned);
  basePullFor = trimmed.pullDates;
  rowsAligned = trimmed.rows;
  var pullDates = lastN(basePullFor, daysLimit);
  if (!pullDates.length) return null;
  const idx = pullDates.map(function (d) { return basePullFor.indexOf(d); });
  let rows = rowsAligned.map(function (r) {
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


/** يكتب جدول انتهاء من B2 بدون أعمدة pad إضافية */
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
  const gDays = (growthDays === "auto" || growthDays == null)
    ? resolveGrowthDays(n, null, true)
    : resolveGrowthDays(n, growthDays, false);
  const hasGrowth = !!(showGrowth && n > gDays);
  const lastI = n - 1;
  const prevI = n - 2;
  const pad = 0; // بدون أعمدة فارغة على الجانبين

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
  // بلا حدود رمادية — مظهر متصل
  const border = undefined;

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

  let putDeltaMax = 0, callDeltaMax = 0, putGrowthMax = 0, callGrowthMax = 0;
  if (hasDelta) {
    rows.forEach(function (r) {
      const dp = positiveDelta(r.puts[lastI], r.puts[prevI]);
      const dc = positiveDelta(r.calls[lastI], r.calls[prevI]);
      if (dp != null && dp > putDeltaMax) putDeltaMax = dp;
      if (dc != null && dc > callDeltaMax) callDeltaMax = dc;
    });
  }
  if (hasGrowth) {
    rows.forEach(function (r) {
      const gp = positiveGrowth(r.puts, gDays);
      const gc = positiveGrowth(r.calls, gDays);
      if (gp != null && gp > putGrowthMax) putGrowthMax = gp;
      if (gc != null && gc > callGrowthMax) callGrowthMax = gc;
    });
  }

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
      cell.fill = (g != null && putGrowthMax > 0 && g === putGrowthMax) ? fillMax : fillGrowth;
    }
    if (hasDelta && putDeltaCol) {
      const dlt = positiveDelta(r.puts[lastI], r.puts[prevI]);
      const cell = ws.getCell(rowIdx, putDeltaCol);
      cell.value = dlt != null ? dlt : "";
      cell.numFmt = "#,##0";
      cell.font = fontN;
      cell.alignment = alignC;
      cell.border = border;
      cell.fill = (dlt != null && putDeltaMax > 0 && dlt === putDeltaMax) ? fillMax : fillDelta;
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
      cell.fill = (dlt != null && callDeltaMax > 0 && dlt === callDeltaMax) ? fillMax : fillDelta;
    }
    if (hasGrowth && callGrowthCol) {
      const g = positiveGrowth(r.calls, gDays);
      const cell = ws.getCell(rowIdx, callGrowthCol);
      cell.value = g != null ? g : "";
      cell.numFmt = "#,##0";
      cell.font = fontN;
      cell.alignment = alignC;
      cell.border = border;
      cell.fill = (g != null && callGrowthMax > 0 && g === callGrowthMax) ? fillMax : fillGrowth;
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


/** أول اثنين من الشهر الميلادي (بتاريخ الجهاز) */
function isFirstMondayOfMonth(d) {
  d = d || new Date();
  if (d.getDay() !== 1) return false;
  return d.getDate() <= 7;
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
  html += '<div class="exp-export-heading">';
  html += '<div class="exp-export-title">' + (state.ticker || "") + "</div>";
  if (isFirstMondayOfMonth(new Date())) {
    html += '<div class="exp-month-tip">بداية شهر جديد — مناسبة لتصدير ما يهمّك</div>';
  }
  html += "</div>";
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
    const showGrowth = !!state.showGrowth;
    const growthDays = state.growthAuto ? "auto" : state.growthDays;

    if (emode === "multi") {
      chosen.forEach(function (exp, i) {
        const view = getViewRowsFor(data, exp, edays, estrikes);
        if (!view) return;
        const ws = wb.addWorksheet(String(exp).slice(0, 31), {
          views: [{ rightToLeft: true }],
        });
        writeOiTableToSheet(ws, 2, 2, view, state.ticker, showDelta, showGrowth, growthDays);
      });
    } else {
      const ws = wb.addWorksheet("Export", {
        views: [{ rightToLeft: true }],
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
const YAHOO_MAP = {
  SPY: "SPY", QQQ: "QQQ", IWM: "IWM", GLD: "GLD", SPX: "^GSPC",
  AAPL: "AAPL", MSFT: "MSFT", NVDA: "NVDA", TSLA: "TSLA", AMZN: "AMZN",
  META: "META", GOOGL: "GOOGL", AVGO: "AVGO", MSTR: "MSTR", AMD: "AMD",
  MU: "MU", COHR: "COHR", SNDK: "SNDK", CRWD: "CRWD", VOO: "VOO", NDX: "^NDX",
};
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
   * إغلاق آخر جلسة مكتملة من Yahoo:
   * - يقرأ الشموع اليومية
   * - إن كان آخر يوم close=null يستخدم regularMarketPrice
   * - يعيد آخر إغلاق ≤ أمس (جلسة مكتملة) وليس السعر اللحظي أثناء الجلسة إن وُجد شريط أمس
   */
  try {
    var symbol = (typeof YAHOO_MAP !== "undefined" && YAHOO_MAP[ticker]) ? YAHOO_MAP[ticker] : ticker;
    if (ticker === "SPX") symbol = "^GSPC";
    if (ticker === "NDX") symbol = "^NDX";
    var url =
      "https://query1.finance.yahoo.com/v8/finance/chart/" +
      encodeURIComponent(symbol) +
      "?range=15d&interval=1d";
    var res = await fetch(url);
    if (!res.ok) return null;
    var j = await res.json();
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
  if ($("#seriesBtn")) {
    $("#seriesBtn").onclick = function () {
      state.seriesMode = !state.seriesMode;
      if (state.seriesMode) {
        state.x3Mode = false;
        var x3 = $("#x3Btn"); if (x3) x3.classList.remove("active");
      }
      $("#seriesBtn").classList.toggle("active", state.seriesMode);
      renderTable();
    };
  }

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
  if ($("#x3Btn")) {
    $("#x3Btn").onclick = function () {
      state.x3Mode = !state.x3Mode;
      $("#x3Btn").classList.toggle("active", state.x3Mode);
      renderTable();
    };
  }
  $("#deltaBtn").onclick = function () {
    state.showDelta = !state.showDelta;
    $("#deltaBtn").classList.toggle("active", state.showDelta);
    renderTable();
  };
  if ($("#growthBtn")) {
    $("#growthBtn").onclick = function () {
      if (!state.showGrowth) {
        var ans = window.prompt("أيام النمو — فارغ = تلقائي", "");
        if (ans == null) return;
        ans = String(ans).trim();
        if (ans === "" || ans === "auto" || ans === "تلقائي") {
          state.growthAuto = true;
          state.growthDays = 0;
        } else {
          var n = parseInt(ans, 10);
          if (!n || n < 1) {
            setStatus("رقم غير صالح", "err");
            return;
          }
          state.growthAuto = false;
          state.growthDays = n;
        }
        state.showGrowth = true;
      } else {
        state.showGrowth = false;
      }
      $("#growthBtn").classList.toggle("active", state.showGrowth);
      $("#growthBtn").title = !state.showGrowth
        ? "النمو"
        : state.growthAuto
          ? "نمو تلقائي حسب الأعمدة (إيقاف)"
          : "نمو " + state.growthDays + " يوم (إيقاف)";
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
  if ($("#archiveBtn")) $("#archiveBtn").onclick = function () { openArchive(); };
  if ($("#archiveClose")) $("#archiveClose").onclick = function () { closeArchive(); };
  if ($("#archExportBtn")) $("#archExportBtn").onclick = function () {
    try { exportArchiveExcel(); } catch (err) {
      setStatus("خطأ أرشيف: " + (err && err.message ? err.message : err), "err");
    }
  };
  var archMode = $("#archExportMode");
  if (archMode) archMode.onchange = function () {
    state.archExportMode = archMode.value || "multi";
  };
  if ($("#archDeltaBtn")) $("#archDeltaBtn").onclick = function () {
    state.archShowDelta = !state.archShowDelta;
    $("#archDeltaBtn").classList.toggle("active", state.archShowDelta);
  };

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
  // ابنِ شريط التحكم كاملًا قبل أول تحميل حتى لا يظهر select فارغ أثناء "جاري التحميل"
  try {
    if (typeof ensureExpDropdownUI === "function") ensureExpDropdownUI();
    if (typeof syncExpDropdownLabel === "function") syncExpDropdownLabel();
    if (typeof renderStocksDropdown === "function") renderStocksDropdown();
  } catch (eInitUi) {}
  refresh();
  startLivePriceLoop();
}




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
      writeOiTableToSheet(ws, 2, 2, view, state.ticker, showDelta, false, 3);
    });
  } else {
    var ws = wb.addWorksheet("Archive", {
      views: [{ rightToLeft: true }],
    });
    var col = 2;
    exps.forEach(function (exp) {
      var view = getArchiveViewRows(data, exp, edays, estrikes);
      if (!view) return;
      var last = writeOiTableToSheet(ws, 2, col, view, state.ticker, showDelta, false, 3);
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
    // أظهر البطاقة حتى بدون بيانات
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

/**
 * أعلى Put = قاع، أعلى Call = قمة — بنفس منطق الجدول الرئيسي.
 * مهم: كل انتهاء له pull_dates خاصة (أقصر من العامة) — يجب استخدام فهرسها لا العام.
 */
function maxOiNearClose(data, exp, close, nEach, dateIdx) {
  var block = data && data.by_expiration && data.by_expiration[exp];
  if (!block || !block.rows || !block.rows.length) {
    return { support: null, resistance: null };
  }
  // فهارس صحيحة لهذا الانتهاء فقط
  var pulls = (block.pull_dates && block.pull_dates.length)
    ? block.pull_dates
    : (data.pull_dates || []);
  var idx = dateIdx;
  if (idx == null || idx < 0) {
    // آخر عمود غير صفري لهذا الانتهاء
    idx = pulls.length - 1;
    while (idx >= 0) {
      var sum = 0;
      for (var ri = 0; ri < block.rows.length; ri++) {
        var rr = block.rows[ri];
        var cc = (rr.calls && rr.calls[idx]) || 0;
        var pp = (rr.puts && rr.puts[idx]) || 0;
        sum += Number(cc) + Number(pp);
      }
      if (sum > 0) break;
      idx--;
    }
  }
  if (idx < 0) return { support: null, resistance: null };

  var rows = block.rows.map(function (r) {
    var callArr = r.calls || [];
    var putArr = r.puts || [];
    return {
      strike: Number(r.strike),
      call: Number(idx < callArr.length ? callArr[idx] : 0) || 0,
      put: Number(idx < putArr.length ? putArr[idx] : 0) || 0,
    };
  });
  // نفس منطق filterStrikes: أقرب n تحت + n فوق من الإغلاق
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
  // إذا كل القيم صفر لا تُرجع سترايك عشوائي
  if (maxPut <= 0 && maxCall <= 0) {
    return { support: null, resistance: null };
  }
  return { support: sup, resistance: res, _idx: idx, _pull: pulls[idx] || null };
}

/** فهرس آخر سحب حقيقي لانتهاء معيّن (+ السابق للمقارنة) */
function expPullIndices(data, exp) {
  var block = data && data.by_expiration && data.by_expiration[exp];
  if (!block) return { last: -1, prev: -1, pulls: [] };
  var pulls = (block.pull_dates && block.pull_dates.length)
    ? block.pull_dates.slice()
    : (data.pull_dates || []).slice();
  var last = pulls.length - 1;
  while (last >= 0) {
    var sum = 0;
    for (var i = 0; i < (block.rows || []).length; i++) {
      var r = block.rows[i];
      sum += Number((r.calls && r.calls[last]) || 0) + Number((r.puts && r.puts[last]) || 0);
    }
    if (sum > 0) break;
    last--;
  }
  var prev = last > 0 ? last - 1 : -1;
  return { last: last, prev: prev, pulls: pulls };
}

async function levelsForMapRange(baseL, range) {
  if (!baseL) return baseL;
  var data;
  try { data = await loadTicker(state.ticker); } catch (e) { return baseL; }
  var nEach = mapRangeN(range); // null = ALL
  var close = null;
  if (baseL.close != null && !isNaN(Number(baseL.close)) && Number(baseL.close) > 0) {
    close = Number(baseL.close);
  } else if (typeof effectiveClose === "function") {
    close = effectiveClose(data);
  } else if (data.close != null && !isNaN(Number(data.close)) && Number(data.close) > 0) {
    close = Number(data.close);
  }
  var L2 = JSON.parse(JSON.stringify(baseL));
  L2.mapRange = range || "ALL";
  L2.close = close;
  ["daily", "tomorrow", "weekly", "opx", "next_opx"].forEach(function (key) {
    var band = L2[key] || {};
    var exp = band.exp;
    if (!exp) return;
    // فهرس السحب من pull_dates الخاصة بهذا الانتهاء — لا من القائمة العامة
    var ix = expPullIndices(data, exp);
    var useLastOnly =
      String(state.ticker).toUpperCase() === "SPX" &&
      typeof isThirdFridayExp === "function" &&
      isThirdFridayExp(exp);
    var cur = maxOiNearClose(data, exp, close, nEach, ix.last);
    var old = (!useLastOnly && ix.prev >= 0)
      ? maxOiNearClose(data, exp, close, nEach, ix.prev)
      : {};
    L2[key] = Object.assign({}, band, {
      support: cur.support,
      resistance: cur.resistance,
      prev_support: old.support != null ? old.support : null,
      prev_resistance: old.resistance != null ? old.resistance : null,
      range: range || "ALL",
      pull_date: cur._pull || (ix.pulls[ix.last] || null),
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


/* ===== تقويم تداول الماب: اليوم / يوم بعد / أسبوع مع عطل ===== */
var US_MARKET_HOLIDAYS = {
  "2025-01-01":1,"2025-01-20":1,"2025-02-17":1,"2025-04-18":1,"2025-05-26":1,
  "2025-06-19":1,"2025-07-04":1,"2025-09-01":1,"2025-11-27":1,"2025-12-25":1,
  "2026-01-01":1,"2026-01-19":1,"2026-02-16":1,"2026-04-03":1,"2026-05-25":1,
  "2026-06-19":1,"2026-07-03":1,"2026-09-07":1,"2026-11-26":1,"2026-12-25":1,
  "2027-01-01":1,"2027-01-18":1,"2027-02-15":1,"2027-03-26":1,"2027-05-31":1,
  "2027-06-18":1,"2027-07-05":1,"2027-09-06":1,"2027-11-25":1,"2027-12-24":1
};
function toIsoDate(d) {
  return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
}
function isUsHoliday(d) { return !!US_MARKET_HOLIDAYS[toIsoDate(d)]; }
function isTradingDay(d) {
  var w = d.getDay();
  if (w === 0 || w === 6) return false;
  return !isUsHoliday(d);
}
function sessionTradingDay(now) {
  var d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  while (!isTradingDay(d)) d.setDate(d.getDate() + 1);
  return d;
}
function nextTradingDayAfter(from) {
  var d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  d.setDate(d.getDate() + 1);
  while (!isTradingDay(d)) d.setDate(d.getDate() + 1);
  return d;
}
function fridayForWeek(session) {
  var d = new Date(session.getFullYear(), session.getMonth(), session.getDate());
  var add = (5 - d.getDay() + 7) % 7;
  if (d.getDay() !== 5) d.setDate(d.getDate() + add);
  var isNext = false;
  while (!isTradingDay(d)) { d.setDate(d.getDate() + 7); isNext = true; }
  return { date: d, isNextWeek: isNext };
}
function thirdFridayOfMonth(year, monthIndex) {
  var d = new Date(year, monthIndex, 1), count = 0;
  while (d.getMonth() === monthIndex) {
    if (d.getDay() === 5) { count++; if (count === 3) return d; }
    d.setDate(d.getDate() + 1);
  }
  return new Date(year, monthIndex, 15);
}

/** يفرض مواعيد بطاقات الماب من تقويم التداول + expirations الفعلية */
async function assignMapBandExps(raw, ticker) {
  var data = await loadTicker(ticker);
  if (!data) return raw;
  var exps = (data.expirations || Object.keys(data.by_expiration || {})).slice().sort();
  function pickExp(iso) {
    if (!iso || !exps.length) return null;
    for (var i = 0; i < exps.length; i++) if (exps[i] === iso) return exps[i];
    for (var j = 0; j < exps.length; j++) if (exps[j] >= iso) return exps[j];
    return exps[exps.length - 1];
  }
  var now = new Date();
  var session = sessionTradingDay(now);
  var tom = nextTradingDayAfter(session);
  var fri = fridayForWeek(session);
  var week = fri.date;
  var opx = thirdFridayOfMonth(session.getFullYear(), session.getMonth());
  if (toIsoDate(opx) < toIsoDate(session)) {
    var nm = session.getMonth() + 1, ny = session.getFullYear();
    if (nm > 11) { nm = 0; ny++; }
    opx = thirdFridayOfMonth(ny, nm);
  }
  var nextOpx = opx.getMonth() === 11
    ? thirdFridayOfMonth(opx.getFullYear() + 1, 0)
    : thirdFridayOfMonth(opx.getFullYear(), opx.getMonth() + 1);

  var expDaily = pickExp(toIsoDate(session));
  var expTom = pickExp(toIsoDate(tom));
  var expWeek = pickExp(toIsoDate(week));
  var expOpx = pickExp(toIsoDate(opx));
  var expNext = pickExp(toIsoDate(nextOpx));

  if (!raw) raw = { ticker: ticker };
  raw.close = (data.close != null ? data.close : raw.close);
  raw.daily = Object.assign({}, raw.daily || {}, { exp: expDaily, target: toIsoDate(session) });
  raw.tomorrow = Object.assign({}, raw.tomorrow || {}, { exp: expTom, target: toIsoDate(tom) });
  raw.weekly = Object.assign({}, raw.weekly || {}, { exp: expWeek, target: toIsoDate(week) });
  raw.opx = Object.assign({}, raw.opx || {}, { exp: expOpx, target: toIsoDate(opx) });
  raw.next_opx = Object.assign({}, raw.next_opx || {}, { exp: expNext, target: toIsoDate(nextOpx) });
  raw.meta = Object.assign({}, raw.meta || {}, {
    session_iso: toIsoDate(session),
    tomorrow_iso: toIsoDate(tom),
    week_iso: toIsoDate(week),
    weekly_is_next_week: !!fri.isNextWeek,
    today_is_weekly: !!(expDaily && expWeek && expDaily === expWeek),
    tomorrow_merged_weekly: !!(expTom && expWeek && expTom === expWeek),
  });
  return raw;
}

async function openMap() {
  levelsCache = null; // إعادة قراءة levels + حساب من JSON الحالي

  const modal = $("#mapModal");
  const body = $("#mapBody");
  const title = $("#mapTitle");
  const sub = $("#mapSub");
  if (!modal) return;
  modal.classList.remove("hidden"); modal.style.display = ""; modal.setAttribute("aria-hidden", "false");
  body.innerHTML = '<p style="color:#94a3b8">جاري تحميل المستويات…</p>';
  try {
    var raw = null;
    try {
      const all = await loadLevels();
      raw = (all.tickers || {})[state.ticker] || null;
    } catch (eLoad) {
      console.warn("levels.json:", eLoad);
    }
    // فرض مواعيد اليوم/يوم بعد من التقويم + إغلاق من JSON الرمز
    raw = await assignMapBandExps(raw, state.ticker);
    if (!raw || !raw.daily) throw new Error("لا مستويات لـ " + state.ticker);
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
      try {
        const all = await loadLevels();
        raw = (all.tickers || {})[state.ticker];
      } catch (e) {}
    }
    raw = await assignMapBandExps(raw, state.ticker);
    mapRawL = raw;
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
  if (modal) {
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
    modal.style.display = "none";
  }
}



// —— تعليقات خاصة (Web3Forms) ——
// ضعي مفتاحك من https://web3forms.com بعد التسجيل (Access Key)
const FEEDBACK_ACCESS_KEY = "53716803-35b4-4c15-a27e-0cde07f2e555";

function openFeedback() {
  const modal = $("#feedbackModal");
  if (!modal) return;
  const st = $("#fbStatus");
  if (st) st.textContent = "";
  modal.classList.remove("hidden"); modal.style.display = ""; modal.setAttribute("aria-hidden", "false");
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
    // قاع = أعلى Put OI | قمة = أعلى Call OI
    trough: {
      strike: maxPutStrike,
      oi: maxPut > 0 ? maxPut : null,
      move: move(maxPutStrike, prevMaxPutStrike),
      exp: view.expiration,
    },
    peak: {
      strike: maxCallStrike,
      oi: maxCall > 0 ? maxCall : null,
      move: move(maxCallStrike, prevMaxCallStrike),
      exp: view.expiration,
    },
  };
}

function buildStrikeScores(deltaCall, deltaPut, growthCall, growthPut, troughs, peaks, close) {
  function makeSide(deltaList, growthList, levelList, levelTag) {
    var map = {};
    function bump(strike, pts, reason) {
      if (strike == null) return;
      var k = String(strike);
      if (!map[k]) map[k] = { strike: Number(strike), score: 0, reasons: [] };
      map[k].score += pts;
      if (reason) map[k].reasons.push(reason);
    }
    (deltaList || []).forEach(function (x, i) {
      bump(x.strike, Math.max(1, 6 - i), "Δ #" + (i + 1));
    });
    (growthList || []).forEach(function (x, i) {
      bump(x.strike, Math.max(1, 5 - i), "G #" + (i + 1));
    });
    (levelList || []).forEach(function (t) {
      if (t && t.oi) bump(t.strike, 4, levelTag + " " + formatExpAr(t.exp));
    });
    if (close != null) {
      Object.keys(map).forEach(function (k) {
        var dist = Math.abs(map[k].strike - close);
        if (dist <= close * 0.02) {
          map[k].score += 3;
          map[k].reasons.push("قرب الإغلاق");
        } else if (dist <= close * 0.05) {
          map[k].score += 1;
          map[k].reasons.push("قريب من السعر");
        }
      });
    }
    var list = Object.keys(map).map(function (k) { return map[k]; });
    list.sort(function (a, b) { return b.score - a.score; });
    return list.slice(0, 12);
  }

  var scoresCall = makeSide(deltaCall, growthCall, peaks, "قمة");
  var scoresPut = makeSide(deltaPut, growthPut, troughs, "قاع");

  var map = {};
  function merge(list, prefix) {
    (list || []).forEach(function (s) {
      var k = String(s.strike);
      if (!map[k]) map[k] = { strike: s.strike, score: 0, reasons: [], sideHint: {} };
      map[k].score += s.score;
      (s.reasons || []).forEach(function (r) {
        map[k].reasons.push(prefix + " " + r);
      });
      map[k].sideHint[prefix] = (map[k].sideHint[prefix] || 0) + s.score;
    });
  }
  merge(scoresCall, "Call");
  merge(scoresPut, "Put");
  var combined = Object.keys(map).map(function (k) {
    var o = map[k];
    var c = o.sideHint.Call || 0;
    var p = o.sideHint.Put || 0;
    o.side = c > p + 2 ? "Call" : p > c + 2 ? "Put" : "مشترك";
    return o;
  });
  combined.sort(function (a, b) { return b.score - a.score; });
  return {
    call: scoresCall,
    put: scoresPut,
    combined: combined.slice(0, 12),
  };
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

  var scoresPack = buildStrikeScores(
    deltaCall, deltaPut, growthCall, growthPut, troughs, peaks, data.close
  );
  var scoresCall = scoresPack.call || [];
  var scoresPut = scoresPack.put || [];
  var scores = scoresPack.combined || [];
  var top = scores[0] || null;
  var topCall = scoresCall[0] || null;
  var topPut = scoresPut[0] || null;
  var conf = confidenceOf(top);
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
    scoresCall: scoresCall,
    scoresPut: scoresPut,
    top: top,
    topCall: topCall,
    topPut: topPut,
    conf: conf,
    close: data.close,
    gDays: gDays,
    topN: topN,
    selectedExps: selectedExps.slice(),
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
  var top = rep.top;
  var topCall = rep.topCall;
  var topPut = rep.topPut;
  if (!top && !topCall && !topPut) {
    return {
      line1: "لا يظهر مستوى بارز ضمن التواريخ المختارة",
      line2: "",
      line3: "",
      side: "",
      strike: null,
      conf: "",
    };
  }

  var conf = (rep.conf && rep.conf.label) || "—";
  var lead = top || topCall || topPut;
  var strike = lead.strike;
  var callScore = topCall ? topCall.score : 0;
  var putScore = topPut ? topPut.score : 0;
  var side = "مشترك";
  if (callScore > putScore + 2) side = "Call";
  else if (putScore > callScore + 2) side = "Put";
  else if (top && top.side) side = top.side;

  // سطر 1: أبرز مستوى + السترايك فقط (بدون اسم الرمز وبدون ثقة)
  var line1 = "أبرز مستوى: " + strike;

  // سطر 2: كما هو
  var line2 = "";
  if (topCall && topPut) {
    line2 =
      "Call الأقوى: " +
      topCall.strike +
      " (" +
      topCall.score +
      ") · Put الأقوى: " +
      topPut.strike +
      " (" +
      topPut.score +
      ")";
  } else if (topCall) {
    line2 = "Call الأقوى: " + topCall.strike + " (" + topCall.score + ")";
  } else if (topPut) {
    line2 = "Put الأقوى: " + topPut.strike + " (" + topPut.score + ")";
  }

  // سطر 3: محذوف
  var line3 = "";

  return {
    line1: line1,
    line2: line2,
    line3: line3,
    side: side,
    strike: strike,
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
  rep.insightText = [insight.line1, insight.line2, insight.line3].filter(Boolean).join(" | ");

  var html = "";
  html += '<div class="rep-insight rep-insight-soft">';
  html += '<div class="rep-insight-title">الملخص</div>';
  html += '<div class="rep-insight-main">🎯 ' + insight.line1 + "</div>";
  if (insight.line2) html += '<div class="rep-insight-sub">⚖️ ' + insight.line2 + "</div>";
    html += '<div class="rep-insight-meta">';
  html += "G = " + rep.gDays + " يوم · أعلى " + rep.topN + " لكل جهة";
  if (rep.conf && rep.conf.label) {
    html +=
      ' · <span class="rep-badge ' +
      (rep.conf.level || "") +
      '">' +
      rep.conf.label +
      "</span>";
  }
  html += "</div></div>";

  function metricCard(title, rows) {
    var h = '<div class="rep-card">';
    h += '<div class="rep-card-title center">' + title + "</div>";
    h +=
      '<table class="rep-table" dir="ltr"><thead><tr>' +
      "<th>الترتيب</th><th>Strike</th><th>القيمة</th><th>اليوم</th>" +
      "</tr></thead><tbody>";
    if (!rows || !rows.length) {
      h += '<tr><td colspan="4" class="rep-empty">لا نتائج</td></tr>';
    } else {
      rows.forEach(function (x, i) {
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

  // يسار النمو · يمين التزايد (في LTR: النمو أولاً ثم التزايد)
  html += '<div class="rep-section-label">Call</div>';
  html += '<div class="rep-grid rep-grid-2">';
  html += metricCard("النمو · G", rep.growthCall);
  html += metricCard("التزايد · Δ", rep.deltaCall);
  html += "</div>";

  html += '<div class="rep-section-label">Put</div>';
  html += '<div class="rep-grid rep-grid-2">';
  html += metricCard("النمو · G", rep.growthPut);
  html += metricCard("التزايد · Δ", rep.deltaPut);
  html += "</div>";

  function levelCard(kind, rows, repeated) {
    var isPeak = kind === "peak";
    var title = isPeak ? "القمم" : "القيعان";
    var cls = isPeak ? "rep-card-peak" : "rep-card-trough";
    var repLabel = isPeak ? "قمم متكررة" : "قيعان متكررة";
    var h = '<div class="rep-card ' + cls + '">';
    h += '<div class="rep-card-title center">' + title + "</div>";
    h +=
      '<table class="rep-table" dir="ltr"><thead><tr>' +
      "<th>Strike</th><th>OI</th><th>الحركة</th><th>اليوم</th>" +
      "</tr></thead><tbody>";
    if (!rows || !rows.length) {
      h += '<tr><td colspan="4" class="rep-empty">—</td></tr>';
    } else {
      rows.forEach(function (x) {
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

  html += '<div class="rep-spacer"></div>';
  html += '<div class="rep-grid rep-grid-2">';
  html += levelCard("trough", rep.troughs, rep.repTrough);
  html += levelCard("peak", rep.peaks, rep.repPeak);
  html += "</div>";

  function scoreTable(list) {
    var h =
      '<table class="rep-table" dir="ltr"><thead><tr>' +
      "<th>#</th><th>Strike</th><th>النقاط</th><th>لماذا</th>" +
      "</tr></thead><tbody>";
    if (!list || !list.length) {
      h += '<tr><td colspan="4" class="rep-empty">—</td></tr>';
    } else {
      list.forEach(function (s, i) {
        var chips = (s.reasons || [])
          .map(function (r) {
            var cls = "chip-reason";
            if (String(r).indexOf("Δ") >= 0) cls += " chip-call";
            if (String(r).indexOf("G") >= 0) cls += " chip-put";
            if (String(r).indexOf("قمة") >= 0) cls += " chip-peak";
            if (String(r).indexOf("قاع") >= 0) cls += " chip-trough";
            return '<span class="' + cls + '">' + r + "</span>";
          })
          .join("");
        h +=
          "<tr class='" +
          (i === 0 ? "rep-top-row" : "") +
          "'><td>" +
          (i + 1) +
          "</td><td><b>" +
          s.strike +
          "</b></td><td><b>" +
          s.score +
          "</b></td><td class='rep-reasons'>" +
          chips +
          "</td></tr>";
      });
    }
    h += "</tbody></table>";
    return h;
  }

  html += '<div class="rep-spacer"></div>';
  html += '<div class="rep-grid rep-grid-2">';
  html += '<div class="rep-card rep-score-card">';
  html += '<div class="rep-card-title center">Score · Call</div>';
  html += scoreTable(rep.scoresCall);
  html += "</div>";
  html += '<div class="rep-card rep-score-card">';
  html += '<div class="rep-card-title center">Score · Put</div>';
  html += scoreTable(rep.scoresPut);
  html += "</div>";
  html += "</div>";

  html += '<div class="rep-spacer"></div>';
  html += '<div id="repLensBox" class="rep-lens-box"></div>';

  return html;
}

function analyzeStrikeLens(data, selectedExps, strike, daysLimit, strikesLimit, gDays) {
  var target = Number(strike);
  if (isNaN(target)) return { error: "أدخلي رقم سترايك صحيح" };
  var close = data.close;
  var lines = [];
  var found = 0;
  (selectedExps || []).forEach(function (exp) {
    var view = getViewForExp(data, exp, daysLimit, strikesLimit);
    if (!view) view = null;
    var row = null;
    if (view) {
      for (var i = 0; i < view.rows.length; i++) {
        if (Number(view.rows[i].strike) === target) {
          row = view.rows[i];
          break;
        }
      }
    }
    if (!row) {
      var block = data.by_expiration && data.by_expiration[exp];
      if (block && block.rows) {
        for (var j = 0; j < block.rows.length; j++) {
          if (Number(block.rows[j].strike) === target) {
            var fullDates = data.pull_dates || [];
            var pullDates = lastN(fullDates, daysLimit);
            var idx = pullDates.map(function (d) { return fullDates.indexOf(d); });
            row = {
              strike: target,
              calls: idx.map(function (ix) {
                return ix >= 0 ? block.rows[j].calls[ix] || 0 : 0;
              }),
              puts: idx.map(function (ix) {
                return ix >= 0 ? block.rows[j].puts[ix] || 0 : 0;
              }),
            };
            view = { pullDates: pullDates, rows: [row], close: close, expiration: exp };
            break;
          }
        }
      }
    }
    if (!row || !view) return;
    found++;
    var n = view.pullDates.length;
    var lastI = n - 1;
    var prevI = n - 2;
    var g = Math.max(1, parseInt(gDays, 10) || 3);
    lines.push({
      exp: exp,
      callLast: row.calls[lastI] || 0,
      putLast: row.puts[lastI] || 0,
      dCall: prevI >= 0 ? positiveDelta(row.calls[lastI], row.calls[prevI]) : null,
      dPut: prevI >= 0 ? positiveDelta(row.puts[lastI], row.puts[prevI]) : null,
      gCall: positiveGrowth(row.calls, g),
      gPut: positiveGrowth(row.puts, g),
    });
  });
  if (!found) return { error: "السترايك " + target + " غير موجود في التواريخ المحددة" };

  var maxPut = 0, maxCall = 0, maxPutExp = "", maxCallExp = "";
  lines.forEach(function (L) {
    if (L.putLast > maxPut) { maxPut = L.putLast; maxPutExp = L.exp; }
    if (L.callLast > maxCall) { maxCall = L.callLast; maxCallExp = L.exp; }
  });

  var bullets = [];
  bullets.push("عدد الانتهاءات: " + found);
  if (close != null) {
    var pos =
      target > close ? "فوق الإغلاق" : target < close ? "تحت الإغلاق" : "عند الإغلاق";
    bullets.push("الموقع: " + pos + " (إغلاق " + Number(close).toLocaleString() + ")");
  }
  if (maxCall > 0) {
    bullets.push(
      "أعلى Call OI: " + maxCall.toLocaleString() + " @ " + formatExpAr(maxCallExp)
    );
  }
  if (maxPut > 0) {
    bullets.push(
      "أعلى Put OI: " + maxPut.toLocaleString() + " @ " + formatExpAr(maxPutExp)
    );
  }
  if (maxCall >= maxPut && maxCall > 0) {
    bullets.push("الخلاصة: تركّز Call — غالبًا مقاومة يُختبر عند الاقتراب");
  } else if (maxPut > 0) {
    bullets.push("الخلاصة: تركّز Put — غالبًا دعم يُحترم عند اللمس");
  }

  return { strike: target, lines: lines, bullets: bullets, close: close };
}

function renderLensResult(res) {
  if (!res) return "";
  if (res.error) return '<div class="rep-lens-err">' + res.error + "</div>";
  var h = '<div class="rep-card rep-lens-card">';
  h += '<div class="rep-card-title center">🔍 ' + res.strike + "</div>";
  h += '<ul class="rep-lens-bullets">';
  (res.bullets || []).forEach(function (b) {
    h += "<li>" + b + "</li>";
  });
  h += "</ul>";
  h +=
    '<table class="rep-table" dir="ltr"><thead><tr>' +
    "<th>اليوم</th><th>Call OI</th><th>Put OI</th><th>Δ Call</th><th>Δ Put</th><th>G Call</th><th>G Put</th>" +
    "</tr></thead><tbody>";
  (res.lines || []).forEach(function (L) {
    h +=
      "<tr><td>" +
      formatExpAr(L.exp) +
      "</td><td>" +
      Number(L.callLast).toLocaleString() +
      "</td><td>" +
      Number(L.putLast).toLocaleString() +
      "</td><td>" +
      (L.dCall != null ? Number(L.dCall).toLocaleString() : "—") +
      "</td><td>" +
      (L.dPut != null ? Number(L.dPut).toLocaleString() : "—") +
      "</td><td>" +
      (L.gCall != null ? Number(L.gCall).toLocaleString() : "—") +
      "</td><td>" +
      (L.gPut != null ? Number(L.gPut).toLocaleString() : "—") +
      "</td></tr>";
  });
  h += "</tbody></table></div>";
  return h;
}

function paintCell(cell, argb, bold, align) {
  if (!cell) return;
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
  var wb = new ExcelJS.Workbook();
  var ws = wb.addWorksheet("Reports");
  for (var c = 1; c <= 13; c++) ws.getColumn(c).width = 12;

  try {
    ws.views = [{ state: "normal", rightToLeft: true, activeCell: "A1", showGridLines: false }];
  } catch (e) {}

  ws.getCell(2, 2).value = String(ticker) + " · Reports";
  ws.getCell(2, 2).font = { name: "Calibri", size: 16, bold: true };
  ws.getCell(2, 2).alignment = { horizontal: "center", vertical: "middle" };
  try {
    ws.mergeCells(2, 2, 2, 11);
  } catch (e) {}

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
  // ورقة RTL: العمود الأصغر يظهر يمينًا → التزايد يمين، النمو يسار
  var r1 = writeMetricBlock(row, 2, "التزايد · Call · Δ", rep.deltaCall, headD, fillD);
  var r2 = writeMetricBlock(row, 7, "النمو · Call · G", rep.growthCall, headG, fillG);
  row = Math.max(r1, r2) + 1;

  r1 = writeMetricBlock(row, 2, "التزايد · Put · Δ", rep.deltaPut, headD, fillD);
  r2 = writeMetricBlock(row, 7, "النمو · Put · G", rep.growthPut, headG, fillG);
  row = Math.max(r1, r2) + 1;

  r1 = writeLevels(row, 2, "القمم", rep.peaks, rep.repPeak, headPeak, fillPeak, "قمم متكررة");
  r2 = writeLevels(row, 7, "القيعان", rep.troughs, rep.repTrough, headTrough, fillTrough, "قيعان متكررة");
  row = Math.max(r1, r2) + 1;

  // Score + الملخص محذوفان من تصدير Excel حسب الطلب

  var buf = await wb.xlsx.writeBuffer();
  var blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  var fname = String(ticker) + "_Reports.xlsx";
  var downloaded = false;
  try {
    if (typeof saveAs === "function") {
      saveAs(blob, fname);
      downloaded = true;
    }
  } catch (eSave) {
    console.warn("saveAs failed", eSave);
  }
  if (!downloaded) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = fname;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      try { URL.revokeObjectURL(url); } catch (e) {}
      try { a.remove(); } catch (e) {}
    }, 2000);
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
  var exps = filterTickerExpirations(state.ticker, allExps);
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

  html += '<div class="exp-export-row rep-input-row rep-tools-row">';
  html += '<span class="rep-tool-label">N</span>';
  html +=
    '<input id="repTopInput" class="rep-input" type="number" min="1" max="50" value="5" title="أعلى نتائج" />';
  html += '<span class="rep-tools-gap"></span>';
  html += '<span class="rep-tool-label">G</span>';
  html +=
    '<input id="repGrowthInput" class="rep-input" type="number" min="1" max="30" value="' +
    (parseInt(state.growthDays, 10) || 3) +
    '" title="أيام النمو" />';
  html += '<span class="rep-tools-gap rep-tools-gap-lg"></span>';
  html +=
    '<button type="button" class="btn btn-lens" id="repLensBtn" title="بحث سترايك">🔍</button>';
  html +=
    '<input id="repLensInput" class="rep-input rep-lens-input" type="number" step="0.5" placeholder="سترايك" title="عدسة السترايك" />';
  html += "</div>";

  html += '<div class="rep-actions">';
  html += '<button type="button" class="btn btn-teal" id="repRunBtn">توليد التقرير</button>';
  html +=
    '<button type="button" class="btn btn-excel" id="repExcelBtn" disabled>تصدير Excel</button>';
  html += "</div></div>";
  html += '<div id="repResult" class="rep-result"></div>';
  body.innerHTML = html;
  modal.classList.remove("hidden"); modal.style.display = ""; modal.setAttribute("aria-hidden", "false");
  // إظهار أعلى نافذة التقارير عند الفتح
  try {
    body.scrollTop = 0;
    if (typeof body.scrollTo === "function") body.scrollTo(0, 0);
    modal.scrollTop = 0;
    if (typeof modal.scrollTo === "function") modal.scrollTo(0, 0);
    var panel = modal.querySelector(".map-panel, .reports-panel");
    if (panel) panel.scrollTop = 0;
  } catch (eOpenScroll) {}

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
          // العودة لأعلى التقرير (الملخص أولاً) بدل القفز لمنتصف النافذة
          try {
            body.scrollTop = 0;
            if (typeof body.scrollTo === "function") body.scrollTo(0, 0);
            modal.scrollTop = 0;
            resultHost.scrollTop = 0;
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
      setStatus("جاري تصدير Excel…", "");
      try {
        await exportReportsExcel(lastRep, state.ticker);
        setStatus("✅ تم تصدير Excel", "ok");
      } catch (err) {
        console.error(err);
        setStatus("فشل التصدير: " + (err && err.message ? err.message : err), "err");
        alert("فشل تصدير Excel: " + (err && err.message ? err.message : err));
      } finally {
        excelBtn.disabled = false;
      }
    };
  }

  var lensBtn = document.getElementById("repLensBtn");
  if (lensBtn) {
    lensBtn.onclick = function () {
      try {
        var selected = [];
        body.querySelectorAll("input[data-rexp]:checked").forEach(function (cb) {
          selected.push(cb.getAttribute("data-rexp"));
        });
        if (!selected.length) {
          setStatus("حددي تواريخًا أولًا للعدسة", "err");
          return;
        }
        var lensEl = document.getElementById("repLensInput");
        var strikeVal = lensEl && lensEl.value;
        if (!strikeVal) {
          setStatus("أدخلي رقم السترايك", "err");
          return;
        }
        var gEl = document.getElementById("repGrowthInput");
        var rgrowth = parseInt(gEl && gEl.value, 10) || 3;
        var res = analyzeStrikeLens(data, selected, strikeVal, rdays, rstrikes, rgrowth);
        // إن لم يُولَّد تقرير بعد، أنشئ حاوية نتيجة
        if (!document.getElementById("repResult") || !resultHost) {
          setStatus("افتح التقرير أولًا", "err");
          return;
        }
        if (!lastRep) {
          // اعرض العدسة وحدها
          resultHost.innerHTML = renderLensResult(res);
        } else {
          var box = document.getElementById("repLensBox");
          if (box) box.innerHTML = renderLensResult(res);
          else resultHost.innerHTML = renderReportsResult(lastRep, state.ticker) + renderLensResult(res);
        }
        setStatus(res.error ? res.error : "تم فحص السترايك " + strikeVal, res.error ? "err" : "ok");
        try {
          var target = document.getElementById("repLensBox") || resultHost;
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        } catch (e) {}
      } catch (err) {
        console.error(err);
        setStatus("خطأ العدسة: " + (err && err.message ? err.message : err), "err");
      }
    };
  }
}

function closeReports() {
  var modal = document.getElementById("reportsModal");
  if (modal) modal.classList.add("hidden");
}


