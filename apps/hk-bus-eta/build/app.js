import { fetchEtas, fetchEtaDb } from "./vendor/hk-bus-eta.esm.js";

const $ = (sel) => document.querySelector(sel);

const T = {
  loading: { zh: "載入路線資料…", en: "Loading route data…" },
  updating: { zh: "更新中…", en: "Updating…" },
  updated: { zh: "已更新", en: "Updated" },
  offline: { zh: "離線 — 使用快取資料", en: "Offline — cached data" },
  noService: { zh: "暫無到站班次", en: "No arriving buses" },
  arriving: { zh: "即將到站", en: "Arriving" },
  noRoute: { zh: "找不到該路線", en: "Route not found" },
  noStop: { zh: "找不到該車站", en: "Stop not found" },
  nearErr: { zh: "無法取得定位", en: "Location unavailable" },
  nearNotice: { zh: "正在定位…", en: "Locating…" },
  empty: { zh: "輸入路線號碼開始查詢", en: "Start typing a route number" },
  stopEmpty: { zh: "輸入車站名稱或編號開始查詢", en: "Start typing a stop name" },
  tabRoute: { zh: "路線查詢", en: "Route" },
  tabStop: { zh: "車站查詢", en: "Stop" },
  headingTo: { zh: "往", en: "To" },
  stopsN: { zh: "個站", en: "stops" },
  services: { zh: "個方向/班次", en: "services" },
  routesN: { zh: "條路線", en: "routes" },
  moreStops: { zh: "載入更多車站", en: "Load more stops" },
  moreRoutes: { zh: "載入更多路線", en: "Load more routes" },
  noteDetail: { zh: "點擊時間查看班次詳情 · 每 30 秒自動更新", en: "Tap a time for details · auto-refresh 30s" },
  noteStop: { zh: "此站在所有路線的到站時間", en: "Arrivals of all routes at this stop" },
  km: { zh: "km", en: "km" },
};

/* ---------------- state ---------------- */
const state = {
  db: null,
  lang: localStorage.getItem("buseta-lang") || "zh",
  routeNoIndex: new Map(),
  stopIndex: new Map(),
  uniqueStops: [],
  view: "home",
  homeTab: "route",
  detail: null,
  etaRows: new Map(),
  refreshing: false,
  _pos: null,
};

const el = {
  routeInput: $("#routeInput"),
  stopInput: $("#stopInput"),
  routeResults: $("#routeResults"),
  stopResults: $("#stopResults"),
  viewHome: $("#viewHome"),
  viewDetail: $("#viewDetail"),
  detailTop: $("#detailTop"),
  detailContent: $("#detailContent"),
};

/* ---------------- i18n ---------------- */
function setLang(l) {
  state.lang = l;
  localStorage.setItem("buseta-lang", l);
  $("#langBtn").textContent = l === "zh" ? "EN" : "中";
  document.documentElement.lang = l === "zh" ? "zh-Hant" : "en";
  $(".tab[data-tab=route]").textContent = T.tabRoute[l];
  $(".tab[data-tab=stop]").textContent = T.tabStop[l];
  $("#routeInput").placeholder = l === "zh" ? "輸入路線號碼，如 1A、286X、A12" : "Enter route no., e.g. 1A, 286X, A12";
  $("#stopInput").placeholder = l === "zh" ? "輸入車站名稱，如 怡和街" : "Enter stop name, e.g. Percival St";
  $("#nearBtn").textContent = l === "zh" ? "附近的站" : "Nearby";
  applyLangToCurrent();
}

/* ---------------- IndexedDB cache ---------------- */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("bus-eta-lite", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(key) {
  try {
    const db = await openDB();
    return await new Promise((res) => {
      const r = db.transaction("kv").objectStore("kv").get(key);
      r.onsuccess = () => res(r.result || null);
      r.onerror = () => res(null);
    });
  } catch { return null; }
}
async function idbSet(key, val) {
  try {
    const db = await openDB();
    await new Promise((res, rej) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(val, key);
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
  } catch { /* ignore */ }
}

/* ---------------- DB load ---------------- */
async function loadDb() {
  const [cachedDb, cachedTs] = await Promise.all([idbGet("db"), idbGet("ts")]);
  if (cachedDb) {
    applyDb(cachedDb);
    hideSplash();
    const age = Date.now() - (cachedTs || 0);
    if (age > 6 * 3600 * 1000) {
      if (navigator.onLine) { statusNow(T.updating[state.lang]); refreshDb().then(() => statusNow(T.updated[state.lang])); }
      else statusNow(T.offline[state.lang]);
    }
    return;
  }
  $("#splashMsg").textContent = T.loading[state.lang];
  try {
    const db = await fetchEtaDb();
    if (!db || !db.routeList) throw new Error("bad db");
    applyDb(db);
    await idbSet("db", db);
    await idbSet("ts", Date.now());
  } catch {
    statusNow(T.offline[state.lang]);
  } finally {
    hideSplash();
  }
}
async function refreshDb() {
  const db = await fetchEtaDb();
  if (!db || !db.routeList) throw new Error("bad db");
  applyDb(db);
  await idbSet("db", db);
  await idbSet("ts", Date.now());
}
function applyDb(db) {
  state.db = db;
  buildIndexes();
  if (state.view === "detail" && state.detail) {
    if (state.detail.kind === "route") openRoute(state.detail.routeNo, true);
    else openStop(state.detail.stopId, true);
  } else {
    renderCurrentList();
  }
}

/* ---------------- indexes ---------------- */
function buildIndexes() {
  const db = state.db;
  state.routeNoIndex.clear();
  state.stopIndex.clear();
  for (const entry of Object.values(db.routeList)) {
    if (!entry || !entry.stops) continue;
    const no = String(entry.route).trim().toUpperCase();
    if (!no) continue;
    let arr = state.routeNoIndex.get(no);
    if (!arr) { arr = []; state.routeNoIndex.set(no, arr); }
    arr.push(entry);
    for (const co of Object.keys(entry.stops)) {
      const list = entry.stops[co];
      if (!Array.isArray(list)) continue;
      list.forEach((ref, seq) => {
        let cell = state.stopIndex.get(ref);
        if (!cell) { cell = []; state.stopIndex.set(ref, cell); }
        cell.push({ entry, co, seq });
      });
    }
  }
  const seen = new Map();
  const items = [];
  for (const [ref, e] of Object.entries(db.stopList)) {
    if (!e || !e.name) continue;
    const norm = normalizeName(e.name);
    if (!norm) continue;
    let o = seen.get(norm);
    if (o) { o.ids.push(ref); continue; }
    o = { norm, ids: [ref], name: e.name, loc: e.location || null };
    seen.set(norm, o);
    items.push(o);
  }
  items.sort((a, b) => (a.name.en || "").localeCompare(b.name.en || ""));
  state.uniqueStops = items;
}
function normalizeName(name) {
  return String(name.zh || name.en || "").replace(/\s*\(.*\)$/, "").trim().toLowerCase().replace(/\s+/g, " ");
}

/* ---------------- helpers ---------------- */
function stopEntry(ref) {
  const db = state.db;
  let e = db.stopList[ref];
  if (e && e.name) return e;
  const m = db.stopMap[ref];
  if (m) {
    for (const [co, id] of m) {
      const x = db.stopList[id];
      if (x && x.name) return x;
    }
  }
  return e || { name: { zh: "", en: "" }, location: null };
}
function stopName(ref) {
  const n = stopEntry(ref).name;
  return n[state.lang] || n.zh || n.en || "";
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function numCompare(a) {
  const m = String(a).match(/^(\d+)/);
  return m ? Number(m[1]) : 1e9;
}
const CO_LABEL = {
  kmb: "九巴", ctb: "城巴", nlb: "嶼巴", gmb: "綠Van", lrtfeeder: "接駁",
  lightRail: "輕鐵", mtr: "港鐵", sunferry: "富洋船", fortuneferry: "富裕船", hkkf: "港九船",
};
function coTag(co) {
  return state.lang === "en" ? (CO_LABEL[co] || co).toUpperCase() : CO_LABEL[co] || co.toUpperCase();
}

/* ---------------- ETA ---------------- */
function etaFor(entry, co, seq) {
  return fetchEtas({
    route: String(entry.route),
    stops: entry.stops,
    bound: entry.bound,
    dest: entry.dest,
    freq: entry.freq,
    seq,
    serviceType: entry.serviceType,
    co: [co],
    nlbId: entry.nlbId,
    gtfsId: entry.gtfsId,
    stopList: state.db.stopList,
    language: state.lang,
    holidays: state.db.holidays,
    serviceDayMap: state.db.serviceDayMap,
  }).then((list) => {
    if (!Array.isArray(list)) return [];
    return list
      .map((x) => ({
        eta: x.eta,
        dest: (x.dest && (x.dest[state.lang] || x.dest.zh || x.dest.en)) || "",
        rmk: (x.remark && (x.remark[state.lang] || x.remark.zh || x.remark.en)) || "",
        co: x.co || co,
      }))
      .filter((x) => x.eta);
  }).catch(() => []);
}
function fmtEta(iso) {
  const t = new Date(iso);
  if (isNaN(t)) return { main: "—", sub: "", soon: false };
  const sub = String(t.getHours()).padStart(2, "0") + ":" + String(t.getMinutes()).padStart(2, "0");
  const mins = Math.floor((t.getTime() - Date.now()) / 60000);
  if (mins <= 1) return { main: T.arriving[state.lang], sub, soon: true };
  if (mins < 60) return { main: state.lang === "zh" ? mins + " 分" : mins + " min", sub, soon: false };
  const h = Math.floor(mins / 60);
  return { main: state.lang === "zh" ? h + " 小時" : h + " hr", sub, soon: false };
}
function chipsHTML(etas) {
  const list = etas.slice(0, 3);
  if (!list.length) return '<span class="eta-chip none">—</span>';
  return list.map((e) => {
    const f = fmtEta(e.eta);
    return `<span class="eta-chip${f.soon ? " soon" : ""}" title="${esc(e.rmk || e.dest)}">` +
      `<span class="t">${f.sub}</span>${f.main}</span>`;
  }).join("");
}
function expandedHTML(etas) {
  if (!etas.length) return `<div class="e-row">${esc(T.noService[state.lang])}</div>`;
  return etas.map((e) => {
    const f = fmtEta(e.eta);
    return `<div class="e-row"><span>${esc(e.dest)}${e.rmk ? ' <span class="rmk">' + esc(e.rmk) + "</span>" : ""}</span>` +
      `<span class="et">${f.sub} · ${f.main}</span></div>`;
  }).join("");
}
async function pool(items, worker, size = 6) {
  let i = 0;
  const out = new Array(items.length);
  const run = async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await worker(items[k], k);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
  return out;
}
function etaRace(rows) {
  return pool(rows, (r) => etaFor(r.entry, r.co, r.seq));
}

/* ---------------- route grouping ---------------- */
function pickEntry(group) {
  return group.entries.find((e) => e.serviceType === "1") || group.entries[0];
}
function entryStopsCo(entry) {
  return Object.keys(entry.stops).find((c) => Array.isArray(entry.stops[c]) && entry.stops[c].length);
}
function groupByDirection(no) {
  const entries = state.routeNoIndex.get(no) || [];
  const map = new Map();
  for (const e of entries) {
    const key = (e.orig.en || "") + "\u0001" + (e.dest.en || "");
    if (!map.has(key)) map.set(key, { key, orig: e.orig, dest: e.dest, entries: [] });
    map.get(key).entries.push(e);
  }
  return [...map.values()].map((g, gi) => ({ ...g, gi }));
}

/* ---------------- route search ---------------- */
function renderRouteResults(q) {
  const box = el.routeResults;
  box.innerHTML = "";
  const text = String(q || "").trim().toUpperCase();
  if (!text) { box.innerHTML = `<div class="msg">${T.empty[state.lang]}</div>`; return; }
  let keys = [...state.routeNoIndex.keys()].filter((k) => k.startsWith(text) || k.includes(text));
  keys.sort((a, b) => {
    const am = a.startsWith(text) ? 0 : 1, bm = b.startsWith(text) ? 0 : 1;
    return (am - bm) || (numCompare(a) - numCompare(b)) || a.localeCompare(b);
  });
  keys = keys.slice(0, 25);
  if (!keys.length) { box.innerHTML = `<div class="msg">${T.noRoute[state.lang]}</div>`; return; }
  keys.forEach((no) => {
    const group = groupByDirection(no);
    const dirs = group.slice(0, 3).map((g) => pickEntry(g).dest[state.lang]).filter(Boolean);
    const cos = [...new Set(group.map((g) => pickEntry(g).co[0]))];
    const card = document.createElement("div");
    card.className = "card tappable route-row";
    card.innerHTML = `
      <div class="route-no">${esc(no)}</div>
      <div class="route-dir">
        <div class="rd">${esc(dirs.join(" · "))}</div>
        <div class="rmeta">${esc(group.length + " " + T.services[state.lang])}
          ${cos.map((c) => `<span class="tag">${esc(coTag(c))}</span>`).join("")}</div>
      </div>`;
    card.addEventListener("click", () => openRoute(no));
    box.appendChild(card);
  });
}

/* ---------------- route detail ---------------- */
function openRoute(no, silent) {
  state.view = "detail";
  state.detail = { kind: "route", routeNo: no, groups: groupByDirection(no), sel: 0 };
  renderDetail();
  if (!silent) renderCurrentList();
}
function renderDetail() {
  const { sel, groups } = state.detail;
  const g = groups[sel];
  const e = pickEntry(g);
  el.viewHome.classList.add("hidden");
  el.viewDetail.classList.remove("hidden");
  el.detailTop.innerHTML = `
    <div class="back-bar">
      <button class="btn-back" id="backBtn" title="${esc(T.updated[state.lang])}">‹</button>
      <div>
        <div class="detail-title">${esc(state.detail.routeNo)} <span class="tag">${esc(coTag(e.co[0]))}</span>
        <span class="detail-sub">${esc(T.headingTo[state.lang] + " " + (e.dest[state.lang] || e.dest.en))}</span></div>
      </div>
    </div>
    <div class="pills">
      ${groups.map((x, i) => `<button class="pill${i === sel ? " active" : ""}" data-pi="${i}">
        ${esc(pickEntry(x).dest[state.lang] || "")}<small>${esc(pickEntry(x).orig[state.lang] || "")}</small>
      </button>`).join("")}
    </div>
    <div class="note">${state.lang === "zh" ? "點擊車站查看經此站的所有路線 · 每 30 秒自動更新" : "Tap a stop to see all routes via it · auto-refresh 30s"}</div>`;
  el.detailTop.querySelector("#backBtn").addEventListener("click", goHome);
  el.detailTop.querySelectorAll(".pill").forEach((p) =>
    p.addEventListener("click", () => {
      state.detail.sel = Number(p.dataset.pi);
      renderDetail();
    })
  );
  el.detailContent.innerHTML = '<div class="stop-list"></div>';
  renderRouteStops(g);
}
function renderRouteStops(group) {
  const listEl = $("#detailContent .stop-list");
  listEl.innerHTML = "";
  const e = pickEntry(group);
  const coMain = entryStopsCo(e);
  if (!coMain) return;
  const stops = e.stops[coMain];
  const STOP_BATCH = 14;
  const cards = [];
  stops.forEach((ref, seq) => {
    const name = stopName(ref);
    if (!name) return;
    const card = document.createElement("div");
    card.className = "stop-card";
    card.dataset.rowkey = group.gi + "\u0002" + coMain + "\u0002" + seq;
    card.innerHTML = `
      <div class="stop-idx${seq === stops.length - 1 ? " last" : ""}">${seq + 1}</div>
      <div class="stop-name">
        <div class="zh">${esc(name)}</div>
      </div>
      <div class="co-tag">${esc(coTag(coMain))}</div>
      <div class="eta-chips"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div>
      <div class="stop-more">›</div>`;
    card.addEventListener("click", () =>
      openStop(ref, false, { kind: "route", routeNo: state.detail.routeNo, sel: state.detail.sel })
    );
    cards.push(card);
  });
  let offset = 0;
  const more = document.createElement("button");
  more.className = "btn-more";
  more.textContent = T.moreStops[state.lang];
  const appendBatch = () => {
    const batch = cards.slice(offset, offset + STOP_BATCH);
    offset += STOP_BATCH;
    batch.forEach((c) => listEl.appendChild(c));
    fetchRowEtas(batch);
    if (cards.length > offset) listEl.appendChild(more);
    else more.remove();
  };
  more.addEventListener("click", appendBatch);
  appendBatch();
}
function fetchRowEtas(cards) {
  const rows = cards.map((c) => {
    const parts = c.dataset.rowkey.split("\u0002");
    const group = state.detail.groups[Number(parts[0])];
    return { el: c, rowkey: c.dataset.rowkey, co: parts[1], seq: Number(parts[2]), entry: pickEntry(group) };
  });
  etaRace(rows).then((res) => {
    rows.forEach((r, i) => {
      state.etaRows.set(r.rowkey, { etas: res[i], entry: r.entry, co: r.co, seq: r.seq });
      const chips = r.el.querySelector(".eta-chips");
      if (chips) chips.innerHTML = chipsHTML(res[i]);
    });
  });
}

/* ---------------- stop search ---------------- */
function pickRef(o) {
  return o.ids.find((id) => (state.stopIndex.get(id) || []).length) || o.ids[0];
}
function stopRouteCount(ref) {
  const rows = state.stopIndex.get(ref) || [];
  return new Set(rows.map((r) => [String(r.entry.route), r.entry.orig.en, r.entry.dest.en].join("|"))).size;
}
function renderStopResults(q) {
  const box = el.stopResults;
  box.innerHTML = "";
  const text = String(q || "").trim().toLowerCase();
  if (!text) { box.innerHTML = `<div class="msg">${T.stopEmpty[state.lang]}</div>`; return; }
  const hits = state.uniqueStops.filter((o) => o.norm.includes(text)).slice(0, 25);
  if (!hits.length) { box.innerHTML = `<div class="msg">${T.noStop[state.lang]}</div>`; return; }
  hits.forEach((o) => {
    const ref = pickRef(o);
    const card = document.createElement("div");
    card.className = "card tappable";
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
        <div><div style="font-weight:700;font-size:15px">${esc(o.name.zh || "")}</div>
        <div style="font-size:12px;color:var(--ink-2)">${esc(o.name.en || "")}</div></div>
        <div class="tag">${esc(stopRouteCount(ref) + " " + T.routesN[state.lang])}</div>
      </div>`;
    card.addEventListener("click", () => openStop(ref));
    box.appendChild(card);
  });
}
function nearby() {
  if (!state._pos) { statusNow(T.nearErr[state.lang]); return; }
  const { lat, lng } = state._pos;
  const scored = state.uniqueStops.filter((o) => o.loc)
    .map((o) => ({ o, d: hav(o.loc.lat, o.loc.lng, lat, lng) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 20);
  const box = el.stopResults;
  box.innerHTML = "";
  scored.forEach(({ o, d }) => {
    const ref = pickRef(o);
    const card = document.createElement("div");
    card.className = "card tappable";
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
        <div><div style="font-weight:700;font-size:15px">${esc(o.name.zh || "")}</div>
        <div style="font-size:12px;color:var(--ink-2)">${esc(o.name.en || "")}</div></div>
        <div style="text-align:right">
          <div class="tag">${d < 1 ? Math.round(d * 1000) + " m" : d.toFixed(1) + " " + T.km[state.lang]}</div>
          <div class="tag" style="margin-top:4px">${esc(stopRouteCount(ref) + " " + T.routesN[state.lang])}</div>
        </div>
      </div>`;
    card.addEventListener("click", () => openStop(ref));
    box.appendChild(card);
  });
}
function hav(aLat, aLng, bLat, bLng) {
  const R = 6371;
  const dLat = (bLat - aLat) * Math.PI / 180;
  const dLng = (bLng - aLng) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/* ---------------- stop detail ---------------- */
function openStop(ref, silent, from) {
  state.view = "detail";
  state.detail = { kind: "stop", stopId: ref, from: from || null };
  const rows = stopRows(ref);
  el.viewHome.classList.add("hidden");
  el.viewDetail.classList.remove("hidden");
  el.detailTop.innerHTML = `
    <div class="back-bar">
      <button class="btn-back" id="backBtn">‹</button>
      <div class="stop-title-row">
        <div class="detail-title">${esc(stopName(ref))}</div>
        <div class="stop-count">${rows.length} ${T.routesN[state.lang]}</div>
      </div>
    </div>
    <div class="note">${T.noteStop[state.lang]}</div>`;
  el.detailTop.querySelector("#backBtn").addEventListener("click", () => {
    const f = state.detail.from;
    if (f && f.kind === "route") {
      openRoute(f.routeNo, true);
      if (typeof f.sel === "number") {
        state.detail.sel = f.sel;
        renderDetail();
      }
    } else {
      goHome();
    }
  });
  el.detailContent.innerHTML = '<div class="stop-list"></div>';
  renderStopRows(rows);
  if (!silent) renderCurrentList();
}
function stopRows(ref) {
  const ids = [ref];
  const m = state.db && state.db.stopMap[ref];
  if (m) {
    for (const [co, id] of m) if (!ids.includes(id)) ids.push(id);
  }
  const rows = ids.flatMap((id) => state.stopIndex.get(id) || []);
  const map = new Map();
  for (const r of rows) {
    const key = [String(r.entry.route), r.entry.orig.en, r.entry.dest.en].join("|");
    if (!map.has(key)) map.set(key, r);
  }
  return [...map.values()].sort((a, b) =>
    naturalRouteCompare(String(a.entry.route), String(b.entry.route))
  );
}
function naturalRouteCompare(a, b) {
  const na = leadingNum(a), nb = leadingNum(b);
  const ta = na === null ? 1 : 0, tb = nb === null ? 1 : 0;
  if (ta !== tb) return ta - tb;
  if (na !== nb) return na - nb;
  return String(a).localeCompare(String(b));
}
function leadingNum(s) {
  const m = String(s).match(/^\d+/);
  return m ? Number(m[0]) : null;
}
function renderStopRows(rows) {
  const listEl = $("#detailContent .stop-list");
  listEl.innerHTML = "";
  const LIMIT = 20;
  rows.slice(0, LIMIT).forEach((r) => appendStopRow(listEl, r));
  if (rows.length > LIMIT) {
    const more = document.createElement("button");
    more.className = "btn-more";
    more.textContent = T.moreRoutes[state.lang];
    more.addEventListener("click", () => {
      more.remove();
      rows.slice(LIMIT).forEach((r) => appendStopRow(listEl, r));
    });
    listEl.appendChild(more);
  }
}
function appendStopRow(listEl, r) {
  const e = r.entry;
  const line = document.createElement("div");
  line.className = "route-line";
  const rowkey = "s" + Math.random().toString(36).slice(2, 9);
  line.dataset.rowkey = rowkey;
  line.innerHTML = `
    <div class="route-no" style="min-width:58px">${esc(String(e.route))}</div>
    <div class="rl-main">
      <div style="font-size:14px;font-weight:650">${esc(e.orig[state.lang] || e.orig.en || "")}
        <small style="color:var(--ink-2)"> → ${esc(e.dest[state.lang] || e.dest.en || "")}</small></div>
      <div style="font-size:11px;color:var(--ink-2)">${esc(coTag(r.co))}</div>
    </div>
    <div class="eta-chips"></div>`;
  line.addEventListener("click", () => {
    const ex = line.querySelector(".eta-expanded");
    if (ex) { ex.remove(); return; }
    const info = state.etaRows.get(rowkey);
    if (info) {
      const d = document.createElement("div");
      d.className = "eta-expanded";
      d.innerHTML = expandedHTML(info.etas);
      line.appendChild(d);
    }
  });
  listEl.appendChild(line);
  state.etaRows.set(rowkey, { etas: null });
  etaFor(e, r.co, r.seq).then((etas) => {
    state.etaRows.set(rowkey, { etas, entry: e, co: r.co, seq: r.seq });
    const chips = line.querySelector(".eta-chips");
    if (chips) chips.innerHTML = chipsHTML(etas);
  });
}

/* ---------------- auto refresh / status ---------------- */
function collectVisibleRows() {
  const rows = [];
  document.querySelectorAll("[data-rowkey]").forEach((rowEl) => {
    const info = state.etaRows.get(rowEl.dataset.rowkey);
    if (!info || info.etas === null) return;
    if (info.entry) rows.push({ rowEl, ...info });
    else {
      const parts = rowEl.dataset.rowkey.split("\u0002");
      if (parts.length === 3) {
        const g = state.detail.groups[Number(parts[0])];
        if (g) rows.push({ rowEl, entry: pickEntry(g), co: parts[1], seq: Number(parts[2]) });
      }
    }
  });
  return rows;
}
function startAutoRefresh() {
  setInterval(async () => {
    if (state.view !== "detail" || state.refreshing) return;
    const rows = collectVisibleRows();
    if (!rows.length) return;
    state.refreshing = true;
    try {
      const res = await etaRace(rows);
      rows.forEach((r, i) => {
        state.etaRows.set(r.rowEl.dataset.rowkey, { etas: res[i], entry: r.entry, co: r.co, seq: r.seq });
        const chips = r.rowEl.querySelector(".eta-chips");
        if (chips) chips.innerHTML = chipsHTML(res[i]);
      });
      statusNow(T.updated[state.lang]);
    } finally {
      state.refreshing = false;
    }
  }, 30000);
}
function statusNow(msg) {
  const bar = $("#statusbar");
  bar.textContent = msg;
  bar.classList.add("show");
  clearTimeout(bar._t);
  bar._t = setTimeout(() => bar.classList.remove("show"), 2200);
}
function hideSplash() {
  $("#splash").classList.add("hidden");
}
function goHome() {
  state.view = "home";
  el.viewDetail.classList.add("hidden");
  el.viewHome.classList.remove("hidden");
  renderCurrentList();
}
function renderCurrentList() {
  if (state.homeTab === "route") renderRouteResults(el.routeInput.value);
  else renderStopResults(el.stopInput.value);
}
function applyLangToCurrent() {
  if (state.view === "detail") {
    if (state.detail.kind === "route") openRoute(state.detail.routeNo, true);
    else openStop(state.detail.stopId, true);
  } else {
    renderCurrentList();
  }
}
async function manualRefresh() {
  $("#refreshBtn").classList.add("spin");
  statusNow(T.updating[state.lang]);
  try {
    await refreshDb();
    statusNow(T.updated[state.lang]);
  } catch {
    statusNow(T.offline[state.lang]);
  } finally {
    $("#refreshBtn").classList.remove("spin");
  }
}

/* ---------------- init ---------------- */
function init() {
  setLang(state.lang);
  $("#langBtn").addEventListener("click", () => setLang(state.lang === "zh" ? "en" : "zh"));
  $("#refreshBtn").addEventListener("click", manualRefresh);
  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      state.homeTab = t.dataset.tab;
      $("#panelRoute").classList.toggle("hidden", state.homeTab !== "route");
      $("#panelStop").classList.toggle("hidden", state.homeTab !== "stop");
    })
  );
  ["routeInput", "stopInput"].forEach((id) => {
    const input = el[id];
    let t;
    input.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        if (id === "routeInput") renderRouteResults(input.value);
        else renderStopResults(input.value);
      }, 120);
    });
  });
  $("#nearBtn").addEventListener("click", () => {
    if (!navigator.geolocation) { statusNow(T.nearErr[state.lang]); return; }
    statusNow(T.nearNotice[state.lang]);
    navigator.geolocation.getCurrentPosition(
      (pos) => { state._pos = { lat: pos.coords.latitude, lng: pos.coords.longitude }; nearby(); },
      () => statusNow(T.nearErr[state.lang]),
      { timeout: 8000 }
    );
  });
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/bus-eta-lite/sw.js").catch(() => {});
  }
  loadDb();
  startAutoRefresh();
}
document.addEventListener("DOMContentLoaded", init);