/* game.js — the race engine: top-down arcade physics, AI trucks,
 * lap tracking, rendering and input. One Race instance per race.
 */
(function () {
  // ---------- small math helpers ----------
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  function angWrap(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }

  // Closest point on a closed polyline. Returns {dist, progress} where progress
  // is segIndex + t (0..N), used for lap counting and race position.
  function closestOnLoop(pts, px, py) {
    const N = pts.length;
    let best = Infinity, bestProg = 0, bx = 0, by = 0;
    for (let i = 0; i < N; i++) {
      const a = pts[i], b = pts[(i + 1) % N];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len2 = dx * dx + dy * dy || 1;
      let t = ((px - a.x) * dx + (py - a.y) * dy) / len2;
      t = clamp(t, 0, 1);
      const cx = a.x + dx * t, cy = a.y + dy * t;
      const d = (px - cx) * (px - cx) + (py - cy) * (py - cy);
      if (d < best) { best = d; bestProg = i + t; bx = cx; by = cy; }
    }
    return { dist: Math.sqrt(best), progress: bestProg, x: bx, y: by };
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
  const CAR_W = 38, CAR_H = 22;

  // ---------- a single vehicle ----------
  class Car {
    constructor(opts) {
      Object.assign(this, opts);
      this.speed = 0;
      this.vx = 0; this.vy = 0; // lateral drift carried separately for feel
      this.lap = 0;
      this.lapProg = this.startProg;     // monotonic progress used for ranking
      this.lapProgRaw = this.startProg;  // raw monotonic progress (AI lookahead)
      this._lastProgRaw = this.startProg;
      this.finished = false;
      this.finishTime = 0;
      this.position = 0;
      this.nitro = 100;
      this.nitroActive = false;
      this.lapStart = 0; this.lastLap = null; this.bestLapThisRace = null;
    }
  }

  // ---------- the race ----------
  class Race {
    constructor(canvas, cfg) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.cfg = cfg; // { track, perf, aiStrength, onUpdate, onFinish }
      this.track = cfg.track;
      this.pts = cfg.track.points;
      this.N = this.pts.length;
      this.cars = [];
      this.running = false;
      this.paused = false;
      this.time = 0;
      this.countdown = 3.2;
      this.finishOrder = [];
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);

      this.input = { left: false, right: false, gas: false, brake: false, nitro: false };
      this._bound = {};
      this._buildCars();
      this._resize();
    }

    _buildCars() {
      const startProg = 0.15;
      const tan = tangentAtProgress(this.pts, startProg);
      const normal = tan + Math.PI / 2;
      const base = pointAtProgress(this.pts, startProg);
      const total = 6; // player + 5 AI
      const perf = this.cfg.perf;

      for (let i = 0; i < total; i++) {
        const isPlayer = i === 0;
        // stagger across track width and slightly along track
        const lane = (i % 3) - 1;       // -1,0,1
        const row = Math.floor(i / 3);  // 0,1
        const along = startProg - row * 0.45;
        const p = pointAtProgress(this.pts, (along + this.N) % this.N);
        const lateral = lane * (this.track.width * 0.26);

        // Each rival has a stable skill bias (so standings are believable),
        // plus a little race-to-race variance.
        const rivalBias = [0.05, 0.025, 0.0, -0.02, -0.045];
        const bias = isPlayer ? 0 : (rivalBias[i - 1] || 0);
        const aiSkill = isPlayer ? 1 : this.cfg.aiStrength * (1 + bias) * (0.985 + Math.random() * 0.03);

        // base stats (player modified by upgrades, AI by difficulty)
        const stats = isPlayer ? {
          maxSpeed: 375 * perf.maxSpeed,
          accel: 270 * perf.accel,
          turn: 3.2 * perf.turn,
          grip: 0.86 + 0.03 * (perf.grip - 1) * 10,
          offroad: 0.5 + 0.06 * (perf.offroad - 1) * 10, // off-track speed factor (higher=better)
          nitroPower: 1.55 * perf.nitroPower,
          nitroRefill: 9 * perf.nitroRefill,
        } : {
          maxSpeed: 375 * aiSkill,
          accel: 270 * aiSkill,
          turn: 3.15,
          grip: 0.87,
          offroad: 0.55,
          nitroPower: 1.5,
          nitroRefill: 8,
        };
        stats.offroad = clamp(stats.offroad, 0.42, 0.92);

        this.cars.push(new Car({
          x: p.x + Math.cos(normal) * lateral,
          y: p.y + Math.sin(normal) * lateral,
          angle: tan,
          color: CAR_COLORS[i % CAR_COLORS.length],
          isPlayer,
          rivalIndex: isPlayer ? -1 : i - 1,
          startProg: (along + this.N) % this.N,
          stats,
          aiSkill,
          aiAggro: 0.5 + Math.random() * 0.5,
        }));
      }
      this.player = this.cars[0];
    }

    // ---------- lifecycle ----------
    start() {
      this.running = true;
      this._attachInput();
      this.last = performance.now();
      this._loop = this._frame.bind(this);
      requestAnimationFrame(this._loop);
    }
    stop() {
      this.running = false;
      this._detachInput();
    }
    setPaused(p) {
      this.paused = p;
      if (!p && this.running) { this.last = performance.now(); requestAnimationFrame(this._loop); }
    }

    _frame(now) {
      if (!this.running) return;
      if (this.paused) return;
      let dt = (now - this.last) / 1000;
      this.last = now;
      dt = Math.min(dt, 0.05); // clamp big gaps (tab switches)
      this._update(dt);
      this._render();
      if (this.running) requestAnimationFrame(this._loop);
    }

    // ---------- input ----------
    _attachInput() { window.Input.init(); window.Input.reset(); }
    _detachInput() { window.Input.reset(); }

    // ---------- simulation ----------
    _update(dt) {
      this.time += this.countdown > 0 ? 0 : dt;
      if (this.countdown > 0) { this.countdown -= dt; }
      const racing = this.countdown <= 0;

      for (const car of this.cars) {
        if (car.finished) { this._integrateStopped(car, dt); continue; }
        let ctrl;
        if (car.isPlayer) ctrl = this._playerControl();
        else ctrl = this._aiControl(car);
        if (!racing) ctrl = { steer: 0, throttle: 0, brake: 0, nitro: false };
        this._drive(car, ctrl, dt);
        this._trackLogic(car, dt, racing);
      }
      this._separate();
      this._rank();
      this._emitHud();
    }

    _playerControl() {
      const i = window.Input;
      return { steer: i.steer, throttle: i.throttle, brake: i.brake, nitro: i.nitro };
    }

    _aiControl(car) {
      // Aim at a point ahead on the racing line; ease throttle in sharp bends.
      const look = 2.2 + car.speed / 140;
      const targetProg = car.lapProgRaw + look;
      const tp = pointAtProgress(this.pts, ((targetProg % this.N) + this.N) % this.N);
      const desired = Math.atan2(tp.y - car.y, tp.x - car.x);
      const diff = angWrap(desired - car.angle);
      const steer = clamp(diff * 2.2, -1, 1);

      const sharp = Math.abs(diff);
      let throttle = sharp > 1.0 ? 0.62 : sharp > 0.55 ? 0.88 : 1;
      // off-track recovery: if far from line, steer harder & ease off
      if (car._offTrack) throttle *= 0.88;
      const nitro = car.nitro > 45 && sharp < 0.3 && car.aiAggro > 0.45;
      return { steer, throttle, brake: 0, nitro };
    }

    _drive(car, ctrl, dt) {
      const s = car.stats;

      // nitro
      car.nitroActive = false;
      let maxSpeed = s.maxSpeed;
      let accel = s.accel;
      if (ctrl.nitro && car.nitro > 1) {
        car.nitro = Math.max(0, car.nitro - 32 * dt);
        maxSpeed *= s.nitroPower;
        accel *= 1.7;
        car.nitroActive = true;
      } else {
        car.nitro = Math.min(100, car.nitro + s.nitroRefill * dt);
      }

      // off-track penalty
      const offFactor = car._offTrack ? s.offroad : 1;
      maxSpeed *= offFactor;

      // longitudinal — analog throttle (stick position sets target speed)
      const th = ctrl.throttle || 0;
      if (th > 0.02) {
        const cap = maxSpeed * Math.max(th, 0.35);
        if (car.speed < cap) car.speed += accel * dt;
        else car.speed = Math.max(cap, car.speed - 220 * dt);
      } else {
        car.speed -= 160 * dt; // coast / rolling drag
      }
      if (ctrl.brake > 0) car.speed -= 460 * ctrl.brake * dt;
      car.speed = clamp(car.speed, -120, maxSpeed);
      if (th <= 0.02 && ctrl.brake <= 0 && Math.abs(car.speed) < 8) car.speed = 0;

      // steering — smoothed + scaled by speed so you can't spin in place
      if (car.steerS === undefined) car.steerS = 0;
      car.steerS += (ctrl.steer - car.steerS) * Math.min(1, dt * 13);
      const speedFrac = clamp(Math.abs(car.speed) / s.maxSpeed, 0, 1);
      const steerAuthority = s.turn * (0.35 + 0.65 * Math.min(1, speedFrac * 1.6));
      car.angle += car.steerS * steerAuthority * dt * Math.sign(car.speed || 1);

      // velocity with a touch of drift (grip blends heading & momentum)
      const hx = Math.cos(car.angle), hy = Math.sin(car.angle);
      const desiredVx = hx * car.speed, desiredVy = hy * car.speed;
      const grip = car._offTrack ? s.grip * 0.7 : s.grip;
      car.vx = lerp(car.vx, desiredVx, grip);
      car.vy = lerp(car.vy, desiredVy, grip);
      car.x += car.vx * dt;
      car.y += car.vy * dt;
    }

    _integrateStopped(car, dt) {
      car.speed *= 0.92;
      car.x += Math.cos(car.angle) * car.speed * dt;
      car.y += Math.sin(car.angle) * car.speed * dt;
    }

    _trackLogic(car, dt, racing) {
      const c = closestOnLoop(this.pts, car.x, car.y);

      // invisible edge walls — keep the truck on the dirt, slide along the edge
      const maxOff = this.track.width / 2 - 12;
      if (c.dist > maxOff) {
        let nx = car.x - c.x, ny = car.y - c.y;
        const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
        car.x = c.x + nx * maxOff; car.y = c.y + ny * maxOff;
        const vn = car.vx * nx + car.vy * ny;
        if (vn > 0) { car.vx -= nx * vn; car.vy -= ny * vn; }
      }
      car._offTrack = false;
      car._distToLine = Math.min(c.dist, maxOff);

      // monotonic progress (raw) for ranking & AI lookahead
      let prog = c.progress;
      let delta = prog - (car._lastProgRaw === undefined ? prog : car._lastProgRaw % this.N);
      if (delta < -this.N / 2) delta += this.N;      // forward wrap
      else if (delta > this.N / 2) delta -= this.N;  // backward wrap
      if (car.lapProgRaw === undefined) car.lapProgRaw = prog;
      car.lapProgRaw += delta;
      car._lastProgRaw = prog;

      // lap counting from monotonic progress
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
          car.finished = true;
          car.finishTime = this.time;
          this.finishOrder.push(car);
          this._checkRaceEnd();
        }
      }
      car.lapProg = car.lapProgRaw;
    }

    _separate() {
      const minDist = CAR_W * 0.9;
      for (let i = 0; i < this.cars.length; i++) {
        for (let j = i + 1; j < this.cars.length; j++) {
          const a = this.cars[i], b = this.cars[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          let d = Math.hypot(dx, dy);
          if (d < minDist && d > 0.001) {
            const nx = dx / d, ny = dy / d;
            const push = (minDist - d) / 2;
            a.x -= nx * push; a.y -= ny * push;
            b.x += nx * push; b.y += ny * push;

            // Only react when the cars are actually closing along the contact
            // normal — side-by-side rubbing shouldn't bleed off speed.
            const rvn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
            if (rvn < 0) {
              // bounce their velocities apart a little so they deflect instead
              // of grinding together frame after frame
              const imp = -rvn * 0.6;
              a.vx -= nx * imp; a.vy -= ny * imp;
              b.vx += nx * imp; b.vy += ny * imp;
              // gentle, impact-scaled speed loss (max ~5% on a hard head-on)
              const scrub = 1 - 0.05 * Math.min(1, -rvn / 320);
              a.speed *= scrub; b.speed *= scrub;
            }
          }
        }
      }
    }

    _rank() {
      const sorted = [...this.cars].sort((a, b) => {
        if (a.finished && b.finished) return a.finishTime - b.finishTime;
        if (a.finished) return -1;
        if (b.finished) return 1;
        return b.lapProg - a.lapProg;
      });
      sorted.forEach((c, i) => (c.position = i + 1));
    }

    _checkRaceEnd() {
      // End shortly after the player finishes (don't wait for the backmarkers).
      if (this.player.finished) {
        // fill remaining finish order by current rank
        const remaining = this.cars.filter((c) => !this.finishOrder.includes(c))
          .sort((a, b) => b.lapProg - a.lapProg);
        remaining.forEach((c) => this.finishOrder.push(c));
        this.stop();
        const order = this.finishOrder.map((c) => ({ isPlayer: c.isPlayer, rivalIndex: c.rivalIndex, color: c.color }));
        setTimeout(() => this.cfg.onFinish(order), 350);
      }
    }

    _emitHud() {
      if (!this.cfg.onUpdate) return;
      const p = this.player;
      this.cfg.onUpdate({
        lap: Math.min(p.lap + 1, this.track.laps),
        laps: this.track.laps,
        pos: p.position,
        total: this.cars.length,
        time: this.time,
        nitro: p.nitro,
        speed: clamp(Math.abs(p.speed) / (p.stats.maxSpeed * p.stats.nitroPower), 0, 1),
        countdown: this.countdown,
        finished: p.finished,
        lapTime: this.time - p.lapStart, lastLap: p.lastLap, bestLap: p.bestLapThisRace, lapsDone: p.lap,
      });
    }

    // ---------- rendering ----------
    _resize() {
      const c = this.canvas;
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      c.width = Math.floor(c.clientWidth * this.dpr);
      c.height = Math.floor(c.clientHeight * this.dpr);
    }

    _render() {
      const ctx = this.ctx, c = this.canvas;
      if (c.width !== Math.floor(c.clientWidth * this.dpr)) this._resize();
      const W = c.width, H = c.height;
      const p = this.player;

      // camera: follow player, look a bit ahead, zoom out a touch with speed
      const zoom = (Math.min(W, H) / 900) * 1.0;
      const aheadX = p.x + Math.cos(p.angle) * 120;
      const aheadY = p.y + Math.sin(p.angle) * 120;
      this.camX = this.camX === undefined ? p.x : lerp(this.camX, aheadX, 0.08);
      this.camY = this.camY === undefined ? p.y : lerp(this.camY, aheadY, 0.08);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      // grass background
      ctx.fillStyle = "#3f6b2e";
      ctx.fillRect(0, 0, W, H);
      this._grassTexture(ctx, W, H, zoom);

      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.scale(zoom, zoom);
      ctx.translate(-this.camX, -this.camY);

      this._drawTrack(ctx);
      this._drawStartLine(ctx);
      for (const car of this.cars) this._drawCar(ctx, car);

      ctx.restore();

      if (this.countdown > 0) this._drawCountdown(ctx, W, H);
    }

    _grassTexture(ctx, W, H, zoom) {
      // subtle moving dapple so motion is readable on plain grass
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.06)";
      const grid = 80 * zoom;
      const ox = (-this.camX * zoom) % grid;
      const oy = (-this.camY * zoom) % grid;
      for (let x = ox - grid; x < W + grid; x += grid) {
        for (let y = oy - grid; y < H + grid; y += grid) {
          if (((Math.round((x - ox) / grid) + Math.round((y - oy) / grid)) & 1) === 0)
            ctx.fillRect(x, y, grid, grid);
        }
      }
      ctx.restore();
    }

    _drawTrack(ctx) {
      const pts = this.pts;
      const path = new Path2D();
      path.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) path.lineTo(pts[i].x, pts[i].y);
      path.closePath();

      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      // dark edge
      ctx.strokeStyle = "#5a3c20";
      ctx.lineWidth = this.track.width + 16;
      ctx.stroke(path);
      // dirt
      ctx.strokeStyle = "#b07a45";
      ctx.lineWidth = this.track.width;
      ctx.stroke(path);
      // centre rut hint
      ctx.strokeStyle = "rgba(107,74,41,0.5)";
      ctx.lineWidth = 6;
      ctx.setLineDash([18, 26]);
      ctx.stroke(path);
      ctx.setLineDash([]);
    }

    _drawStartLine(ctx) {
      const prog = 0.0;
      const a = pointAtProgress(this.pts, prog);
      const tan = tangentAtProgress(this.pts, prog);
      const nx = Math.cos(tan + Math.PI / 2), ny = Math.sin(tan + Math.PI / 2);
      const half = this.track.width / 2;
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(tan);
      const w = this.track.width, sq = 14;
      for (let i = -Math.floor(half / sq); i < Math.floor(half / sq); i++) {
        ctx.fillStyle = (i & 1) ? "#fff" : "#222";
        ctx.fillRect(-sq, i * sq, sq, sq);
        ctx.fillStyle = (i & 1) ? "#222" : "#fff";
        ctx.fillRect(0, i * sq, sq, sq);
      }
      ctx.restore();
    }

    _drawCar(ctx, car) {
      ctx.save();
      ctx.translate(car.x, car.y);
      ctx.rotate(car.angle);

      // dust when fast / off-track
      if (Math.abs(car.speed) > 60) {
        const intensity = car._offTrack ? 0.5 : 0.22;
        ctx.fillStyle = `rgba(150,120,80,${intensity})`;
        ctx.beginPath();
        ctx.ellipse(-CAR_W * 0.7, 0, CAR_W * 0.5, CAR_H * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // nitro flame
      if (car.nitroActive) {
        ctx.fillStyle = "rgba(80,200,255,0.85)";
        ctx.beginPath();
        ctx.moveTo(-CAR_W / 2, -5);
        ctx.lineTo(-CAR_W / 2 - 20, 0);
        ctx.lineTo(-CAR_W / 2, 5);
        ctx.fill();
      }

      // shadow
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      roundRect(ctx, -CAR_W / 2 + 2, -CAR_H / 2 + 3, CAR_W, CAR_H, 5);
      ctx.fill();

      // body
      ctx.fillStyle = car.color;
      roundRect(ctx, -CAR_W / 2, -CAR_H / 2, CAR_W, CAR_H, 5);
      ctx.fill();
      // cabin
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      roundRect(ctx, -CAR_W * 0.1, -CAR_H / 2 + 3, CAR_W * 0.34, CAR_H - 6, 3);
      ctx.fill();
      // wheels
      ctx.fillStyle = "#1a1a1a";
      ctx.fillRect(-CAR_W / 2 + 3, -CAR_H / 2 - 3, 9, 5);
      ctx.fillRect(-CAR_W / 2 + 3, CAR_H / 2 - 2, 9, 5);
      ctx.fillRect(CAR_W / 2 - 12, -CAR_H / 2 - 3, 9, 5);
      ctx.fillRect(CAR_W / 2 - 12, CAR_H / 2 - 2, 9, 5);

      if (car.isPlayer) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        roundRect(ctx, -CAR_W / 2, -CAR_H / 2, CAR_W, CAR_H, 5);
        ctx.stroke();
      }
      ctx.restore();
    }

    _drawCountdown(ctx, W, H) {
      const n = Math.ceil(this.countdown - 0.2);
      let txt = n > 0 ? String(n) : "GO!";
      if (this.countdown <= 0.2 && this.countdown > -0.6) txt = "GO!";
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `bold ${Math.min(W, H) * 0.22}px Trebuchet MS, sans-serif`;
      ctx.fillStyle = txt === "GO!" ? "#5fd35f" : "#ffb43a";
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.lineWidth = 8;
      ctx.strokeText(txt, W / 2, H / 2);
      ctx.fillText(txt, W / 2, H / 2);
      ctx.restore();
    }
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

  window.Race = Race;
})();
