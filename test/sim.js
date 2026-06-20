/* Headless smoke test: stubs the browser, loads the game modules, and
 * simulates a full race to verify physics, lap counting, finishing & career. */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// ---- minimal browser stubs ----
const noopCtx = new Proxy({}, { get: () => () => {} });
const canvas = {
  clientWidth: 800, clientHeight: 600, width: 800, height: 600,
  getContext: () => noopCtx,
};
const store = {};
const ctx = {
  window: {}, document: {
    querySelector: () => null,
    querySelectorAll: () => [],
  },
  navigator: { maxTouchPoints: 0 },
  performance: { now: () => Date.now() },
  requestAnimationFrame: () => 0,
  setTimeout: (fn) => fn(),
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => (store[k] = String(v)),
    removeItem: (k) => delete store[k],
  },
  Path2D: class { moveTo() {} lineTo() {} closePath() {} arcTo() {} beginPath() {} },
  Math, JSON, console, Date,
};
ctx.window = ctx; // game code reads window.* and bare globals
ctx.globalThis = ctx;
vm.createContext(ctx);

function loadFile(rel) {
  const code = fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
  vm.runInContext(code, ctx, { filename: rel });
}

["js/tracks.js", "js/career.js", "js/input.js", "js/game.js"].forEach(loadFile);

let failures = 0;
function assert(cond, msg) {
  if (!cond) { console.error("  ✗ " + msg); failures++; }
  else console.log("  ✓ " + msg);
}

// ---- 1. tracks ----
console.log("Tracks:");
assert(ctx.TRACKS.length === 5, "5 tracks defined");
assert(ctx.TRACKS.every((t) => t.points.length > 20), "all tracks have point loops");

// ---- 2. career ----
console.log("Career:");
const C = ctx.Career;
C.newCareer();
assert(C.state.money === 800, "starts with 800 cash");
const cost = C.upgradeCostFor("engine");
assert(C.buy("engine"), "can buy first engine upgrade");
assert(C.state.money === 800 - cost, "cash deducted after buy");
assert(C.upgradeLevel("engine") === 1, "engine level is 1");

// ---- 3. simulate a full race ----
console.log("Race simulation:");
const track = C.currentTrack();
let finished = null;
const race = new ctx.Race(canvas, {
  track,
  perf: C.performance(),
  aiStrength: C.aiStrength(),
  onUpdate: () => {},
  onFinish: (order) => { finished = order; },
});
race.countdown = 0; // skip countdown for the test

// player drives via the shared analog Input (full throttle); AI drives itself
ctx.Input.throttle = 1;
race._attachInput = () => {}; // don't bind real listeners
race.stop = function () { this.running = false; }; // keep onFinish via setTimeout stub

const dt = 1 / 60;
let steps = 0;
const maxSteps = 60 * 60 * 6; // up to 6 min sim time
while (!finished && steps < maxSteps) {
  // crude autopilot for the player too, so it actually completes laps:
  const p = race.player;
  const look = race.player.lapProgRaw + 2.5;
  const tp = (function () {
    const pts = race.pts, N = pts.length;
    let prog = ((look % N) + N) % N;
    let i = Math.floor(prog) % N;
    const a = pts[i], b = pts[(i + 1) % N], t = prog - Math.floor(prog);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  })();
  const desired = Math.atan2(tp.y - p.y, tp.x - p.x);
  let diff = desired - p.angle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  ctx.Input.throttle = 1;
  ctx.Input.steer = diff < -0.05 ? -1 : diff > 0.05 ? 1 : 0;
  race._update(dt);
  steps++;
}

assert(finished !== null, "race finished within time budget (" + (steps / 60).toFixed(1) + "s sim)");
if (finished) {
  assert(finished.length === 6, "finish order has all 6 cars");
  assert(finished.some((c) => c.isPlayer), "player is in finish order");
  assert(race.player.lap >= track.laps, "player completed required laps (" + race.player.lap + "/" + track.laps + ")");

  // record result into career
  const res = C.recordResult(finished);
  assert(typeof res.prize === "number" && res.prize > 0, "prize awarded: " + res.prize);
  assert(C.state.season.raceIndex === 1, "season advanced to next race");
  const total = C.sortedStandings().reduce((a, r) => a + r.points, 0);
  assert(total > 0, "championship points distributed");
}

console.log(failures === 0 ? "\nALL PASS ✅" : `\n${failures} FAILURE(S) ❌`);
process.exit(failures === 0 ? 0 : 1);
