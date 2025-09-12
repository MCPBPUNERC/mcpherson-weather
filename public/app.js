const LS_KEY = "mcpherson_hourly_log_v1";

// -------- helpers --------
const roundOrNull = (v, d=1) => (v == null || isNaN(v) ? null : Number(v.toFixed(d)));
const fmt = (n, d=1) => (n == null || isNaN(n) ? "—" : Number(n).toFixed(d));
const yyyymmddHHmmLocal = (d = new Date()) => {
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const msToNextTopOfHour = () => {
  const now = new Date();
  return (60 - now.getMinutes()) * 60000 - now.getSeconds() * 1000 - now.getMilliseconds();
};

// -------- state --------
let latest = null;
let hourlyLog = (() => { try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; } catch { return []; } })();

// -------- DOM --------
const $ = (id) => document.getElementById(id);
const elStation = $("stationName");
const elUpdated = $("lastUpdated");
const elError = $("errorBox");
const elTempF = $("tempF");
const elRH = $("rh");
const elDry = $("dryBulbF");
const elWet = $("wetBulbF");
const elWindMph = $("windMph");
const elWindDir = $("windDir");
const elPress = $("pressureInHg");
const elTSV = $("tsvField");
const elLogTable = $("logTable").querySelector("tbody");

$("refreshBtn").addEventListener("click", refresh);
$("snapshotBtn").addEventListener("click", snapshotNow);

// -------- data flow --------
async function refresh() {
  try {
    showError(null);
    const r = await fetch(`/api/obs?ts=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "Unknown backend error");

    const st = j.station || {};
    elStation.textContent = st.name && st.id ? `${st.name} [${st.id}]` : "—";

    latest = j.data || null;
    elUpdated.textContent = yyyymmddHHmmLocal(new Date());
    renderLatest(latest);
    renderTSV(latest);
  } catch (e) {
    showError(e.message || String(e));
  }
}

function renderLatest(o) {
  elTempF.textContent = fmt(o?.tempF, 1);
  elRH.textContent = o?.rh == null ? "—" : Math.round(o.rh);
  elDry.textContent = fmt(o?.dryBulbF, 1);
  elWet.textContent = fmt(o?.wetBulbF, 1);
  elWindMph.textContent = fmt(o?.windMph, 1);
  elWindDir.textContent = o?.windDirTxt ? `${o.windDirTxt} (${fmt(o.windDirDeg,0)}°)` : (o?.windDirDeg == null ? "—" : `${fmt(o?.windDirDeg,0)}°`);
  elPress.textContent = fmt(o?.pressureInHg, 2);
}

function renderTSV(o) {
  if (!o) { elTSV.value = ""; return; }
  const row = toRow(o);
  elTSV.value = [
    row.timeLocal,
    row.temperature_F,
    row.humidity_pct,
    row.dryBulb_F,
    row.wetBulb_F,
    row.windSpeed_mph,
    row.windDirection,
    row.pressure_inHg
  ].join("\t");
}

function toRow(o, when = new Date()) {
  return {
    timeLocal: yyyymmddHHmmLocal(when),
    temperature_F: roundOrNull(o?.tempF, 1),
    humidity_pct: o?.rh == null ? null : Math.round(o.rh),
    dryBulb_F: roundOrNull(o?.dryBulbF, 1),
    wetBulb_F: roundOrNull(o?.wetBulbF, 1),
    windSpeed_mph: roundOrNull(o?.windMph, 1),
    windDirection: o?.windDirTxt
      ? `${roundOrNull(o.windDirDeg,0)}° ${o.windDirTxt}`
      : (o?.windDirDeg != null ? `${roundOrNull(o.windDirDeg,0)}°` : null),
    pressure_inHg: roundOrNull(o?.pressureInHg, 2)
  };
}

// -------- hourly log --------
function renderLog() {
  elLogTable.innerHTML = "";
  for (const r of hourlyLog) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.timeLocal ?? ""}</td>
      <td>${r.temperature_F ?? ""}</td>
      <td>${r.humidity_pct ?? ""}</td>
      <td>${r.dryBulb_F ?? ""}</td>
      <td>${r.wetBulb_F ?? ""}</td>
      <td>${r.windSpeed_mph ?? ""}</td>
      <td>${r.windDirection ?? ""}</td>
      <td>${r.pressure_inHg ?? ""}</td>
    `;
    elLogTable.appendChild(tr);
  }
}
function persistLog() { try { localStorage.setItem(LS_KEY, JSON.stringify(hourlyLog)); } catch {} }

function buildCSV(rows) {
  const header = [
    "Time (local)",
    "Temp (°F)",
    "Humidity (%)",
    "Dry Bulb (°F)",
    "Wet Bulb (°F)",
    "Wind (mph)",
    "Wind Dir",
    "Pressure (inHg)"
  ].join(",");
  const lines = rows.map(r => [
    r.timeLocal,
    r.temperature_F,
    r.humidity_pct,
    r.dryBulb_F,
    r.wetBulb_F,
    r.windSpeed_mph,
    r.windDirection,
    r.pressure_inHg
  ].join(","));
  return [header, ...lines].join("\n");
}

function downloadCSV() {
  const csv = buildCSV(hourlyLog);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "mcpherson_hourly_weather.csv";
  a.click();
  URL.revokeObjectURL(url);
}

async function copyToClipboard(text) {
  try { await navigator.clipboard.writeText(text); alert("Copied to clipboard"); }
  catch { alert("Copy failed. You can select and copy manually."); }
}

function showError(msg) {
  if (!msg) { elError.hidden = true; elError.textContent = ""; return; }
  elError.hidden = false; elError.textContent = msg;
}

function snapshotNow() {
  if (!latest) return alert("No data yet to snapshot.");
  const now = new Date();
  const hourKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")} ${String(now.getHours()).padStart(2,"0")}:00`;
  const exists = hourlyLog.some(r => (r.timeLocal || "").startsWith(hourKey));
  if (exists && !confirm("A row for this hour already exists. Add another?")) return;
  hourlyLog.push(toRow(latest, now));
  persistLog(); renderLog();
}

function scheduleHourlySnapshot() {
  setTimeout(() => { if (latest) snapshotNow(); setInterval(() => { if (latest) snapshotNow(); }, 3600000); }, msToNextTopOfHour() + 1200);
}

// ---- kick off immediately ----
document.addEventListener("DOMContentLoaded", () => {
  refresh();                   // immediate fetch
  setInterval(refresh, 60_000);
  renderLog(); scheduleHourlySnapshot();
});

// Export buttons
$("copyCSVBtn").addEventListener("click", () => copyToClipboard(buildCSV(hourlyLog)));
$("downloadCSVBtn").addEventListener("click", downloadCSV);
$("clearLogBtn").addEventListener("click", () => {
  if (confirm("Clear all logged rows?")) { hourlyLog = []; persistLog(); renderLog(); }
});
