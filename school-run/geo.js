// Geometry helpers: projection, path resampling, tile math.
export const R = 6378137;
const D2R = Math.PI / 180;

function mercX(lon) { return R * lon * D2R; }
function mercY(lat) { return R * Math.log(Math.tan(Math.PI / 4 + (lat * D2R) / 2)); }

export function makeGeo(data) {
  const coords = data.coords; // [lon, lat][]
  let minLon = 1e9, maxLon = -1e9, minLat = 1e9, maxLat = -1e9;
  for (const [lo, la] of coords) {
    if (lo < minLon) minLon = lo; if (lo > maxLon) maxLon = lo;
    if (la < minLat) minLat = la; if (la > maxLat) maxLat = la;
  }
  const lon0 = (minLon + maxLon) / 2;
  const lat0 = (minLat + maxLat) / 2;
  const k = Math.cos(lat0 * D2R); // mercator -> true meters at this latitude
  const mx0 = mercX(lon0), my0 = mercY(lat0);

  // local frame: x = east (m), z = south (m), y = up
  // exact ENU tangent-plane projection so the route aligns with the ECEF-anchored
  // Google 3D tiles in world.js by construction
  const A = 6378137, E2 = 0.00669437999014;
  const p0r = lat0 * D2R, l0r = lon0 * D2R;
  const eV = [-Math.sin(l0r), Math.cos(l0r), 0];
  const uV = [Math.cos(p0r) * Math.cos(l0r), Math.cos(p0r) * Math.sin(l0r), Math.sin(p0r)];
  const sV = [eV[1] * uV[2] - eV[2] * uV[1], eV[2] * uV[0] - eV[0] * uV[2], eV[0] * uV[1] - eV[1] * uV[0]];
  function ecefXYZ(lat, lon) {
    const p = lat * D2R, l = lon * D2R;
    const N = A / Math.sqrt(1 - E2 * Math.sin(p) ** 2);
    return [N * Math.cos(p) * Math.cos(l), N * Math.cos(p) * Math.sin(l), N * (1 - E2) * Math.sin(p)];
  }
  const oE = ecefXYZ(lat0, lon0);
  const toLocal = (lon, lat) => {
    const c = ecefXYZ(lat, lon);
    const d = [c[0] - oE[0], c[1] - oE[1], c[2] - oE[2]];
    return [eV[0] * d[0] + eV[1] * d[1] + eV[2] * d[2], sV[0] * d[0] + sV[1] * d[1] + sV[2] * d[2]];
  };
  const mercToLocal = (mx, my) => [(mx - mx0) * k, -(my - my0) * k];

  // ---- polyline with cumulative distance (pre-smooth, for step matching) ----
  const pts = coords.map((c) => toLocal(c[0], c[1]));
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0], dz = pts[i][1] - pts[i - 1][1];
    cum.push(cum[i - 1] + Math.hypot(dx, dz));
  }
  const total = cum[cum.length - 1];

  // distance along route for an arbitrary lon/lat (nearest vertex)
  function distFor(lon, lat) {
    const [x, z] = toLocal(lon, lat);
    let best = 0, bestD = 1e18;
    for (let i = 0; i < pts.length; i++) {
      const d = (pts[i][0] - x) ** 2 + (pts[i][1] - z) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    return cum[best];
  }

  // ---- resample every ~3 m, then smooth corners ----
  const STEP = 3;
  const n = Math.max(2, Math.floor(total / STEP));
  const samples = [];
  let seg = 1;
  for (let i = 0; i <= n; i++) {
    const d = (i / n) * total;
    while (seg < cum.length - 1 && cum[seg] < d) seg++;
    const d0 = cum[seg - 1], d1 = cum[seg];
    const t = d1 > d0 ? (d - d0) / (d1 - d0) : 0;
    samples.push([
      pts[seg - 1][0] + (pts[seg][0] - pts[seg - 1][0]) * t,
      pts[seg - 1][1] + (pts[seg][1] - pts[seg - 1][1]) * t,
    ]);
  }
  // moving-average smoothing (2 passes, radius 3 -> gentle corner rounding)
  for (let pass = 0; pass < 2; pass++) {
    const src = samples.map((s) => s.slice());
    for (let i = 3; i < samples.length - 3; i++) {
      let sx = 0, sz = 0;
      for (let j = -3; j <= 3; j++) { sx += src[i + j][0]; sz += src[i + j][1]; }
      samples[i][0] = sx / 7; samples[i][1] = sz / 7;
    }
  }
  // recompute cumulative distances on smoothed path
  const sCum = [0];
  for (let i = 1; i < samples.length; i++) {
    sCum.push(sCum[i - 1] + Math.hypot(samples[i][0] - samples[i - 1][0], samples[i][1] - samples[i - 1][1]));
  }
  const sTotal = sCum[sCum.length - 1];
  // headings
  const headings = [];
  for (let i = 0; i < samples.length; i++) {
    const a = samples[Math.max(0, i - 1)], b = samples[Math.min(samples.length - 1, i + 1)];
    headings.push(Math.atan2(b[0] - a[0], b[1] - a[1]));
  }

  function posAt(d) {
    const dd = Math.max(0, Math.min(sTotal - 0.001, d));
    // samples are near-uniform; guess index then refine
    let i = Math.min(samples.length - 2, Math.max(0, Math.floor((dd / sTotal) * (samples.length - 1))));
    while (i > 0 && sCum[i] > dd) i--;
    while (i < samples.length - 2 && sCum[i + 1] < dd) i++;
    const t = (dd - sCum[i]) / Math.max(0.001, sCum[i + 1] - sCum[i]);
    let h0 = headings[i], h1 = headings[i + 1];
    let dh = h1 - h0;
    if (dh > Math.PI) dh -= 2 * Math.PI;
    if (dh < -Math.PI) dh += 2 * Math.PI;
    return {
      x: samples[i][0] + (samples[i + 1][0] - samples[i][0]) * t,
      z: samples[i][1] + (samples[i + 1][1] - samples[i][1]) * t,
      heading: h0 + dh * t,
    };
  }

  // ---- target speed profile (m/s) per sample ----
  const target = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const j = Math.min(samples.length - 2, i);
    let dh = headings[j + 1] - headings[j];
    if (dh > Math.PI) dh -= 2 * Math.PI;
    if (dh < -Math.PI) dh += 2 * Math.PI;
    const ds = Math.max(0.5, sCum[j + 1] - sCum[j]);
    const turnRate = Math.abs(dh) / ds; // rad per meter
    target[i] = Math.min(18, Math.max(4, 19 - turnRate * 520));
  }
  // brake anticipation: look ahead ~45 m
  for (let i = 0; i < samples.length; i++) {
    let m = target[i];
    for (let j = i; j < Math.min(samples.length, i + 15); j++) m = Math.min(m, target[j] + (j - i) * 0.35);
    target[i] = m;
  }
  function targetAt(d, zones) {
    const i = Math.min(samples.length - 1, Math.max(0, Math.round((d / sTotal) * (samples.length - 1))));
    let t = target[i];
    if (d < 250) t = Math.min(t, 12);                    // pulling out of the neighborhood
    if (d > zones.schoolZone) t = Math.min(t, 9);        // school zone 20 mph
    if (d > zones.campus) t = Math.min(t, 6);            // on campus ~13 mph
    return t;
  }

  // ---- tile coverage (Esri World Imagery z18) ----
  const Z = 18, N = 2 ** Z;
  const padLon = 0.0042, padLat = 0.0032;
  const lonToTx = (lon) => ((lon + 180) / 360) * N;
  const latToTy = (lat) => ((1 - Math.log(Math.tan(lat * D2R) + 1 / Math.cos(lat * D2R)) / Math.PI) / 2) * N;
  const tx0 = Math.floor(lonToTx(minLon - padLon)), tx1 = Math.floor(lonToTx(maxLon + padLon));
  const ty0 = Math.floor(latToTy(maxLat + padLat)), ty1 = Math.floor(latToTy(minLat - padLat));
  const tiles = [];
  const world = 2 * Math.PI * R, tileM = world / N;
  // corridor filter: only fetch hi-res tiles within ~450 m of the route
  const corridor = 450;
  const nearRoute = (cx, cz) => {
    for (let i = 0; i < samples.length; i += 12) {
      const dx = samples[i][0] - cx, dz = samples[i][1] - cz;
      if (dx * dx + dz * dz < corridor * corridor) return true;
    }
    return false;
  };
  for (let x = tx0; x <= tx1; x++) {
    for (let y = ty0; y <= ty1; y++) {
      const mx = -world / 2 + x * tileM;        // west edge (mercator m)
      const my = world / 2 - y * tileM;         // north edge (mercator m)
      const [lx0, lz0] = mercToLocal(mx, my);           // NW corner
      const [lx1, lz1] = mercToLocal(mx + tileM, my - tileM); // SE corner
      if (!nearRoute((lx0 + lx1) / 2, (lz0 + lz1) / 2)) continue;
      tiles.push({ url: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${Z}/${y}/${x}`, x0: lx0, z0: lz0, x1: lx1, z1: lz1 });
    }
  }

  return { toLocal, samples, sTotal, posAt, targetAt, distFor, tiles, bbox: { minLon, maxLon, minLat, maxLat } };
}
