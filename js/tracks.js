/* tracks.js — 12 courses. Each has a distinct theme, shape, ramps and feature.
 * `home` is a driver id (that driver gets a boost there); the championship races
 * every track. `ramps`/`mud` are progress fractions (0..1) around the loop.
 *
 * Shapes: Catmull-Rom spline circuits + smooth polar `wave` loops + self-crossing
 * `gerono` figure-8s for the bridge tracks. Every turn radius exceeds the barrier
 * offset so the kerb walls never fold across the track (see test/wallcheck).
 * `bridge` marks the elevated progress range of an overpass.
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

  // Gerono lemniscate — a vertical figure-8 that crosses itself once at the
  // centre. phase puts progress 0 on the bottom lobe (clear of the crossing).
  function gerono(a, b, samples, phase = -Math.PI / 2) {
    const pts = [];
    for (let i = 0; i < samples; i++) {
      const t = phase + (i / samples) * Math.PI * 2;
      pts.push({ x: a * Math.sin(t) * Math.cos(t), y: b * Math.sin(t) });
    }
    return pts;
  }
  // Limaçon — a big outer loop with a tight inner loop, crossing itself once at
  // the centre (a different bridge configuration from the figure-8).
  function limacon(R, k, samples, sx = 1, sy = 1) {
    const pts = [];
    for (let i = 0; i < samples; i++) {
      const t = (i / samples) * Math.PI * 2, r = R * (k + Math.cos(t));
      pts.push({ x: r * Math.cos(t) * sx, y: r * Math.sin(t) * sy });
    }
    return pts;
  }
  // Serpentine maze generator: down-fingers from the top edge + up-fingers from the
  // bottom edge, connected at the sides, forming a single weaving non-crossing loop.
  function maze(o) {
    const { x0, x1, yT, yB, dT, dB, top, bot } = o;
    const wp = [{ x: x0, y: yT }];
    for (const [a, b] of top) wp.push({ x: a, y: yT }, { x: a, y: dT }, { x: b, y: dT }, { x: b, y: yT });
    wp.push({ x: x1, y: yT }, { x: x1, y: yB });
    for (const [a, b] of bot) wp.push({ x: a, y: yB }, { x: a, y: dB }, { x: b, y: dB }, { x: b, y: yB });
    wp.push({ x: x0, y: yB });
    return wp;
  }
  const rot = (pts) => pts.map((p) => ({ x: p.y, y: -p.x })); // 90° (horizontal fingers)
  const TRACKS = [
    {
      // open serpentine maze
      id: "mesa", name: "Blazing Mesa", home: "hotrod",
      laps: 4, width: 105, difficulty: 3, feature: "Open maze",
      theme: { ground: "#8a4326", groundDark: "#6e3219", dirt: "#d98c4a", dirtDark: "#6e3a18", rut: "#7a4520" },
      ramps: [0.1, 0.6], mud: [], whoops: [0.85],
      points: spline(maze({ x0: -440, x1: 460, yT: -540, yB: 540, dT: -130, dB: 130, top: [[-300, -130], [130, 300]], bot: [[300, 130], [-130, -300]] }), 200),
    },
    {
      // figure-8 with a neon flyover — the ascending pass goes UNDER the bridge,
      // the descending pass goes OVER it. `bridge` is the elevated progress range.
      id: "neon", name: "Neon City", home: "rob",
      laps: 4, width: 200, difficulty: 3, feature: "Figure-8 flyover",
      theme: { ground: "#201f38", groundDark: "#15132233", dirt: "#4b475f", dirtDark: "#211d2e", rut: "#5a5570" },
      ramps: [0.1, 0.55], mud: [], bridge: [0.69, 0.81], figure8: true,
      points: gerono(1040, 820, 132),
    },
    {
      // horizontal serpentine maze — switchback corridors
      id: "canyon", name: "Dust Canyon", home: "west",
      laps: 4, width: 95, difficulty: 4, feature: "Maze switchbacks",
      theme: { ground: "#b9863f", groundDark: "#9c6a2c", dirt: "#cca162", dirtDark: "#7a5226", rut: "#8a6230" },
      ramps: [0.06], mud: [0.62], surface: "mud", whoops: [0.3],
      points: spline(rot(maze({ x0: -420, x1: 440, yT: -540, yB: 540, dT: -120, dB: 120, top: [[-300, -150], [150, 300]], bot: [[300, 150], [-150, -300]] })), 200),
    },
    {
      // big, fast figure-8 with a flyover and water hazards
      id: "thunder", name: "Thunder Valley", home: "atrain",
      laps: 5, width: 210, difficulty: 3, feature: "Big figure-8 flyover",
      theme: { ground: "#2e6b46", groundDark: "#24563a", dirt: "#b9925e", dirtDark: "#6e4a28", rut: "#8a6838" },
      ramps: [0.15, 0.45], mud: [0.42, 0.9], surface: "water", whoops: [0.1, 0.58],
      bridge: [0.69, 0.81], figure8: true,
      points: gerono(1180, 780, 136),
    },
    {
      // dense serpentine maze — tight weaving corridors
      id: "gravel", name: "Gravel Pit", home: "olddog",
      laps: 5, width: 78, difficulty: 4, feature: "Dense maze",
      theme: { ground: "#566b39", groundDark: "#43542c", dirt: "#9a9484", dirtDark: "#5a5448", rut: "#6a6458" },
      ramps: [0.5], mud: [0.2, 0.7], surface: "sand",
      points: spline(maze({ x0: -440, x1: 460, yT: -560, yB: 560, dT: -110, dB: 110, top: [[-330, -200], [-60, 70], [200, 330]], bot: [[330, 200], [70, -60], [-200, -330]] }), 220),
    },
    {
      // technical horizontal maze — dense switchbacks
      id: "lab", name: "Test Loop", home: "drg",
      laps: 4, width: 78, difficulty: 5, feature: "Technical maze",
      theme: { ground: "#2e6b3a", groundDark: "#24562f", dirt: "#8f9a8a", dirtDark: "#4a544a", rut: "#6a746a" },
      ramps: [0.1, 0.6], mud: [], whoops: [0.85],
      points: spline(rot(maze({ x0: -440, x1: 460, yT: -560, yB: 560, dT: -110, dB: 110, top: [[-330, -200], [-60, 70], [200, 330]], bot: [[330, 200], [70, -60], [-200, -330]] })), 220),
    },
    {
      // Sidewinder — a true serpentine: corridors weave back with walls between them
      id: "sidewinder", name: "Sidewinder", home: "hotrod",
      laps: 4, width: 95, difficulty: 4, feature: "Weaving serpentine",
      theme: { ground: "#9c6b2e", groundDark: "#7a5223", dirt: "#d39a52", dirtDark: "#6e4a22", rut: "#8a5e2a" },
      ramps: [0.5], mud: [], whoops: [0.25, 0.75],
      points: spline(W([
        [-420, -560], [-300, -560], [-300, -120], [-150, -120], [-150, -560], [150, -560],
        [150, -120], [300, -120], [300, -560], [440, -560], [440, 560], [300, 560],
        [300, 120], [150, 120], [150, 560], [-150, 560], [-150, 120], [-300, 120], [-300, 560], [-440, 560],
      ]), 200),
    },
    {
      // Big Dukes — a big, fast banked oval speedway
      id: "bigdukes", name: "Big Dukes", home: "atrain",
      laps: 5, width: 170, difficulty: 2, feature: "Fast oval speedway",
      theme: { ground: "#2b3a55", groundDark: "#223047", dirt: "#8a93a6", dirtDark: "#454d5e", rut: "#6a7388" },
      ramps: [0.25, 0.75], mud: [], whoops: [],
      points: wave(580, 120, (t) => 1 + 0.05 * Math.sin(t * 2), 1.18, 1.28),
    },
    {
      // Cliffhanger — wide horizontal maze with sweeping switchbacks
      id: "cliffhanger", name: "Cliffhanger", home: "west",
      laps: 4, width: 100, difficulty: 4, feature: "Wide maze",
      theme: { ground: "#6e5a44", groundDark: "#574734", dirt: "#b59868", dirtDark: "#6a5436", rut: "#8a7048" },
      ramps: [0.5], mud: [0.18], surface: "sand", whoops: [0.82],
      points: spline(rot(maze({ x0: -440, x1: 460, yT: -540, yB: 540, dT: -130, dB: 130, top: [[-300, -130], [130, 300]], bot: [[300, 130], [-130, -300]] })), 200),
    },
    {
      // Wipeout — a single bold fold weaving back on itself
      id: "wipeout", name: "Wipeout", home: "drg",
      laps: 4, width: 85, difficulty: 4, feature: "Single fold",
      theme: { ground: "#2e6b50", groundDark: "#245640", dirt: "#a89a6a", dirtDark: "#5a5238", rut: "#6a624a" },
      ramps: [0.35, 0.85], mud: [0.6], surface: "mud", whoops: [],
      points: spline(maze({ x0: -400, x1: 420, yT: -540, yB: 540, dT: -110, dB: 110, top: [[-180, 200]], bot: [[180, -200]] }), 170),
    },
    {
      // Blaster — a tall vertical maze with deep weaving fingers
      id: "blaster", name: "Blaster", home: "rob",
      laps: 4, width: 92, difficulty: 3, feature: "Tall maze",
      theme: { ground: "#3a2b55", groundDark: "#2c2143", dirt: "#7a6a9a", dirtDark: "#3a3050", rut: "#5a4f78" },
      ramps: [0.0, 0.5], mud: [], whoops: [0.25, 0.75],
      points: spline(maze({ x0: -360, x1: 380, yT: -620, yB: 620, dT: -160, dB: 160, top: [[-240, -90], [120, 260]], bot: [[260, 120], [-90, -240]] }), 210),
    },
    {
      // Hurricane Gulch — a tight figure-8 flyover with water hazards
      id: "hurricane", name: "Hurricane Gulch", home: "olddog",
      laps: 5, width: 190, difficulty: 5, feature: "Figure-8 flyover",
      theme: { ground: "#2e4a55", groundDark: "#243a45", dirt: "#7a8a90", dirtDark: "#44545a", rut: "#647480" },
      ramps: [0.12, 0.55], mud: [0.4, 0.9], surface: "water", whoops: [0.1],
      bridge: [0.69, 0.81], figure8: true,
      points: gerono(900, 780, 132),
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
