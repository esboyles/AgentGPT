/* linecast desktop: draws linecast's --json data as a dashboard.
 *
 * Every time linecast reports is the location's own wall-clock time
 * without a zone ("2026-10-10T17:42"). The page reads those as if they
 * were UTC and formats them back in UTC, so nothing shifts by the zone
 * of the computer showing the page.
 */
"use strict";

const $ = (sel, root = document) => root.querySelector(sel);
const params = new URLSearchParams(window.location.search);
const SVGNS = "http://www.w3.org/2000/svg";

const REFRESH = { weather: 600, sunshine: 60, moon: 300, tides: 600, sky: 120 };
const ART_REFRESH = { radar: 300, weather: 600, sunshine: 60, moon: 300, sky: 120, tides: 600, maps: 3600 };
const VIEW_APPS = { weather: ["weather"], sun: ["sunshine"], moon: ["moon"], tides: ["tides"], sky: ["sky"], art: [] };
const RENDER = {};

const state = {
  location: params.get("location") ?? load("location") ?? "",
  payloads: {},
  received: {},
  stale: {},
  timers: {},
  artApp: params.get("app") || load("art") || "radar",
  artTimer: null,
};

/* ---------- small helpers ---------- */

function load(key) {
  try { return window.localStorage.getItem("lcd:" + key); } catch { return null; }
}
function save(key, value) {
  try {
    if (value == null || value === "") window.localStorage.removeItem("lcd:" + key);
    else window.localStorage.setItem("lcd:" + key, value);
  } catch { /* storage may be blocked; the page works without it */ }
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

function svg(tag, attrs = {}, parent) {
  const node = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v != null) node.setAttribute(k, v);
  }
  if (parent) parent.append(node);
  return node;
}

function svgText(parent, x, y, text, attrs = {}) {
  const t = svg("text", { x, y, ...attrs }, parent);
  t.textContent = text;
  return t;
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function num(v, digits = 0) {
  if (v == null || Number.isNaN(Number(v))) return "–";
  return Number(v).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

function deg(v, unit) {
  if (v == null) return "–";
  return Math.round(v) + (unit && unit.startsWith("°") ? "°" : "");
}

/* ---------- time ---------- */

function parseLocal(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d\d)-(\d\d)(?:[T ](\d\d):(\d\d)(?::(\d\d))?)?/.exec(s);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
}

const fmt = {
  time: new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: "UTC" }),
  hour: new Intl.DateTimeFormat(undefined, { hour: "numeric", timeZone: "UTC" }),
  weekday: new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" }),
  date: new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" }),
  dayTime: new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "UTC" }),
  longDate: new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }),
};

function fmtTime(s) { const t = parseLocal(s); return t == null ? "–" : fmt.time.format(t); }

/** The location's current wall-clock time, carried forward from the
 *  moment linecast reported it. */
function localNow(app) {
  const p = state.payloads[app];
  if (!p) return null;
  const base = parseLocal(p.fetched_at || p.generated_at);
  if (base == null) return null;
  return base + (Date.now() - state.received[app]);
}

function anyLocalNow() {
  for (const app of ["sunshine", "moon", "sky", "weather", "tides"]) {
    const t = localNow(app);
    if (t != null) return t;
  }
  return null;
}

function duration(ms) {
  const mins = Math.round(Math.abs(ms) / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

/* ---------- tooltip ---------- */

const tip = $("#tooltip");

function showTip(x, y, title, rows) {
  tip.replaceChildren(el("div", { class: "tt-title", text: title }));
  for (const r of rows) {
    const row = el("div", { class: "tt-row" });
    if (r.color) {
      const key = el("span", { class: "tt-key" });
      key.style.background = r.color;
      row.append(key);
    }
    row.append(el("span", { text: r.label }), el("span", { text: r.value }));
    tip.append(row);
  }
  tip.hidden = false;
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  let left = x + 14;
  let top = y + 14;
  if (left + w > window.innerWidth - 8) left = x - w - 14;
  if (top + h > window.innerHeight - 8) top = y - h - 14;
  tip.style.left = Math.max(8, left) + "px";
  tip.style.top = Math.max(8, top) + "px";
}

function hideTip() { tip.hidden = true; }

/* ---------- data loading ---------- */

async function api(path, extra = {}) {
  const q = new URLSearchParams(extra);
  if (state.location) q.set("location", state.location);
  const qs = q.toString();
  const res = await fetch(path + (qs ? "?" + qs : ""), { cache: "no-store" });
  let body = null;
  try { body = await res.json(); } catch { /* fall through to the status */ }
  if (!res.ok) throw new Error((body && body.error) || `The server answered ${res.status}`);
  return { data: body, stale: res.headers.get("X-Linecast-Stale") === "1" };
}

const CARD_FOR = { weather: "weather", sunshine: "sun", moon: "moon", tides: "tides", sky: "sky" };

function body(card) { return $(`#card-${card} .body`); }

function showError(card, err) {
  const b = body(card);
  b.replaceChildren(el("p", { class: "status error", text: messageFor(err) }));
}

function messageFor(err) {
  const text = String((err && err.message) || err || "Something went wrong");
  if (/Failed to fetch|NetworkError|Load failed/i.test(text)) {
    return "Can't reach the linecast desktop server. Is it still running?";
  }
  return text;
}

function setStale(card, stale) {
  const node = $(`#card-${card}`);
  let tag = node.querySelector(".stale-tag");
  if (stale && !tag) {
    tag = el("span", { class: "stale-tag", text: "last good data", title: "The latest refresh failed; this is the previous result." });
    node.append(tag);
  } else if (!stale && tag) {
    tag.remove();
  }
}

async function refresh(app) {
  const card = CARD_FOR[app];
  clearTimeout(state.timers[app]);
  try {
    const { data, stale } = await api("/api/" + app);
    state.payloads[app] = data;
    state.received[app] = Date.now();
    state.stale[app] = stale;
    draw(app);
    updateHeader();
  } catch (err) {
    if (!state.payloads[app]) showError(card, err);
    else setStale(card, true);
  }
  state.timers[app] = setTimeout(() => refresh(app), REFRESH[app] * 1000);
}

function draw(app) {
  const p = state.payloads[app];
  if (!p) return;
  const card = CARD_FOR[app];
  try {
    RENDER[app](p, body(card));
    setStale(card, !!state.stale[app]);
  } catch (err) {
    console.error(err);
    showError(card, new Error("Couldn't draw this card: " + err.message));
  }
}

/* ---------- header ---------- */

function updateHeader() {
  const p = state.payloads.sunshine || state.payloads.moon || state.payloads.weather ||
            state.payloads.tides || state.payloads.sky;
  if (p) {
    const loc = typeof p.location === "object" && p.location ? p.location.name : p.location;
    $("#place-name").textContent = loc || "Your location";
    document.title = (loc ? loc + " · " : "") + "linecast desktop";
  }
  const now = anyLocalNow();
  $("#place-clock").textContent = now == null ? "" : fmt.dayTime.format(now);
}

/* ---------- weather ---------- */

RENDER.weather = (p, root) => {
  root.replaceChildren();
  const cur = p.current || {};
  const today = p.today || {};
  const units = p.units || {};
  const tU = units.temperature || "";

  const hero = el("div", { class: "hero" },
    el("div", { class: "hero-icon", "aria-hidden": "true", text: cur.icon || "" }),
    el("div", { class: "hero-value tabular", text: deg(cur.temperature, tU) + (tU ? tU.replace("°", "") : "") }),
    el("div", { class: "hero-sub" },
      el("span", { class: "condition", text: cur.condition || "" }),
      el("span", { class: "muted", text: `Feels like ${deg(cur.feels_like, tU)} · High ${deg(today.high, tU)} · Low ${deg(today.low, tU)}` }),
    ),
  );
  root.append(hero);

  const facts = el("div", { class: "facts" });
  const fact = (label, value) => facts.append(el("span", {}, label + " ", el("b", { text: value })));
  if (cur.wind_speed != null) {
    let wind = `${num(cur.wind_speed)} ${units.wind || ""}`;
    if (cur.wind_gusts != null && cur.wind_gusts > cur.wind_speed) wind += `, gusts ${num(cur.wind_gusts)}`;
    fact("Wind", wind);
  }
  if (cur.humidity != null) fact("Humidity", num(cur.humidity) + "%");
  if (today.precipitation_probability != null) fact("Chance of rain today", num(today.precipitation_probability) + "%");
  if (p.aqi && p.aqi.us_aqi != null) fact("Air quality (US AQI)", num(p.aqi.us_aqi));
  else if (p.aqi && p.aqi.european_aqi != null) fact("Air quality (EAQI)", num(p.aqi.european_aqi));
  if (facts.childElementCount) root.append(facts);

  for (const a of p.alerts || []) root.append(alertBox(a));

  const text = p.narrative || p.summary;
  if (text) root.append(el("p", { class: "narrative", text }));

  const hours = (p.hourly || []).slice(0, 25).filter((h) => h.temperature != null);
  if (hours.length > 1) {
    root.append(el("div", { class: "chart-title", text: `Next ${hours.length - 1} hours` }));
    const holder = el("div");
    root.append(holder);
    hourlyChart(holder, hours, tU, units);
  }

  if ((p.daily || []).length) root.append(dailyList(p.daily, tU, p.fetched_at));
  if (p.stale) root.append(el("p", { class: "muted small", text: "This forecast is from an earlier day; the latest fetch failed." }));
};

function alertBox(a) {
  const sev = String(a.severity || "").toLowerCase();
  const cls = sev === "extreme" || sev === "severe" ? "severe" : sev === "moderate" ? "moderate" : "";
  const box = el("div", { class: "alert " + cls, role: "note" },
    el("span", { class: "alert-icon", "aria-hidden": "true", text: "⚠" }));
  const inner = el("div", { class: "alert-body" },
    el("div", { class: "alert-title", text: [a.event || "Weather alert", a.severity].filter(Boolean).join(" · ") }));
  const when = [a.effective && "from " + fmtTime(a.effective), a.expires && "until " + fmtTime(a.expires)].filter(Boolean).join(" ");
  if (a.headline && a.headline !== a.event) inner.append(el("div", { text: a.headline }));
  if (when) inner.append(el("div", { class: "muted small", text: when }));
  if (a.description) {
    inner.append(el("details", {}, el("summary", { text: "Details" }), el("p", { text: a.description })));
  }
  box.append(inner);
  return box;
}

function niceTicks(lo, hi, count = 4) {
  const span = hi - lo || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(+v.toFixed(6));
  return ticks;
}

function roundedTopBar(x, y, w, h, r = 4) {
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function hourlyChart(holder, hours, tU, units) {
  const W = Math.max(280, holder.clientWidth || 600);
  const L = 36, R = 14, T = 18;
  const tempH = 130, gap = 34, popH = 46, axisH = 20;
  const H = T + tempH + gap + popH + axisH;
  const n = hours.length;
  const step = (W - L - R) / (n - 1);
  const x = (i) => L + i * step;

  const temps = hours.map((h) => h.temperature);
  let lo = Math.min(...temps), hi = Math.max(...temps);
  if (hi - lo < 4) { lo -= 2; hi += 2; }
  const ticks = niceTicks(lo, hi, 3);
  const yLo = Math.min(lo, ticks[0]), yHi = Math.max(hi, ticks[ticks.length - 1]);
  const yT = (v) => T + tempH - ((v - yLo) / (yHi - yLo || 1)) * tempH;
  const popTop = T + tempH + gap;
  const yP = (v) => popTop + popH - (v / 100) * popH;

  const root = svg("svg", { class: "chart", width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img",
    "aria-label": `Temperature and chance of precipitation for the next ${n - 1} hours` });

  for (const t of ticks) {
    svg("line", { class: "grid-line", x1: L, x2: W - R, y1: yT(t), y2: yT(t) }, root);
    svgText(root, L - 6, yT(t) + 4, Math.round(t) + "°", { "text-anchor": "end" });
  }

  const pts = hours.map((h, i) => [x(i), yT(h.temperature)]);
  const line = pts.map((pt, i) => (i ? "L" : "M") + pt[0].toFixed(1) + "," + pt[1].toFixed(1)).join("");
  svg("path", { class: "area-temp", d: `${line}L${x(n - 1)},${T + tempH}L${x(0)},${T + tempH}Z` }, root);
  svg("path", { class: "line-temp", d: line }, root);

  // Label only the warmest and coolest hours.
  const iHi = temps.indexOf(Math.max(...temps));
  const iLo = temps.indexOf(Math.min(...temps));
  for (const [i, above] of [[iHi, true], [iLo, false]]) {
    svg("circle", { class: "dot", cx: pts[i][0], cy: pts[i][1], r: 4, fill: cssVar("--temp") }, root);
    const anchor = i < 2 ? "start" : i > n - 3 ? "end" : "middle";
    svgText(root, pts[i][0], pts[i][1] + (above ? -9 : 17), deg(temps[i], tU),
      { class: "label-strong", "text-anchor": anchor });
  }

  // Precipitation chance: its own panel and scale, below the temperature.
  svgText(root, L, popTop - 10, "Chance of precipitation", {});
  svg("line", { class: "grid-line", x1: L, x2: W - R, y1: yP(100), y2: yP(100) }, root);
  svgText(root, L - 6, yP(100) + 4, "100%", { "text-anchor": "end" });
  svg("line", { class: "axis-line", x1: L, x2: W - R, y1: yP(0), y2: yP(0) }, root);
  svgText(root, L - 6, yP(0) + 4, "0", { "text-anchor": "end" });
  const barW = Math.max(2, Math.min(24, step - 2));
  hours.forEach((h, i) => {
    const v = h.precipitation_probability;
    if (!v) return;
    const top = yP(v);
    svg("path", { class: "bar-precip", d: roundedTopBar(x(i) - barW / 2, top, barW, yP(0) - top) }, root);
  });

  // Hour labels every three hours, or wider on a narrow chart.
  const every = step < 14 ? 6 : 3;
  hours.forEach((h, i) => {
    if (i % every) return;
    const t = parseLocal(h.time);
    if (t != null) svgText(root, x(i), H - 4, fmt.hour.format(t), { "text-anchor": i === 0 ? "start" : "middle" });
  });

  // Crosshair across both panels, one readout for every value.
  const cross = svg("line", { class: "crosshair", y1: T, y2: yP(0), visibility: "hidden" }, root);
  const hoverDot = svg("circle", { class: "dot", r: 4.5, fill: cssVar("--temp"), visibility: "hidden" }, root);
  const hit = svg("rect", { x: L - step / 2, y: 0, width: W - L - R + step, height: H, fill: "transparent" }, root);
  const move = (ev) => {
    const box = root.getBoundingClientRect();
    const px = (ev.clientX - box.left) * (W / box.width);
    const i = Math.max(0, Math.min(n - 1, Math.round((px - L) / step)));
    const h = hours[i];
    cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i));
    cross.setAttribute("visibility", "visible");
    hoverDot.setAttribute("cx", pts[i][0]); hoverDot.setAttribute("cy", pts[i][1]);
    hoverDot.setAttribute("visibility", "visible");
    const t = parseLocal(h.time);
    const rows = [
      { label: "Temperature", value: deg(h.temperature, tU), color: cssVar("--temp") },
      { label: "Feels like", value: deg(h.feels_like, tU) },
      { label: "Chance of precipitation", value: num(h.precipitation_probability) + "%", color: cssVar("--water") },
    ];
    if (h.wind_speed != null) rows.push({ label: "Wind", value: `${num(h.wind_speed)} ${units.wind || ""}` });
    showTip(ev.clientX, ev.clientY, `${t == null ? "" : fmt.dayTime.format(t)} · ${h.condition || ""}`, rows);
  };
  const leave = () => {
    cross.setAttribute("visibility", "hidden");
    hoverDot.setAttribute("visibility", "hidden");
    hideTip();
  };
  hit.addEventListener("pointermove", move);
  hit.addEventListener("pointerdown", move);
  hit.addEventListener("pointerleave", leave);
  holder.replaceChildren(root);
}

function dailyList(days, tU, fetchedAt) {
  const wrap = el("div", { class: "days" });
  const lows = days.map((d) => d.low).filter((v) => v != null);
  const highs = days.map((d) => d.high).filter((v) => v != null);
  const lo = Math.min(...lows), hi = Math.max(...highs);
  const today = (fetchedAt || "").slice(0, 10);
  for (const d of days) {
    const t = parseLocal(d.date);
    const name = d.date === today ? "Today" : t == null ? d.date : fmt.weekday.format(t);
    const range = el("div", { class: "d-range", "aria-hidden": "true" }, el("div", { class: "d-track" }));
    if (d.low != null && d.high != null && hi > lo) {
      const a = ((d.low - lo) / (hi - lo)) * 100;
      const b = ((d.high - lo) / (hi - lo)) * 100;
      const bar = el("div", { class: "d-bar" });
      bar.style.left = a + "%";
      bar.style.width = `max(8px, ${b - a}%)`;
      range.append(bar);
    }
    const row = [
      el("span", { class: "d-name", text: name }),
      el("span", { class: "d-icon", "aria-hidden": "true", text: d.icon || "" }),
      el("span", { class: "muted tabular", text: deg(d.low, tU) }),
      range,
      el("span", { class: "tabular", text: deg(d.high, tU) }),
      el("span", { class: "d-pop tabular", text: d.precipitation_probability ? `💧${num(d.precipitation_probability)}%` : "" }),
    ];
    const label = `${name}: ${d.condition || ""}, low ${deg(d.low, tU)}, high ${deg(d.high, tU)}` +
      (d.precipitation_probability ? `, ${d.precipitation_probability}% chance of precipitation` : "");
    row[0].setAttribute("title", label);
    wrap.append(...row);
  }
  return wrap;
}

/* ---------- sun ---------- */

RENDER.sunshine = (p, root) => {
  root.replaceChildren();
  const now = localNow("sunshine");
  if (p.polar) {
    root.append(el("p", { class: "phase-name", text: p.polar === "day" ? "Midnight sun" : "Polar night" }),
      el("p", { class: "muted", text: p.polar === "day" ? "The sun stays above the horizon all day." : "The sun stays below the horizon all day." }));
  } else {
    const holder = el("div");
    root.append(holder);
    sunChart(holder, p, now);
  }

  const kv = el("dl", { class: "kv" });
  const row = (k, v) => kv.append(el("dt", { text: k }), el("dd", { class: "tabular", text: v }));
  if (p.sunrise) row("Sunrise", fmtTime(p.sunrise));
  if (p.sunset) row("Sunset", fmtTime(p.sunset));
  if (p.solar_noon) row("Solar noon", fmtTime(p.solar_noon));
  if (p.day_length_seconds != null) {
    let v = duration(p.day_length_seconds * 1000);
    if (p.day_length_delta_seconds) {
      const d = p.day_length_delta_seconds;
      const mm = Math.floor(Math.abs(d) / 60), ss = Math.abs(d) % 60;
      v += ` (${d < 0 ? "−" : "+"}${mm ? mm + "m " : ""}${ss}s vs yesterday)`;
    }
    row("Daylight", v);
  }
  if (p.elevation_deg != null) row("Sun's height now", `${num(p.elevation_deg, 1)}°`);
  if (p.next_event && now != null) {
    const t = parseLocal(p.next_event.time);
    if (t != null && t > now) {
      const word = { sunrise: "Sunrise", sunset: "Sunset" }[p.next_event.kind] || p.next_event.kind;
      row("Next", `${word} in ${duration(t - now)}`);
    }
  }
  root.append(kv);
};

function sunChart(holder, p, now) {
  const W = Math.max(240, holder.clientWidth || 320);
  const H = 150, L = 8, R = 8, horizon = 104;
  const rise = parseLocal(p.sunrise), set = parseLocal(p.sunset);
  if (rise == null || set == null) return;
  const dayStart = Date.UTC(new Date(rise).getUTCFullYear(), new Date(rise).getUTCMonth(), new Date(rise).getUTCDate());
  const DAY = 86400000;
  const noon = (rise + set) / 2;
  const base = Math.cos((2 * Math.PI * (rise - noon)) / DAY);
  const shape = (t) => Math.cos((2 * Math.PI * (t - noon)) / DAY) - base;
  const peak = shape(noon) || 1;
  const amp = horizon - 22;
  const x = (t) => L + ((t - dayStart) / DAY) * (W - L - R);
  const y = (t) => horizon - (shape(t) / peak) * amp;

  const root = svg("svg", { class: "chart", width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img",
    "aria-label": `Sun path today: sunrise ${fmtTime(p.sunrise)}, sunset ${fmtTime(p.sunset)}` });

  // Daylight wash under the arc
  const steps = 96;
  let day = "", night = "";
  for (let k = 0; k <= steps; k++) {
    const t = dayStart + (k / steps) * DAY;
    const seg = `${k ? "L" : "M"}${x(t).toFixed(1)},${Math.min(H - 6, y(t)).toFixed(1)}`;
    night += seg;
  }
  for (let k = 0; k <= 60; k++) {
    const t = rise + (k / 60) * (set - rise);
    day += `${k ? "L" : "M"}${x(t).toFixed(1)},${y(t).toFixed(1)}`;
  }
  svg("path", { d: `${day}L${x(set)},${horizon}L${x(rise)},${horizon}Z`, fill: cssVar("--sun"), opacity: 0.12 }, root);
  svg("path", { d: night, fill: "none", stroke: cssVar("--ink-3"), "stroke-width": 1, "stroke-dasharray": "2 4" }, root);
  svg("path", { d: day, fill: "none", stroke: cssVar("--sun"), "stroke-width": 2, "stroke-linecap": "round" }, root);
  svg("line", { class: "axis-line", x1: L, x2: W - R, y1: horizon, y2: horizon }, root);

  const label = (t, text, anchor) => svgText(root, x(t), horizon + 18, text, { "text-anchor": anchor });
  label(rise, "↑ " + fmtTime(p.sunrise), "middle");
  label(set, "↓ " + fmtTime(p.sunset), "middle");
  svgText(root, x(noon), y(noon) - 8, fmtTime(p.solar_noon || ""), { "text-anchor": "middle" });

  if (now != null && now >= dayStart && now <= dayStart + DAY) {
    const up = now > rise && now < set;
    svg("circle", { class: "dot", cx: x(now), cy: Math.min(H - 8, y(now)), r: 7,
      fill: up ? cssVar("--sun") : cssVar("--ink-3") }, root);
  }
  holder.replaceChildren(root);
}

/* ---------- moon ---------- */

RENDER.moon = (p, root) => {
  root.replaceChildren();
  const wrap = el("div", { class: "moon-wrap" });
  wrap.append(moonDisc(p.illumination, p.waxing, p.southern, 66));
  const side = el("div");
  side.append(el("div", { class: "phase-name", text: p.phase || "" }));
  const kv = el("dl", { class: "kv" });
  const row = (k, v) => kv.append(el("dt", { text: k }), el("dd", { class: "tabular", text: v }));
  if (p.illumination != null) row("Lit", `${num(p.illumination, 1)}%`);
  if (p.age_days != null) row("Age", `${num(p.age_days, 1)} days`);
  for (const e of (p.events || []).slice(0, 2)) {
    row(e.kind === "rise" ? "Moonrise" : "Moonset", fmtDayTime(e.time));
  }
  if (p.up_now != null) row("Up now", p.up_now ? `Yes, ${num(p.altitude_deg)}° high` : "No");
  side.append(kv);
  wrap.append(side);
  root.append(wrap);

  const kv2 = el("dl", { class: "kv" });
  const row2 = (k, v) => kv2.append(el("dt", { text: k }), el("dd", { class: "tabular", text: v }));
  if (p.next_full) row2("Next full moon", fmtDate(p.next_full) + (p.next_full_name ? ` · ${p.next_full_name} Moon` : ""));
  if (p.next_new) row2("Next new moon", fmtDate(p.next_new));
  if (p.calendar && typeof p.calendar === "object") {
    const c = p.calendar;
    const text = c.label || c.name || c.date || "";
    if (text) row2("Calendar", String(text));
  }
  root.append(kv2);
};

function fmtDayTime(s) { const t = parseLocal(s); return t == null ? "–" : fmt.dayTime.format(t); }
function fmtDate(s) { const t = parseLocal(s); return t == null ? s : fmt.longDate.format(t); }

/** The Moon's face as seen: a dark disc with the lit part on the side
 *  the Sun is on (right while waxing in the north, flipped in the south). */
function moonDisc(illumPct, waxing, southern, r) {
  const size = r * 2;
  const c = r;
  const k = Math.max(0, Math.min(1, (illumPct ?? 0) / 100));
  const root = svg("svg", { viewBox: `0 0 ${size} ${size}`, role: "img",
    "aria-label": `${num(illumPct, 0)}% lit, ${waxing ? "waxing" : "waning"}` });
  svg("circle", { cx: c, cy: c, r: r - 1, fill: cssVar("--moon-dark"), stroke: cssVar("--border"), "stroke-width": 1 }, root);
  if (k > 0.002) {
    const rr = r - 1;
    const litRight = !!waxing !== !!southern;
    const tx = Math.abs(1 - 2 * k) * rr; // terminator half-width
    const top = `${c},${c - rr}`, bottom = `${c},${c + rr}`;
    let d;
    if (litRight) {
      // right limb, top to bottom; terminator back up, bulging right for a crescent
      d = `M${top}A${rr},${rr} 0 0 1 ${bottom}A${tx},${rr} 0 0 ${k < 0.5 ? 0 : 1} ${top}Z`;
    } else {
      d = `M${top}A${rr},${rr} 0 0 0 ${bottom}A${tx},${rr} 0 0 ${k < 0.5 ? 1 : 0} ${top}Z`;
    }
    svg("path", { d, fill: cssVar("--moon-lit") }, root);
  }
  return root;
}

/* ---------- tides ---------- */

RENDER.tides = (p, root) => {
  root.replaceChildren();
  if (!p.station || !(p.series || []).length) {
    root.append(el("p", { class: "status", text: "No tide station near this location. Try a coastal place." }));
    return;
  }
  const unit = (p.units || {}).height || "";
  const head = el("div", { class: "facts" });
  head.append(el("span", {}, "Station ", el("b", { text: p.station })));
  if (p.now_height != null) head.append(el("span", {}, "Water now ", el("b", { text: `${num(p.now_height, 2)} ${unit}` })));
  root.append(head);

  const holder = el("div");
  root.append(holder);
  tideChart(holder, p, unit);

  const list = el("div", { class: "tide-events" });
  for (const e of (p.events || []).slice(0, 4)) {
    list.append(el("div", { class: "tide-event" },
      el("div", { class: "k", text: (e.kind === "high" ? "High tide" : "Low tide") }),
      el("div", { class: "v tabular", text: `${fmtDayTime(e.time)} · ${num(e.height, 2)} ${unit}` })));
  }
  root.append(list);
  if (p.source) root.append(el("p", { class: "muted small", text: `Predictions: ${p.source}` }));
};

function tideChart(holder, p, unit) {
  const W = Math.max(280, holder.clientWidth || 600);
  const L = 40, R = 14, T = 22, plotH = 150, axisH = 20, floor = 20;
  const H = T + plotH + axisH;
  const pts = p.series.map((s) => ({ t: parseLocal(s.time), h: s.height })).filter((s) => s.t != null);
  if (pts.length < 2) return;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const heights = pts.map((s) => s.h);
  const lo = Math.min(...heights), hi = Math.max(...heights);
  const ticks = niceTicks(lo, hi, 3);
  const yLo = Math.min(lo, ticks[0]), yHi = Math.max(hi, ticks[ticks.length - 1]);
  const x = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
  // The lowest water sits a label's height above the axis, so a low
  // tide's time never lands on the hour labels.
  const y = (h) => T + plotH - floor - ((h - yLo) / (yHi - yLo || 1)) * (plotH - floor);

  const root = svg("svg", { class: "chart", width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img",
    "aria-label": `Tide height at ${p.station} from ${fmt.dayTime.format(t0)} to ${fmt.dayTime.format(t1)}` });
  for (const v of ticks) {
    svg("line", { class: "grid-line", x1: L, x2: W - R, y1: y(v), y2: y(v) }, root);
    svgText(root, L - 6, y(v) + 4, `${num(v, 1)}`, { "text-anchor": "end" });
  }
  svgText(root, L - 6, T - 8, unit, { "text-anchor": "end" });

  const line = pts.map((s, i) => `${i ? "L" : "M"}${x(s.t).toFixed(1)},${y(s.h).toFixed(1)}`).join("");
  svg("path", { class: "area-water", d: `${line}L${x(t1)},${T + plotH}L${x(t0)},${T + plotH}Z` }, root);
  svg("path", { class: "line-water", d: line }, root);

  // Hours along the bottom: every three, or six on a narrow chart
  const HOUR = 3600000;
  const every = (x(t0 + 3 * HOUR) - x(t0)) < 48 ? 6 : 3;
  const first = Math.ceil(t0 / (every * HOUR)) * every * HOUR;
  for (let t = first; t <= t1; t += every * HOUR) {
    svgText(root, x(t), H - 4, fmt.hour.format(t), { "text-anchor": "middle" });
  }

  const now = localNow("tides");
  if (now != null && now >= t0 && now <= t1) {
    svg("line", { class: "now-line", x1: x(now), x2: x(now), y1: T - 4, y2: T + plotH }, root);
    // A high tide's time sits above the chart too; drop "now" to the
    // bottom of the plot when the two would touch.
    const crowded = (p.events || []).some((e) => {
      const t = parseLocal(e.time);
      return e.kind === "high" && t != null && t >= t0 && t <= t1 && Math.abs(x(t) - x(now)) < 44;
    });
    svgText(root, x(now) + (crowded ? 4 : 0), crowded ? T + plotH - 4 : T - 8, "now",
      { "text-anchor": crowded ? "start" : "middle", class: "label-strong" });
  }

  for (const e of p.events || []) {
    const t = parseLocal(e.time);
    if (t == null || t < t0 || t > t1) continue;
    const cy = y(e.height);
    svg("circle", { class: "dot", cx: x(t), cy, r: 4, fill: cssVar("--water") }, root);
    const above = e.kind === "high";
    svgText(root, x(t), cy + (above ? -9 : 17), fmtTime(e.time), {
      "text-anchor": x(t) < L + 30 ? "start" : x(t) > W - R - 30 ? "end" : "middle" });
  }

  const cross = svg("line", { class: "crosshair", y1: T, y2: T + plotH, visibility: "hidden" }, root);
  const dot = svg("circle", { class: "dot", r: 4.5, fill: cssVar("--water"), visibility: "hidden" }, root);
  const hit = svg("rect", { x: L, y: 0, width: W - L - R, height: H, fill: "transparent" }, root);
  const move = (ev) => {
    const box = root.getBoundingClientRect();
    const px = (ev.clientX - box.left) * (W / box.width);
    let best = 0;
    for (let i = 1; i < pts.length; i++) {
      if (Math.abs(x(pts[i].t) - px) < Math.abs(x(pts[best].t) - px)) best = i;
    }
    const s = pts[best];
    cross.setAttribute("x1", x(s.t)); cross.setAttribute("x2", x(s.t));
    cross.setAttribute("visibility", "visible");
    dot.setAttribute("cx", x(s.t)); dot.setAttribute("cy", y(s.h));
    dot.setAttribute("visibility", "visible");
    showTip(ev.clientX, ev.clientY, fmt.dayTime.format(s.t),
      [{ label: "Tide height", value: `${num(s.h, 2)} ${unit}`, color: cssVar("--water") }]);
  };
  hit.addEventListener("pointermove", move);
  hit.addEventListener("pointerdown", move);
  hit.addEventListener("pointerleave", () => {
    cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); hideTip();
  });
  holder.replaceChildren(root);
}

/* ---------- sky ---------- */

const PLANET = { mercury: "Mercury", venus: "Venus", mars: "Mars", jupiter: "Jupiter",
  saturn: "Saturn", uranus: "Uranus", neptune: "Neptune" };
const SKY_WORD = { daylight: "Daylight", civil: "Civil twilight", nautical: "Nautical twilight",
  astronomical: "Astronomical twilight", night: "Night" };

RENDER.sky = (p, root) => {
  root.replaceChildren();
  const holder = el("div");
  root.append(holder);
  skyChart(holder, p);

  const up = (p.planets || []).filter((pl) => pl.up);
  const list = el("ul", { class: "sky-list" });
  const add = (name, o) => list.append(el("li", {}, el("span", { text: name }),
    el("span", { class: "where tabular", text: `${o.compass || ""} ${num(o.altitude)}°` })));
  if (p.sun && p.sun.up) add("Sun", p.sun);
  if (p.moon && p.moon.up) add("Moon", p.moon);
  for (const pl of up) add(PLANET[pl.name] || pl.name, pl);
  if (list.childElementCount) root.append(list);
  else root.append(el("p", { class: "muted", text: "No planets above the horizon right now." }));
  const sky = p.sun && p.sun.sky;
  if (sky) root.append(el("p", { class: "muted small", text: `${SKY_WORD[sky] || sky}. Looking up: north at the top, east on the left.` }));
};

function skyChart(holder, p) {
  const size = Math.max(200, Math.min(holder.clientWidth || 300, 360));
  const c = size / 2, R = c - 18;
  const root = svg("svg", { class: "chart", width: size, height: size, viewBox: `0 0 ${size} ${size}`,
    role: "img", "aria-label": "Map of the sky overhead with the Sun, Moon, planets and bright stars" });
  root.style.margin = "0 auto";
  const night = p.sun && p.sun.sky && p.sun.sky !== "daylight";
  svg("circle", { cx: c, cy: c, r: R, fill: night ? cssVar("--night") : cssVar("--surface-2"),
    stroke: cssVar("--border") }, root);
  for (const alt of [30, 60]) {
    svg("circle", { cx: c, cy: c, r: (R * (90 - alt)) / 90, fill: "none", class: "grid-line" }, root);
  }
  const pos = (alt, az) => {
    const r = (R * (90 - alt)) / 90;
    const a = (az * Math.PI) / 180;
    return [c - r * Math.sin(a), c - r * Math.cos(a)];
  };
  for (const [label, az] of [["N", 0], ["E", 90], ["S", 180], ["W", 270]]) {
    const [lx, ly] = pos(-11, az);
    svgText(root, lx, ly + 4, label, { "text-anchor": "middle", class: "label-strong" });
  }
  const marks = [];
  for (const s of p.bright_stars || []) {
    if (s.up) marks.push({ o: s, name: s.name, r: 2.5, fill: night ? "#e9edf5" : cssVar("--ink-3"), label: false,
      detail: [s.designation, `magnitude ${num(s.magnitude, 1)}`] });
  }
  for (const pl of p.planets || []) {
    if (pl.up) marks.push({ o: pl, name: PLANET[pl.name] || pl.name, r: 4.5, fill: cssVar("--accent"), label: true,
      detail: [`magnitude ${num(pl.magnitude, 1)}`, pl.visible ? "visible to the eye" : "lost in daylight or too low"] });
  }
  if (p.moon && p.moon.up) marks.push({ o: p.moon, name: "Moon", r: 7, fill: cssVar("--moon-lit"), label: true,
    detail: [`${num(p.moon.illumination, 1)}% lit`] });
  if (p.sun && p.sun.up) marks.push({ o: p.sun, name: "Sun", r: 8, fill: cssVar("--sun"), label: true, detail: [] });

  const placed = [];
  const fits = (b) => b.x >= 0 && b.x + b.w <= size && b.y >= 0 && b.y + b.h <= size &&
    !placed.some((o) => b.x < o.x + o.w && o.x < b.x + b.w && b.y < o.y + o.h && o.y < b.y + b.h);
  for (const m of marks) {
    const [mx, my] = pos(m.o.altitude, m.o.azimuth);
    placed.push({ x: mx - m.r, y: my - m.r, w: m.r * 2, h: m.r * 2 });
  }
  // Label the brightest first: Sun, Moon, then planets.
  const order = [...marks].reverse();
  const labelAt = new Map();
  for (const m of order) {
    if (!m.label) continue;
    const [mx, my] = pos(m.o.altitude, m.o.azimuth);
    const w = m.name.length * 6.4 + 2, h = 13, gap = m.r + 4;
    const spots = [
      { x: mx + gap, y: my - h / 2, anchor: "start", tx: mx + gap, ty: my + 4 },
      { x: mx - gap - w, y: my - h / 2, anchor: "end", tx: mx - gap, ty: my + 4 },
      { x: mx - w / 2, y: my - gap - h, anchor: "middle", tx: mx, ty: my - gap - 2 },
      { x: mx - w / 2, y: my + gap, anchor: "middle", tx: mx, ty: my + gap + 10 },
    ];
    const spot = spots.find((sp) => fits({ x: sp.x, y: sp.y, w, h }));
    if (spot) {
      placed.push({ x: spot.x, y: spot.y, w, h });
      labelAt.set(m, spot);
    }
  }

  for (const m of marks) {
    const [mx, my] = pos(m.o.altitude, m.o.azimuth);
    const g = svg("g", { tabindex: m.label ? 0 : null }, root);
    svg("circle", { cx: mx, cy: my, r: m.r + 6, fill: "transparent" }, g); // larger hit target
    svg("circle", { class: "dot", cx: mx, cy: my, r: m.r, fill: m.fill,
      stroke: night ? cssVar("--night") : cssVar("--surface-2") }, g);
    const spot = labelAt.get(m);
    if (spot) {
      svgText(g, spot.tx, spot.ty, m.name, { "text-anchor": spot.anchor, fill: night ? "#e9edf5" : cssVar("--ink") });
    }
    const show = (ev) => {
      const box = g.getBoundingClientRect();
      const px = ev && ev.clientX != null ? ev.clientX : box.right;
      const py = ev && ev.clientY != null ? ev.clientY : box.bottom;
      showTip(px, py, m.name, [
        { label: "Height", value: `${num(m.o.altitude, 1)}°` },
        { label: "Direction", value: `${m.o.compass || ""} (${num(m.o.azimuth)}°)` },
        ...m.detail.filter(Boolean).map((d) => ({ label: d, value: "" })),
      ]);
    };
    g.addEventListener("pointermove", show);
    g.addEventListener("pointerleave", hideTip);
    g.addEventListener("focus", () => show());
    g.addEventListener("blur", hideTip);
  }
  holder.replaceChildren(root);
}

/* ---------- linecast's own drawings ---------- */

let artMetrics = null;

function measureArt() {
  const probe = el("pre", { class: "art" });
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.textContent = "M".repeat(20) + "\n" + "M".repeat(20);
  document.body.append(probe);
  const box = probe.getBoundingClientRect();
  probe.remove();
  return { cw: box.width / 20 || 8.4, ch: box.height / 2 || 14 };
}

async function refreshArt() {
  clearTimeout(state.artTimer);
  const app = state.artApp;
  for (const b of document.querySelectorAll(".tabs button")) {
    b.setAttribute("aria-selected", String(b.dataset.app === app));
  }
  const frame = $("#art-frame");
  const pre = $("#art");
  const note = $("#art-note");
  if (!frame.clientWidth) return; // card hidden
  artMetrics = artMetrics || measureArt();
  pre.style.setProperty("--cw", artMetrics.cw + "px");
  pre.style.setProperty("--ch", artMetrics.ch + "px");
  const cols = Math.max(20, Math.min(300, Math.floor((frame.clientWidth - 16) / artMetrics.cw)));
  const rows = Math.max(8, Math.min(120, Math.floor((frame.clientHeight - 12) / artMetrics.ch)));
  note.textContent = "Drawing…";
  try {
    const { data, stale } = await api("/api/art/" + app, { cols, rows });
    if (app !== state.artApp) return;
    pre.innerHTML = data.html; // built and escaped by the server
    pre.style.transform = "";
    const scale = Math.min(1, (frame.clientWidth - 8) / pre.scrollWidth, (frame.clientHeight - 8) / pre.scrollHeight);
    if (scale < 1) pre.style.transform = `scale(${scale})`;
    const when = data.generated_at ? new Date(data.generated_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
    note.textContent = `linecast ${app}, drawn at ${when}${stale ? " (last good drawing; the latest one failed)" : ""}. ` +
      (app === "radar" ? "One frame of the radar loop. " : "") +
      `Refreshes every ${Math.round(ART_REFRESH[app] / 60)} min.`;
  } catch (err) {
    if (app !== state.artApp) return;
    pre.textContent = "";
    note.textContent = messageFor(err);
  }
  state.artTimer = setTimeout(refreshArt, ART_REFRESH[app] * 1000);
}

/* ---------- wiring ---------- */

function applyTheme(theme) {
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

function isDark() {
  const t = document.documentElement.dataset.theme;
  if (t) return t === "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function redrawAll() {
  for (const app of Object.keys(state.payloads)) draw(app);
}

function appsToLoad() {
  const view = params.get("view");
  if (view && VIEW_APPS[view]) return VIEW_APPS[view];
  return ["sunshine", "moon", "sky", "tides", "weather"];
}

function start() {
  for (const app of Object.keys(state.timers)) clearTimeout(state.timers[app]);
  state.payloads = {};
  for (const app of appsToLoad()) {
    body(CARD_FOR[app]).replaceChildren(el("p", { class: "status", text: "Loading…" }));
    refresh(app);
  }
  refreshArt();
}

function init() {
  applyTheme(params.get("theme") || load("theme"));
  const view = params.get("view");
  if (view && VIEW_APPS[view]) {
    document.body.classList.add("single");
    $(`.card[data-view="${view}"]`).classList.add("shown");
  }
  if (params.get("bare") === "1" || params.get("chrome") === "0") document.body.classList.add("bare");
  if (params.get("transparent") === "1") document.body.classList.add("transparent");

  const input = $("#place-input");
  input.value = state.location;
  $("#place-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    state.location = input.value.trim();
    save("location", state.location);
    $("#place-name").textContent = state.location || "Finding your location…";
    start();
  });

  $("#theme-toggle").addEventListener("click", () => {
    const next = isDark() ? "light" : "dark";
    applyTheme(next);
    save("theme", next);
    redrawAll();
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redrawAll);

  for (const b of document.querySelectorAll(".tabs button")) {
    b.addEventListener("click", () => {
      state.artApp = b.dataset.app;
      save("art", state.artApp);
      refreshArt();
    });
  }

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { redrawAll(); refreshArt(); }, 300);
  });

  // Keep the clock and the "now" markers moving between refreshes.
  setInterval(updateHeader, 15000);
  setInterval(() => { for (const app of ["sunshine", "tides"]) draw(app); }, 60000);

  api("/api/config").then(({ data }) => {
    $("#versions").textContent = `linecast ${data.linecast} · linecast desktop ${data.version}`;
  }).catch(() => {});

  start();
}

init();
