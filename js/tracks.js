/* tracks.js — 6 courses, one home track per driver. Each has a distinct
 * theme (colours), shape, ramps and signature feature. `home` is the driver id
 * whose home track it is (that driver gets a boost there).
 * `ramps` and `mud` are progress fractions (0..1) around the loop.
 *
 * Shapes: hand-placed Catmull-Rom spline circuits (mesa/canyon/gravel — winding
 * layouts with straights, chicanes and switchbacks) and self-crossing generators
 * for the bridge tracks (gerono figure-8 for neon/thunder, limaçon loop-in-loop
 * for lab). `bridge` marks the elevated progress range of an overpass.
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
  const TRACKS = [
    {
      // fast tri-oval — three straights joined by wide sweepers (roomy)
      id: "mesa", name: "Blazing Mesa", home: "hotrod",
      laps: 4, width: 156, difficulty: 2, feature: "Fast tri-oval",
      theme: { ground: "#8a4326", groundDark: "#6e3219", dirt: "#d98c4a", dirtDark: "#6e3a18", rut: "#7a4520" },
      ramps: [0.1, 0.6], mud: [], whoops: [0.85],
      points: spline(W([
        [0, -680], [300, -560], [450, -300], [470, 40], [360, 360],
        [180, 620], [-180, 620], [-360, 360], [-470, 40], [-450, -300], [-300, -560],
      ]), 132),
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
      // D-shape — a long left straight into a big sweeping right-hander
      id: "canyon", name: "Dust Canyon", home: "west",
      laps: 4, width: 156, difficulty: 4, feature: "Long straight & sweep",
      theme: { ground: "#b9863f", groundDark: "#9c6a2c", dirt: "#cca162", dirtDark: "#7a5226", rut: "#8a6230" },
      ramps: [0.06], mud: [0.62], surface: "mud", whoops: [0.3],
      points: spline(W([
        [-380, -560], [-380, -180], [-380, 200], [-380, 540], [-120, 660], [200, 600],
        [420, 360], [470, 0], [420, -360], [200, -600], [-120, -660],
      ]), 132),
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
      // sweeping kidney — one long bend in, one big sweep out, sandy
      id: "gravel", name: "Gravel Pit", home: "olddog",
      laps: 5, width: 150, difficulty: 4, feature: "Sweeping kidney",
      theme: { ground: "#566b39", groundDark: "#43542c", dirt: "#9a9484", dirtDark: "#5a5448", rut: "#6a6458" },
      ramps: [0.5], mud: [0.2, 0.7], surface: "sand",
      points: wave(540, 120, (t) => 1 + 0.15 * Math.sin(t * 2 + 1.0), 1.2, 1.04, 0.3),
    },
    {
      // multi-straight circuit — six straights joined by gentle turns
      id: "lab", name: "Test Loop", home: "drg",
      laps: 4, width: 160, difficulty: 5, feature: "Multi-straight circuit",
      theme: { ground: "#2e6b3a", groundDark: "#24562f", dirt: "#8f9a8a", dirtDark: "#4a544a", rut: "#6a746a" },
      ramps: [0.1, 0.6], mud: [], whoops: [0.85],
      points: spline(W([
        [-200, -660], [200, -660], [440, -380], [440, 40], [300, 420], [0, 640],
        [-300, 420], [-440, 40], [-440, -380],
      ]), 132),
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
