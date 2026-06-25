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

  // Measure the on-screen HUD bar and controls (device px) so the track is fitted
  // strictly between them and never overlaps. Falls back to fractions if unmeasured.
  function uiBands(H, dpr, touch) {
    let top = H * 0.12, bot = touch ? H * 0.28 : H * 0.05;
    try {
      const bar = document.getElementById("hud-bar");
      if (bar) { const r = bar.getBoundingClientRect(); if (r.height) top = (r.bottom + 6) * dpr; }
      if (touch) {
        let minTop = Infinity;
        for (const id of ["stick-base", "btn-nitro", "wheel"]) {
          const e = document.getElementById(id);
          if (e) { const r = e.getBoundingClientRect(); if (r.height) minTop = Math.min(minTop, r.top); }
        }
        if (isFinite(minTop)) bot = H - (minTop - 6) * dpr;
      }
    } catch (e) { /* keep fallback */ }
    top = Math.max(0, Math.min(top, H * 0.42));
    bot = Math.max(0, Math.min(bot, H * 0.5));
    return { top, bot };
  }

  // min distance from a point to a closed polyline (for the track-mask walls)
  function distToPolyline(pts, px, py) {
    const N = pts.length; let best = Infinity;
    for (let i = 0; i < N; i++) {
      const a = pts[i], b = pts[(i + 1) % N];
      const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
      let t = ((px - a.x) * dx + (py - a.y) * dy) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cx = a.x + dx * t, cy = a.y + dy * t;
      const d = (px - cx) * (px - cx) + (py - cy) * (py - cy);
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

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
  // search only segments near the car's current progress, so at a figure-8
  // crossing it follows its own branch instead of snapping to the other one.
  function closestOnLoopLocal(pts, px, py, near, win) {
    const N = pts.length;
    let best = Infinity, bestProg = near;
    const start = Math.floor(near) - win;
    for (let k = 0; k <= 2 * win; k++) {
      const i = ((start + k) % N + N) % N;
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
      // which kind of craft is racing here (truck / boat / heli) — drives the
      // wall style, surface effects and boundary feel.
      this.vehKind = (window.getVehicle && cfg.roster && cfg.roster[0]
        ? (window.getVehicle(cfg.roster[0].vehicleId) || {}).kind : null) || "truck";
      this.truckScale = clamp(this.track.width / 175, 0.5, 1); // shrink trucks on narrow tracks
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
      this.floats = [];        // floating "+$" pickup texts
      this.cashCollected = 0;  // bonus cash from $ pickups this race
      this.shake = 0;

      this._computeBBox();
      this._buildDecal();
      this._buildRamps();
      this._buildPickups();
      this._buildWalls();
      this._buildScene();
      this._buildMounds();
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
      // a hovering helicopter never hits a ramp — no jumps on the heli circuit
      this.ramps = (this.vehKind === "heli" ? [] : (this.track.ramps || [])).map((frac) => {
        const prog = frac * this.N;
        const p = pointAtProgress(this.pts, prog);
        const tan = tangentAtProgress(this.pts, prog);
        return { prog, x: p.x, y: p.y, tan, half: this.track.width * 0.5 };
      });
      // hazard patches (mud / water / snow / sand). Offset to one side and sized
      // so a clean racing lane always remains on the far side — avoiding them is
      // strategy, not a roadblock.
      this.hazardType = this.track.surface || "mud";
      this.mud = (this.track.mud || []).map((frac, i) => {
        const prog = frac * this.N;
        const p = pointAtProgress(this.pts, prog), tan = tangentAtProgress(this.pts, prog);
        const side = (i % 2) ? 1 : -1;
        const off = side * this.track.width * 0.28;
        return { x: p.x - Math.sin(tan) * off, y: p.y + Math.cos(tan) * off, r: this.track.width * 0.34, side };
      });
      // whoops: short rough sections that make the truck chatter & hop
      // washboard "whoops" are a ground-terrain effect — none for hovering helis
      this.whoops = (this.vehKind === "heli" ? [] : (this.track.whoops || [])).map((frac) => {
        const prog = frac * this.N;
        return { prog, len: 6 }; // length in progress units
      });
    }

    // gold $ pickups spread around the lap, offset to alternating sides so you
    // have to steer for them. Collected by the player for bonus cash; respawn each lap.
    _buildPickups() {
      const n = 9;
      this.pickups = [];
      for (let i = 0; i < n; i++) {
        const frac = (i + 0.5) / n;
        const prog = frac * this.N;
        const p = pointAtProgress(this.pts, prog);
        const tan = tangentAtProgress(this.pts, prog);
        const lane = (i % 3) - 1; // -1,0,1
        const off = lane * (this.track.width * 0.26);
        this.pickups.push({
          x: p.x - Math.sin(tan) * off, y: p.y + Math.cos(tan) * off,
          taken: false, value: 25, phase: i,
        });
      }
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

      this._paintHazards(g);
      this._paintWhoops(g);
      for (const ramp of this.ramps) this._paintRamp(g, ramp);
      this._paintBarriers(g);
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

    _paintHazards(g) {
      const T = this.hazardType;
      const palette = {
        mud: ["rgba(35,22,10,0.62)", "rgba(80,58,28,0.55)", "rgba(255,255,255,0.06)"],
        water: ["rgba(28,70,110,0.55)", "rgba(60,120,170,0.5)", "rgba(220,245,255,0.22)"],
        snow: ["rgba(225,232,240,0.85)", "rgba(245,250,255,0.8)", "rgba(255,255,255,0.5)"],
        sand: ["rgba(150,120,60,0.5)", "rgba(190,160,95,0.5)", "rgba(255,245,210,0.18)"],
      }[T] || palette_mud_fallback();
      function palette_mud_fallback() { return ["rgba(35,22,10,0.62)", "rgba(80,58,28,0.55)", "rgba(255,255,255,0.06)"]; }
      for (const m of (this.mud || [])) {
        g.fillStyle = palette[0];
        g.beginPath(); g.ellipse(m.x, m.y, m.r, m.r * 0.8, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = palette[1];
        g.beginPath(); g.ellipse(m.x, m.y, m.r * 0.66, m.r * 0.5, 0, 0, Math.PI * 2); g.fill();
        if (T === "water") { // ripple rings
          g.strokeStyle = palette[2]; g.lineWidth = 2;
          for (const rr of [0.4, 0.7]) { g.beginPath(); g.ellipse(m.x, m.y, m.r * rr, m.r * rr * 0.78, 0, 0, Math.PI * 2); g.stroke(); }
        } else {
          g.fillStyle = palette[2];
          g.beginPath(); g.ellipse(m.x - m.r * 0.2, m.y - m.r * 0.15, m.r * 0.3, m.r * 0.2, 0, 0, Math.PI * 2); g.fill();
        }
      }
    }

    // whoops: a run of small ridges across the track that make trucks chatter
    _paintWhoops(g) {
      const half = this.track.width / 2 - 6;
      for (const wp of (this.whoops || [])) {
        for (let s = -wp.len / 2; s <= wp.len / 2; s += 0.7) {
          const p = pointAtProgress(this.pts, (wp.prog + s + this.N) % this.N);
          const tan = tangentAtProgress(this.pts, (wp.prog + s + this.N) % this.N);
          g.save(); g.translate(p.x, p.y); g.rotate(tan);
          g.fillStyle = "rgba(0,0,0,0.22)"; g.fillRect(-5, -half, 4, half * 2);
          g.fillStyle = "rgba(255,240,210,0.28)"; g.fillRect(-1, -half, 4, half * 2);
          g.restore();
        }
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

    // Build walls from the track region's boundary using marching squares on the
    // signed-distance field (SDF = half - dist-to-centreline). Smooth contour segments,
    // and the boundary can't fold across the track on tight turns.
    _buildWalls() {
      const half = this.track.width / 2 + 5, b = this.bbox;
      const cell = Math.max(10, this.track.width / 8);
      const x0 = b.minX - cell * 2, y0 = b.minY - cell * 2;
      const cols = Math.ceil((b.w + cell * 4) / cell), rows = Math.ceil((b.h + cell * 4) / cell);
      const gw = cols + 1, gh = rows + 1, sdf = new Float32Array(gw * gh);
      for (let r = 0; r < gh; r++) for (let c = 0; c < gw; c++) {
        sdf[r * gw + c] = half - distToPolyline(this.pts, x0 + c * cell, y0 + r * cell);
      }
      let cross = null;
      if (this.track.bridge) cross = pointAtProgress(this.pts, ((this.track.bridge[0] + this.track.bridge[1]) / 2) * this.N);
      const clr2 = (this.track.width * 1.5) ** 2;
      const cases = { 1: ["L", "B"], 2: ["B", "R"], 3: ["L", "R"], 4: ["T", "R"], 5: ["T", "R", "B", "L"], 6: ["T", "B"], 7: ["T", "L"], 8: ["T", "L"], 9: ["T", "B"], 10: ["T", "L", "B", "R"], 11: ["T", "R"], 12: ["L", "R"], 13: ["B", "R"], 14: ["L", "B"] };
      const edges = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const x = x0 + c * cell, y = y0 + r * cell;
        const vTL = sdf[r * gw + c], vTR = sdf[r * gw + c + 1], vBR = sdf[(r + 1) * gw + c + 1], vBL = sdf[(r + 1) * gw + c];
        const idx = (vTL > 0 ? 8 : 0) | (vTR > 0 ? 4 : 0) | (vBR > 0 ? 2 : 0) | (vBL > 0 ? 1 : 0);
        const k = cases[idx]; if (!k) continue;
        const pt = (e) => {
          if (e === "T") { const t = vTL / (vTL - vTR); return [x + t * cell, y]; }
          if (e === "R") { const t = vTR / (vTR - vBR); return [x + cell, y + t * cell]; }
          if (e === "B") { const t = vBL / (vBL - vBR); return [x + t * cell, y + cell]; }
          const t = vTL / (vTL - vBL); return [x, y + t * cell];
        };
        for (let i = 0; i < k.length; i += 2) {
          const p = pt(k[i]), q = pt(k[i + 1]);
          const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
          if (cross && ((mx - cross.x) ** 2 + (my - cross.y) ** 2) < clr2) continue;
          edges.push({ x1: p[0], y1: p[1], x2: q[0], y2: q[1], mx, my });
        }
      }
      this._wallEdges = edges;
    }

    // red & white striped barrier walls along the track-region boundary
    _isWater() { return !!{ open: 1, lagoon: 1, delta: 1, harbor: 1 }[this.track.env]; }
    // kerb walls for trucks, a foam channel edge for boats, nothing for helis
    // (their course is bounded by the obstacle maze, not a wall).
    _wallMode() { return this.vehKind === "heli" ? "none" : this.vehKind === "boat" ? "foam" : "kerb"; }

    _paintBarriers(g) {
      g.lineCap = "round"; g.lineJoin = "round";
      const mode = this._wallMode();
      if (mode === "none") return; // helis fly through obstacles — no kerb
      if (mode === "foam") { // waterway: a foamy channel edge, not a striped kerb
        const th = this.track.theme;
        g.strokeStyle = shade(th.ground, 0.5); g.lineWidth = 13;
        for (const e of this._wallEdges) { g.beginPath(); g.moveTo(e.x1, e.y1); g.lineTo(e.x2, e.y2); g.stroke(); }
        g.strokeStyle = "rgba(235,245,255,0.7)"; g.lineWidth = 5; // foam line
        for (const e of this._wallEdges) { g.beginPath(); g.moveTo(e.x1, e.y1); g.lineTo(e.x2, e.y2); g.stroke(); }
        return;
      }
      // dark base first (so the kerb sits on a continuous shadow)
      g.strokeStyle = "rgba(0,0,0,0.5)"; g.lineWidth = 20;
      for (const e of this._wallEdges) { g.beginPath(); g.moveTo(e.x1, e.y1); g.lineTo(e.x2, e.y2); g.stroke(); }
      for (const e of this._wallEdges) {
        const red = (Math.floor((e.mx + e.my) / 34) % 2) === 0;
        g.strokeStyle = red ? "#d22f2f" : "#edeef2"; g.lineWidth = 14;
        g.beginPath(); g.moveTo(e.x1, e.y1); g.lineTo(e.x2, e.y2); g.stroke();
      }
    }
    _oldPaintBarriers(g) {
      const off = this.track.width / 2 + 5;
      let cross = null;
      if (this.track.bridge) cross = pointAtProgress(this.pts, ((this.track.bridge[0] + this.track.bridge[1]) / 2) * this.N);
      const clear = this.track.width * 1.5;
      for (const side of [off, -off]) {
        // build the offset edge as a series of points so we can break it at a bridge
        const segs = this._edgePolyline(side, cross, clear);
        g.lineCap = "round"; g.lineJoin = "round";
        for (const pl of segs) {
          const path = new Path2D();
          path.moveTo(pl[0].x, pl[0].y);
          for (let i = 1; i < pl.length; i++) path.lineTo(pl[i].x, pl[i].y);
          // shadow / dark base (depth)
          g.strokeStyle = "rgba(0,0,0,0.5)"; g.lineWidth = 17; g.stroke(path);
          // white kerb base
          g.strokeStyle = "#edeef2"; g.lineWidth = 12; g.stroke(path);
          // red stripes dashed over the white
          g.strokeStyle = "#d22f2f"; g.lineWidth = 12;
          g.setLineDash([20, 20]); g.lineDashOffset = side > 0 ? 0 : 20;
          g.stroke(path); g.setLineDash([]); g.lineDashOffset = 0;
          // bright top edge so the kerb reads as a raised wall
          g.strokeStyle = "rgba(255,255,255,0.4)"; g.lineWidth = 3; g.stroke(path);
        }
      }
    }
    // offset edge points, split into runs that skip a gap around the bridge crossing
    _edgePolyline(off, cross, clear) {
      const N = this.N, runs = []; let run = [];
      for (let i = 0; i <= N; i++) {
        const s = i % N;
        const a = this.pts[(s - 1 + N) % N], b = this.pts[(s + 1) % N];
        const tx = b.x - a.x, ty = b.y - a.y, l = Math.hypot(tx, ty) || 1;
        const p = { x: this.pts[s].x + (-ty / l) * off, y: this.pts[s].y + (tx / l) * off };
        if (cross && Math.hypot(p.x - cross.x, p.y - cross.y) < clear) {
          if (run.length > 1) runs.push(run);
          run = [];
        } else { run.push(p); }
      }
      if (run.length > 1) runs.push(run);
      return runs;
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

    // grandstands, hay bales, sponsor banners, a parked-rig paddock & start crowd
    _paintScenery(g) {
      const cx = (this.bbox.minX + this.bbox.maxX) / 2, cy = (this.bbox.minY + this.bbox.maxY) / 2;
      this._cx = cx; this._cy = cy;
      // aerial circuits get a real environment (city / mesa / jungle / mountains)
      // instead of the stadium grandstands & paddock.
      if (this.track.env) { this._paintEnvScenery(g); return; }
      const rx = this.bbox.w / 2 + 150, ry = this.bbox.h / 2 + 150;
      const spots = [0.35, 1.25, 2.4, 3.5, 4.4, 5.3];
      this._stands = [];
      spots.forEach((ang, i) => {
        const x = cx + Math.cos(ang) * rx, y = cy + Math.sin(ang) * ry;
        this._stands.push({ x, y, ang, i });
        this._grandstand(g, x, y, ang, i);
      });
      // sponsor banners laid along the outer barrier at a couple of spots
      this._banner(g, 0.22, "OFFROADERS", "#c8341f");
      this._banner(g, 0.72, "SUPER 4×4", "#1f7ec8");
      // hay bales tucked into the infield at a few corners
      [0.1, 0.45, 0.82].forEach((f) => this._hayCluster(g, f));
      // parked rigs paddock in the infield near the start line
      this._paddock(g);
    }

    // ---- environment scenery (aerial & waterway circuits) ----
    _buildEnvProps() {
      const env = this.track.env, b = this.bbox, Wd = this.track.width, R = () => Math.random();
      const poly = () => Array.from({ length: 8 }, () => 0.78 + R() * 0.44);
      const island = () => ({ type: "island", w: 120 + R() * 170, d: 120 + R() * 150, height: 22 + R() * 22, hue: R(), poly: poly() });
      const big = {
        urban: () => ({ type: "tower", w: 58 + R() * 66, d: 58 + R() * 66, height: 110 + R() * 170, hue: R() }),
        mesa: () => ({ type: "butte", w: 96 + R() * 120, d: 96 + R() * 120, height: 72 + R() * 120, hue: R(), poly: poly() }),
        mountain: () => ({ type: "peak", w: 150 + R() * 150, d: 150 + R() * 150, height: 170 + R() * 200, hue: R(), poly: poly() }),
        jungle: () => ({ type: "tree", w: 52 + R() * 64, d: 52 + R() * 64, height: 64 + R() * 74, hue: R() }),
        open: island, lagoon: island, delta: island,
        harbor: () => (R() < 0.5
          ? { type: "dock", w: 80 + R() * 60, d: 46 + R() * 28, height: 10 + R() * 6, hue: R() }
          : { type: "ship", w: 130 + R() * 90, d: 46 + R() * 20, height: 22 + R() * 16, hue: R() }),
      }[env];
      const water = !!{ open: 1, lagoon: 1, delta: 1, harbor: 1 }[env];
      const heliLand = !!{ urban: 1, mesa: 1, jungle: 1, mountain: 1 }[env];
      const clearance = (water ? Wd * 0.62 + 96 : heliLand ? Wd * 0.5 + 30 : Wd * 0.6 + 64);
      const step = env === "urban" ? 184 : env === "jungle" ? 150 : water ? 300 : 244;
      const jit = env === "urban" ? 34 : 110;
      const props = [];
      for (let gx = b.minX - 130; gx <= b.maxX + 120; gx += step) {
        for (let gy = b.minY - 130; gy <= b.maxY + 120; gy += step) {
          const x = gx + (R() * 2 - 1) * jit, y = gy + (R() * 2 - 1) * jit;
          if (closestOnLoop(this.pts, x, y).dist < clearance) continue;
          props.push(Object.assign({ x, y }, big()));
        }
      }
      // helicopters: line BOTH banks with the biome obstacle so the maze of
      // buildings / trees / canyon walls IS the course boundary (no kerb).
      if (heliLand) {
        const n = this.N, gap = env === "urban" ? 26 : env === "mountain" ? 36 : 22;
        for (let f = 0; f < 1; f += 0.03) {
          const prog = f * n, p = pointAtProgress(this.pts, prog), tan = tangentAtProgress(this.pts, prog);
          const nx = -Math.sin(tan), ny = Math.cos(tan);
          for (const side of [1, -1]) {
            const pr = big(), half = Math.max(pr.w, pr.d) / 2, off = Wd / 2 + gap + half * 0.55;
            if (env === "urban") pr.height *= 0.72; // shorter near the lane so it doesn't occlude
            const x = p.x + nx * side * off, y = p.y + ny * side * off;
            if (closestOnLoop(this.pts, x, y).dist < Wd * 0.46) continue; // don't drop into a neighbouring corridor
            props.push(Object.assign({ x, y }, pr));
          }
        }
      }
      // waterways: line the channel with red/green marker buoys on both banks
      if (water) {
        const off = Wd / 2 + 22, n = this.N;
        for (let f = 0; f < 1; f += 0.05) {
          const prog = f * n, p = pointAtProgress(this.pts, prog), tan = tangentAtProgress(this.pts, prog);
          const nx = -Math.sin(tan), ny = Math.cos(tan);
          props.push({ type: "buoy", x: p.x + nx * off, y: p.y + ny * off, w: 14, d: 14, height: 26, hue: 0.8 });
          props.push({ type: "buoy", x: p.x - nx * off, y: p.y - ny * off, w: 14, d: 14, height: 26, hue: 0.2 });
        }
      }
      this._props = props;
    }

    _paintEnvScenery(g) {
      this._stands = null; // no grandstands on an aerial course
      this._buildEnvProps();
      // far -> near so nearer props overlap correctly in the baked top-down image
      const list = [...this._props].sort((a, b) => a.y - b.y);
      for (const p of list) this._propTopDown(g, p);
    }

    _fillBlob(g, x, y, r, poly, sqY) {
      g.beginPath();
      for (let i = 0; i < poly.length; i++) {
        const a = (i / poly.length) * Math.PI * 2, rr = r * poly[i];
        const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr * (sqY || 1);
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.closePath(); g.fill();
    }

    _propTopDown(g, p) {
      const th = this.track.theme;
      if (p.type === "tower") {
        const w = p.w, d = p.d, base = ["#39415a", "#454d68", "#2e3650", "#4c5470"][Math.floor(p.hue * 4) % 4];
        g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(p.x - w / 2 + 12, p.y - d / 2 + 14, w, d); // long shadow
        g.fillStyle = base; g.fillRect(p.x - w / 2, p.y - d / 2, w, d);
        g.strokeStyle = "rgba(255,255,255,0.12)"; g.lineWidth = 3; g.strokeRect(p.x - w / 2 + 2, p.y - d / 2 + 2, w - 4, d - 4);
        g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(p.x - w * 0.2, p.y - d * 0.2, w * 0.28, d * 0.28); // rooftop unit
        g.fillStyle = shade(base, 1.22); g.fillRect(p.x - w * 0.22, p.y - d * 0.22, w * 0.28, d * 0.28);
        g.fillStyle = "rgba(255,255,255,0.12)"; g.fillRect(p.x + w * 0.04, p.y - d * 0.32, 6, d * 0.64); // vent strip
      } else if (p.type === "butte") {
        const r = Math.max(p.w, p.d) / 2;
        g.fillStyle = "rgba(0,0,0,0.26)"; this._fillBlob(g, p.x + 12, p.y + 15, r * 1.02, p.poly);
        g.fillStyle = shade(th.ground, 0.58); this._fillBlob(g, p.x, p.y, r, p.poly);            // cliff base
        g.fillStyle = shade(th.dirt, 0.92); this._fillBlob(g, p.x - 3, p.y - 4, r * 0.82, p.poly); // sunlit plateau
        g.fillStyle = shade(th.dirt, 1.16); this._fillBlob(g, p.x - 6, p.y - 8, r * 0.5, p.poly);
      } else if (p.type === "peak") {
        const r = Math.max(p.w, p.d) / 2;
        g.fillStyle = "rgba(0,0,0,0.3)"; this._fillBlob(g, p.x + 16, p.y + 18, r, p.poly);
        g.fillStyle = shade(th.ground, 0.5); this._fillBlob(g, p.x, p.y, r, p.poly);              // shaded base
        g.fillStyle = shade(th.ground, 0.92); this._fillBlob(g, p.x - r * 0.12, p.y - r * 0.14, r * 0.68, p.poly);
        g.fillStyle = "#e9eef5"; this._fillBlob(g, p.x - r * 0.2, p.y - r * 0.24, r * 0.3, p.poly); // snow cap
      } else if (p.type === "tree") { // tree canopy cluster
        const r = Math.max(p.w, p.d) / 2, greens = ["#2f6b2f", "#357a33", "#2a5e2a", "#3f8a3a"], gi = Math.floor(p.hue * 4) % 4;
        g.fillStyle = "rgba(0,0,0,0.26)"; g.beginPath(); g.ellipse(p.x + 8, p.y + 10, r, r * 0.92, 0, 0, 7); g.fill();
        for (const [ox, oy, rr, s] of [[-r * 0.32, -r * 0.18, r * 0.72, 0], [r * 0.32, -r * 0.08, r * 0.64, 1], [0, r * 0.28, r * 0.6, 2], [0, -r * 0.12, r * 0.56, 3]]) {
          g.fillStyle = greens[(gi + s) % 4]; g.beginPath(); g.ellipse(p.x + ox, p.y + oy, rr, rr, 0, 0, 7); g.fill();
        }
        g.fillStyle = "rgba(220,240,170,0.34)"; g.beginPath(); g.ellipse(p.x - r * 0.22, p.y - r * 0.22, r * 0.32, r * 0.3, 0, 0, 7); g.fill();
      } else if (p.type === "island") {
        const r = Math.max(p.w, p.d) / 2;
        g.fillStyle = "rgba(30,60,90,0.4)"; this._fillBlob(g, p.x + 10, p.y + 12, r * 1.08, p.poly); // shallow-water shadow
        g.fillStyle = "rgba(228,212,150,0.92)"; this._fillBlob(g, p.x, p.y, r, p.poly);               // sandy shore
        g.fillStyle = "#3f7a3a"; this._fillBlob(g, p.x - 2, p.y - 3, r * 0.72, p.poly);                // greenery
        g.fillStyle = shade("#3f7a3a", 1.2); this._fillBlob(g, p.x - 4, p.y - 5, r * 0.4, p.poly);
      } else if (p.type === "buoy") {
        g.fillStyle = "rgba(0,0,0,0.22)"; g.beginPath(); g.ellipse(p.x + 3, p.y + 3, 9, 9, 0, 0, 7); g.fill();
        g.fillStyle = p.hue > 0.5 ? "#e23b2f" : "#f2c33a"; g.beginPath(); g.arc(p.x, p.y, 8, 0, 7); g.fill();
        g.fillStyle = "#fff"; g.beginPath(); g.arc(p.x, p.y, 3.4, 0, 7); g.fill();
      } else if (p.type === "dock") {
        const w = p.w, d = p.d;
        g.fillStyle = "rgba(0,0,0,0.28)"; g.fillRect(p.x - w / 2 + 6, p.y - d / 2 + 8, w, d);
        g.fillStyle = "#7a5a36"; g.fillRect(p.x - w / 2, p.y - d / 2, w, d);
        g.strokeStyle = "rgba(0,0,0,0.3)"; g.lineWidth = 2;
        for (let i = 1; i < 5; i++) { g.beginPath(); g.moveTo(p.x - w / 2 + (w / 5) * i, p.y - d / 2); g.lineTo(p.x - w / 2 + (w / 5) * i, p.y + d / 2); g.stroke(); }
      } else { // ship
        const w = p.w, d = p.d, cols = ["#c8431f", "#1f7ec8", "#3a9a3a", "#d2a23a"];
        g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(p.x - w / 2 + 8, p.y - d / 2 + 9, w, d);
        g.fillStyle = "#6b7682"; g.beginPath();
        g.moveTo(p.x + w / 2, p.y); g.lineTo(p.x + w * 0.32, p.y - d / 2); g.lineTo(p.x - w / 2, p.y - d / 2);
        g.lineTo(p.x - w / 2, p.y + d / 2); g.lineTo(p.x + w * 0.32, p.y + d / 2); g.closePath(); g.fill();
        for (let i = 0; i < 5; i++) { g.fillStyle = cols[i % 4]; g.fillRect(p.x - w * 0.3 + i * w * 0.12, p.y - d * 0.22, w * 0.1, d * 0.44); }
      }
    }

    _banner(g, frac, text, color) {
      const off = this.track.width / 2 + 30;
      const p = pointAtProgress(this.pts, frac * this.N), tan = tangentAtProgress(this.pts, frac * this.N);
      g.save(); g.translate(p.x - Math.sin(tan) * off, p.y + Math.cos(tan) * off); g.rotate(tan);
      const w = 170, h = 30;
      g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(-w / 2 + 4, -h / 2 + 4, w, h);
      g.fillStyle = color; g.fillRect(-w / 2, -h / 2, w, h);
      g.fillStyle = "rgba(255,255,255,0.9)"; g.lineWidth = 2;
      g.strokeStyle = "rgba(255,255,255,0.8)"; g.strokeRect(-w / 2 + 3, -h / 2 + 3, w - 6, h - 6);
      g.font = "bold 19px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(text, 0, 1);
      g.restore();
    }

    _hayCluster(g, frac) {
      const p = pointAtProgress(this.pts, frac * this.N);
      let dx = this._cx - p.x, dy = this._cy - p.y; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
      const bx = p.x + dx * (this.track.width / 2 + 34), by = p.y + dy * (this.track.width / 2 + 34);
      const tan = Math.atan2(dy, dx);
      for (let i = -1; i <= 1; i++) this._hay(g, bx - Math.sin(tan) * i * 26, by + Math.cos(tan) * i * 26);
    }
    _hay(g, x, y) {
      g.save(); g.translate(x, y);
      g.fillStyle = "rgba(0,0,0,0.28)"; g.fillRect(-15, -9, 32, 22);
      g.fillStyle = "#d9b24a"; g.fillRect(-18, -12, 32, 22);
      g.strokeStyle = "#a8842f"; g.lineWidth = 1.5;
      for (let r = -8; r <= 8; r += 5) { g.beginPath(); g.moveTo(-18, r); g.lineTo(14, r); g.stroke(); }
      g.strokeStyle = "rgba(0,0,0,0.3)"; g.strokeRect(-18, -12, 32, 22);
      g.restore();
    }

    _paddock(g) {
      const p = pointAtProgress(this.pts, 0.04 * this.N);
      let dx = this._cx - p.x, dy = this._cy - p.y; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
      const px = p.x + dx * (this.track.width / 2 + 90), py = p.y + dy * (this.track.width / 2 + 90);
      const tan = Math.atan2(dy, dx);
      const cols = ["#e8482c", "#3aa0ff", "#57d957", "#c46bff"];
      g.save(); g.translate(px, py); g.rotate(tan + Math.PI / 2);
      for (let i = 0; i < 4; i++) {
        const ry = (i - 1.5) * 30;
        g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(-20, ry - 11, 46, 22);
        g.fillStyle = cols[i]; g.fillRect(-23, ry - 13, 46, 22);
        g.fillStyle = "rgba(0,0,0,0.4)"; g.fillRect(-6, ry - 9, 14, 18); // cab
      }
      g.restore();
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
      const sf = car.stats && car.stats.maxSpeed ? Math.min(1, (car.speedApprox || 0) / car.stats.maxSpeed) : 0;
      return window.Input.resolve(car.angle, sf);
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

      // hazard patches: mud/sand slow you, water/snow are slippery (handled below)
      car._inMud = false;
      if (this.mud) for (const m of this.mud) {
        const dx = car.x - m.x, dy = car.y - m.y;
        if (dx * dx + dy * dy < m.r * m.r) { car._inMud = true; break; }
      }
      if (car._inMud && onGround) {
        const slow = { mud: 0.6, sand: 0.62, snow: 0.74, water: 0.82 }[this.hazardType] || 0.6;
        maxSpeed *= slow;
      }

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
      const autoDrift = onGround && car.nitroActive && Math.abs(car.steerS) > 0.18 && Math.abs(vlong) > 95;
      let gripLat;
      if (!onGround) gripLat = 0.999;
      else if (autoDrift) gripLat = 0.975; // break the rear loose so it really slides (counter-steer keeps it controlled)
      else gripLat = s.grip * (car._offTrack ? 1.05 : 1);
      // water & snow are slippery — the truck holds less lateral grip on them
      if (car._inMud && onGround && (this.hazardType === "water" || this.hazardType === "snow")) {
        gripLat = clamp(gripLat * 1.1, 0, 0.985);
      }
      vlat *= Math.pow(clamp(gripLat, 0, 0.999), dt * 60);

      // steering authority (mild speed-sensitive wash-out)
      const speedFrac = clamp(Math.abs(vlong) / s.maxSpeed, 0, 1);
      let authority = s.turn * (0.68 + 0.4 * Math.min(1, speedFrac * 1.9));
      authority *= 1 - 0.14 * speedFrac * Math.min(1, Math.abs(car.steerS));
      if (!onGround) authority *= 0.45; // enough air control to line up the landing

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
      car.drifting = onGround && car.slip > 52 && car.speedApprox > 80;

      // ---- jumps ----
      if (car.rampCooldown > 0) car.rampCooldown -= dt;
      if (onGround && car.rampCooldown <= 0 && vlong > 150) {
        for (const ramp of this.ramps) {
          const dx = car.x - ramp.x, dy = car.y - ramp.y;
          const along = dx * Math.cos(ramp.tan) + dy * Math.sin(ramp.tan);
          const side = -dx * Math.sin(ramp.tan) + dy * Math.cos(ramp.tan);
          if (Math.abs(along) < 55 && Math.abs(side) < ramp.half) {
            car.vz = clamp(vlong / s.maxSpeed, 0.3, 1.0) * 195;
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

      // skid marks + dust — tyre/dirt effects only for ground vehicles (trucks).
      // Boats throw spray and helis touch nothing, so they leave no skid decals.
      if (this.vehKind === "truck") {
        if (onGround && car.drifting) { this._layStreak(car); this._spawnDust(car, 1, 0.5); }
        else if (onGround && car._offTrack && car.speedApprox > 120) this._spawnDust(car, 1, 0.4);
        else if (onGround && car.nitroActive) this._spawnDust(car, 1, 0.3);
      }
      car.wobble = lerp(car.wobble, car.drifting ? 1 : 0, 0.2);
    }

    _trackLogic(car, dt, racing) {
      // local search keeps each truck on its own branch through a crossover;
      // fall back to a global search if it somehow drifts out of the window.
      let c = closestOnLoopLocal(this.pts, car.x, car.y, car._lastProgRaw, 12);
      if (c.dist > this.track.width) c = closestOnLoop(this.pts, car.x, car.y);

      const maxOff = this.track.width / 2 - 12;
      if (this.vehKind === "heli") {
        // soft flight corridor: no kerb. Drifting toward the obstacle maze scrubs
        // speed and nudges you back in; a wider hard limit stops you escaping.
        const soft = this.track.width / 2 - 6, hard = this.track.width / 2 + 28;
        if (c.dist > soft) {
          const cp = pointAtProgress(this.pts, c.progress);
          let nx = car.x - cp.x, ny = car.y - cp.y; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
          const over = Math.min(1, (c.dist - soft) / (hard - soft));
          car.vx *= 1 - 0.05 * over; car.vy *= 1 - 0.05 * over; // brush = scrub speed
          const vn = car.vx * nx + car.vy * ny;
          if (vn > 0) { const k = 0.4 + 0.6 * over; car.vx -= nx * vn * k; car.vy -= ny * vn * k; }
          if (c.dist > hard) { car.x = cp.x + nx * hard; car.y = cp.y + ny * hard; }
        }
      } else if (c.dist > maxOff) {
        // invisible edge walls — keep the truck/boat on course, slide along the edge
        const cp = pointAtProgress(this.pts, c.progress);
        let nx = car.x - cp.x, ny = car.y - cp.y;
        const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
        car.x = cp.x + nx * maxOff; car.y = cp.y + ny * maxOff;
        const vn = car.vx * nx + car.vy * ny; // outward velocity
        if (vn > 0) { car.vx -= nx * vn; car.vy -= ny * vn; }
      }
      car._offTrack = false; // boundary keeps everyone on course

      let prog = c.progress;
      let delta = prog - (car._lastProgRaw % this.N);
      if (delta < -this.N / 2) delta += this.N; else if (delta > this.N / 2) delta -= this.N;
      car.lapProgRaw += delta; car._lastProgRaw = prog;

      // bridge: lift the truck onto the elevated deck over the figure-8 crossing
      car.onBridge = false; car.bridgeZ = 0;
      if (this.track.bridge) {
        const frac = ((prog % this.N) + this.N) % this.N / this.N;
        const [f0, f1] = this.track.bridge;
        if (frac > f0 && frac < f1) {
          const u = (frac - f0) / (f1 - f0); // 0..1 across the deck
          car.onBridge = true;
          car.bridgeZ = 26 * Math.min(1, Math.min(u, 1 - u) / 0.22); // ramp at the ends
        }
      }

      // whoops: while on a rough section the truck chatters and hops
      if (racing) for (const wp of (this.whoops || [])) {
        let d = Math.abs(prog - wp.prog); if (d > this.N / 2) d = this.N - d;
        if (d < wp.len / 2 && car.z <= 0.001 && car.speedApprox > 70) {
          car._whoopAcc = (car._whoopAcc || 0) + car.speedApprox * dt;
          if (car._whoopAcc > 34) {
            car._whoopAcc = 0; car.vz = 60 + Math.random() * 30;
            if (car.isPlayer) this.shake = Math.min(this.shake + 1.4, 5);
          }
        }
      }

      const lapsDone = Math.floor((car.lapProgRaw - car.startProg) / this.N);
      if (racing && lapsDone > car.lap) {
        car.lap = lapsDone;
        if (car.isPlayer) {
          const split = this.time - car.lapStart;
          car.lapStart = this.time;
          car.lastLap = split;
          if (car.bestLapThisRace == null || split < car.bestLapThisRace) car.bestLapThisRace = split;
          this.pickups.forEach((pk) => (pk.taken = false)); // $ respawn each lap
        }
        if (car.lap >= this.track.laps && !car.finished) {
          car.finished = true; car.finishTime = this.time;
          this.finishOrder.push(car); this._checkRaceEnd();
        }
      }
      car.lapProg = car.lapProgRaw;

      // cash pickups — the player grabs $ for bonus money
      if (racing && car.isPlayer) {
        for (const pk of this.pickups) {
          if (pk.taken) continue;
          const dx = car.x - pk.x, dy = car.y - pk.y;
          if (dx * dx + dy * dy < 30 * 30) {
            pk.taken = true; this.cashCollected += pk.value;
            this.floats.push({ x: pk.x, y: pk.y, life: 1, text: "+$" + pk.value });
            this._spawnDust(car, 6, 0.6);
          }
        }
      }
    }

    _separate() {
      const minDist = CAR_W * 0.9;
      for (let i = 0; i < this.cars.length; i++)
        for (let j = i + 1; j < this.cars.length; j++) {
          const a = this.cars[i], b = this.cars[j];
          if (Math.abs(a.z - b.z) > 30) continue; // one is airborne over the other
          if (a.onBridge !== b.onBridge) continue; // one is on the bridge, one beneath
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
      // rank by distance actually travelled (cars start on a staggered grid, so
      // absolute lapProg isn't comparable — subtract each car's own startProg)
      const dist = (c) => c.lapProg - c.startProg;
      const sorted = [...this.cars].sort((a, b) => {
        if (a.finished && b.finished) return a.finishTime - b.finishTime;
        if (a.finished) return -1; if (b.finished) return 1;
        return dist(b) - dist(a);
      });
      sorted.forEach((c, i) => (c.position = i + 1));
    }

    _checkRaceEnd() {
      if (this.player.finished) {
        const dist = (c) => c.lapProg - c.startProg;
        const remaining = this.cars.filter((c) => !this.finishOrder.includes(c)).sort((a, b) => dist(b) - dist(a));
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
      const fs = this.floats;
      for (let i = fs.length - 1; i >= 0; i--) {
        const f = fs[i]; f.life -= dt * 0.9; f.y -= 36 * dt;
        if (f.life <= 0) fs.splice(i, 1);
      }
    }

    // spinning gold $ coins (shrink horizontally for a 3D spin), bobbing
    _drawPickups(ctx) {
      const t = this.time;
      for (const pk of this.pickups) {
        if (pk.taken) continue;
        const spin = Math.abs(Math.cos(t * 4 + pk.phase));
        const bob = Math.sin(t * 3 + pk.phase) * 3;
        ctx.save();
        ctx.translate(pk.x, pk.y + bob);
        ctx.fillStyle = "rgba(0,0,0,0.3)";
        ctx.beginPath(); ctx.ellipse(0, 16, 13 * (0.4 + 0.6 * spin), 5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.scale(0.3 + 0.7 * spin, 1); // spin
        const g = ctx.createRadialGradient(-4, -4, 2, 0, 0, 16);
        g.addColorStop(0, "#fff4b0"); g.addColorStop(0.5, "#ffd23b"); g.addColorStop(1, "#c8881a");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 16, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#8a5e0e"; ctx.lineWidth = 2.5; ctx.stroke();
        ctx.fillStyle = "#8a5e0e"; ctx.font = "bold 22px sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("$", 0, 1);
        ctx.restore();
      }
    }

    // the elevated overpass deck at the figure-8 crossing (neon-railed)
    _drawBridge(ctx) {
      const bz = this.track.bridge, mid = ((bz[0] + bz[1]) / 2) * this.N;
      const p = pointAtProgress(this.pts, mid), tan = tangentAtProgress(this.pts, mid);
      const len = this.track.width * 2.3, half = this.track.width / 2 + 8, H = 26;
      const th = this.track.theme;
      // cast shadow on the lane below
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(tan);
      ctx.fillStyle = "rgba(0,0,0,0.4)"; ctx.fillRect(-len / 2 + 7, -half + 12, len, half * 2);
      ctx.restore();
      // raised deck
      ctx.save(); ctx.translate(p.x, p.y - H); ctx.rotate(tan);
      ctx.fillStyle = "#2a2433"; // support edges
      ctx.fillRect(-len / 2, -half - 2, len, 6); ctx.fillRect(-len / 2, half - 4, len, 6);
      ctx.fillStyle = th.dirtDark; ctx.fillRect(-len / 2, -half, len, half * 2);
      const pat = ctx.createPattern(getDirtTile(th.dirt), "repeat");
      ctx.fillStyle = pat || th.dirt; ctx.fillRect(-len / 2 + 5, -half + 5, len - 10, half * 2 - 10);
      // neon guard rails
      ctx.fillStyle = "#ff3df2"; ctx.fillRect(-len / 2, -half - 6, len, 5);
      ctx.fillStyle = "#3df2ff"; ctx.fillRect(-len / 2, half + 1, len, 5);
      ctx.restore();
    }

    _drawFloats(ctx) {
      for (const f of this.floats) {
        ctx.save();
        ctx.globalAlpha = clamp(f.life, 0, 1);
        ctx.fillStyle = "#ffe11a"; ctx.strokeStyle = "rgba(0,0,0,0.7)"; ctx.lineWidth = 4;
        ctx.font = "bold 30px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.strokeText(f.text, f.x, f.y); ctx.fillText(f.text, f.x, f.y);
        ctx.restore();
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

    // ---- Isometric prototype: foreshortened ground + extruded striped walls ----
    _renderIso() {
      const ctx = this.ctx, c = this.canvas;
      if (c.width !== Math.floor(c.clientWidth * this.dpr)) this._resize();
      const W = c.width, H = c.height, b = this.bbox, ISO = 0.62, Wd = this.track.width;
      const bands = uiBands(H, this.dpr, this.cfg.touch);
      const availH = H - bands.top - bands.bot;
      const zoom = Math.min(W / (b.w * 1.02), availH / (b.h * ISO * 1.04));
      this._zoom = zoom;
      const camX = (b.minX + b.maxX) / 2, camY = (b.minY + b.maxY) / 2;
      const ox = W / 2, oy = bands.top + availH / 2;
      // perspective: near (lower) bigger, far (upper) smaller — converge x by depth
      const halfH = b.h / 2, PP = 0.17;
      const perspAt = (y) => 1 / (1 - clamp((y - camY) / halfH, -1.3, 1.3) * PP);
      const pg = (x, y) => { const p = perspAt(y); return [ox + (x - camX) * zoom * p, oy + (y - camY) * zoom * ISO, p]; };
      const theme = this.track.theme || { ground: "#3f6b2e", dirt: "#b07a45" };

      // sky / ground backdrop
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, shade(theme.ground, 0.62)); grad.addColorStop(0.5, shade(theme.ground, 0.8)); grad.addColorStop(1, shade(theme.ground, 1.05));
      ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);

      // perspective-warped ground (baked course + skid decals) drawn in strips
      ctx.imageSmoothingEnabled = true;
      this._groundStrips(ctx, this.scene, this.sceneX, this.sceneY, this.scene.width, this.scene.height, pg, perspAt, ox, camX, zoom);
      this._groundStrips(ctx, this.decal, this.bbox.minX, this.bbox.minY, this.bbox.w, this.bbox.h, pg, perspAt, ox, camX, zoom);
      // 3D dirt mounds for relief, then pickups, then extruded grandstands
      this._drawMoundsIso(ctx, pg, zoom, ISO);
      this._drawPickupsIso(ctx, pg, zoom);
      this._drawStandsIso(ctx, pg, zoom);
      this._drawPropsIso(ctx, pg, zoom, ISO);

      // track-region boundary: tall red/white kerb walls on land, a low foamy
      // channel edge on the water, nothing for helis (obstacle maze is the bound).
      const wmode = this._wallMode(), water = wmode === "foam";
      const wallH = water ? 8 : 44, edgeDark = shade(theme.ground, 0.45);
      const segs = wmode === "none" ? [] : this._wallEdges.map((e) => ({ a: { x: e.x1, y: e.y1 }, b: { x: e.x2, y: e.y2 }, red: (Math.floor((e.mx + e.my) / 30) % 2) === 0 }));
      segs.sort((p, q) => (pg(p.a.x, p.a.y)[1] + pg(p.b.x, p.b.y)[1]) - (pg(q.a.x, q.a.y)[1] + pg(q.b.x, q.b.y)[1]));
      for (const s of segs) {
        const b0 = pg(s.a.x, s.a.y), b1 = pg(s.b.x, s.b.y);
        const t0 = [b0[0], b0[1] - wallH * zoom * b0[2]], t1 = [b1[0], b1[1] - wallH * zoom * b1[2]];
        ctx.fillStyle = water ? edgeDark : (s.red ? "#a8281f" : "#b9b9c4"); // front face
        ctx.beginPath(); ctx.moveTo(b0[0], b0[1]); ctx.lineTo(b1[0], b1[1]); ctx.lineTo(t1[0], t1[1]); ctx.lineTo(t0[0], t0[1]); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = water ? "rgba(235,245,255,0.7)" : (s.red ? "#e8483a" : "#f2f2f7"); ctx.lineWidth = 3; // foam / bright top edge
        ctx.beginPath(); ctx.moveTo(t0[0], t0[1]); ctx.lineTo(t1[0], t1[1]); ctx.stroke();
      }

      // trucks as billboards standing on the ground; bridge deck between layers
      const ground = this.cars.filter((c2) => !c2.onBridge).sort((p, q) => pg(p.x, p.y)[1] - pg(q.x, q.y)[1]);
      const onB = this.cars.filter((c2) => c2.onBridge).sort((p, q) => pg(p.x, p.y)[1] - pg(q.x, q.y)[1]);
      for (const car of ground) this._drawCarIso(ctx, car, pg, zoom, ISO);
      if (this.track.bridge) this._drawBridgeIso(ctx, pg, zoom);
      for (const car of onB) this._drawCarIso(ctx, car, pg, zoom, ISO);

      this._drawVignette(ctx, W, H);
      if (this.countdown > 0) this._drawCountdown(ctx, W, H);
    }

    // off-track dirt mounds for relief (drawn in 3D in iso mode)
    _buildMounds() {
      this.mounds = [];
      if (this.track.env) return; // env props provide the relief instead
      const b = this.bbox, Wd = this.track.width;
      for (let gx = b.minX - 40; gx <= b.maxX + 40; gx += 240) {
        for (let gy = b.minY - 40; gy <= b.maxY + 40; gy += 230) {
          const x = gx + (Math.random() * 130 - 65), y = gy + (Math.random() * 130 - 65);
          if (closestOnLoop(this.pts, x, y).dist > Wd * 0.95) {
            this.mounds.push({ x, y, r: 55 + Math.random() * 45, hh: 0.55 + Math.random() * 0.5 });
          }
        }
      }
    }

    _drawMoundsIso(ctx, pg, zoom, ISO) {
      if (!this.mounds) return;
      const dirt = (this.track.theme && this.track.theme.ground) || "#7a4a28";
      const list = [...this.mounds].sort((a, b) => pg(a.x, a.y)[1] - pg(b.x, b.y)[1]);
      for (const m of list) {
        const g = pg(m.x, m.y), z = zoom * g[2], r = m.r * z, h = m.r * 0.6 * m.hh * z;
        ctx.fillStyle = "rgba(0,0,0,0.16)";
        ctx.beginPath(); ctx.ellipse(g[0] + r * 0.18, g[1] + r * 0.12 * ISO, r * 1.02, r * ISO, 0, 0, Math.PI * 2); ctx.fill();
        const cxp = g[0], cyp = g[1] - h * 0.5;
        const grd = ctx.createRadialGradient(cxp - r * 0.35, cyp - r * 0.45, r * 0.1, cxp, cyp, r * 1.1);
        grd.addColorStop(0, shade(dirt, 1.22)); grd.addColorStop(0.6, shade(dirt, 1.0)); grd.addColorStop(1, shade(dirt, 0.66));
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.ellipse(cxp, cyp, r, r * ISO + h * 0.5, 0, 0, Math.PI * 2); ctx.fill();
      }
    }

    // draw an image mapped to a world rect, warped into perspective via horizontal strips
    _groundStrips(ctx, img, wx, wy, ww, wh, pg, perspAt, ox, camX, zoom) {
      const N = 30, ih = img.height, iw = img.width;
      for (let i = 0; i < N; i++) {
        const wy0 = wy + (i / N) * wh, wy1 = wy + ((i + 1) / N) * wh;
        const sy0 = pg(wx, wy0)[1], sy1 = pg(wx, wy1)[1];
        const p = perspAt((wy0 + wy1) / 2);
        const dx = ox + (wx - camX) * zoom * p, dw = ww * zoom * p;
        const srcY = (i / N) * ih, srcH = ih / N;
        ctx.drawImage(img, 0, srcY, iw, srcH, dx, sy0, dw, (sy1 - sy0) + 0.6);
      }
    }

    _drawPickupsIso(ctx, pg, zoom) {
      const t = this.time;
      for (const pk of this.pickups) {
        if (pk.taken) continue;
        const g = pg(pk.x, pk.y), z = zoom * g[2];
        const spin = Math.abs(Math.cos(t * 4 + pk.phase)), bob = Math.sin(t * 3 + pk.phase) * 3;
        ctx.save(); ctx.translate(g[0], g[1] - (10 + bob) * z);
        ctx.fillStyle = "#ffd23b"; ctx.beginPath(); ctx.ellipse(0, 0, (3 + 13 * spin) * z, 15 * z, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#8a5e0e"; ctx.lineWidth = 2; ctx.stroke();
        if (spin > 0.4) { ctx.fillStyle = "#8a5e0e"; ctx.font = `bold ${20 * z}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("$", 0, 0); }
        ctx.restore();
      }
    }

    _drawStandsIso(ctx, pg, zoom) {
      if (!this._stands) return;
      const CROWD = ["#e6dcc0", "#ffffff", "#f2b8b0", "#bcd0f0", "#ffe7a8", "#cfead0", "#e8c0e0"];
      const list = [...this._stands].sort((a, b) => pg(a.x, a.y)[1] - pg(b.x, b.y)[1]);
      for (const s of list) {
        const aa = s.ang + Math.PI / 2, fx = Math.cos(aa), fy = Math.sin(aa), nx = -Math.sin(aa), ny = Math.cos(aa);
        const w = 250, d = 72;
        const C = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([a, o]) => ({ x: s.x + fx * a + nx * o, y: s.y + fy * a + ny * o }));
        const base = C.map((q) => pg(q.x, q.y)), h = 64 * zoom * base[0][2], top = base.map((q) => [q[0], q[1] - h]);
        ctx.fillStyle = "#4c5058";
        for (let i = 0; i < 4; i++) {
          const a = base[i], b2 = base[(i + 1) % 4], c2 = top[(i + 1) % 4], d2 = top[i];
          ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b2[0], b2[1]); ctx.lineTo(c2[0], c2[1]); ctx.lineTo(d2[0], d2[1]); ctx.closePath(); ctx.fill();
        }
        ctx.fillStyle = "#6a6e75";
        ctx.beginPath(); ctx.moveTo(top[0][0], top[0][1]); for (let i = 1; i < 4; i++) ctx.lineTo(top[i][0], top[i][1]); ctx.closePath(); ctx.fill();
        for (let r = 0; r < 22; r++) {
          const u = r / 22, tx = top[0][0] + (top[1][0] - top[0][0]) * u, ty = top[0][1] + (top[1][1] - top[0][1]) * u;
          ctx.fillStyle = CROWD[(r * 7 + s.i) % CROWD.length]; ctx.fillRect(tx - 2, ty - 4, 4, 5);
        }
      }
    }

    // extruded biome props for the aerial / waterway circuits
    _drawPropsIso(ctx, pg, zoom, ISO) {
      if (!this._props) return;
      const list = [...this._props].sort((a, b) => pg(a.x, a.y)[1] - pg(b.x, b.y)[1]);
      for (const p of list) {
        if (p.type === "tower") this._isoTower(ctx, p, pg, zoom);
        else if (p.type === "butte") this._isoButte(ctx, p, pg, zoom);
        else if (p.type === "peak") this._isoPeak(ctx, p, pg, zoom);
        else if (p.type === "tree") this._isoTree(ctx, p, pg, zoom);
        else if (p.type === "island") this._isoIsland(ctx, p, pg, zoom, ISO);
        else if (p.type === "buoy") this._isoBuoy(ctx, p, pg, zoom, ISO);
        else if (p.type === "dock") this._isoDock(ctx, p, pg, zoom);
        else if (p.type === "ship") this._isoShip(ctx, p, pg, zoom);
      }
    }

    // square-footprint extruded prism with depth-sorted side faces
    _isoBox(ctx, p, pg, zoom, hMul) {
      const w = p.w / 2, d = p.d / 2;
      const corn = [[-w, -d], [w, -d], [w, d], [-w, d]].map(([a, o]) => pg(p.x + a, p.y + o));
      const persp = corn[0][2], h = p.height * zoom * persp * (hMul || 1);
      const top = corn.map((q) => [q[0], q[1] - h]);
      const faces = [0, 1, 2, 3].map((i) => ({ i, depth: (corn[i][1] + corn[(i + 1) % 4][1]) / 2 })).sort((a, b) => a.depth - b.depth);
      return { corn, top, faces, persp, h };
    }

    _isoTower(ctx, p, pg, zoom) {
      const base = ["#39415a", "#454d68", "#2e3650", "#4c5470"][Math.floor(p.hue * 4) % 4];
      const { corn, top, faces } = this._isoBox(ctx, p, pg, zoom);
      for (const f of faces.slice(1)) { // skip the rear-most (hidden) face
        const i = f.i, a = corn[i], b = corn[(i + 1) % 4], c = top[(i + 1) % 4], d = top[i];
        const lit = (f.depth > (corn[0][1] + corn[2][1]) / 2) ? 0.92 : 0.66;
        ctx.fillStyle = shade(base, lit);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]); ctx.closePath(); ctx.fill();
        // window grid on the face
        const cols = 4, rows = Math.max(4, Math.round(p.height / 40));
        for (let r = 0; r < rows; r++) for (let cc = 0; cc < cols; cc++) {
          const u = (cc + 0.5) / cols, v = (r + 0.6) / rows;
          const bx = a[0] + (b[0] - a[0]) * u, by = a[1] + (b[1] - a[1]) * u;
          const tx = d[0] + (c[0] - d[0]) * u, ty = d[1] + (c[1] - d[1]) * u;
          const x = bx + (tx - bx) * v, y = by + (ty - by) * v;
          const onLit = ((r * 7 + cc * 13 + (i + 1) * 5 + Math.floor(p.hue * 97)) % 5) > 1;
          ctx.fillStyle = onLit ? "rgba(255,230,150,0.85)" : "rgba(20,28,44,0.7)";
          ctx.fillRect(x - 2.4, y - 3.2, 4.8, 5.2);
        }
      }
      ctx.fillStyle = shade(base, 1.12);
      ctx.beginPath(); ctx.moveTo(top[0][0], top[0][1]); for (let i = 1; i < 4; i++) ctx.lineTo(top[i][0], top[i][1]); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.4)"; ctx.lineWidth = 1.4; ctx.stroke();
    }

    // extruded organic prism (octagon footprint), used for buttes
    _isoPrismOrganic(ctx, p, pg, zoom, hMul, sideF, topLo, topHi) {
      const n = p.poly.length, r = Math.max(p.w, p.d) / 2, pts = [];
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, rr = r * p.poly[i]; pts.push(pg(p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr)); }
      const persp = pts[0][2], h = p.height * zoom * persp * (hMul || 1), top = pts.map((q) => [q[0], q[1] - h]);
      const faces = pts.map((_, i) => ({ i, depth: (pts[i][1] + pts[(i + 1) % n][1]) / 2 })).sort((a, b) => a.depth - b.depth);
      for (const f of faces) {
        const i = f.i, a = pts[i], b = pts[(i + 1) % n], c = top[(i + 1) % n], d = top[i];
        ctx.fillStyle = shade(this.track.theme.ground, sideF * (f.depth > pts[0][1] ? 1.12 : 0.86));
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]); ctx.closePath(); ctx.fill();
      }
      const tg = ctx.createLinearGradient(top[0][0], top[0][1], top[(n >> 1)][0], top[(n >> 1)][1]);
      tg.addColorStop(0, topHi); tg.addColorStop(1, topLo);
      ctx.fillStyle = tg; ctx.beginPath(); ctx.moveTo(top[0][0], top[0][1]); for (let i = 1; i < n; i++) ctx.lineTo(top[i][0], top[i][1]); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.3)"; ctx.lineWidth = 1.4; ctx.stroke();
      return { top, persp, h };
    }

    _isoButte(ctx, p, pg, zoom) {
      const th = this.track.theme;
      this._isoPrismOrganic(ctx, p, pg, zoom, 1, 0.5, shade(th.dirt, 0.86), shade(th.dirt, 1.18));
    }

    _isoPeak(ctx, p, pg, zoom) {
      const th = this.track.theme, n = p.poly.length, r = Math.max(p.w, p.d) / 2, pts = [];
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, rr = r * p.poly[i]; pts.push(pg(p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr)); }
      const c0 = pg(p.x, p.y), persp = c0[2], h = p.height * zoom * persp, apex = [c0[0], c0[1] - h];
      const faces = pts.map((_, i) => ({ i, depth: (pts[i][1] + pts[(i + 1) % n][1]) / 2 })).sort((a, b) => a.depth - b.depth);
      for (const f of faces) {
        const i = f.i, a = pts[i], b = pts[(i + 1) % n];
        const lit = (f.depth > c0[1]) ? 1.0 : 0.58;
        ctx.fillStyle = shade(th.ground, lit);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(apex[0], apex[1]); ctx.closePath(); ctx.fill();
        // snow cap on the near faces
        if (f.depth > c0[1]) {
          const sa = [a[0] + (apex[0] - a[0]) * 0.62, a[1] + (apex[1] - a[1]) * 0.62];
          const sb = [b[0] + (apex[0] - b[0]) * 0.62, b[1] + (apex[1] - b[1]) * 0.62];
          ctx.fillStyle = "#eef3f8"; ctx.beginPath(); ctx.moveTo(sa[0], sa[1]); ctx.lineTo(sb[0], sb[1]); ctx.lineTo(apex[0], apex[1]); ctx.closePath(); ctx.fill();
        }
      }
    }

    _isoTree(ctx, p, pg, zoom) {
      const g0 = pg(p.x, p.y), z = zoom * g0[2], h = p.height * z;
      ctx.strokeStyle = "#5a3a22"; ctx.lineWidth = Math.max(3, p.w * 0.14 * z); ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(g0[0], g0[1]); ctx.lineTo(g0[0], g0[1] - h * 0.5); ctx.stroke();
      const cx = g0[0], cy = g0[1] - h * 0.58, r = p.w * 0.5 * z, greens = ["#2f6b2f", "#357a33", "#2a5e2a", "#3f8a3a"], gi = Math.floor(p.hue * 4) % 4;
      ctx.fillStyle = greens[gi]; ctx.beginPath(); ctx.ellipse(cx, cy, r, r * 0.92, 0, 0, 7); ctx.fill();
      ctx.fillStyle = greens[(gi + 1) % 4]; ctx.beginPath(); ctx.ellipse(cx - r * 0.42, cy + r * 0.2, r * 0.6, r * 0.55, 0, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + r * 0.42, cy + r * 0.12, r * 0.6, r * 0.55, 0, 0, 7); ctx.fill();
      ctx.fillStyle = "rgba(220,240,170,0.4)"; ctx.beginPath(); ctx.ellipse(cx - r * 0.28, cy - r * 0.34, r * 0.34, r * 0.3, 0, 0, 7); ctx.fill();
    }

    // ---- waterway props (boat circuit) ----
    _isoIsland(ctx, p, pg, zoom, ISO) {
      const n = p.poly.length, r = Math.max(p.w, p.d) / 2, pts = [];
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, rr = r * p.poly[i]; pts.push(pg(p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr)); }
      const persp = pts[0][2], h = p.height * zoom * persp, top = pts.map((q) => [q[0], q[1] - h]);
      // sandy shore ring on the water
      ctx.fillStyle = "rgba(225,210,150,0.5)";
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1] + 5); for (let i = 1; i < n; i++) ctx.lineTo(pts[i][0], pts[i][1] + 5); ctx.closePath(); ctx.fill();
      const faces = pts.map((_, i) => ({ i, depth: (pts[i][1] + pts[(i + 1) % n][1]) / 2 })).sort((a, b) => a.depth - b.depth);
      for (const f of faces) { const i = f.i, a = pts[i], b = pts[(i + 1) % n], c = top[(i + 1) % n], d = top[i];
        ctx.fillStyle = shade("#caa85e", f.depth > pts[0][1] ? 1.0 : 0.78);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]); ctx.closePath(); ctx.fill(); }
      ctx.fillStyle = "#3f7a3a"; ctx.beginPath(); ctx.moveTo(top[0][0], top[0][1]); for (let i = 1; i < n; i++) ctx.lineTo(top[i][0], top[i][1]); ctx.closePath(); ctx.fill();
      // a palm or two
      if (p.hue > 0.4) this._isoTree(ctx, { x: p.x, y: p.y, w: p.w * 0.5, height: p.height + 40, hue: 0.2 }, pg, zoom);
    }

    _isoBuoy(ctx, p, pg, zoom, ISO) {
      const g0 = pg(p.x, p.y), z = zoom * g0[2], h = 26 * z;
      ctx.fillStyle = "rgba(0,0,0,0.18)"; ctx.beginPath(); ctx.ellipse(g0[0], g0[1], 11 * z, 6 * z, 0, 0, 7); ctx.fill();
      ctx.fillStyle = p.hue > 0.5 ? "#e23b2f" : "#f2c33a";
      ctx.beginPath(); ctx.moveTo(g0[0] - 7 * z, g0[1]); ctx.lineTo(g0[0] + 7 * z, g0[1]); ctx.lineTo(g0[0] + 4 * z, g0[1] - h); ctx.lineTo(g0[0] - 4 * z, g0[1] - h); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.fillRect(g0[0] - 5 * z, g0[1] - h * 0.55, 10 * z, 4 * z);
      ctx.fillStyle = "#222"; ctx.beginPath(); ctx.ellipse(g0[0], g0[1] - h, 3 * z, 2 * z, 0, 0, 7); ctx.fill();
    }

    _isoDock(ctx, p, pg, zoom) {
      const th = this.track.theme;
      const { corn, top, faces } = this._isoBox(ctx, p, pg, zoom);
      for (const f of faces.slice(1)) { const i = f.i, a = corn[i], b = corn[(i + 1) % 4], c = top[(i + 1) % 4], d = top[i];
        ctx.fillStyle = shade("#7a5a36", f.depth > (corn[0][1] + corn[2][1]) / 2 ? 1.0 : 0.72);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]); ctx.closePath(); ctx.fill(); }
      ctx.fillStyle = "#8a6a44"; ctx.beginPath(); ctx.moveTo(top[0][0], top[0][1]); for (let i = 1; i < 4; i++) ctx.lineTo(top[i][0], top[i][1]); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.3)"; ctx.lineWidth = 1.4; ctx.stroke();
    }

    _isoShip(ctx, p, pg, zoom) {
      const th = this.track.theme;
      const { corn, top, faces } = this._isoBox(ctx, p, pg, zoom);
      for (const f of faces.slice(1)) { const i = f.i, a = corn[i], b = corn[(i + 1) % 4], c = top[(i + 1) % 4], d = top[i];
        ctx.fillStyle = shade("#6b7682", f.depth > (corn[0][1] + corn[2][1]) / 2 ? 1.0 : 0.7);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]); ctx.closePath(); ctx.fill(); }
      ctx.fillStyle = "#8b96a2"; ctx.beginPath(); ctx.moveTo(top[0][0], top[0][1]); for (let i = 1; i < 4; i++) ctx.lineTo(top[i][0], top[i][1]); ctx.closePath(); ctx.fill();
      // stacked containers on deck
      const cols = ["#c8431f", "#1f7ec8", "#3a9a3a", "#d2a23a"];
      const cx = (top[0][0] + top[2][0]) / 2, cy = (top[0][1] + top[2][1]) / 2;
      for (let i = 0; i < 4; i++) { ctx.fillStyle = cols[i]; ctx.fillRect(cx - 18 + i * 9, cy - 10 - (i % 2) * 8, 8, 16); }
    }

    // a procedural 3D monster truck: 4 big tyres + an extruded body + cab, projected
    _drawCarIso(ctx, car, pg, zoom, ISO) {
      const g0 = pg(car.x, car.y), cx = g0[0], cy = g0[1], persp = g0[2] || 1, a = car.angle;
      const z = (zoom * persp * this.truckScale);
      const fwd = [Math.cos(a), Math.sin(a) * ISO], rgt = [-Math.sin(a), Math.cos(a) * ISO];
      const base = (car.z + (car.bridgeZ || 0)) * z;
      const P = (lx, ly, h) => [cx + (fwd[0] * lx + rgt[0] * ly) * z, cy + (fwd[1] * lx + rgt[1] * ly) * z - h * z - base];
      // ground shadow
      ctx.save(); ctx.translate(cx, cy); ctx.scale(1, ISO);
      ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.beginPath(); ctx.ellipse(3 * z, 3 * z, 30 * z, 22 * z, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      const kind = (window.getVehicle ? (window.getVehicle(car.vehicleId) || {}).kind : null) || "truck";
      if (kind === "boat") this._isoBoat(ctx, car, P, z);
      else if (kind === "heli") this._isoHeli(ctx, car, P, z);
      else this._isoTruck(ctx, car, P, z);

      // nitro flame out the back (all kinds)
      if (car.nitroActive) { const f = P(-24 - Math.random() * 10, 0, kind === "heli" ? 16 : 11); ctx.fillStyle = "rgba(120,220,255,0.8)"; ctx.beginPath(); ctx.ellipse(f[0], f[1], 7 * z, 4 * z, 0, 0, Math.PI * 2); ctx.fill(); }

      if (car.isPlayer) {
        const pulse = Math.sin(this.time * 6), m = P(0, 0, 44 + pulse * 3);
        ctx.strokeStyle = "rgba(255,238,0,0.97)"; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(cx, cy - base, 30 * z, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(m[0] - 14, m[1] - 14); ctx.lineTo(m[0] + 14, m[1] - 14); ctx.lineTo(m[0], m[1] + 3); ctx.closePath();
        ctx.fillStyle = "#ffee00"; ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.7)"; ctx.fill(); ctx.stroke();
      }
    }

    // extruded prism helper: draw the side walls then the gradient top of a polygon
    _isoPrism(ctx, car, P, pts, hBot, hTop, col, sideF, topLo, topHi) {
      const Bc = pts.map(([lx, ly]) => P(lx, ly, hBot)), Tc = pts.map(([lx, ly]) => P(lx, ly, hTop)), n = pts.length;
      ctx.fillStyle = shade(col, sideF);
      for (let i = 0; i < n; i++) { const A = Bc[i], B = Bc[(i + 1) % n], C = Tc[(i + 1) % n], D = Tc[i]; ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.lineTo(C[0], C[1]); ctx.lineTo(D[0], D[1]); ctx.closePath(); ctx.fill(); }
      const tg = ctx.createLinearGradient(Tc[0][0], Tc[0][1], Tc[(n >> 1)][0], Tc[(n >> 1)][1]);
      tg.addColorStop(0, shade(col, topHi)); tg.addColorStop(1, shade(col, topLo));
      ctx.fillStyle = tg; ctx.beginPath(); ctx.moveTo(Tc[0][0], Tc[0][1]); for (let i = 1; i < n; i++) ctx.lineTo(Tc[i][0], Tc[i][1]); ctx.closePath(); ctx.fill();
      ctx.lineWidth = car.isPlayer ? 2.4 : 1.4; ctx.strokeStyle = car.isPlayer ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.4)"; ctx.stroke();
      return Tc;
    }

    _isoTruck(ctx, car, P, z) {
      const col = car.color;
      // tyres (knobby, big)
      for (const [lx, ly] of [[20, 17], [20, -17], [-20, 17], [-20, -17]]) {
        const c = P(lx, ly, 8);
        ctx.fillStyle = "#100d0a"; ctx.beginPath(); ctx.ellipse(c[0], c[1], 12 * z, 9 * z, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#2c2820"; ctx.beginPath(); ctx.ellipse(c[0], c[1], 5.5 * z, 4 * z, 0, 0, Math.PI * 2); ctx.fill();
      }
      this._isoPrism(ctx, car, P, [[22, 13], [22, -13], [-22, -13], [-22, 13]], 9, 21, col, 0.55, 0.85, 1.3);
      // cab / windshield (set forward)
      const cab = [[10, 10], [10, -10], [-6, -10], [-6, 10]];
      const KB = cab.map(([lx, ly]) => P(lx, ly, 21)), KT = cab.map(([lx, ly]) => P(lx, ly, 30));
      ctx.fillStyle = "#10141c";
      for (let i = 0; i < 4; i++) { const A = KB[i], B = KB[(i + 1) % 4], C = KT[(i + 1) % 4], D = KT[i]; ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.lineTo(C[0], C[1]); ctx.lineTo(D[0], D[1]); ctx.closePath(); ctx.fill(); }
      ctx.fillStyle = "#223044"; ctx.beginPath(); ctx.moveTo(KT[0][0], KT[0][1]); for (let i = 1; i < 4; i++) ctx.lineTo(KT[i][0], KT[i][1]); ctx.closePath(); ctx.fill();
      // headlights
      const hl = P(22, 7, 15), hr = P(22, -7, 15);
      ctx.fillStyle = "#fff6c8"; ctx.beginPath(); ctx.ellipse(hl[0], hl[1], 3 * z, 2.2 * z, 0, 0, Math.PI * 2); ctx.ellipse(hr[0], hr[1], 3 * z, 2.2 * z, 0, 0, Math.PI * 2); ctx.fill();
    }

    _isoBoat(ctx, car, P, z) {
      const col = car.color;
      // foamy wake on the water behind the transom (flat on the surface)
      ctx.fillStyle = "rgba(255,255,255,0.26)";
      const w = [P(-20, 0, 0), P(-42, -18, 0), P(-34, 0, 0), P(-42, 18, 0)];
      ctx.beginPath(); ctx.moveTo(w[0][0], w[0][1]); for (let i = 1; i < 4; i++) ctx.lineTo(w[i][0], w[i][1]); ctx.closePath(); ctx.fill();
      // hull — pointed bow at +x, raked sides from waterline up to the deck
      this._isoPrism(ctx, car, P, [[30, 0], [13, -13], [-22, -13], [-22, 13], [13, 13]], 3, 12, col, 0.5, 0.8, 1.32);
      // cockpit / windshield block set back
      const ck = [[6, 8], [6, -8], [-12, -8], [-12, 8]];
      const KB = ck.map(([lx, ly]) => P(lx, ly, 12)), KT = ck.map(([lx, ly]) => P(lx, ly, 21));
      ctx.fillStyle = "#12233a";
      for (let i = 0; i < 4; i++) { const A = KB[i], B = KB[(i + 1) % 4], C = KT[(i + 1) % 4], D = KT[i]; ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.lineTo(C[0], C[1]); ctx.lineTo(D[0], D[1]); ctx.closePath(); ctx.fill(); }
      ctx.fillStyle = "rgba(150,200,255,0.5)"; ctx.beginPath(); ctx.moveTo(KT[0][0], KT[0][1]); for (let i = 1; i < 4; i++) ctx.lineTo(KT[i][0], KT[i][1]); ctx.closePath(); ctx.fill();
      // bow spray fleck
      const bs = P(28, 0, 4); ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.beginPath(); ctx.ellipse(bs[0], bs[1], 4 * z, 2.5 * z, 0, 0, Math.PI * 2); ctx.fill();
    }

    _isoHeli(ctx, car, P, z) {
      const col = car.color, H = 14; // hover height of the fuselage above the skids
      ctx.lineCap = "round";
      // skids on the ground + struts up to the body
      ctx.strokeStyle = "rgba(20,20,20,0.85)"; ctx.lineWidth = 2.6 * z;
      for (const off of [-13, 13]) { const s0 = P(-12, off, 1), s1 = P(15, off, 1); ctx.beginPath(); ctx.moveTo(s0[0], s0[1]); ctx.lineTo(s1[0], s1[1]); ctx.stroke(); }
      ctx.strokeStyle = "rgba(30,30,30,0.7)"; ctx.lineWidth = 2 * z;
      for (const [lx, ly] of [[-7, -13], [9, -13], [-7, 13], [9, 13]]) { const a = P(lx, ly, 1), b = P(lx, ly * 0.66, H); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
      // tail boom backward (-x) + vertical fin + tail rotor
      const tb0 = P(-14, 0, H + 6), tb1 = P(-36, 0, H + 6);
      ctx.strokeStyle = shade(col, 0.7); ctx.lineWidth = 5 * z; ctx.beginPath(); ctx.moveTo(tb0[0], tb0[1]); ctx.lineTo(tb1[0], tb1[1]); ctx.stroke();
      const tf = P(-38, 0, H + 15); ctx.lineWidth = 3 * z; ctx.beginPath(); ctx.moveTo(tb1[0], tb1[1]); ctx.lineTo(tf[0], tf[1]); ctx.stroke();
      // spinning tail rotor disc
      const trSpin = this.time * 40;
      ctx.strokeStyle = "rgba(30,34,42,0.85)"; ctx.lineWidth = 2 * z;
      for (const off of [0, Math.PI / 2]) { const th = trSpin + off, t0 = P(-37, Math.cos(th) * 8, H + 6 + Math.sin(th) * 8), t1 = P(-37, -Math.cos(th) * 8, H + 6 - Math.sin(th) * 8); ctx.beginPath(); ctx.moveTo(t0[0], t0[1]); ctx.lineTo(t1[0], t1[1]); ctx.stroke(); }
      // fuselage prism (hovering)
      this._isoPrism(ctx, car, P, [[20, 0], [11, -11], [-15, -11], [-17, 0], [-15, 11], [11, 11]], H, H + 13, col, 0.55, 0.82, 1.3);
      // canopy bubble at the nose
      const cp = P(13, 0, H + 9); ctx.fillStyle = "rgba(150,200,255,0.6)"; ctx.beginPath(); ctx.ellipse(cp[0], cp[1], 7 * z, 5 * z, 0, 0, Math.PI * 2); ctx.fill();
      // main rotor — bright disc + rim + sweep arc + 4 spinning blades
      const rh = H + 23, rad = 31, spin = this.time * 26, ring = [];
      for (let i = 0; i <= 24; i++) { const th = (i / 24) * Math.PI * 2; ring.push(P(Math.cos(th) * rad, Math.sin(th) * rad, rh)); }
      ctx.fillStyle = "rgba(225,234,246,0.22)"; ctx.beginPath(); ctx.moveTo(ring[0][0], ring[0][1]); for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i][0], ring[i][1]); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(235,242,252,0.45)"; ctx.lineWidth = 1.6 * z; ctx.beginPath(); ctx.moveTo(ring[0][0], ring[0][1]); for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i][0], ring[i][1]); ctx.closePath(); ctx.stroke();
      // bright leading arc to read as spin
      ctx.strokeStyle = "rgba(255,255,255,0.6)"; ctx.lineWidth = 3.2 * z; ctx.beginPath();
      for (let i = 0; i <= 6; i++) { const th = spin + (i / 6) * 1.3, p = P(Math.cos(th) * rad, Math.sin(th) * rad, rh); if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); }
      ctx.stroke();
      ctx.strokeStyle = "rgba(28,32,40,0.9)"; ctx.lineWidth = 2.6 * z;
      for (const off of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) { const th = spin + off, e = P(Math.cos(th) * rad, Math.sin(th) * rad, rh), m = P(0, 0, rh); ctx.beginPath(); ctx.moveTo(m[0], m[1]); ctx.lineTo(e[0], e[1]); ctx.stroke(); }
      const hub = P(0, 0, rh); ctx.fillStyle = "#33373f"; ctx.beginPath(); ctx.ellipse(hub[0], hub[1], 4.5 * z, 3.2 * z, 0, 0, Math.PI * 2); ctx.fill();
    }

    _drawBridgeIso(ctx, pg, zoom) {
      const bz = this.track.bridge, mid = ((bz[0] + bz[1]) / 2) * this.N;
      const p = pointAtProgress(this.pts, mid), tan = tangentAtProgress(this.pts, mid);
      const half = this.track.width / 2 + 8, len = this.track.width * 2.3;
      const fx = Math.cos(tan), fy = Math.sin(tan), nx = -Math.sin(tan), ny = Math.cos(tan);
      const corner = (a, o) => ({ x: p.x + fx * a + nx * o, y: p.y + fy * a + ny * o });
      const cs = [corner(-len / 2, -half), corner(len / 2, -half), corner(len / 2, half), corner(-len / 2, half)];
      const base = cs.map((q) => pg(q.x, q.y)), dh = 30 * zoom * base[0][2], top = base.map((q) => [q[0], q[1] - dh]);
      ctx.fillStyle = "#241f2e"; // support sides
      for (let i = 0; i < 4; i++) {
        const a = base[i], b2 = base[(i + 1) % 4], c2 = top[(i + 1) % 4], d2 = top[i];
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b2[0], b2[1]); ctx.lineTo(c2[0], c2[1]); ctx.lineTo(d2[0], d2[1]); ctx.closePath(); ctx.fill();
      }
      const pat = ctx.createPattern(getDirtTile(this.track.theme.dirt), "repeat");
      ctx.fillStyle = pat || this.track.theme.dirt;
      ctx.beginPath(); ctx.moveTo(top[0][0], top[0][1]); for (let i = 1; i < 4; i++) ctx.lineTo(top[i][0], top[i][1]); ctx.closePath(); ctx.fill();
      ctx.lineWidth = 4; ctx.strokeStyle = "#ff3df2";
      ctx.beginPath(); ctx.moveTo(top[0][0], top[0][1]); ctx.lineTo(top[1][0], top[1][1]); ctx.stroke();
      ctx.strokeStyle = "#3df2ff";
      ctx.beginPath(); ctx.moveTo(top[3][0], top[3][1]); ctx.lineTo(top[2][0], top[2][1]); ctx.stroke();
    }

    _render() {
      if (this.cfg.iso) return this._renderIso();
      const ctx = this.ctx, c = this.canvas;
      if (c.width !== Math.floor(c.clientWidth * this.dpr)) this._resize();
      const W = c.width, H = c.height, p = this.player;
      // Static "set piece" camera: frame the ENTIRE track at once (Super Off Road
      // style) so every truck stays on screen and the world never pans or zooms.
      const b = this.bbox;
      // Arcade layout: upper area is the "monitor", lower third the controls.
      // Fill the play area aggressively (don't waste space around the track).
      const bands = uiBands(H, this.dpr, this.cfg.touch);
      const topUI = bands.top, botUI = bands.bot;
      const availH = H - topUI - botUI;
      const zoom = Math.min(W / (b.w * 1.0), availH / (b.h * 1.0));
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
      this._drawPickups(ctx);
      // cars sorted so airborne draw last; trucks under the bridge first, then the
      // elevated deck, then trucks on the bridge — so the overpass reads correctly.
      const ordered = [...this.cars].sort((a, b) => a.z - b.z);
      ordered.filter((c) => !c.onBridge).forEach((car) => this._drawCar(ctx, car));
      if (this.track.bridge) this._drawBridge(ctx);
      ordered.filter((c) => c.onBridge).forEach((car) => this._drawCar(ctx, car));
      this._drawParticles(ctx, true); // airborne dust over cars
      this._drawFloats(ctx);

      ctx.restore();

      this._drawVignette(ctx, W, H);
      if (this.countdown > 0) this._drawCountdown(ctx, W, H);
      if (p.z > 4) this._drawAir(ctx, W, H);
    }

    _drawCar(ctx, car) {
      const sprite = (window.makeTruckSprite || truckSprite)(car.vehicleId, car.color, car.isPlayer);
      const lift = car.z + (car.bridgeZ || 0);
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
      const mul = (car.isPlayer ? 2.9 : 2.6) * this.truckScale;
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
