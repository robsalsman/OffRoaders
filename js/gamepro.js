/* gamepro.js — "Enhanced" 2.5D race engine (window.RacePro).
 * Same gameplay/career interface as the classic Race, but with:
 *  - drift / understeer physics (lateral slip, handbrake)
 *  - jump ramps (airborne z, gravity, scaling + shadow gap, landing dust)
 *  - pre-rendered shaded truck sprites, dynamic shadows
 *  - persistent skid-mark decals, particle dust/rooster-tails
 *  - textured dirt, berms, camera shake, vignette & warm lighting
 * Drop-in: new RacePro(canvas, {track, perf, aiStrength, onUpdate, onFinish}).
 */
(function () {
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  function angWrap(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }

  function closestOnLoop(pts, px, py) {
    const N = pts.length;
    let best = Infinity, bestProg = 0;
    for (let i = 0; i < N; i++) {
      const a = pts[i], b = pts[(i + 1) % N];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len2 = dx * dx + dy * dy || 1;
      let t = ((px - a.x) * dx + (py - a.y) * dy) / len2;
      t = clamp(t, 0, 1);
      const cx = a.x + dx * t, cy = a.y + dy * t;
      const d = (px - cx) * (px - cx) + (py - cy) * (py - cy);
      if (d < best) { best = d; bestProg = i + t; }
    }
    return { dist: Math.sqrt(best), progress: bestProg };
  }
  function pointAtProgress(pts, prog) {
    const N = pts.length;
    let i = Math.floor(prog) % N; if (i < 0) i += N;
    const t = prog - Math.floor(prog);
    const a = pts[i], b = pts[(i + 1) % N];
    return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
  }
  function tangentAtProgress(pts, prog) {
    const N = pts.length;
    let i = Math.floor(prog) % N; if (i < 0) i += N;
    const a = pts[i], b = pts[(i + 1) % N];
    return Math.atan2(b.y - a.y, b.x - a.x);
  }

  const CAR_COLORS = ["#ffcf33", "#e8482c", "#3aa0ff", "#57d957", "#c46bff", "#ff8e2b"];
  const CAR_W = 40, CAR_H = 24;

  // ---- pre-rendered shaded truck sprite (cached per colour) ----
  const spriteCache = {};
  function truckSprite(color, isPlayer) {
    const key = color + (isPlayer ? "_p" : "");
    if (spriteCache[key]) return spriteCache[key];
    const S = 4; // supersample
    const w = 64, h = 40;
    const cv = document.createElement("canvas");
    cv.width = w * S; cv.height = h * S;
    const g = cv.getContext("2d");
    g.scale(S, S);
    g.translate(w / 2, h / 2);
    // sprite faces +x (right)
    const bodyL = -22, bodyW = 44, bodyT = -13, bodyH = 26;

    function rr(x, y, ww, hh, r) {
      g.beginPath();
      g.moveTo(x + r, y);
      g.arcTo(x + ww, y, x + ww, y + hh, r);
      g.arcTo(x + ww, y + hh, x, y + hh, r);
      g.arcTo(x, y + hh, x, y, r);
      g.arcTo(x, y, x + ww, y, r);
      g.closePath();
    }

    // knobby tyres
    g.fillStyle = "#15110d";
    [[-15, -15], [-15, 9], [12, -15], [12, 9]].forEach(([tx, ty]) => {
      rr(tx, ty, 11, 6, 2); g.fill();
      g.fillStyle = "#2a241d";
      for (let i = 0; i < 4; i++) g.fillRect(tx + 1 + i * 2.6, ty, 1.2, 6);
      g.fillStyle = "#15110d";
    });

    // chassis shadow plate
    g.fillStyle = "rgba(0,0,0,0.35)";
    rr(bodyL - 1, bodyT + 1, bodyW + 2, bodyH, 7); g.fill();

    // body with vertical shading
    const grad = g.createLinearGradient(0, bodyT, 0, bodyT + bodyH);
    grad.addColorStop(0, shade(color, 1.35));
    grad.addColorStop(0.45, color);
    grad.addColorStop(1, shade(color, 0.6));
    g.fillStyle = grad;
    rr(bodyL, bodyT, bodyW, bodyH, 7); g.fill();

    // front nose accent
    g.fillStyle = shade(color, 1.15);
    rr(bodyL + bodyW - 12, bodyT + 2, 10, bodyH - 4, 4); g.fill();

    // cabin / windshield (dark glass with highlight)
    g.fillStyle = "#10141c";
    rr(bodyL + 12, bodyT + 4, 16, bodyH - 8, 4); g.fill();
    g.fillStyle = "rgba(150,200,255,0.35)";
    rr(bodyL + 13, bodyT + 5, 6, bodyH - 10, 2); g.fill();

    // roll cage bars
    g.strokeStyle = "rgba(220,220,220,0.5)";
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(bodyL + 11, bodyT + 4); g.lineTo(bodyL + 11, bodyT + bodyH - 4);
    g.moveTo(bodyL + 28, bodyT + 4); g.lineTo(bodyL + 28, bodyT + bodyH - 4);
    g.stroke();

    // racing stripe
    g.fillStyle = "rgba(255,255,255,0.85)";
    g.fillRect(bodyL + 2, -2, 9, 4);

    // headlights at the front
    g.fillStyle = "#fff6c8";
    g.beginPath(); g.arc(bodyL + bodyW - 2, bodyT + 4, 2, 0, 7); g.fill();
    g.beginPath(); g.arc(bodyL + bodyW - 2, bodyT + bodyH - 4, 2, 0, 7); g.fill();

    // outline
    g.strokeStyle = isPlayer ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.35)";
    g.lineWidth = isPlayer ? 2 : 1.2;
    rr(bodyL, bodyT, bodyW, bodyH, 7); g.stroke();

    // top sheen
    g.fillStyle = "rgba(255,255,255,0.18)";
    rr(bodyL + 2, bodyT + 2, bodyW - 14, 5, 3); g.fill();

    cv._w = w; cv._h = h;
    spriteCache[key] = cv;
    return cv;
  }
  function shade(hex, f) {
    const c = hex.replace("#", "");
    let r = parseInt(c.substr(0, 2), 16), gg = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16);
    r = clamp(Math.round(r * f), 0, 255); gg = clamp(Math.round(gg * f), 0, 255); b = clamp(Math.round(b * f), 0, 255);
    return `rgb(${r},${gg},${b})`;
  }

  // ---- tileable textures (cached per colour so each track theme differs) ----
  const dirtTiles = {}, grassTiles = {};
  function getDirtTile(color) {
    if (dirtTiles[color]) return dirtTiles[color];
    const s = 128, cv = document.createElement("canvas"); cv.width = cv.height = s;
    const g = cv.getContext("2d");
    g.fillStyle = color; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 900; i++) {
      const x = Math.random() * s, y = Math.random() * s;
      g.fillStyle = Math.random() < 0.5 ? "rgba(0,0,0," + (0.04 + Math.random() * 0.1) + ")"
                                        : "rgba(255,255,255," + (0.03 + Math.random() * 0.07) + ")";
      g.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
    dirtTiles[color] = cv; return cv;
  }
  function getGrassTile(color) {
    if (grassTiles[color]) return grassTiles[color];
    const s = 128, cv = document.createElement("canvas"); cv.width = cv.height = s;
    const g = cv.getContext("2d");
    g.fillStyle = color; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 700; i++) {
      const x = Math.random() * s, y = Math.random() * s;
      g.fillStyle = Math.random() < 0.5 ? "rgba(0,0,0,0.22)" : "rgba(255,255,255,0.10)";
      g.fillRect(x, y, 1, 2 + Math.random() * 3);
    }
    grassTiles[color] = cv; return cv;
  }

  class Car {
    constructor(o) {
      Object.assign(this, o);
      this.vx = 0; this.vy = 0; this.z = 0; this.vz = 0;
      this.speedApprox = 0; this.steerS = 0;
      this.lap = 0;
      this.lapProg = this.startProg;
      this.lapProgRaw = this.startProg;
      this._lastProgRaw = this.startProg;
      this.finished = false; this.finishTime = 0; this.position = 0;
      this.lapStart = 0; this.lastLap = null; this.bestLapThisRace = null;
      this.nitro = 100; this.nitroActive = false;
      this.rampCooldown = 0;
      this.slip = 0; this.drifting = false;
      this.wobble = 0;
    }
  }

  class RacePro {
    constructor(canvas, cfg) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.cfg = cfg;
      this.track = cfg.track;
      this.pts = cfg.track.points;
      this.N = this.pts.length;
      this.cars = [];
      this.running = false; this.paused = false;
      this.time = 0; this.countdown = 3.2;
      this.finishOrder = [];
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.input = { left: false, right: false, gas: false, brake: false, nitro: false, drift: false };
      this._bound = {};
      this.particles = [];
      this.shake = 0;

      this._computeBBox();
      this._buildDecal();
      this._buildRamps();
      this._buildScene();
      this._buildCars();
      this._resize();
    }

    _computeBBox() {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of this.pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
      const pad = this.track.width;
      this.bbox = { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
      this.bbox.w = this.bbox.maxX - this.bbox.minX;
      this.bbox.h = this.bbox.maxY - this.bbox.minY;
    }

    _buildDecal() {
      this.decalScale = 0.5;
      const cv = document.createElement("canvas");
      cv.width = Math.ceil(this.bbox.w * this.decalScale);
      cv.height = Math.ceil(this.bbox.h * this.decalScale);
      this.decal = cv;
      this.decalCtx = cv.getContext("2d");
      this._fadeTick = 0;
    }
    _worldToDecal(x, y) {
      return { x: (x - this.bbox.minX) * this.decalScale, y: (y - this.bbox.minY) * this.decalScale };
    }

    _buildRamps() {
      this.ramps = (this.track.ramps || []).map((frac) => {
        const prog = frac * this.N;
        const p = pointAtProgress(this.pts, prog);
        const tan = tangentAtProgress(this.pts, prog);
        return { prog, x: p.x, y: p.y, tan, half: this.track.width * 0.5 };
      });
      // mud / rough patches that slow you down
      this.mud = (this.track.mud || []).map((frac) => {
        const p = pointAtProgress(this.pts, frac * this.N);
        return { x: p.x, y: p.y, r: this.track.width * 0.42 };
      });
    }

    // Pre-render the whole static course (track, berms, ruts, mud, ramps, tyre
    // barriers, start banner, grandstands) to one offscreen canvas. Quality goes
    // up (we can afford expensive detail once) and per-frame cost goes down.
    _buildScene() {
      const b = this.bbox, margin = 320;
      const sx = Math.floor(b.minX - margin), sy = Math.floor(b.minY - margin);
      const w = Math.ceil(b.w + margin * 2), h = Math.ceil(b.h + margin * 2);
      const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
      const g = cv.getContext("2d");
      g.translate(-sx, -sy);
      this.scene = cv; this.sceneX = sx; this.sceneY = sy;

      const th = this.track.theme || { dirt: "#b07a45", dirtDark: "#5a3c20", rut: "#6b4a29" };
      const Wd = this.track.width;
      const path = this._loopPath(0);
      g.lineJoin = "round"; g.lineCap = "round";

      this._paintScenery(g);

      // soft drop shadow under the raised track
      g.save(); g.shadowColor = "rgba(0,0,0,0.5)"; g.shadowBlur = 26; g.shadowOffsetY = 10;
      g.strokeStyle = "rgba(0,0,0,0.5)"; g.lineWidth = Wd + 20; g.stroke(path); g.restore();

      // banked berm: dark base, then a lighter raised lip on top
      g.strokeStyle = th.dirtDark; g.lineWidth = Wd + 24; g.stroke(path);
      g.strokeStyle = shade(th.dirt, 1.16); g.lineWidth = Wd + 12; g.stroke(path);

      // dirt surface (textured)
      const pat = g.createPattern(getDirtTile(th.dirt), "repeat");
      g.strokeStyle = pat || th.dirt; g.lineWidth = Wd; g.stroke(path);

      // edge ambient-occlusion (darker towards the rim) + worn ruts following the line
      g.strokeStyle = "rgba(0,0,0,0.16)"; g.lineWidth = Wd; g.stroke(this._loopPath(0));
      g.globalAlpha = 0.5; g.strokeStyle = th.rut; g.lineWidth = 5;
      for (const off of [-Wd * 0.24, 0, Wd * 0.24]) {
        g.setLineDash([26, 34]); g.stroke(this._loopPath(off));
      }
      g.setLineDash([]); g.globalAlpha = 1;

      this._paintMud(g);
      for (const ramp of this.ramps) this._paintRamp(g, ramp);
      this._paintTyres(g);
      this._paintStartBanner(g);
    }

    // closed path of the centre line, optionally offset along the outward normal
    _loopPath(off) {
      const pts = this.pts, N = pts.length, p = new Path2D();
      const pt = (i) => {
        if (!off) return pts[i];
        const a = pts[(i - 1 + N) % N], b = pts[(i + 1) % N];
        const tx = b.x - a.x, ty = b.y - a.y, l = Math.hypot(tx, ty) || 1;
        return { x: pts[i].x + (-ty / l) * off, y: pts[i].y + (tx / l) * off };
      };
      const s = pt(0); p.moveTo(s.x, s.y);
      for (let i = 1; i < N; i++) { const q = pt(i); p.lineTo(q.x, q.y); }
      p.closePath(); return p;
    }

    _paintMud(g) {
      for (const m of (this.mud || [])) {
        g.fillStyle = "rgba(35,22,10,0.6)";
        g.beginPath(); g.ellipse(m.x, m.y, m.r, m.r * 0.8, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = "rgba(80,58,28,0.55)";
        g.beginPath(); g.ellipse(m.x, m.y, m.r * 0.66, m.r * 0.5, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = "rgba(255,255,255,0.06)";
        g.beginPath(); g.ellipse(m.x - m.r * 0.2, m.y - m.r * 0.15, m.r * 0.3, m.r * 0.2, 0, 0, Math.PI * 2); g.fill();
      }
    }

    _paintRamp(g, ramp) {
      g.save(); g.translate(ramp.x, ramp.y); g.rotate(ramp.tan);
      const w = Math.min(ramp.half * 1.6, this.track.width * 0.8), len = 74;
      const grad = g.createLinearGradient(-len / 2, 0, len / 2, 0);
      grad.addColorStop(0, "#7a4e26"); grad.addColorStop(0.5, "#b3823f"); grad.addColorStop(1, "#d8ab68");
      g.fillStyle = grad; g.fillRect(-len / 2, -w / 2, len, w);
      g.fillStyle = "rgba(255,235,180,0.9)";
      for (let i = -1; i <= 1; i++) {
        const cx = i * 24; g.beginPath();
        g.moveTo(cx - 9, -w / 2 + 6); g.lineTo(cx + 9, 0); g.lineTo(cx - 9, w / 2 - 6);
        g.lineTo(cx - 2, w / 2 - 6); g.lineTo(cx + 16, 0); g.lineTo(cx - 2, -w / 2 + 6);
        g.closePath(); g.fill();
      }
      g.strokeStyle = "rgba(0,0,0,0.35)"; g.lineWidth = 3; g.strokeRect(-len / 2, -w / 2, len, w);
      g.restore();
    }

    // tyre barriers lining both edges of the track — the Super Off Road signature
    _paintTyres(g) {
      const off = this.track.width / 2 + 13, N = this.N;
      let acc = 0, prev = this.pts[0], count = 0;
      for (let s = 0; s < N; s += 0.5) {
        const p = pointAtProgress(this.pts, s);
        acc += Math.hypot(p.x - prev.x, p.y - prev.y); prev = p;
        if (acc >= 46) {
          acc = 0;
          const tan = tangentAtProgress(this.pts, s), nx = -Math.sin(tan), ny = Math.cos(tan);
          this._tyre(g, p.x + nx * off, p.y + ny * off, count);
          this._tyre(g, p.x - nx * off, p.y - ny * off, count);
          count++;
        }
      }
    }
    _tyre(g, x, y, i) {
      g.fillStyle = "rgba(0,0,0,0.4)"; g.beginPath(); g.arc(x + 2, y + 3, 11, 0, 7); g.fill();
      g.fillStyle = "#1b1813"; g.beginPath(); g.arc(x, y, 11, 0, 7); g.fill();
      g.fillStyle = i % 2 ? "#d23b2e" : "#ededed"; g.beginPath(); g.arc(x, y, 6.5, 0, 7); g.fill();
      g.fillStyle = "#0f0d0b"; g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill();
    }

    _paintStartBanner(g) {
      const a = pointAtProgress(this.pts, 0), tan = tangentAtProgress(this.pts, 0);
      const half = this.track.width / 2;
      g.save(); g.translate(a.x, a.y); g.rotate(tan);
      const sq = 15;
      for (let i = -Math.ceil(half / sq); i < Math.ceil(half / sq); i++) {
        g.fillStyle = (i & 1) ? "#fff" : "#1a1a1a"; g.fillRect(-sq, i * sq, sq, sq);
        g.fillStyle = (i & 1) ? "#1a1a1a" : "#fff"; g.fillRect(0, i * sq, sq, sq);
      }
      // banner posts at both ends
      g.fillStyle = "#caa24a";
      g.fillRect(-12, -half - 26, 24, 22); g.fillRect(-12, half + 4, 24, 22);
      g.fillStyle = "#b03020"; g.fillRect(-sq, -half - 22, sq * 2, 16);
      g.fillStyle = "#fff"; g.font = "bold 13px sans-serif"; g.textAlign = "center";
      g.fillText("START", 0, -half - 10);
      g.restore();
    }

    // grandstands set back from the track on the long outer faces
    _paintScenery(g) {
      const cx = (this.bbox.minX + this.bbox.maxX) / 2, cy = (this.bbox.minY + this.bbox.maxY) / 2;
      const rx = this.bbox.w / 2 + 150, ry = this.bbox.h / 2 + 150;
      const spots = [0.35, 1.25, 2.4, 3.5, 4.4, 5.3];
      spots.forEach((ang, i) => {
        const x = cx + Math.cos(ang) * rx, y = cy + Math.sin(ang) * ry;
        this._grandstand(g, x, y, ang, i);
      });
    }
    _grandstand(g, x, y, ang, seed) {
      const CROWD = ["#e6dcc0", "#ffffff", "#f2b8b0", "#bcd0f0", "#ffe7a8", "#cfead0", "#e8c0e0"];
      const w = 250, h = 78;
      g.save(); g.translate(x, y); g.rotate(ang + Math.PI / 2);
      g.fillStyle = "rgba(0,0,0,0.28)"; g.fillRect(-w / 2 + 7, -h / 2 + 9, w, h);
      g.fillStyle = "#6a6e75"; g.fillRect(-w / 2, -h / 2, w, h);
      for (let r = 0; r < 4; r++) {
        const ry = -h / 2 + 9 + r * 15;
        g.fillStyle = r % 2 ? "#7c818a" : "#73787f"; g.fillRect(-w / 2 + 6, ry, w - 12, 11);
        for (let px = -w / 2 + 13; px < w / 2 - 10; px += 11) {
          g.fillStyle = CROWD[((px * 7 + r * 3 + seed * 5) >>> 0) % CROWD.length];
          g.fillRect(px, ry + 2, 5, 7);
        }
      }
      g.fillStyle = "#3b3f45"; g.fillRect(-w / 2, -h / 2, w, 7); // roof lip
      g.strokeStyle = "rgba(0,0,0,0.4)"; g.lineWidth = 3; g.strokeRect(-w / 2, -h / 2, w, h);
      g.restore();
    }

    _buildCars() {
      const startProg = 0.15;
      const tan = tangentAtProgress(this.pts, startProg);
      const normal = tan + Math.PI / 2;
      const roster = this.cfg.roster || [];
      for (let i = 0; i < roster.length; i++) {
        const R = roster[i];
        const isPlayer = R.isPlayer;
        const p = R.perf;
        const lane = (i % 3) - 1, row = Math.floor(i / 3);
        const along = startProg - row * 0.5;
        const gp = pointAtProgress(this.pts, (along + this.N) % this.N);
        const lateral = lane * (this.track.width * 0.26);
        // AI runs a touch slower than the player so a race is winnable while you learn
        const variance = isPlayer ? 1 : (0.9 + Math.random() * 0.05);

        const stats = {
          maxSpeed: 292 * p.maxSpeed * variance,
          accel: 235 * p.accel * variance,
          turn: 3.5 * p.turn,
          grip: clamp(0.83 - (p.grip - 1) * 0.16, 0.7, 0.88),
          offroad: clamp(0.5 + ((p.offroad || 1) - 1) * 0.6, 0.45, 0.9),
          nitroPower: 1.5 * p.nitroPower,
          nitroRefill: 13 * p.nitroRefill,
          drift: p.drift || 1,
        };

        this.cars.push(new Car({
          x: gp.x + Math.cos(normal) * lateral,
          y: gp.y + Math.sin(normal) * lateral,
          angle: tan, color: R.color,
          isPlayer, characterId: R.characterId, name: R.name, vehicleId: R.vehicleId,
          startProg: (along + this.N) % this.N,
          stats, aiAggro: 0.5 + Math.random() * 0.5,
        }));
      }
      this.player = this.cars.find((c) => c.isPlayer) || this.cars[0];
    }

    // ---- lifecycle (mirror classic Race) ----
    start() {
      this.running = true; this._attachInput();
      this.last = performance.now();
      this._loop = this._frame.bind(this);
      requestAnimationFrame(this._loop);
    }
    stop() { this.running = false; this._detachInput(); }
    setPaused(p) { this.paused = p; if (!p && this.running) { this.last = performance.now(); requestAnimationFrame(this._loop); } }

    _frame(now) {
      if (!this.running || this.paused) return;
      let dt = (now - this.last) / 1000; this.last = now;
      dt = Math.min(dt, 0.05);
      this._update(dt);
      this._render();
      if (this.running) requestAnimationFrame(this._loop);
    }

    // ---- input ----
    _attachInput() { window.Input.init(); window.Input.reset(); }
    _detachInput() { window.Input.reset(); }

    // ---- simulation ----
    _update(dt) {
      if (this.countdown > 0) this.countdown -= dt; else this.time += dt;
      const racing = this.countdown <= 0;

      for (const car of this.cars) {
        let ctrl = car.isPlayer ? this._playerControl(car) : this._aiControl(car);
        if (!racing) ctrl = { steer: 0, throttle: 0, brake: 0, nitro: false };
        this._drive(car, ctrl, dt);
        this._trackLogic(car, dt, racing);
      }
      this._separate();
      this._rank();
      this._updateParticles(dt);
      if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 28);
      // fade skid marks occasionally
      if (++this._fadeTick % 8 === 0) {
        const d = this.decalCtx;
        d.globalCompositeOperation = "destination-out";
        d.fillStyle = "rgba(0,0,0,0.05)";
        d.fillRect(0, 0, this.decal.width, this.decal.height);
        d.globalCompositeOperation = "source-over";
      }
      this._emitHud();
    }

    _playerControl(car) {
      return window.Input.resolve(car.angle);
    }
    _aiControl(car) {
      const look = 2.4 + car.speedApprox / 150;
      const tp = pointAtProgress(this.pts, ((car.lapProgRaw + look) % this.N + this.N) % this.N);
      const desired = Math.atan2(tp.y - car.y, tp.x - car.x);
      const diff = angWrap(desired - car.angle);
      const steer = clamp(diff * 2.2, -1, 1);
      const sharp = Math.abs(diff);
      let throttle = sharp > 1.0 ? 0.62 : sharp > 0.55 ? 0.9 : 1;
      if (car._offTrack) throttle *= 0.88;
      // AI uses nitro on flow-y bits AND to power-drift tight corners
      const nitro = car.z <= 0 && car.nitro > 35 &&
        ((sharp < 0.3 && car.aiAggro > 0.45) || (sharp > 0.7 && car.speedApprox > 210));
      return { steer, throttle, brake: 0, nitro };
    }

    _drive(car, ctrl, dt) {
      const s = car.stats;
      const onGround = car.z <= 0.001;
      const f = { x: Math.cos(car.angle), y: Math.sin(car.angle) };
      const r = { x: -Math.sin(car.angle), y: Math.cos(car.angle) };
      let vlong = car.vx * f.x + car.vy * f.y;
      let vlat = car.vx * r.x + car.vy * r.y;

      // nitro
      car.nitroActive = false;
      let maxSpeed = s.maxSpeed, accel = s.accel;
      if (ctrl.nitro && car.nitro > 1 && onGround) {
        car.nitro = Math.max(0, car.nitro - 24 * dt);
        maxSpeed *= s.nitroPower; accel *= 1.7; car.nitroActive = true;
      } else {
        car.nitro = Math.min(100, car.nitro + s.nitroRefill * dt);
      }
      const offFactor = car._offTrack && onGround ? s.offroad : 1;
      maxSpeed *= offFactor;

      // mud / rough patches slow everyone down
      car._inMud = false;
      if (this.mud) for (const m of this.mud) {
        const dx = car.x - m.x, dy = car.y - m.y;
        if (dx * dx + dy * dy < m.r * m.r) { car._inMud = true; break; }
      }
      if (car._inMud && onGround) maxSpeed *= 0.6;

      if (onGround) {
        const th = ctrl.throttle || 0; // analog: stick position sets target speed
        if (th > 0.02) {
          const cap = maxSpeed * Math.max(th, 0.35);
          if (vlong < cap) vlong += accel * dt;
          else vlong = Math.max(cap, vlong - 240 * dt);
        } else {
          vlong -= 150 * dt * Math.sign(vlong || 1);
        }
        if (ctrl.brake > 0) vlong -= 460 * ctrl.brake * dt;
        vlong = clamp(vlong, -130, maxSpeed);
        if (th <= 0.02 && ctrl.brake <= 0 && Math.abs(vlong) < 6) vlong = 0;
      }

      // smooth steering input to take the twitch out (snappy but not jittery)
      car.steerS += (ctrl.steer - car.steerS) * Math.min(1, dt * 16);

      // Drift: holding NITRO while turning breaks the rear loose. Trucks grip
      // normally otherwise. The drift is the FAST line through a corner — it
      // holds a limited slip angle instead of spinning into a donut.
      const autoDrift = onGround && car.nitroActive && Math.abs(car.steerS) > 0.2 && Math.abs(vlong) > 110;
      let gripLat;
      if (!onGround) gripLat = 0.999;
      else if (autoDrift) gripLat = 0.92; // slide, but bleed lateral so it settles
      else gripLat = s.grip * (car._offTrack ? 1.05 : 1);
      vlat *= Math.pow(clamp(gripLat, 0, 0.999), dt * 60);

      // steering authority (mild speed-sensitive wash-out)
      const speedFrac = clamp(Math.abs(vlong) / s.maxSpeed, 0, 1);
      let authority = s.turn * (0.68 + 0.4 * Math.min(1, speedFrac * 1.9));
      authority *= 1 - 0.14 * speedFrac * Math.min(1, Math.abs(car.steerS));
      if (!onGround) authority *= 0.12;

      let dAngle = car.steerS * authority * dt * Math.sign(vlong || 1);
      if (autoDrift) {
        // slip = angle of travel relative to where the nose points
        const slip = angWrap(Math.atan2(car.vy, car.vx) - car.angle);
        const slipMax = 0.5 + ((s.drift || 1) - 1) * 0.5; // drift skill widens the controllable angle
        // strong turn-in while there's slip room; fades to 0 at slipMax so the
        // car settles into a held drift rather than rotating forever
        const room = clamp((slipMax - Math.abs(slip)) / slipMax, 0, 1);
        dAngle = car.steerS * authority * dt * Math.sign(vlong || 1) * (0.7 + 1.3 * room);
        // auto counter-steer if it overshoots, to recover instead of spinning
        if (Math.abs(slip) > slipMax) dAngle += (-slip) * 3.0 * dt;
      }
      car.angle += dAngle;

      // recombine
      car.vx = f.x * vlong + r.x * vlat;
      car.vy = f.y * vlong + r.y * vlat;
      car.speedApprox = Math.abs(vlong);
      car.slip = Math.abs(vlat);
      car.drifting = onGround && car.slip > 70 && car.speedApprox > 80;

      // ---- jumps ----
      if (car.rampCooldown > 0) car.rampCooldown -= dt;
      if (onGround && car.rampCooldown <= 0 && vlong > 150) {
        for (const ramp of this.ramps) {
          const dx = car.x - ramp.x, dy = car.y - ramp.y;
          const along = dx * Math.cos(ramp.tan) + dy * Math.sin(ramp.tan);
          const side = -dx * Math.sin(ramp.tan) + dy * Math.cos(ramp.tan);
          if (Math.abs(along) < 55 && Math.abs(side) < ramp.half) {
            car.vz = clamp(vlong / s.maxSpeed, 0.3, 1.2) * 230;
            car.rampCooldown = 0.8;
            if (car.isPlayer) this.shake = Math.min(this.shake + 2, 6);
            break;
          }
        }
      }
      if (!onGround || car.vz > 0) {
        car.vz -= 620 * dt;
        car.z += car.vz * dt;
        if (car.z <= 0) {
          // landing
          const hard = -car.vz;
          car.z = 0; car.vz = 0;
          if (hard > 120) {
            this._spawnDust(car, 14, 1.2);
            if (car.isPlayer) this.shake = Math.min(this.shake + hard / 40, 9);
            // sideways landing scrubs speed
            const align = Math.abs(Math.cos(Math.atan2(car.vy, car.vx) - car.angle));
            car.vx *= 0.7 + 0.3 * align; car.vy *= 0.7 + 0.3 * align;
          }
        }
      }

      // position
      car.x += car.vx * dt; car.y += car.vy * dt;

      // skid marks + dust
      if (onGround && car.drifting) { this._layStreak(car); this._spawnDust(car, 1, 0.5); }
      else if (onGround && car._offTrack && car.speedApprox > 120) this._spawnDust(car, 1, 0.4);
      else if (onGround && car.nitroActive) this._spawnDust(car, 1, 0.3);
      car.wobble = lerp(car.wobble, car.drifting ? 1 : 0, 0.2);
    }

    _trackLogic(car, dt, racing) {
      const c = closestOnLoop(this.pts, car.x, car.y);

      // invisible edge walls — keep the truck on the dirt, slide along the edge
      const maxOff = this.track.width / 2 - 12;
      if (c.dist > maxOff) {
        const cp = pointAtProgress(this.pts, c.progress);
        let nx = car.x - cp.x, ny = car.y - cp.y;
        const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
        car.x = cp.x + nx * maxOff; car.y = cp.y + ny * maxOff;
        const vn = car.vx * nx + car.vy * ny; // outward velocity
        if (vn > 0) { car.vx -= nx * vn; car.vy -= ny * vn; }
      }
      car._offTrack = false; // walls keep everyone on track now

      let prog = c.progress;
      let delta = prog - (car._lastProgRaw % this.N);
      if (delta < -this.N / 2) delta += this.N; else if (delta > this.N / 2) delta -= this.N;
      car.lapProgRaw += delta; car._lastProgRaw = prog;
      const lapsDone = Math.floor((car.lapProgRaw - car.startProg) / this.N);
      if (racing && lapsDone > car.lap) {
        car.lap = lapsDone;
        if (car.isPlayer) {
          const split = this.time - car.lapStart;
          car.lapStart = this.time;
          car.lastLap = split;
          if (car.bestLapThisRace == null || split < car.bestLapThisRace) car.bestLapThisRace = split;
        }
        if (car.lap >= this.track.laps && !car.finished) {
          car.finished = true; car.finishTime = this.time;
          this.finishOrder.push(car); this._checkRaceEnd();
        }
      }
      car.lapProg = car.lapProgRaw;
    }

    _separate() {
      const minDist = CAR_W * 0.9;
      for (let i = 0; i < this.cars.length; i++)
        for (let j = i + 1; j < this.cars.length; j++) {
          const a = this.cars[i], b = this.cars[j];
          if (Math.abs(a.z - b.z) > 30) continue; // one is airborne over the other
          const dx = b.x - a.x, dy = b.y - a.y;
          let d = Math.hypot(dx, dy);
          if (d < minDist && d > 0.001) {
            const nx = dx / d, ny = dy / d, push = (minDist - d) / 2;
            a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
            const rvn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
            if (rvn < 0) {
              const imp = -rvn * 0.6;
              a.vx -= nx * imp; a.vy -= ny * imp; b.vx += nx * imp; b.vy += ny * imp;
              const scrub = 1 - 0.05 * Math.min(1, -rvn / 320);
              a.vx *= scrub; a.vy *= scrub; b.vx *= scrub; b.vy *= scrub;
            }
          }
        }
    }

    _rank() {
      const sorted = [...this.cars].sort((a, b) => {
        if (a.finished && b.finished) return a.finishTime - b.finishTime;
        if (a.finished) return -1; if (b.finished) return 1;
        return b.lapProg - a.lapProg;
      });
      sorted.forEach((c, i) => (c.position = i + 1));
    }

    _checkRaceEnd() {
      if (this.player.finished) {
        const remaining = this.cars.filter((c) => !this.finishOrder.includes(c)).sort((a, b) => b.lapProg - a.lapProg);
        remaining.forEach((c) => this.finishOrder.push(c));
        this.stop();
        const order = this.finishOrder.map((c) => ({ isPlayer: c.isPlayer, characterId: c.characterId, name: c.name, color: c.color }));
        setTimeout(() => this.cfg.onFinish(order), 350);
      }
    }

    _emitHud() {
      if (!this.cfg.onUpdate) return;
      const p = this.player;
      this.cfg.onUpdate({
        lap: Math.min(p.lap + 1, this.track.laps), laps: this.track.laps,
        pos: p.position, total: this.cars.length, time: this.time,
        nitro: p.nitro, speed: clamp(p.speedApprox / (p.stats.maxSpeed * p.stats.nitroPower), 0, 1),
        countdown: this.countdown, finished: p.finished,
        lapTime: this.time - p.lapStart, lastLap: p.lastLap, bestLap: p.bestLapThisRace, lapsDone: p.lap,
      });
    }

    // ---- particles & decals ----
    _spawnDust(car, n, scale) {
      const back = car.angle + Math.PI;
      for (let i = 0; i < n; i++) {
        if (this.particles.length > 320) break;
        this.particles.push({
          x: car.x + Math.cos(back) * 18 + rand(-6, 6),
          y: car.y + Math.sin(back) * 18 + rand(-6, 6),
          z: car.z + rand(0, 6),
          vx: Math.cos(back) * rand(10, 60) + rand(-30, 30),
          vy: Math.sin(back) * rand(10, 60) + rand(-30, 30),
          vz: rand(10, 60),
          life: 0, max: rand(0.4, 0.9) * (1 + scale),
          size: rand(6, 14) * scale,
          off: car._offTrack,
        });
      }
    }
    _updateParticles(dt) {
      const ps = this.particles;
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i];
        p.life += dt;
        if (p.life >= p.max) { ps.splice(i, 1); continue; }
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.vz -= 80 * dt; p.z = Math.max(0, p.z + p.vz * dt);
        p.vx *= 0.94; p.vy *= 0.94;
        p.size += 14 * dt;
      }
    }
    _layStreak(car) {
      const d = this.decalCtx;
      const r = { x: -Math.sin(car.angle), y: Math.cos(car.angle) };
      [-1, 1].forEach((sgn) => {
        const wx = car.x + r.x * sgn * 7 - Math.cos(car.angle) * 12;
        const wy = car.y + r.y * sgn * 7 - Math.sin(car.angle) * 12;
        const p = this._worldToDecal(wx, wy);
        d.fillStyle = "rgba(30,20,12,0.5)";
        d.beginPath(); d.arc(p.x, p.y, 2.2 * this.decalScale + 1.2, 0, 7); d.fill();
      });
    }

    // ---- rendering ----
    _resize() {
      const c = this.canvas;
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      c.width = Math.floor(c.clientWidth * this.dpr);
      c.height = Math.floor(c.clientHeight * this.dpr);
    }

    _render() {
      const ctx = this.ctx, c = this.canvas;
      if (c.width !== Math.floor(c.clientWidth * this.dpr)) this._resize();
      const W = c.width, H = c.height, p = this.player;
      // Static "set piece" camera: frame the ENTIRE track at once (Super Off Road
      // style) so every truck stays on screen and the world never pans or zooms.
      const b = this.bbox;
      // fit the track into the clear band between the top HUD and the bottom controls
      const topUI = H * 0.16, botUI = H * 0.30, availH = H - topUI - botUI;
      const zoom = Math.min(W / (b.w * 1.06), availH / (b.h * 1.06));
      this._zoom = zoom;
      this.camX = (b.minX + b.maxX) / 2;
      this.camY = (b.minY + b.maxY) / 2;
      const centerY = topUI + availH / 2;
      const shk = this.shake * 0.3; // gentle — the whole track is in view
      const sx = shk ? rand(-shk, shk) : 0;
      const sy = shk ? rand(-shk, shk) : 0;

      const theme = this.track.theme || { ground: "#3f6b2e" };
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      // off-track ground (themed)
      ctx.fillStyle = ctx.createPattern ? ctx.createPattern(getGrassTile(theme.ground), "repeat") : theme.ground;
      ctx.fillRect(0, 0, W, H);

      ctx.save();
      ctx.translate(W / 2 + sx, centerY + sy); // centre track in the clear play band
      ctx.scale(zoom, zoom);
      ctx.translate(-this.camX, -this.camY);

      // pre-rendered static course (track, berms, tyres, ramps, banner, stands)
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.scene, this.sceneX, this.sceneY);
      // dynamic skid decals on top of the dirt
      ctx.drawImage(this.decal, this.bbox.minX, this.bbox.minY, this.bbox.w, this.bbox.h);
      this._drawParticles(ctx, false); // ground dust under cars
      // cars sorted so airborne draw last
      [...this.cars].sort((a, b) => a.z - b.z).forEach((car) => this._drawCar(ctx, car));
      this._drawParticles(ctx, true); // airborne dust over cars

      ctx.restore();

      this._drawVignette(ctx, W, H);
      if (this.countdown > 0) this._drawCountdown(ctx, W, H);
      if (p.z > 4) this._drawAir(ctx, W, H);
    }

    _drawCar(ctx, car) {
      const sprite = (window.makeTruckSprite || truckSprite)(car.vehicleId, car.color, car.isPlayer);
      const lift = car.z;
      const scale = 1 + car.z / 260; // grows when airborne (closer to "camera")
      // shadow on the ground (offset opposite to lift, lighter when high)
      ctx.save();
      ctx.translate(car.x, car.y + lift * 0.25);
      ctx.rotate(car.angle);
      ctx.globalAlpha = clamp(0.4 - car.z / 600, 0.12, 0.4);
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.ellipse(0, 0, CAR_W * 0.55 * (1 + car.z / 500), CAR_H * 0.55 * (1 + car.z / 500), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // nitro flame
      if (car.nitroActive) {
        ctx.save(); ctx.translate(car.x - lift, car.y - lift); ctx.rotate(car.angle);
        const fl = ctx.createLinearGradient(-CAR_W / 2 - 26, 0, -CAR_W / 2, 0);
        fl.addColorStop(0, "rgba(120,220,255,0)"); fl.addColorStop(1, "rgba(120,220,255,0.9)");
        ctx.fillStyle = fl;
        ctx.beginPath(); ctx.moveTo(-CAR_W / 2, -6); ctx.lineTo(-CAR_W / 2 - 26 - Math.random() * 8, 0); ctx.lineTo(-CAR_W / 2, 6); ctx.fill();
        ctx.restore();
      }

      // body (lifted) — the player's truck is drawn a little larger so it stands out
      ctx.save();
      ctx.translate(car.x, car.y - lift);
      ctx.rotate(car.angle + car.wobble * Math.sin(this.time * 30) * 0.04);
      const mul = car.isPlayer ? 1.32 : 1.12;
      const w = CAR_W * scale * mul, h = CAR_H * scale * mul;
      ctx.drawImage(sprite, -w / 2, -h / 2, w, h);
      ctx.restore();

      // player marker: pulsing ring + bobbing arrow so you never lose your truck.
      // Sized in screen pixels (÷zoom) so it stays clear on every track.
      if (car.isPlayer) {
        const k = 1 / (this._zoom || 0.3), pulse = Math.sin(this.time * 6);
        ctx.save();
        ctx.translate(car.x, car.y - lift);
        ctx.strokeStyle = "rgba(255,238,0,0.97)"; ctx.lineWidth = 4 * k;
        ctx.beginPath(); ctx.arc(0, 0, (24 + pulse * 2) * k, 0, Math.PI * 2); ctx.stroke();
        const ay = (-40 + pulse * 4) * k, aw = 16 * k;
        ctx.beginPath();
        ctx.moveTo(-aw, ay - aw); ctx.lineTo(aw, ay - aw); ctx.lineTo(0, ay + 4 * k); ctx.closePath();
        ctx.fillStyle = "#ffee00"; ctx.lineWidth = 3 * k; ctx.strokeStyle = "rgba(0,0,0,0.7)";
        ctx.fill(); ctx.stroke();
        ctx.restore();
      }
    }

    _drawParticles(ctx, airborne) {
      for (const p of this.particles) {
        if ((p.z > 8) !== airborne) continue;
        const a = (1 - p.life / p.max) * 0.5;
        ctx.fillStyle = p.off ? `rgba(120,150,90,${a})` : `rgba(170,135,90,${a})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y - p.z, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    _drawVignette(ctx, W, H) {
      if (!this._vig || this._vig.w !== W || this._vig.h !== H) {
        const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
        const g = cv.getContext("2d");
        const rg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.72);
        rg.addColorStop(0, "rgba(0,0,0,0)"); rg.addColorStop(1, "rgba(0,0,0,0.42)");
        g.fillStyle = rg; g.fillRect(0, 0, W, H);
        // warm top light
        const wl = g.createLinearGradient(0, 0, 0, H);
        wl.addColorStop(0, "rgba(255,220,150,0.06)"); wl.addColorStop(0.5, "rgba(255,220,150,0)");
        g.fillStyle = wl; g.fillRect(0, 0, W, H);
        this._vig = { cv, w: W, h: H };
      }
      ctx.drawImage(this._vig.cv, 0, 0);
    }

    _drawAir(ctx, W, H) {
      ctx.save();
      ctx.textAlign = "center"; ctx.font = `bold ${Math.min(W, H) * 0.05}px Trebuchet MS, sans-serif`;
      ctx.fillStyle = "rgba(255,220,120,0.9)"; ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.lineWidth = 4;
      ctx.strokeText("AIR!", W / 2, H * 0.2); ctx.fillText("AIR!", W / 2, H * 0.2);
      ctx.restore();
    }

    _drawCountdown(ctx, W, H) {
      const n = Math.ceil(this.countdown - 0.2);
      let txt = n > 0 ? String(n) : "GO!";
      if (this.countdown <= 0.2 && this.countdown > -0.6) txt = "GO!";
      ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = `bold ${Math.min(W, H) * 0.22}px Trebuchet MS, sans-serif`;
      ctx.fillStyle = txt === "GO!" ? "#5fd35f" : "#ffb43a";
      ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.lineWidth = 8;
      ctx.strokeText(txt, W / 2, H / 2); ctx.fillText(txt, W / 2, H / 2);
      ctx.restore();
    }
  }

  window.RacePro = RacePro;
})();
