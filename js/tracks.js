/* tracks.js — 6 courses, one home track per driver. Each has a distinct
 * theme (colours), shape, ramps and signature feature. `home` is the driver id
 * whose home track it is (that driver gets a boost there).
 * `ramps` and `mud` are progress fractions (0..1) around the loop.
 */
(function () {
  function loop(opts) {
    const { samples = 56, base = 700, sx = 1, sy = 1, cx = 0, cy = 0, rot = 0, radiusFn = () => 1 } = opts;
    const pts = [];
    for (let i = 0; i < samples; i++) {
      const t = (i / samples) * Math.PI * 2;
      const r = base * radiusFn(t);
      const x = Math.cos(t) * r * sx, y = Math.sin(t) * r * sy;
      pts.push({ x: x * Math.cos(rot) - y * Math.sin(rot) + cx, y: x * Math.sin(rot) + y * Math.cos(rot) + cy });
    }
    return pts;
  }

  const TRACKS = [
    {
      id: "mesa", name: "Blazing Mesa", home: "hotrod",
      laps: 4, width: 205, difficulty: 2, feature: "Jump-heavy & fast",
      theme: { ground: "#8a4326", groundDark: "#6e3219", dirt: "#d98c4a", dirtDark: "#6e3a18", rut: "#7a4520" },
      ramps: [0.16, 0.4, 0.62, 0.85], mud: [],
      points: loop({ samples: 52, base: 660, sx: 1.4, sy: 0.85, radiusFn: (t) => 1 + 0.06 * Math.sin(t * 2) }),
    },
    {
      id: "neon", name: "Neon City", home: "rob",
      laps: 4, width: 220, difficulty: 3, feature: "Long drift sweepers",
      theme: { ground: "#201f38", groundDark: "#15132233", dirt: "#4b475f", dirtDark: "#211d2e", rut: "#5a5570" },
      ramps: [0.5], mud: [],
      points: loop({ samples: 58, base: 720, sx: 1.3, sy: 1.0, rot: 0.2, radiusFn: (t) => 1 + 0.16 * Math.sin(t) }),
    },
    {
      id: "canyon", name: "Dust Canyon", home: "west",
      laps: 4, width: 165, difficulty: 4, feature: "Tight & technical",
      theme: { ground: "#b9863f", groundDark: "#9c6a2c", dirt: "#cca162", dirtDark: "#7a5226", rut: "#8a6230" },
      ramps: [0.3, 0.7], mud: [0.18, 0.55],
      points: loop({ samples: 70, base: 600, sx: 1.05, sy: 1.1, rot: 0.4, radiusFn: (t) => 1 + 0.2 * Math.sin(t * 4) + 0.07 * Math.cos(t * 2) }),
    },
    {
      id: "thunder", name: "Thunder Valley", home: "atrain",
      laps: 5, width: 215, difficulty: 3, feature: "Big track, long straights",
      theme: { ground: "#2e6b46", groundDark: "#24563a", dirt: "#b9925e", dirtDark: "#6e4a28", rut: "#8a6838" },
      ramps: [0.22, 0.74], mud: [],
      points: loop({ samples: 76, base: 820, sx: 1.4, sy: 0.95, rot: 0.1, radiusFn: (t) => 1 + 0.07 * Math.sin(t * 3) }),
    },
    {
      id: "gravel", name: "Gravel Pit", home: "olddog",
      laps: 5, width: 170, difficulty: 4, feature: "Twisty old-school",
      theme: { ground: "#566b39", groundDark: "#43542c", dirt: "#9a9484", dirtDark: "#5a5448", rut: "#6a6458" },
      ramps: [0.6], mud: [0.28, 0.66, 0.9],
      points: loop({ samples: 74, base: 560, sx: 1.25, sy: 1.05, rot: 0.6, radiusFn: (t) => 1 + 0.22 * Math.sin(t * 5) + 0.08 * Math.cos(t * 3) }),
    },
    {
      id: "lab", name: "Test Loop", home: "drg",
      laps: 4, width: 185, difficulty: 5, feature: "Precision chicanes",
      theme: { ground: "#2e6b3a", groundDark: "#24562f", dirt: "#8f9a8a", dirtDark: "#4a544a", rut: "#6a746a" },
      ramps: [0.45, 0.9], mud: [],
      points: loop({ samples: 80, base: 700, sx: 1.2, sy: 1.0, rot: 0.15, radiusFn: (t) => 1 + 0.14 * Math.sin(t * 6) + 0.05 * Math.cos(t * 2) }),
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
