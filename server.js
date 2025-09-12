// server.js — KWCH-first (via env), NWS fallback nearest to 17th Ave (McPherson, KS).
// Frontend calls only this server; UI never names the provider.

import 'dotenv/config';
import express from 'express';
import morgan from 'morgan';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- Config ----------
const ZIP = '67460'; // McPherson ZIP
const MC_17TH_AVE = { lat: 38.355, lon: -97.666 }; // adjust if you want a different spot

// Optional: private KWCH JSON endpoint (kept off the UI)
const KWCH_URL = process.env.KWCH_WEATHER_JSON_URL || '';

const NWS_HEADERS = {
  'Accept': 'application/geo+json',
  'User-Agent': process.env.NWS_USER_AGENT || 'McPhersonWeatherLink (admin@example.com)'
};

// ---------- Express ----------
app.use(morgan('tiny'));
app.use(express.static('public'));

// ---------- Helpers ----------
async function fetchJSON(url, { headers = {}, timeoutMs = 12000, retries = 1, tag = '' } = {}) {
  for (let a = 0; a <= retries; a++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers, signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`[${tag}] HTTP ${res.status} :: ${url} :: ${text.slice(0, 200)}`);
      }
      try { return await res.json(); }
      catch {
        const text = await res.text().catch(() => '');
        throw new Error(`[${tag}] Non-JSON from ${url} :: ${text.slice(0, 200)}`);
      }
    } catch (e) {
      clearTimeout(t);
      if (a === retries) throw e;
      await new Promise(r => setTimeout(r, 500 * (a + 1)));
    }
  }
}

const toF = (c) => (c == null ? null : (c * 9) / 5 + 32);
const msToMph = (ms) => (ms == null ? null : ms * 2.23693629);
const kmhToMph = (kmh) => (kmh == null ? null : kmh / 1.609344);
const paToInHg = (pa) => (pa == null ? null : pa / 3386.389);
const degToCardinal = (deg) => {
  if (deg == null || isNaN(deg)) return null;
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(((deg % 360) / 22.5)) % 16];
};
function wetBulbC_Stull(Tc, RH) {
  if (Tc == null || RH == null) return null;
  const x = Math.sqrt(RH + 8.313659);
  return Tc * Math.atan(0.151977 * x) +
         Math.atan(Tc + RH) -
         Math.atan(RH - 1.676331) +
         0.00391838 * Math.pow(RH, 1.5) * Math.atan(0.023101 * RH) -
         4.686035;
}
function rhFromTd(Tc, TdC) {
  if (Tc == null || TdC == null) return null;
  const es = (t) => 6.112 * Math.exp((17.67 * t) / (t + 243.5));
  return Math.max(0, Math.min(100, (es(TdC) / es(Tc)) * 100));
}
function standardize({ timestamp, tempC, dewpointC, rhPct, windSpeed, windUnit, windDirDeg, pressurePa }) {
  let windMph = null;
  if (windSpeed != null) {
    if (windUnit?.includes('km_h-1')) windMph = kmhToMph(windSpeed);
    else if (windUnit?.includes('m_s-1')) windMph = msToMph(windSpeed);
    else windMph = windSpeed; // assume mph
  }
  const rh = rhPct ?? rhFromTd(tempC, dewpointC);
  const wetC = wetBulbC_Stull(tempC, rh);
  return {
    tempF: toF(tempC),
    rh,
    dryBulbF: toF(tempC),
    wetBulbF: wetC != null ? toF(wetC) : null,
    windMph,
    windDirDeg,
    windDirTxt: degToCardinal(windDirDeg),
    pressureInHg: paToInHg(pressurePa),
    timestamp: timestamp ? new Date(timestamp) : new Date()
  };
}

// ---------- Primary (KWCH via env; kept off UI) ----------
async function tryKWCH(zip) {
  if (!KWCH_URL) throw new Error('KWCH disabled');
  const url = new URL(KWCH_URL);
  if (zip) url.searchParams.set('zip', zip);

  const j = await fetchJSON(url.toString(), { timeoutMs: 12000, retries: 0, tag: 'KWCH' });
  const src = j?.current || j?.observation || j?.data || j;
  if (!src || typeof src !== 'object') throw new Error('KWCH payload missing expected fields');

  const num = (v) => (v == null ? null : Number(v));
  const tempC     = num(src.tempC ?? src.temperatureC ?? (src.tempF != null ? (src.tempF - 32) * 5/9 : null));
  const dewpointC = num(src.dewpointC ?? (src.dewpointF != null ? (src.dewpointF - 32) * 5/9 : null));
  const rhPct     = num(src.humidity ?? src.relativeHumidity ?? src.rh);
  const windSpeed = num(src.windSpeed ?? src.wind_speed ?? src.wind?.speed);
  const windUnit  = src.windUnit ?? src.wind_unit ?? 'm_s-1'; // change if your feed is mph
  const windDirDeg= num(src.windDir ?? src.wind_direction ?? src.wind?.directionDeg);
  const pressurePa= num(src.pressurePa ?? (src.pressureInHg != null ? src.pressureInHg * 3386.389 : null)) ??
                    num(src.barometricPressurePa ?? src.barometric_pressure_pa);

  return {
    data: standardize({
      timestamp: src.timestamp ?? src.obsTime ?? src.time,
      tempC, dewpointC, rhPct, windSpeed, windUnit, windDirDeg, pressurePa
    }),
    station: { id: 'primary', name: 'primary' } // UI won’t display this
  };
}

// ---------- Fallback (NWS near 17th Ave) ----------
async function resolveNearestStation(lat, lon) {
  const points = await fetchJSON(
    `https://api.weather.gov/points/${lat},${lon}`,
    { headers: NWS_HEADERS, retries: 1, tag: 'NWS points' }
  );
  const stationsUrl = points?.properties?.observationStations;
  if (!stationsUrl) throw new Error('NWS: no observationStations link');

  const stns = await fetchJSON(
    `${stationsUrl}?_${Date.now()}`,
    { headers: NWS_HEADERS, retries: 1, tag: 'NWS stations' }
  );
  const first = stns?.features?.[0];
  if (!first) throw new Error('NWS: no stations returned');

  return {
    id: first.properties?.stationIdentifier || first.id.split('/').pop(),
    url: first.id,
    name: first.properties?.name || first.properties?.stationIdentifier || 'Nearest station'
  };
}

async function fetchNWSLatest(stationUrl) {
  try {
    const j = await fetchJSON(`${stationUrl}/observations/latest?_=${Date.now()}`, { headers: NWS_HEADERS, retries: 0, tag: 'NWS latest' });
    if (j?.properties) return j.properties;
  } catch {}
  const j2 = await fetchJSON(`${stationUrl}/observations?limit=1&_=${Date.now()}`, { headers: NWS_HEADERS, retries: 0, tag: 'NWS list' });
  const feat = j2?.features?.[0];
  if (!feat) throw new Error('NWS: no observations available');
  return feat.properties;
}

function normalizeNWS(p) {
  const tempC     = p?.temperature?.value ?? null;
  const dewpointC = p?.dewpoint?.value ?? null;
  const rhPct     = p?.relativeHumidity?.value ?? null;
  const windSpeed = p?.windSpeed?.value ?? null;
  const windUnit  = p?.windSpeed?.unitCode ?? 'm_s-1';
  const windDirDeg= p?.windDirection?.value ?? null;
  let pressurePa  = p?.barometricPressure?.value ?? null;
  if (pressurePa == null) pressurePa = p?.seaLevelPressure?.value ?? null;

  return standardize({
    timestamp: p?.timestamp,
    tempC, dewpointC, rhPct, windSpeed, windUnit, windDirDeg, pressurePa
  });
}

// ---------- Health (for debugging) ----------
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, env: { KWCH: Boolean(KWCH_URL), NWS_USER_AGENT: Boolean(process.env.NWS_USER_AGENT) } });
});

// ---------- Unified observation (UI calls this) ----------
app.get('/api/obs', async (_req, res) => {
  const stage = { step: 'start' };
  try {
    // 1) KWCH (if configured)
    stage.step = 'kwch';
    if (KWCH_URL) {
      try {
        const k = await tryKWCH(ZIP);
        return res.json({ ok: true, data: k.data, station: k.station, used: 'primary' });
      } catch (e) {
        console.warn(`[KWCH fallback] ${e.message}`);
      }
    }

    // 2) NWS fallback
    stage.step = 'nws:resolve';
    const st = await resolveNearestStation(MC_17TH_AVE.lat, MC_17TH_AVE.lon);

    stage.step = 'nws:fetch';
    const nwsProps = await fetchNWSLatest(st.url);

    stage.step = 'nws:normalize';
    const data = normalizeNWS(nwsProps);

    return res.json({ ok: true, data, station: st, used: 'nws' });
  } catch (err) {
    console.error(`[ERROR @ ${stage.step}]`, err);
    res.status(500).json({ ok: false, step: stage.step, error: err.message || String(err) });
  }
});

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
