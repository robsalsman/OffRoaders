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

["js/tracks.js", "js/vehicles.js", "js/characters.js", "js/career.js", "js/input.js", "js/game.js"].forEach(loadFile);

let failures = 0;
function assert(cond, msg) {
  if (!cond) { console.error("  ✗ " + msg); failures++; }
  else console.log("  ✓ " + msg);
}

// ---- 1. tracks ----
console.log("Tracks:");
assert(ctx.TRACKS.length === 12, "12 tracks defined");
assert(ctx.TRACKS.every((t) => t.points.length > 20), "all tracks have point loops");
assert(ctx.TRACKS.every((t) => ctx.getCharacter(t.home)), "every track has a valid home driver");
assert(new Set(ctx.TRACKS.map((t) => t.home)).size === 6, "home tracks span all 6 drivers");

// ---- 2. career ----
console.log("Career:");
const C = ctx.Career;
C.newCareer();
assert(C.state.money === 800, "starts with 800 cash");
const vid = C.vehicleId();
const cost = C.upgradeCostFor(vid, "engine");
assert(C.buy(vid, "engine"), "can buy first engine upgrade on the truck");
assert(C.state.money === 800 - cost, "cash deducted after buy");
assert(C.upgradeLevel(vid, "engine") === 1, "engine upgrade level is 1");
// driver training & roster
C.state.money = 5000;
assert(C.train(C.driverId(), "handling") === true, "can train the driver");
const roster = C.buildRoster(C.currentTrack().id);
assert(roster.length === 6, "roster has 6 racers");
assert(roster[0].isPlayer && roster.filter(r => !r.isPlayer).length === 5, "1 player + 5 rivals");
assert(new Set(roster.map(r => r.vehicleId)).size === 6, "all 6 trucks are unique on the grid");
assert(new Set(roster.map(r => r.characterId)).size === 6, "all 6 drivers are unique on the grid");

// ---- 3. simulate a full race ----
console.log("Race simulation:");
const track = C.currentTrack();
let finished = null;
const race = new ctx.Race(canvas, {
  track,
  roster: C.buildRoster(track.id),
  onUpdate: () => {},
  onFinish: (order) => { finished = order; },
});
race.countdown = 0; // skip countdown for the test

// player drives via the shared analog Input (test override: set fields directly)
ctx.Input.override = true;
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

  // lap timing & records
  const bl = race.player.bestLapThisRace;
  assert(bl != null && bl > 0, "player best lap recorded: " + (bl && bl.toFixed(2)) + "s");
  assert(race.player.finishTime > bl, "race time longer than a single lap");
  assert(C.submitLap(track.id, bl) === true, "first lap time sets a lap record");
  assert(C.getRecord(track.id).lap === bl, "lap record persisted");
  assert(C.submitLap(track.id, bl + 1) === false, "a slower lap does not beat the record");
  assert(C.submitRace(track.id, race.player.finishTime) === true, "race time sets a track record");

  // record result into career
  const res = C.recordResult(finished);
  assert(typeof res.prize === "number" && res.prize > 0, "prize awarded: " + res.prize);
  assert(C.state.season.completed.length === 1, "season recorded the completed race");
  const total = C.sortedStandings().reduce((a, r) => a + r.points, 0);
  assert(total > 0, "championship points distributed");
}

console.log(failures === 0 ? "\nALL PASS ✅" : `\n${failures} FAILURE(S) ❌`);
process.exit(failures === 0 ? 0 : 1);
