import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { makeGeo } from './geo.js';
import { buildWorld } from './world.js';

const DATA = window.GAME_DATA;
const geo = makeGeo(DATA);

// ---------- renderer / camera first (the tiles renderer needs them) ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const camera = new THREE.PerspectiveCamera(58, 1, 1, 12000);

const world = buildWorld(geo, camera, renderer);
const { scene, car, addMarker, updateBeacons, onTile } = world;

// ---------- key route distances ----------
const stepDists = DATA.steps.map((s) => geo.distFor(s.loc[0], s.loc[1]));
const ckpt1 = geo.distFor(DATA.waypoints[2].loc[0], DATA.waypoints[2].loc[1]);
const campus = stepDists[3];               // arrive at the CES car rider entrance (south drive)
const zones = { campus, schoolZone: campus - 350 };
const TOTAL = geo.sTotal;

const STEP_TEXT = [
  { t: 'Head south on Quality Hill St', i: '\u2191' },
  { t: 'Turn left onto W L D Lockett Rd', i: '\u2190' },
  { t: 'Turn right onto Pleasant Run Rd', i: '\u2192' },
  { t: 'Turn left into the SOUTH car rider entrance (middle drive is bus/staff only)', i: '\u2190' },
  { t: 'Two lanes merge into one after the turn', i: '\u2191' },
  { t: 'Turn right, follow the car line', i: '\u2192' },
  { t: 'Keep left along the main drive', i: '\u2190' },
  { t: 'Turn right toward the back parking lot', i: '\u2192' },
  { t: 'Drop-off 1: Colleyville Elementary', i: '\u25C9' },
  { t: 'Pull out of the car line, bear right', i: '\u2192' },
  { t: 'Turn right toward Bogart Dr', i: '\u2192' },
  { t: 'Turn left onto the CMS loop', i: '\u2190' },
  { t: 'Drop-off 2: Colleyville Middle', i: '\u25C9' },
];

// ---------- markers ----------
const home = geo.posAt(0), end = geo.posAt(TOTAL - 0.5), cesPos = geo.posAt(ckpt1);
addMarker(home.x, home.z, 0x44dd88, 'HOME · QUALITY HILL RD', null, 0);
addMarker(cesPos.x, cesPos.z, 0xffcc33, 'COLLEYVILLE ELEMENTARY', '1', ckpt1);
addMarker(end.x, end.z, 0x55aaff, 'COLLEYVILLE MIDDLE', '2', TOTAL - 1);

camera.position.set(home.x, 260, home.z + 260);

const orbit = new OrbitControls(camera, canvas);
const mid = geo.posAt(TOTAL * 0.55);
orbit.target.set(mid.x, 0, mid.z);
orbit.maxPolarAngle = Math.PI * 0.47;
orbit.minDistance = 40;
orbit.maxDistance = 3800;
orbit.enableDamping = true;
orbit.enabled = false;

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  world.onResize();
}
window.addEventListener('resize', resize);
resize();

// ---------- state ----------
const state = {
  mode: 'drive',            // 'drive' | 'explore'
  phase: 'start',           // 'start' | 'driving' | 'paused' | 'ckpt' | 'done'
  dist: 0, speed: 0, mult: 1,
  simElapsed: 0,
  kid1: false, kid2: false,
  keys: { up: false, down: false },
};
const START_CLOCK = 7 * 3600 + 5 * 60; // 7:05 AM

// ---------- HUD refs ----------
const $ = (id) => document.getElementById(id);
const el = {
  clock: $('clock'), mph: $('mph'), fill: $('progressFill'),
  pip1: $('pip1'), pip2: $('pip2'), kid1: $('kid1'), kid2: $('kid2'),
  icon: $('instrIcon'), main: $('instrMain'), dist: $('instrDist'), then: $('instrThen'),
  mini: $('minimap'), note: $('loadingNote'),
};
el.pip1.style.left = ((ckpt1 / TOTAL) * 100).toFixed(1) + '%';

onTile.cb = (p) => {
  if (!el.note) return;
  el.note.textContent = p >= 1
    ? 'Google Earth streamed in. Buckle up.'
    : `Streaming Google Earth\u2026 ${Math.round((p || 0) * 100)}%`;
};

// ---------- UI wiring ----------
function setMode(mode) {
  state.mode = mode;
  orbit.enabled = mode === 'explore';
  $('btnDrive').classList.toggle('active', mode === 'drive');
  $('btnExplore').classList.toggle('active', mode === 'explore');
  if (mode === 'explore') {
    const p = geo.posAt(state.dist);
    orbit.target.set(p.x, world.yAt(state.dist), p.z);
    const off = camera.position.clone().sub(orbit.target);
    if (off.y < 60 || off.length() < 80) camera.position.set(p.x + 180, world.yAt(state.dist) + 420, p.z + 380);
  }
}
$('btnDrive').onclick = () => setMode('drive');
$('btnExplore').onclick = () => setMode('explore');
document.querySelectorAll('#multRow button').forEach((b) => {
  b.onclick = () => {
    state.mult = +b.dataset.m;
    document.querySelectorAll('#multRow button').forEach((x) => x.classList.toggle('active', x === b));
  };
});
$('btnStart').onclick = () => { $('startOverlay').classList.add('hidden'); state.phase = 'driving'; setMode('drive'); };
$('btnStartExplore').onclick = () => { $('startOverlay').classList.add('hidden'); state.phase = 'paused'; setMode('explore'); };
$('btnResume').onclick = () => { $('ckptOverlay').classList.add('hidden'); state.phase = 'driving'; };
$('btnRestart').onclick = () => {
  $('endOverlay').classList.add('hidden');
  Object.assign(state, { dist: 0, speed: 0, simElapsed: 0, kid1: false, kid2: false, phase: 'driving' });
  el.kid1.classList.remove('done'); el.kid2.classList.remove('done');
  el.pip1.classList.remove('done'); el.pip2.classList.remove('done');
  setMode('drive');
};
$('btnEndExplore').onclick = () => { $('endOverlay').classList.add('hidden'); state.phase = 'done'; setMode('explore'); };
window.addEventListener('keydown', (e) => {
  if (e.code === 'ArrowUp') { state.keys.up = true; e.preventDefault(); }
  if (e.code === 'ArrowDown') { state.keys.down = true; e.preventDefault(); }
  if (e.code === 'Space') {
    if (state.phase === 'driving') state.phase = 'paused';
    else if (state.phase === 'paused' && state.dist > 0) state.phase = 'driving';
    e.preventDefault();
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'ArrowUp') state.keys.up = false;
  if (e.code === 'ArrowDown') state.keys.down = false;
});

// ---------- formatting ----------
function fmtClock(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')} AM`;
}
function fmtDist(m) {
  const ft = m * 3.28084;
  if (ft < 900) return `${Math.max(50, Math.round(ft / 50) * 50)} ft`;
  return `${(m / 1609.34).toFixed(1)} mi`;
}

// ---------- instruction card ----------
function updateInstr() {
  let next = -1;
  for (let i = 0; i < stepDists.length; i++) {
    if (stepDists[i] > state.dist + 6 && DATA.steps[i].type !== 'depart') { next = i; break; }
  }
  if (next === -1) {
    el.icon.textContent = '\u25C9'; el.main.textContent = STEP_TEXT[STEP_TEXT.length - 1].t; el.dist.textContent = 'Arriving'; el.then.textContent = '';
    return;
  }
  const d = stepDists[next] - state.dist;
  el.icon.textContent = STEP_TEXT[next].i;
  el.main.textContent = STEP_TEXT[next].t;
  el.dist.textContent = d < 18 ? 'NOW' : `In ${fmtDist(d)}`;
  const after = next + 1 < STEP_TEXT.length ? STEP_TEXT[next + 1].t : '';
  el.then.textContent = after ? `then: ${after}` : '';
}

// ---------- minimap ----------
const mm = el.mini.getContext('2d');
const mmPad = 12;
function mmXY(x, z) {
  const b = geo.bbox;
  const [x0, z0] = geo.toLocal(b.minLon, b.maxLat);
  const [x1, z1] = geo.toLocal(b.maxLon, b.minLat);
  const sx = (el.mini.width - 2 * mmPad) / (x1 - x0);
  const sy = (el.mini.height - 2 * mmPad) / (z1 - z0);
  const s = Math.min(sx, sy);
  const ox = (el.mini.width - (x1 - x0) * s) / 2, oy = (el.mini.height - (z1 - z0) * s) / 2;
  return [ox + (x - x0) * s, oy + (z - z0) * s];
}
function drawMinimap() {
  mm.clearRect(0, 0, el.mini.width, el.mini.height);
  mm.fillStyle = 'rgba(16,20,32,0.9)';
  mm.fillRect(0, 0, el.mini.width, el.mini.height);
  mm.strokeStyle = '#ff0099';
  mm.lineWidth = 2.5;
  mm.lineJoin = 'round';
  mm.beginPath();
  for (let i = 0; i < geo.samples.length; i += 6) {
    const [px, py] = mmXY(geo.samples[i][0], geo.samples[i][1]);
    i === 0 ? mm.moveTo(px, py) : mm.lineTo(px, py);
  }
  mm.stroke();
  const dots = [
    [home, '#44dd88'], [cesPos, '#ffcc33'], [end, '#55aaff'],
  ];
  for (const [p, c] of dots) {
    const [px, py] = mmXY(p.x, p.z);
    mm.fillStyle = c;
    mm.beginPath(); mm.arc(px, py, 4, 0, 7); mm.fill();
  }
  const cp = geo.posAt(state.dist);
  const [px, py] = mmXY(cp.x, cp.z);
  mm.fillStyle = '#ffffff';
  mm.strokeStyle = '#ff0099'; mm.lineWidth = 2;
  mm.beginPath(); mm.arc(px, py, 5, 0, 7); mm.fill(); mm.stroke();
}

// ---------- game loop ----------
let last = performance.now();
const camTarget = new THREE.Vector3(), lookTarget = new THREE.Vector3();
let firstFrame = true;
let carY = 0;

function tick(now) {
  requestAnimationFrame(tick);
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = now / 1000;
  updateBeacons(t);

  if (state.phase === 'driving') {
    const sdt = dt * state.mult;
    let target = geo.targetAt(state.dist, zones);
    if (state.keys.up) target = Math.min(24, target * 1.7);
    if (state.keys.down) target = 0;
    const accel = target > state.speed ? 3.2 : 6.5;
    state.speed += Math.max(-accel * sdt, Math.min(accel * sdt, target - state.speed));
    state.speed = Math.max(0, state.speed);
    state.dist += state.speed * sdt;
    state.simElapsed += sdt;

    if (!state.kid1 && state.dist >= ckpt1 - 1) {
      state.dist = ckpt1; state.speed = 0; state.kid1 = true; state.phase = 'ckpt';
      el.kid1.classList.add('done'); el.pip1.classList.add('done');
      $('ckptOverlay').classList.remove('hidden');
    }
    if (!state.kid2 && state.dist >= TOTAL - 1.5) {
      state.dist = TOTAL - 1; state.speed = 0; state.kid2 = true; state.phase = 'done';
      el.kid2.classList.add('done'); el.pip2.classList.add('done');
      const arriveSec = START_CLOCK + state.simElapsed;
      $('endTime').textContent = `${Math.floor(state.simElapsed / 60)}:${String(Math.round(state.simElapsed % 60)).padStart(2, '0')}`;
      $('endArrive').textContent = fmtClock(arriveSec).replace(' AM', '');
      const margin = 7 * 3600 + 27 * 60 - arriveSec;
      $('endMargin').textContent = margin > 0 ? `${Math.round(margin / 60)} min` : 'LATE!';
      $('endOverlay').classList.remove('hidden');
    }
  }

  // car placement, glued to streamed terrain
  const p = geo.posAt(state.dist);
  const targetY = world.yAt(state.dist);
  carY += (targetY - carY) * Math.min(1, dt * (firstFrame ? 1000 : 6));
  car.position.set(p.x, carY, p.z);
  car.rotation.y = p.heading;

  // camera
  if (state.mode === 'drive') {
    const fwd = new THREE.Vector3(Math.sin(p.heading), 0, Math.cos(p.heading));
    camTarget.set(p.x - fwd.x * 19, carY + 9.5, p.z - fwd.z * 19);
    lookTarget.set(p.x + fwd.x * 26, carY + 2.5, p.z + fwd.z * 26);
    const a = firstFrame ? 1 : 1 - Math.exp(-dt * 4.2);
    camera.position.lerp(camTarget, a);
    camera.lookAt(lookTarget);
    const mph = state.speed * 2.23694;
    const fov = 56 + mph * 0.28;
    if (Math.abs(camera.fov - fov) > 0.2) { camera.fov = fov; camera.updateProjectionMatrix(); }
    firstFrame = false;
  } else {
    orbit.update();
  }

  // stream + drape Google Earth tiles
  world.update(t);

  // HUD
  el.mph.textContent = Math.round(state.speed * 2.23694);
  el.clock.textContent = fmtClock(START_CLOCK + state.simElapsed);
  el.fill.style.width = ((state.dist / TOTAL) * 100).toFixed(1) + '%';
  updateInstr();
  drawMinimap();

  renderer.render(scene, camera);
}
requestAnimationFrame(tick);
