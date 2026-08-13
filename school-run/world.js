// Google Earth edition: photorealistic 3D tiles (Google Map Tiles API),
// terrain-draped neon route, car, beacons, morning sky.
import * as THREE from 'three';
import { TilesRenderer } from '3d-tiles-renderer';
import { GoogleCloudAuthPlugin, GLTFExtensionsPlugin, TileCompressionPlugin } from '3d-tiles-renderer/plugins';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const KEY = 'AIzaSyBW7CQsnEDtK502VHA2DbQq9WiNooNEqdQ';
const D2R = Math.PI / 180;

// WGS84 geodetic -> ECEF (h = 0 on the ellipsoid)
function ecef(latDeg, lonDeg) {
  const a = 6378137, e2 = 0.00669437999014;
  const p = latDeg * D2R, l = lonDeg * D2R;
  const N = a / Math.sqrt(1 - e2 * Math.sin(p) ** 2);
  return new THREE.Vector3(
    N * Math.cos(p) * Math.cos(l),
    N * Math.cos(p) * Math.sin(l),
    N * (1 - e2) * Math.sin(p)
  );
}

export function buildWorld(geo, camera, renderer) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xc8d9e8, 1600, 5200);

  // ---- sky dome: morning gradient ----
  const skyGeom = new THREE.SphereGeometry(8500, 24, 12);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(0x3d7bd6) },
      mid: { value: new THREE.Color(0x9dc4ec) },
      bot: { value: new THREE.Color(0xf0dfc2) },
    },
    vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 bot;
      void main(){
        float h = clamp(normalize(vP).y, 0.0, 1.0);
        vec3 c = h < 0.18 ? mix(bot, mid, h / 0.18) : mix(mid, top, (h - 0.18) / 0.82);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(skyGeom, skyMat));

  // sun glow sprite low in the east
  const sc = document.createElement('canvas');
  sc.width = sc.height = 256;
  const sg = sc.getContext('2d');
  const grad = sg.createRadialGradient(128, 128, 8, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,246,220,1)');
  grad.addColorStop(0.25, 'rgba(255,232,180,0.85)');
  grad.addColorStop(1, 'rgba(255,220,160,0)');
  sg.fillStyle = grad; sg.fillRect(0, 0, 256, 256);
  const sunSpr = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false, fog: false,
  }));
  sunSpr.scale.set(1500, 1500, 1);
  sunSpr.position.set(4200, 900, 1100);
  scene.add(sunSpr);

  scene.add(new THREE.HemisphereLight(0xdce9f7, 0x8a8272, 1.0));
  const sun = new THREE.DirectionalLight(0xffe2b8, 1.6);
  sun.position.set(900, 420, 250);
  scene.add(sun);

  // ---- Google photorealistic 3D tiles ----
  const b = geo.bbox;
  const lat0 = (b.minLat + b.maxLat) / 2, lon0 = (b.minLon + b.maxLon) / 2;

  const tiles = new TilesRenderer();
  tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: KEY, autoRefreshToken: true }));
  tiles.registerPlugin(new TileCompressionPlugin());
  const draco = new DRACOLoader();
  draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
  tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco }));
  tiles.setCamera(camera);
  tiles.setResolutionFromRenderer(camera, renderer);
  tiles.errorTarget = 14;

  // Anchor ECEF tileset to the game frame: x = east, y = up, z = south at (lat0, lon0)
  const p0 = lat0 * D2R, l0 = lon0 * D2R;
  const east = new THREE.Vector3(-Math.sin(l0), Math.cos(l0), 0);
  const up = new THREE.Vector3(Math.cos(p0) * Math.cos(l0), Math.cos(p0) * Math.sin(l0), Math.sin(p0));
  const south = east.clone().cross(up); // e x u = -north
  const rot = new THREE.Matrix4().makeBasis(east, up, south).transpose();
  const origin = ecef(lat0, lon0);
  const trans = origin.clone().applyMatrix4(rot).negate();
  tiles.group.quaternion.setFromRotationMatrix(rot);
  tiles.group.position.copy(trans);
  const earth = new THREE.Group();
  earth.add(tiles.group);
  scene.add(earth);

  // ---- terrain sampling: raycast down onto the tiles ----
  const raycaster = new THREE.Raycaster();
  raycaster.firstHitOnly = true;
  const DOWN = new THREE.Vector3(0, -1, 0);
  const rayFrom = new THREE.Vector3();
  function groundAt(x, z) {
    rayFrom.set(x, 900, z);
    raycaster.set(rayFrom, DOWN);
    const hits = raycaster.intersectObject(tiles.group, true);
    return hits.length ? hits[0].point.y : null;
  }

  const nS = geo.samples.length;
  const drapedY = new Float32Array(nS);
  let offsetSet = false;
  let drapeI = 0, drapeDirty = 99, lastBuild = -10;

  function yAt(d) {
    const i = Math.max(0, Math.min(nS - 1, Math.round((d / geo.sTotal) * (nS - 1))));
    return drapedY[i];
  }

  // ---- route ribbon (rebuilt as terrain streams in) ----
  const routeMatCore = new THREE.MeshBasicMaterial({ color: 0xff0099 });
  const routeMatGlow = new THREE.MeshBasicMaterial({ color: 0xff44bb, transparent: true, opacity: 0.16, depthWrite: false });
  let core = null, glow = null;
  function rebuildRoute() {
    const routePts = [];
    for (let i = 0; i < nS; i += 2) {
      routePts.push(new THREE.Vector3(geo.samples[i][0], drapedY[i] + 1.0, geo.samples[i][1]));
    }
    const curve = new THREE.CatmullRomCurve3(routePts);
    const segs = routePts.length * 2;
    const gCore = new THREE.TubeGeometry(curve, segs, 1.5, 6, false);
    const gGlow = new THREE.TubeGeometry(curve, segs, 3.2, 6, false);
    if (core) { core.geometry.dispose(); core.geometry = gCore; glow.geometry.dispose(); glow.geometry = gGlow; }
    else {
      core = new THREE.Mesh(gCore, routeMatCore);
      glow = new THREE.Mesh(gGlow, routeMatGlow);
      scene.add(core, glow);
    }
    for (const c of chevrons) c.mesh.position.y = yAt(c.d) + 2.3;
    for (const m of markers) m.group.position.y = yAt(m.d);
  }

  // chevron arrows along the route
  const chevrons = [];
  const chevMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
  const chevGeom = new THREE.ConeGeometry(1.3, 3.8, 5);
  chevGeom.rotateX(Math.PI / 2);
  for (let d = 40; d < geo.sTotal - 30; d += 80) {
    const p = geo.posAt(d);
    const cone = new THREE.Mesh(chevGeom, chevMat);
    cone.position.set(p.x, 2.3, p.z);
    cone.rotation.y = p.heading;
    scene.add(cone);
    chevrons.push({ mesh: cone, d });
  }

  // ---- car (built facing +Z) ----
  const car = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x15151b, roughness: 0.4, metalness: 0.6 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.0, 4.7), bodyMat);
  body.position.y = 1.0;
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.9, 0.85, 2.5),
    new THREE.MeshStandardMaterial({ color: 0x2a3444, roughness: 0.1, metalness: 0.8 })
  );
  cabin.position.set(0, 1.8, -0.3);
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(2.14, 0.22, 4.74),
    new THREE.MeshBasicMaterial({ color: 0xff0099 })
  );
  stripe.position.y = 0.62;
  const wheelGeom = new THREE.CylinderGeometry(0.55, 0.55, 0.4, 14);
  wheelGeom.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.9 });
  for (const [wx, wz] of [[-1.05, 1.55], [1.05, 1.55], [-1.05, -1.55], [1.05, -1.55]]) {
    const w = new THREE.Mesh(wheelGeom, wheelMat);
    w.position.set(wx, 0.55, wz);
    car.add(w);
  }
  const lightGeom = new THREE.BoxGeometry(0.5, 0.25, 0.1);
  for (const sx of [-0.7, 0.7]) {
    const head = new THREE.Mesh(lightGeom, new THREE.MeshBasicMaterial({ color: 0xfff6cc }));
    head.position.set(sx, 1.05, 2.36);
    const tail = new THREE.Mesh(lightGeom, new THREE.MeshBasicMaterial({ color: 0xff2222 }));
    tail.position.set(sx, 1.05, -2.36);
    car.add(head, tail);
  }
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(3.1, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.12;
  car.add(blob, body, cabin, stripe);
  scene.add(car);

  // ---- beacons + labels ----
  const beacons = [];
  const markers = [];
  function addMarker(x, z, color, text, num, d) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(4.5, 4.5, 70, 16, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false })
    );
    pillar.position.y = 35;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(6, 9, 32),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.4;
    g.add(pillar, ring);
    g.add(makeLabel(text, color, num));
    scene.add(g);
    beacons.push({ pillar, ring, t: Math.random() * 6 });
    markers.push({ group: g, d: d || 0 });
    return g;
  }
  function makeLabel(text, color, num) {
    const c = document.createElement('canvas');
    c.width = 640; c.height = 150;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(8,10,18,0.82)';
    roundRect(ctx, 6, 6, 628, 138, 26);
    ctx.fill();
    ctx.strokeStyle = '#' + new THREE.Color(color).getHexString();
    ctx.lineWidth = 6;
    roundRect(ctx, 6, 6, 628, 138, 26);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 52px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((num ? num + '  ·  ' : '') + text, 320, 80);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    spr.scale.set(120, 28, 1);
    spr.position.y = 86;
    return spr;
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function updateBeacons(t) {
    for (const b of beacons) {
      const s = 1 + 0.18 * Math.sin(t * 2.4 + b.t);
      b.ring.scale.set(s, s, 1);
      b.pillar.material.opacity = 0.25 + 0.14 * (0.5 + 0.5 * Math.sin(t * 2.4 + b.t));
    }
  }

  // ---- per-frame world update: stream tiles, settle terrain, drape route ----
  const onTile = { cb: null };
  function update(nowSec) {
    camera.updateMatrixWorld();
    tiles.update();

    if (onTile.cb) {
      const p = ('loadProgress' in tiles) ? tiles.loadProgress : 1;
      onTile.cb(p);
    }

    if (!offsetSet) {
      const y = groundAt(geo.samples[0][0], geo.samples[0][1]);
      if (y !== null) { earth.position.y -= y; offsetSet = true; }
      return;
    }
    // round-robin drape: keep the route glued to streamed terrain
    for (let k = 0; k < 2; k++) {
      const i = drapeI % nS; drapeI++;
      const y = groundAt(geo.samples[i][0], geo.samples[i][1]);
      if (y !== null && Math.abs(y - drapedY[i]) > 0.35) { drapedY[i] = y; drapeDirty++; }
    }
    if (drapeDirty > 4 && nowSec - lastBuild > 1.6) {
      rebuildRoute();
      lastBuild = nowSec;
      drapeDirty = 0;
    }
  }
  rebuildRoute(); // initial flat ribbon

  function onResize() { tiles.setResolutionFromRenderer(camera, renderer); }

  return { scene, car, addMarker, updateBeacons, onTile, update, yAt, onResize };
}
