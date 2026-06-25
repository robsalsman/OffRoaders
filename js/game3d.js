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
    this.vehKind = this.sim.vehKind || "truck";
    this.bbox = this.sim.bbox;
    this.carMeshes = new Map();
    this._tmp = new THREE.Vector3();
    this._look = new THREE.Vector3((this.bbox.minX + this.bbox.maxX) / 2, 0, (this.bbox.minY + this.bbox.maxY) / 2);

    this._buildScene();
    this._buildTrack();
    this._buildCars();
    this._buildEnvironment();
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

    // ground — water for the boat circuit, solid terrain otherwise
    let ground;
    if (this.vehKind === "boat") {
      const wmat = new THREE.MeshStandardMaterial({ color: this._toColor(this.theme.ground), roughness: 0.12, metalness: 0.25, envMapIntensity: 1.6 });
      const geo = new THREE.PlaneGeometry(span * 5, span * 5, 48, 48);
      ground = new THREE.Mesh(geo, wmat);
      this.water = geo; this._waterBase = Float32Array.from(geo.attributes.position.array);
    } else {
      const gmat = new THREE.MeshStandardMaterial({ color: this._toColor(this.theme.ground), roughness: 1, metalness: 0 });
      ground = new THREE.Mesh(new THREE.PlaneGeometry(span * 5, span * 5), gmat);
    }
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
    const N = this.sim.pts.length, hw = this.track.width / 2, kind = this.vehKind;
    const yTop = kind === "boat" ? 1.4 : 0.6;
    // surface ribbon
    const pos = [], idx = [];
    for (let i = 0; i < N; i++) {
      const L = this._edge(i, -hw), R = this._edge(i, hw);
      pos.push(L.x, yTop, L.y, R.x, yTop, R.y);
    }
    for (let i = 0; i < N; i++) {
      const a = i * 2, b = ((i + 1) % N) * 2;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    let roadMat;
    if (kind === "boat") roadMat = new THREE.MeshStandardMaterial({ color: this._shade(this._toColor(this.theme.dirt), 0.92), roughness: 0.16, metalness: 0.2, envMapIntensity: 1.3, transparent: true, opacity: 0.55 });
    else roadMat = new THREE.MeshStandardMaterial({ color: this._toColor(this.theme.dirt), roughness: kind === "heli" ? 0.92 : 0.96, metalness: 0 });
    const road = new THREE.Mesh(geo, roadMat);
    road.receiveShadow = true; this.scene.add(road);

    // edges: kerb walls (trucks), low foam (boats), nothing (helis fly the maze)
    if (kind === "truck") for (const sign of [1, -1]) this.scene.add(this._kerbWall(sign, hw + 4, 11));
    else if (kind === "boat") for (const sign of [1, -1]) this.scene.add(this._kerbWall(sign, hw + 2, 3, "#eef4f7", "#cfe0e6"));
  }

  _kerbWall(sign, off, H, ca = "#c43326", cb = "#e9eaef") {
    const N = this.sim.pts.length;
    const pos = [], col = [], idx = [];
    const red = new THREE.Color(ca), white = new THREE.Color(cb);
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

  _shade(c, f) { const x = (c.clone ? c.clone() : new THREE.Color(c)); return x.multiplyScalar(f); }
  _distToTrack(x, y) {
    const p = this.sim.pts; let m = Infinity;
    for (let i = 0; i < p.length; i += 2) { const dx = p[i].x - x, dy = p[i].y - y, d = dx * dx + dy * dy; if (d < m) m = d; }
    return Math.sqrt(m);
  }

  // 3D world dressing
  _buildEnvironment() {
    // boats & helis: the sim already placed buoys/islands/docks/ships/buildings/
    // trees/buttes/peaks (this.sim._props) — build them in 3D.
    if (this.vehKind === "boat" || this.vehKind === "heli") { this._make3DProps(); return; }
    const b = this.bbox, Wd = this.track.width, span = Math.max(b.w, b.h);
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    const ground = this._toColor(this.theme.ground);
    const isGreen = ground.g > ground.r * 1.05 && ground.g > ground.b * 1.05;
    const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), Yx = new THREE.Vector3(0, 1, 0), V = new THREE.Vector3(), S = new THREE.Vector3();
    const place = (mesh, list, yOf, sOf) => {
      mesh.castShadow = true; mesh.receiveShadow = true;
      list.forEach((p, i) => { Q.setFromAxisAngle(Yx, p.rot); V.set(p.x, yOf(p), p.y); const s = sOf(p); S.set(s.x, s.y, s.z); M4.compose(V, Q, S); mesh.setMatrixAt(i, M4); });
      mesh.instanceMatrix.needsUpdate = true; this.scene.add(mesh);
    };

    // scatter positions off the track
    const rocks = [], trees = [];
    const step = 150;
    for (let gx = b.minX - 200; gx <= b.maxX + 200; gx += step) {
      for (let gy = b.minY - 200; gy <= b.maxY + 200; gy += step) {
        const x = gx + (Math.random() * 2 - 1) * 70, y = gy + (Math.random() * 2 - 1) * 70;
        const d = this._distToTrack(x, y);
        if (d < Wd * 0.62 + 30) continue;
        const rot = Math.random() * 6.28;
        if (isGreen && Math.random() < 0.6) trees.push({ x, y, rot, s: 0.7 + Math.random() * 0.8 });
        else rocks.push({ x, y, rot, s: 0.6 + Math.random() * 1.1, fy: 0.7 + Math.random() * 0.6 });
      }
    }
    // boulders (faceted, instanced)
    if (rocks.length) {
      const rockMat = new THREE.MeshStandardMaterial({ color: this._shade(this.theme.groundDark ? this._toColor(this.theme.groundDark) : ground, 0.92), roughness: 1, metalness: 0, flatShading: true });
      const inst = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(22, 0), rockMat, rocks.length);
      place(inst, rocks, () => 6, (p) => ({ x: p.s, y: p.s * p.fy, z: p.s }));
    }
    // trees (trunk + foliage), instanced, on green tracks
    if (trees.length) {
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 1 });
      const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(4, 5, 30, 6), trunkMat, trees.length);
      place(trunk, trees, (p) => 15 * p.s, (p) => ({ x: p.s, y: p.s, z: p.s }));
      const leafMat = new THREE.MeshStandardMaterial({ color: this._shade(ground, 1.15), roughness: 0.9, flatShading: true });
      const leaf = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(26, 0), leafMat, trees.length);
      place(leaf, trees, (p) => 44 * p.s, (p) => ({ x: p.s, y: p.s * 1.1, z: p.s }));
    }

    // grandstands at the ring positions the 2D scene computed
    const stands = this.sim._stands || [];
    for (const s of stands) {
      const g = new THREE.Group(); g.position.set(s.x, 0, s.y); g.rotation.y = -(s.ang + Math.PI / 2);
      const base = new THREE.Mesh(rbox(250, 30, 70, 6), new THREE.MeshStandardMaterial({ color: 0x4a4f57, roughness: 0.9 }));
      base.position.y = 15; base.castShadow = true; base.receiveShadow = true; g.add(base);
      const seat = new THREE.Mesh(new THREE.BoxGeometry(250, 6, 74), new THREE.MeshStandardMaterial({ color: 0x6a6f77, roughness: 0.85 }));
      seat.position.set(0, 34, 0); seat.rotation.x = -0.5; seat.castShadow = true; g.add(seat);
      const roof = new THREE.Mesh(rbox(258, 5, 80, 2), new THREE.MeshStandardMaterial({ color: 0x33373d, metalness: 0.4, roughness: 0.5 }));
      roof.position.set(0, 56, -10); g.add(roof);
      for (let i = 0; i < 2; i++) { const post = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 56, 6), new THREE.MeshStandardMaterial({ color: 0x33373d })); post.position.set((i ? 1 : -1) * 110, 28, -30); post.castShadow = true; g.add(post); }
      this.scene.add(g);
    }

    // distant mountain/mesa ring for backdrop depth (fog fades them)
    const ringR = span * 1.15, mtnMat = new THREE.MeshStandardMaterial({ color: this._shade(ground, 0.7), roughness: 1, flatShading: true });
    const mtnGeo = new THREE.ConeGeometry(1, 1, 5);
    const mtns = new THREE.InstancedMesh(mtnGeo, mtnMat, 16);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * 6.283 + Math.random() * 0.2, r = ringR * (0.9 + Math.random() * 0.4);
      const h = span * (0.16 + Math.random() * 0.16), w = h * (1.0 + Math.random() * 0.6);
      Q.setFromAxisAngle(Yx, Math.random() * 6.28); V.set(cx + Math.cos(a) * r, h / 2 - 10, cy + Math.sin(a) * r); S.set(w, h, w);
      M4.compose(V, Q, S); mtns.setMatrixAt(i, M4);
    }
    mtns.instanceMatrix.needsUpdate = true; this.scene.add(mtns);
  }

  // 3D versions of the buoys/islands/docks/ships (boats) and buildings/trees/
  // buttes/peaks (helis) that the 2D sim already placed in this.sim._props.
  _make3DProps() {
    const props = this.sim._props || [], ground = this._toColor(this.theme.ground);
    const bMat = ["#2b3450", "#39426a", "#222a48", "#3b4566"].map((c) => new THREE.MeshStandardMaterial({ color: new THREE.Color(c), roughness: 0.18, metalness: 0.5, envMapIntensity: 1.6 }));
    const rock = new THREE.MeshStandardMaterial({ color: this._shade(this.theme.groundDark ? this._toColor(this.theme.groundDark) : ground, 0.85), roughness: 1, flatShading: true });
    const snow = new THREE.MeshStandardMaterial({ color: 0xeef3f8, roughness: 0.7, flatShading: true });
    const bark = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 1 });
    const leaf = new THREE.MeshStandardMaterial({ color: 0x2f6b2f, roughness: 0.9, flatShading: true });
    const sand = new THREE.MeshStandardMaterial({ color: 0xd9c27e, roughness: 1 });
    const grass = new THREE.MeshStandardMaterial({ color: 0x3f7a3a, roughness: 0.95, flatShading: true });
    const wood = new THREE.MeshStandardMaterial({ color: 0x7a5a36, roughness: 0.9 });
    const hullM = new THREE.MeshStandardMaterial({ color: 0x6b7682, roughness: 0.55, metalness: 0.35 });
    const cont = ["#c8431f", "#1f7ec8", "#3a9a3a", "#d2a23a"].map((c) => new THREE.MeshStandardMaterial({ color: new THREE.Color(c), roughness: 0.7 }));
    const half = new THREE.PlaneGeometry(0, 0); // unused placeholder
    const addM = (mesh, x, y, z) => { mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; this.scene.add(mesh); return mesh; };

    const hk = this.vehKind === "heli" ? 0.5 : 1; // shorter obstacles read better from the chase cam
    for (const p of props) {
      const t = p.type, h = p.height * hk;
      if (t === "tower") {
        addM(new THREE.Mesh(rbox(p.w, h, p.d, 2), bMat[Math.floor(p.hue * 4) % 4]), p.x, h / 2, p.y);
        const cap = new THREE.Mesh(rbox(p.w * 0.5, 8, p.d * 0.5, 1.5), bMat[(Math.floor(p.hue * 4) + 1) % 4]); cap.position.set(p.x, h + 4, p.y); cap.castShadow = true; this.scene.add(cap); // rooftop unit
      } else if (t === "butte") {
        // angular flat-top mesa (tapered hexagonal prism) reads as rock, not a pillow
        const m = addM(new THREE.Mesh(new THREE.CylinderGeometry(Math.max(p.w, p.d) * 0.38, Math.max(p.w, p.d) * 0.5, h, 6), rock), p.x, h / 2, p.y);
        m.rotation.y = (p.poly ? p.poly[0] : 0.3) * 2;
      } else if (t === "peak") {
        addM(new THREE.Mesh(new THREE.ConeGeometry(p.w / 2, h, 6), rock), p.x, h / 2, p.y);
        const cap = new THREE.Mesh(new THREE.ConeGeometry(p.w / 2 * 0.42, h * 0.34, 6), snow); cap.position.set(p.x, h * 0.83, p.y); cap.castShadow = true; this.scene.add(cap);
      } else if (t === "tree") {
        const s = p.w / 55;
        addM(new THREE.Mesh(new THREE.CylinderGeometry(3 * s, 4.5 * s, 26 * s, 6), bark), p.x, 13 * s, p.y);
        addM(new THREE.Mesh(new THREE.IcosahedronGeometry(p.w * 0.55, 0), leaf), p.x, 26 * s + p.w * 0.45, p.y);
      } else if (t === "island") {
        const r = Math.max(p.w, p.d) / 2;
        const d = addM(new THREE.Mesh(new THREE.SphereGeometry(r, 18, 10, 0, 6.283, 0, Math.PI / 2), sand), p.x, 0.5, p.y); d.scale.y = 0.26;
        const g2 = addM(new THREE.Mesh(new THREE.SphereGeometry(r * 0.66, 14, 8, 0, 6.283, 0, Math.PI / 2), grass), p.x, r * 0.12, p.y); g2.scale.y = 0.3;
      } else if (t === "buoy") {
        addM(new THREE.Mesh(new THREE.ConeGeometry(7, 26, 8), new THREE.MeshStandardMaterial({ color: p.hue > 0.5 ? 0xe23b2f : 0xf2c33a, roughness: 0.5, emissive: p.hue > 0.5 ? 0x3a0c08 : 0x3a3008, emissiveIntensity: 0.4 })), p.x, 13, p.y);
      } else if (t === "dock") {
        addM(new THREE.Mesh(rbox(p.w, 8, p.d, 1.5), wood), p.x, 4, p.y);
      } else if (t === "ship") {
        const grp = new THREE.Group(); grp.position.set(p.x, 0, p.y);
        const hl = new THREE.Mesh(rbox(p.w, h, p.d, 3), hullM); hl.position.y = h / 2; hl.castShadow = true; grp.add(hl);
        for (let i = 0; i < 4; i++) { const c = new THREE.Mesh(new THREE.BoxGeometry(p.w * 0.13, 10, p.d * 0.5), cont[i % 4]); c.position.set(-p.w * 0.24 + i * p.w * 0.16, h + 5, 0); c.castShadow = true; grp.add(c); }
        this.scene.add(grp);
      }
    }
  }

  // ---- vehicles ----
  _buildCars() {
    for (const car of this.sim.cars) {
      const col = this._toColor(car.color);
      const m = this.vehKind === "boat" ? this._makeBoat(col, car.isPlayer)
        : this.vehKind === "heli" ? this._makeHeli(col, car.isPlayer)
          : this._makeTruck(col, car.isPlayer);
      m.kind = this.vehKind;
      this.scene.add(m.group);
      this.carMeshes.set(car, m);
    }
  }

  _vmats(color) {
    return {
      paint: new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.3, envMapIntensity: 1.3 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x14181f, metalness: 0.45, roughness: 0.5 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x243246, metalness: 0.55, roughness: 0.07, envMapIntensity: 1.8 }),
      chrome: new THREE.MeshStandardMaterial({ color: 0xcfd4da, metalness: 0.95, roughness: 0.2 }),
    };
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

  _makeBoat(color, isPlayer) {
    const g = new THREE.Group();
    const { paint, dark, glass, chrome } = this._vmats(color);
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f5f7, roughness: 0.4, metalness: 0.1 });
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };

    add(rbox(34, 9, 19, 5), paint, -1, 6, 0);        // hull
    add(rbox(10, 7, 15, 4), paint, 16, 5.5, 0);      // tapered bow
    add(rbox(6, 6, 9, 3), paint, 21.5, 5, 0);        // bow point
    add(rbox(30, 3, 17, 2), white, -2, 11, 0);       // deck
    add(rbox(12, 5, 13, 3), dark, -7, 11, 0);        // cockpit well
    const ws = add(rbox(2, 6, 12, 1), glass, 3, 13, 0); ws.rotation.z = -0.4;  // windshield
    add(rbox(7, 6, 9, 2), dark, -19, 7, 0);          // outboard motor
    add(new THREE.CylinderGeometry(1.6, 1.6, 8, 8), chrome, -23, 4, 0).rotation.z = Math.PI / 2;
    for (const z of [9.4, -9.4]) add(rbox(36, 1.6, 1.6, 0.6), white, -2, 8, z); // rub-rails
    // wake plane on the water behind the transom
    const wake = new THREE.Mesh(new THREE.PlaneGeometry(26, 40), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, roughness: 0.6, depthWrite: false }));
    wake.rotation.x = -Math.PI / 2; wake.position.set(-40, 1.5, 0); g.add(wake);
    if (isPlayer) { const ring = new THREE.Mesh(new THREE.TorusGeometry(15, 1.7, 10, 30), new THREE.MeshStandardMaterial({ color: 0xffe000, emissive: 0xffe000, emissiveIntensity: 1.6 })); ring.rotation.x = -Math.PI / 2; ring.position.y = 40; g.add(ring); g._marker = ring; }
    return { group: g, wheels: [], wake };
  }

  _makeHeli(color, isPlayer) {
    const g = new THREE.Group();
    const { paint, dark, glass, chrome } = this._vmats(color);
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };

    add(rbox(30, 13, 16, 6), paint, 0, 6, 0);         // fuselage pod
    add(rbox(10, 10, 12, 4), paint, 16, 5, 0);        // nose
    add(rbox(13, 9, 13, 4), glass, 9, 7, 0);          // canopy bubble
    // tail boom + fin
    const boom = add(new THREE.CylinderGeometry(2.6, 1.8, 30, 8), dark, -23, 8, 0); boom.rotation.z = Math.PI / 2;
    add(rbox(7, 11, 2, 1), paint, -37, 11, 0);        // tail fin
    // skids
    for (const z of [9, -9]) add(new THREE.CylinderGeometry(1.2, 1.2, 34, 6), chrome, -2, -7, z).rotation.z = Math.PI / 2;
    for (const [x, z] of [[8, 9], [-10, 9], [8, -9], [-10, -9]]) { const s = add(new THREE.CylinderGeometry(0.9, 0.9, 9, 6), dark, x, -2, z); }
    // main rotor (spins): hub + 4 blades + faint disc
    const rotor = new THREE.Group(); rotor.position.set(0, 16, 0);
    rotor.add(new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 4, 8), chrome));
    for (let i = 0; i < 2; i++) { const bl = new THREE.Mesh(rbox(60, 1.2, 4.5, 0.4), dark); bl.rotation.y = i * Math.PI / 2; rotor.add(bl); }
    const disc = new THREE.Mesh(new THREE.CircleGeometry(30, 24), new THREE.MeshStandardMaterial({ color: 0xdfe6f0, transparent: true, opacity: 0.12, roughness: 1, depthWrite: false })); disc.rotation.x = -Math.PI / 2; disc.position.y = 1.5; rotor.add(disc);
    g.add(rotor);
    // tail rotor (spins) on the fin
    const tailRotor = new THREE.Group(); tailRotor.position.set(-38, 11, 2);
    for (let i = 0; i < 2; i++) { const bl = new THREE.Mesh(rbox(2, 16, 1.4, 0.4), dark); bl.rotation.x = i * Math.PI / 2; tailRotor.add(bl); }
    g.add(tailRotor);
    if (isPlayer) { const ring = new THREE.Mesh(new THREE.TorusGeometry(15, 1.7, 10, 30), new THREE.MeshStandardMaterial({ color: 0xffe000, emissive: 0xffe000, emissiveIntensity: 1.6 })); ring.rotation.x = -Math.PI / 2; ring.position.y = 30; g.add(ring); g._marker = ring; }
    return { group: g, wheels: [], rotor, tailRotor };
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
    const t = this.sim.time, kind = this.vehKind; let ci = 0;
    for (const car of this.sim.cars) {
      const m = this.carMeshes.get(car); if (!m) continue; ci++;
      m.group.rotation.y = -car.angle;
      if (kind === "heli") {
        m.group.position.set(car.x, 24 + Math.sin(t * 2.4 + ci) * 2.4, car.y);
        m.group.rotation.z = -(car.slip || 0) * 0.0013;                 // bank into turns
        m.group.rotation.x = -Math.min(0.16, (car.speedApprox || 0) * 0.0007); // nose-down with speed
        if (m.rotor) m.rotor.rotation.y += 1.1;
        if (m.tailRotor) m.tailRotor.rotation.x += 1.6;
      } else if (kind === "boat") {
        m.group.position.set(car.x, Math.sin(t * 3 + ci) * 1.3, car.y);
        m.group.rotation.z = -(car.slip || 0) * 0.0012 + Math.sin(t * 2 + ci) * 0.03;
        m.group.rotation.x = Math.sin(t * 2.4 + ci) * 0.02 - Math.min(0.13, (car.speedApprox || 0) * 0.0006); // bow lifts with speed
        if (m.wake) m.wake.scale.y = 0.5 + Math.min(2.6, (car.speedApprox || 0) / 90);
      } else {
        m.group.position.set(car.x, (car.z || 0), car.y);
        m.group.rotation.z = -(car.slip || 0) * 0.0009;
        const spin = (car.speedApprox || 0) * 0.0016;
        for (const w of m.wheels) w.rotation.z -= spin;
      }
      if (m.group._marker) { m.group._marker.rotation.z += 0.05; }
    }
    // gentle animated swell on the water
    if (this.water) {
      const pos = this.water.attributes.position, base = this._waterBase;
      for (let i = 0; i < pos.count; i++) { const x = base[i * 3], y = base[i * 3 + 1]; pos.array[i * 3 + 2] = Math.sin(x * 0.012 + t * 1.5) * 3 + Math.cos(y * 0.015 + t * 1.2) * 3; }
      pos.needsUpdate = true; this.water.computeVertexNormals();
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
      const dist = this.chaseDist || (kind === "heli" ? 200 : 210);
      const hgt = this.camHeight || (kind === "heli" ? 150 : kind === "boat" ? 118 : 132);
      const ly = kind === "heli" ? 26 : 20;
      const desired = new THREE.Vector3(p.x - fx * dist, hgt, p.y - fz * dist);
      this.camera.position.lerp(desired, 0.06);
      this._look.lerp(new THREE.Vector3(p.x + fx * 24, ly, p.y + fz * 24), 0.08);
      this.camera.lookAt(this._look);
      // speed/nitro FOV punch for a sense of pace
      const tFov = 55 + (p.nitroActive ? 9 : 0) + Math.min(7, (p.speedApprox || 0) / 60);
      this.camera.fov += (tFov - this.camera.fov) * 0.1; this.camera.updateProjectionMatrix();
    }
    this.composer.render();
  }
}

window.Race3D = Race3D;
