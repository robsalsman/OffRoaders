/* tracks.js — 6 courses, one home track per driver. Each has a distinct
 * theme (colours), shape, ramps and signature feature. `home` is the driver id
 * whose home track it is (that driver gets a boost there).
 * `ramps` and `mud` are progress fractions (0..1) around the loop.
 *
 * Shapes come from two engine-safe generators: hand-placed Catmull-Rom splines
 * (mesa/neon/thunder — distinct silhouettes & S-curves) and dense polar waves
 * (canyon/gravel/lab — scalloped technical corners). Neither self-crosses, since
 * the lap/progress + edge-wall systems rely on nearest-point-on-path and a true
 * overpass would confuse them.
 */
(function () {
  // closed Catmull-Rom spline through the waypoints -> dense point loop
  function spline(wp, total = 100) {
    const n = wp.length, seg = Math.max(3, Math.round(total / n)), pts = [];
    for (let i = 0; i < n; i++) {
      const p0 = wp[(i - 1 + n) % n], p1 = wp[i], p2 = wp[(i + 1) % n], p3 = wp[(i + 2) % n];
      for (let j = 0; j < seg; j++) {
        const t = j / seg, t2 = t * t, t3 = t2 * t;
        pts.push({
          x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
          y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
        });
      }
    }
    return pts;
  }
  const W = (pairs) => pairs.map(([x, y]) => ({ x, y }));
  // Densely-sampled polar curve r(θ). Since r stays positive and each angle maps to
  // one radius, the loop is mathematically simple (never self-crosses) — so it's
  // always engine-safe, while a strong radiusFn gives scalloped, technical corners.
  function wave(base, samples, fn, sx = 1, sy = 1, rot = 0) {
    const pts = [];
    for (let i = 0; i < samples; i++) {
      const t = (i / samples) * Math.PI * 2, r = base * fn(t);
      const x = Math.cos(t) * r * sx, y = Math.sin(t) * r * sy;
      pts.push({ x: x * Math.cos(rot) - y * Math.sin(rot), y: x * Math.sin(rot) + y * Math.cos(rot) });
    }
    return pts;
  }

  const TRACKS = [
    {
      // wide flowing asymmetric loop with sweeping bulges
      id: "mesa", name: "Blazing Mesa", home: "hotrod",
      laps: 4, width: 200, difficulty: 2, feature: "Fast flowing sweepers",
      theme: { ground: "#8a4326", groundDark: "#6e3219", dirt: "#d98c4a", dirtDark: "#6e3a18", rut: "#7a4520" },
      ramps: [0.12, 0.55, 0.82], mud: [], whoops: [0.68],
      points: spline(W([
        [-120, -760], [380, -700], [620, -380], [430, -120], [690, 120],
        [640, 470], [300, 720], [-180, 770], [-560, 600], [-680, 220],
        [-560, -160], [-660, -520], [-440, -760],
      ]), 104),
    },
    {
      // long S-curve kidney — big sweeping left/right transitions
      id: "neon", name: "Neon City", home: "rob",
      laps: 4, width: 215, difficulty: 3, feature: "Long drift sweepers",
      theme: { ground: "#201f38", groundDark: "#15132233", dirt: "#4b475f", dirtDark: "#211d2e", rut: "#5a5570" },
      ramps: [0.28, 0.78], mud: [],
      points: spline(W([
        [0, -800], [430, -600], [470, -180], [250, 60], [470, 300],
        [460, 660], [80, 850], [-380, 800], [-640, 440], [-660, -40],
        [-560, -520], [-260, -780],
      ]), 108),
    },
    {
      // tight technical — 5 scalloped corners, elliptical
      id: "canyon", name: "Dust Canyon", home: "west",
      laps: 4, width: 160, difficulty: 4, feature: "Tight & technical",
      theme: { ground: "#b9863f", groundDark: "#9c6a2c", dirt: "#cca162", dirtDark: "#7a5226", rut: "#8a6230" },
      ramps: [0.4, 0.88], mud: [0.18, 0.62], surface: "mud", whoops: [0.52],
      points: wave(560, 92, (t) => 1 + 0.26 * Math.sin(t * 5) + 0.05 * Math.cos(t * 3), 1.05, 1.16, 0.2),
    },
    {
      // huge rounded rectangle — long straights, wide power turns
      id: "thunder", name: "Thunder Valley", home: "atrain",
      laps: 5, width: 210, difficulty: 3, feature: "Big track, water hazards",
      theme: { ground: "#2e6b46", groundDark: "#24563a", dirt: "#b9925e", dirtDark: "#6e4a28", rut: "#8a6838" },
      ramps: [0.18, 0.5, 0.82], mud: [0.36, 0.72], surface: "water", whoops: [0.12, 0.62],
      points: spline(W([
        [-560, -780], [560, -780], [760, -560], [760, 560], [560, 780],
        [-560, 780], [-760, 560], [-760, -560],
      ]), 112),
    },
    {
      // twisty old-school — 4 wide scallops, stretched
      id: "gravel", name: "Gravel Pit", home: "olddog",
      laps: 5, width: 165, difficulty: 4, feature: "Twisty, sandy",
      theme: { ground: "#566b39", groundDark: "#43542c", dirt: "#9a9484", dirtDark: "#5a5448", rut: "#6a6458" },
      ramps: [0.5], mud: [0.3, 0.7, 0.92], surface: "sand",
      points: wave(560, 90, (t) => 1 + 0.24 * Math.sin(t * 4) + 0.06 * Math.sin(t * 2), 1.2, 0.95, 0.5),
    },
    {
      // precision chicanes — 6 shallow scallops
      id: "lab", name: "Test Loop", home: "drg",
      laps: 4, width: 180, difficulty: 5, feature: "Precision chicanes",
      theme: { ground: "#2e6b3a", groundDark: "#24562f", dirt: "#8f9a8a", dirtDark: "#4a544a", rut: "#6a746a" },
      ramps: [0.35, 0.65, 0.95], mud: [],
      points: wave(620, 96, (t) => 1 + 0.19 * Math.sin(t * 6) + 0.05 * Math.cos(t * 2), 1.1, 1.0, 0.1),
    },
  ];

  // small top-down preview for the track-select cards
  function makeTrackPreview(id, px) {
    const t = TRACKS.find((x) => x.id === id) || TRACKS[0];
    const S = 2, cv = document.createElement("canvas");
    cv.width = px * S; cv.height = px * S;
    cv.style.width = px + "px"; cv.style.height = px + "px";
    const g = cv.getContext("2d");
    g.fillStyle = t.theme.ground; g.fillRect(0, 0, px * S, px * S);
    // fit the loop into the canvas
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of t.points) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
    const pad = t.width, bw = maxX - minX + pad * 2, bh = maxY - minY + pad * 2;
    const sc = Math.min((px * S) / bw, (px * S) / bh);
    g.translate((px * S - bw * sc) / 2 - (minX - pad) * sc, (px * S - bh * sc) / 2 - (minY - pad) * sc);
    g.scale(sc, sc);
    const path = new Path2D();
    path.moveTo(t.points[0].x, t.points[0].y);
    for (let i = 1; i < t.points.length; i++) path.lineTo(t.points[i].x, t.points[i].y);
    path.closePath();
    g.lineJoin = g.lineCap = "round";
    g.strokeStyle = t.theme.dirtDark; g.lineWidth = t.width + 14; g.stroke(path);
    g.strokeStyle = t.theme.dirt; g.lineWidth = t.width; g.stroke(path);
    return cv;
  }

  window.TRACKS = TRACKS;
  window.getTrack = (id) => TRACKS.find((t) => t.id === id) || TRACKS[0];
  window.makeTrackPreview = makeTrackPreview;
})();
