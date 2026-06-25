/* game3d.js — real-time WebGL 3D presentation layer (Three.js).
 *
 * Keeps the existing 2D physics 100% authoritative: it runs a normal RacePro
 * instance, then SWAPS that engine's 2D draw for a Three.js render. Each frame
 * the 3D meshes are synced from the physics state (car.x, car.y, car.angle,
 * car.speedApprox). Maps the 2D plane (x, y) onto the 3D ground plane (x, z).
 *
 * This is the truck-circuit vertical slice; boats & helicopters layer in after.
 */
import * as THREE from "three";
import { RoundedBoxGeometry } from "./vendor/three/addons/geometries/RoundedBoxGeometry.js";
import { EffectComposer } from "./vendor/three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "./vendor/three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "./vendor/three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "./vendor/three/addons/postprocessing/OutputPass.js";

// rounded box helper (cached geometries by dims for reuse)
const _rbox = {};
function rbox(w, h, d, r = 1.6) {
  const k = `${w}_${h}_${d}_${r}`;
  return _rbox[k] || (_rbox[k] = new RoundedBoxGeometry(w, h, d, 3, r));
}

const hexToCss = (h) => (typeof h === "string" ? h : "#" + h.toString(16).padStart(6, "0"));

class Race3D {
  constructor(canvas, cfg) {
    this.canvas = canvas;
    this.cfg = cfg;
    this.track = cfg.track;
    this.theme = this.track.theme || { ground: "#9c6a3a", dirt: "#b07a45", dirtDark: "#5a3c20" };

    // physics via the existing engine, with its 2D renderer swapped out
    const pc = document.createElement("canvas"); pc.width = 320; pc.height = 240;
    this.sim = new window.RacePro(pc, Object.assign({}, cfg));
    this.sim._render = () => this._draw();      // hijack the per-frame draw
    this.bbox = this.sim.bbox;
    this.carMeshes = new Map();
    this._tmp = new THREE.Vector3();
    this._look = new THREE.Vector3((this.bbox.minX + this.bbox.maxX) / 2, 0, (this.bbox.minY + this.bbox.maxY) / 2);

    this._buildScene();
    this._buildTrack();
    this._buildCars();
  }

  // ---- lifecycle (mirrors RacePro's public surface used by app.js) ----
  get player() { return this.sim.player; }
  get running() { return this.sim.running; }
  start() { this._resize(); this.sim.start(); }
  stop() { if (this.sim) this.sim.stop(); if (this.renderer) { this.renderer.dispose(); } }
  setPaused(p) { this.sim.setPaused(p); }

  // ---- world ----
  _buildScene() {
    const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: "high-performance" });
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.08;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer = r;

    const scene = new THREE.Scene();
    this.scene = scene;
    const span = Math.max(this.bbox.w, this.bbox.h);

    // sky + environment reflections from one gradient equirect
    const sky = this._skyTexture();
    scene.background = sky;
    const pmrem = new THREE.PMREMGenerator(r);
    scene.environment = pmrem.fromEquirectangular(sky).texture;
    scene.fog = new THREE.Fog(new THREE.Color(this._horizon), span * 0.9, span * 2.6);

    // camera
    this.camera = new THREE.PerspectiveCamera(55, 1, 2, span * 6);
    this.camera.position.set(this._look.x - 200, 240, this._look.z + 320);

    // key sun (shadow) + soft sky fill
    const sun = new THREE.DirectionalLight(0xfff2dc, 3.1);
    sun.position.set(span * 0.5, span * 0.9, span * 0.35);
    sun.castShadow = true;
    const sc = sun.shadow.camera, R = span * 0.75;
    sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 1; sc.far = span * 3;
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 2;
    scene.add(sun);
    scene.add(new THREE.HemisphereLight(0xdcefff, this._toColor(this.theme.groundDark || this.theme.ground), 0.95));

    // ground
    const gmat = new THREE.MeshStandardMaterial({ color: this._toColor(this.theme.ground), roughness: 1, metalness: 0 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(span * 5, span * 5), gmat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(this._look.x, 0, this._look.z);
    ground.receiveShadow = true;
    scene.add(ground);

    // post-processing: bloom + ACES output for the "modern" sheen, MSAA target
    const ds = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(Math.max(2, ds.x), Math.max(2, ds.y), { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(r, rt);
    this.composer.addPass(new RenderPass(scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(ds.x, ds.y), 0.28, 0.5, 0.9); // strength, radius, threshold
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  _skyTexture() {
    const c = document.createElement("canvas"); c.width = 16; c.height = 256;
    const g = c.getContext("2d");
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0.0, "#1d5fa8");   // zenith
    grd.addColorStop(0.45, "#6fa8db");  // sky
    grd.addColorStop(0.54, "#a9c4d8");  // horizon haze (kept below bloom threshold)
    grd.addColorStop(0.56, "#9aa6a4");
    grd.addColorStop(1.0, "#5f5340");   // ground bounce
    g.fillStyle = grd; g.fillRect(0, 0, 16, 256);
    this._horizon = "#a9c4d8";
    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  _toColor(h) { return new THREE.Color(hexToCss(h)); }

  // signed normals along the centreline, for ribbons / walls
  _edge(i, off) {
    const p = this.sim.pts, N = p.length;
    const a = p[(i - 1 + N) % N], b = p[(i + 1) % N];
    const tx = b.x - a.x, ty = b.y - a.y, l = Math.hypot(tx, ty) || 1;
    return { x: p[i].x + (-ty / l) * off, y: p[i].y + (tx / l) * off };
  }

  _buildTrack() {
    const N = this.sim.pts.length, hw = this.track.width / 2;
    // road surface ribbon
    const pos = [], idx = []; let v = 0;
    for (let i = 0; i < N; i++) {
      const L = this._edge(i, -hw), R = this._edge(i, hw);
      pos.push(L.x, 0.6, L.y, R.x, 0.6, R.y);
    }
    for (let i = 0; i < N; i++) {
      const a = i * 2, b = ((i + 1) % N) * 2;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    const road = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: this._toColor(this.theme.dirt), roughness: 0.96, metalness: 0 }));
    road.receiveShadow = true; this.scene.add(road);

    // red/white kerb walls along both banks
    for (const sign of [1, -1]) this.scene.add(this._kerbWall(sign, hw + 4));
  }

  _kerbWall(sign, off) {
    const N = this.sim.pts.length, H = 11;
    const pos = [], col = [], idx = [];
    const red = new THREE.Color("#c43326"), white = new THREE.Color("#e9eaef");
    for (let i = 0; i < N; i++) {
      const e = this._edge(i, sign * off);
      pos.push(e.x, 0.5, e.y, e.x, H, e.y);
      const c = (i % 2 === 0) ? red : white;
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    for (let i = 0; i < N; i++) {
      const a = i * 2, b = ((i + 1) % N) * 2;
      if (sign > 0) idx.push(a, b, a + 1, a + 1, b, b + 1);
      else idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0, side: THREE.DoubleSide }));
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  // ---- vehicles ----
  _buildCars() {
    for (const car of this.sim.cars) {
      const m = this._makeTruck(this._toColor(car.color), car.isPlayer);
      this.scene.add(m.group);
      this.carMeshes.set(car, m);
    }
  }

  _makeTruck(color, isPlayer) {
    const g = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.3, envMapIntensity: 1.3 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x14181f, metalness: 0.45, roughness: 0.5 });
    const matte = new THREE.MeshStandardMaterial({ color: 0x23262c, metalness: 0.2, roughness: 0.85 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x243246, metalness: 0.55, roughness: 0.07, envMapIntensity: 1.8 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xcfd4da, metalness: 0.95, roughness: 0.2 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x141109, metalness: 0, roughness: 0.95 });
    const emis = new THREE.MeshStandardMaterial({ color: 0xfff3c8, emissive: 0xfff0b0, emissiveIntensity: 1.5 });
    const taill = new THREE.MeshStandardMaterial({ color: 0xff6a5a, emissive: 0xff2a14, emissiveIntensity: 1.1 });
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };

    add(rbox(40, 8, 22, 2.5), matte, 0, 7, 0);                 // skid plate / chassis
    add(rbox(40, 12, 19, 3), paint, -1, 14.5, 0);              // main body
    add(rbox(15, 9, 19, 3), paint, 14, 12.5, 0);               // hood
    add(rbox(17, 11, 17.5, 2.5), paint, -12, 17, 0);           // rear bed block
    for (const [x, z] of [[13, 10.8], [13, -10.8], [-13, 10.8], [-13, -10.8]]) add(rbox(15, 7, 5, 2), paint, x, 11, z); // fenders
    add(rbox(15, 10, 16, 2.5), glass, -2, 22, 0);              // cabin glass
    add(rbox(16.5, 4, 16.5, 2), paint, -2, 27.5, 0);           // roof
    // roll cage
    for (const z of [6.5, -6.5]) { const p = add(new THREE.CylinderGeometry(0.9, 0.9, 11, 8), chrome, -9, 24, z); }
    const topbar = add(new THREE.CylinderGeometry(0.9, 0.9, 16, 8), chrome, -9, 29, 0); topbar.rotation.x = Math.PI / 2;
    // bumper + grille
    add(rbox(3, 7, 20, 1.2), chrome, 21.4, 9, 0);
    add(rbox(2, 6, 13, 0.8), dark, 22, 13, 0);
    for (const z of [6.5, -6.5]) add(new THREE.SphereGeometry(2.2, 14, 10), emis, 21.4, 13, z);   // headlights
    for (const z of [6, -6]) add(rbox(1.6, 2.6, 3, 0.6), taill, -20.6, 15, z);                    // taillights
    for (const z of [9.6, -9.6]) add(rbox(1.2, 1.6, 4, 0.4), dark, 6, 22, z);                      // mirrors
    add(rbox(3, 2, 15, 0.8), dark, 0, 30.5, 0);                                                    // light bar
    for (let i = -2; i <= 2; i++) add(new THREE.SphereGeometry(1.1, 10, 8), emis, 1.6, 31, i * 2.7);
    const exh = add(new THREE.CylinderGeometry(1, 1, 7, 8), chrome, -18, 9, 7); exh.rotation.z = Math.PI / 2;

    // detailed wheels: tyre + chromed rim + spokes
    const wheels = [];
    const tireGeo = new THREE.CylinderGeometry(7, 7, 7.6, 26); tireGeo.rotateX(Math.PI / 2);
    const rimGeo = new THREE.CylinderGeometry(3.9, 3.9, 7.9, 18); rimGeo.rotateX(Math.PI / 2);
    const spokeGeo = rbox(1.5, 7.4, 1.5, 0.4);
    for (const [x, z] of [[13, 10.5], [13, -10.5], [-13, 10.5], [-13, -10.5]]) {
      const w = new THREE.Group();
      const t = new THREE.Mesh(tireGeo, rubber); t.castShadow = true; w.add(t);
      w.add(new THREE.Mesh(rimGeo, chrome));
      for (let s = 0; s < 3; s++) { const sp = new THREE.Mesh(spokeGeo, chrome); sp.rotation.z = s * Math.PI / 3; w.add(sp); }
      w.position.set(x, 7, z); g.add(w); wheels.push(w);
    }
    if (isPlayer) { // floating ring so you spot your truck
      const ring = new THREE.Mesh(new THREE.TorusGeometry(15, 1.7, 10, 30), new THREE.MeshStandardMaterial({ color: 0xffe000, emissive: 0xffe000, emissiveIntensity: 1.6 }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 48; g.add(ring); g._marker = ring;
    }
    return { group: g, wheels };
  }

  // ---- per-frame ----
  _resize() {
    const c = this.canvas, w = c.clientWidth || c.width || 800, h = c.clientHeight || c.height || 600;
    this.renderer.setSize(w, h, false);
    if (this.composer) this.composer.setSize(w, h);
    if (this.bloom) this.bloom.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  _draw() {
    if (this.canvas.clientWidth && this.canvas.width !== Math.floor(this.canvas.clientWidth * Math.min(window.devicePixelRatio || 1, 2))) this._resize();
    for (const car of this.sim.cars) {
      const m = this.carMeshes.get(car); if (!m) continue;
      m.group.position.set(car.x, 0, car.y);
      m.group.rotation.y = -car.angle;
      m.group.rotation.z = -(car.slip || 0) * 0.0009; // lean into a drift
      const spin = (car.speedApprox || 0) * 0.0016;
      for (const w of m.wheels) w.rotation.z -= spin;
      if (m.group._marker) { m.group._marker.position.y = 46 + Math.sin(this.sim.time * 6) * 3; m.group._marker.rotation.z += 0.05; }
    }
    // portrait/orbit mode (for showcasing a vehicle)
    if (this.portrait) {
      const car = this.sim.cars[0], t = this.sim.time, ang = 0.7 + t * 0.35, r = 64;
      this.camera.position.set(car.x + Math.cos(ang) * r, 34, car.y + Math.sin(ang) * r);
      this.camera.lookAt(car.x, 15, car.y);
      this.composer.render(); return;
    }
    // damped chase camera behind the player
    const p = this.sim.player;
    if (p) {
      const a = p.angle, fx = Math.cos(a), fz = Math.sin(a);
      const dist = this.chaseDist || 210, hgt = this.camHeight || 132;
      const desired = new THREE.Vector3(p.x - fx * dist, hgt, p.y - fz * dist);
      this.camera.position.lerp(desired, 0.06);
      this._look.lerp(new THREE.Vector3(p.x + fx * 24, 20, p.y + fz * 24), 0.08);
      this.camera.lookAt(this._look);
    }
    this.composer.render();
  }
}

window.Race3D = Race3D;
