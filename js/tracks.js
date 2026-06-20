/* tracks.js — course definitions for OffRoaders
 * Each track is a closed loop of centreline points (world units ~= pixels).
 * Tracks are generated parametrically so the loops are always smooth & closed.
 * `ramps` are progress fractions (0..1 around the loop) where the Enhanced
 * engine places jump ramps. The Classic engine ignores them.
 */
(function () {
  // Build a closed loop by sampling a radius function around a centre.
  function loop(opts) {
    const {
      samples = 56, base = 700, sx = 1, sy = 1,
      cx = 0, cy = 0, rot = 0, radiusFn = () => 1,
    } = opts;
    const pts = [];
    for (let i = 0; i < samples; i++) {
      const t = (i / samples) * Math.PI * 2;
      const r = base * radiusFn(t);
      let x = Math.cos(t) * r * sx;
      let y = Math.sin(t) * r * sy;
      const rx = x * Math.cos(rot) - y * Math.sin(rot);
      const ry = x * Math.sin(rot) + y * Math.cos(rot);
      pts.push({ x: rx + cx, y: ry + cy });
    }
    return pts;
  }

  const TRACKS = [
    {
      id: "sidewinder", name: "Sidewinder", laps: 4, width: 210, difficulty: 1,
      ramps: [0.30, 0.78],
      points: loop({ samples: 50, base: 620, sx: 1.45, sy: 0.85,
        radiusFn: (t) => 1 + 0.05 * Math.sin(t * 2) }),
    },
    {
      id: "dustbowl", name: "Dust Bowl", laps: 4, width: 195, difficulty: 2,
      ramps: [0.20, 0.55, 0.85],
      points: loop({ samples: 60, base: 560, sx: 1.5, sy: 1.0,
        radiusFn: (t) => 1 + 0.32 * Math.cos(t * 2) }),
    },
    {
      id: "canyon", name: "Canyon Run", laps: 4, width: 185, difficulty: 3,
      ramps: [0.18, 0.5, 0.82],
      points: loop({ samples: 64, base: 640, sx: 1.1, sy: 1.1, rot: 0.3,
        radiusFn: (t) => 1 + 0.18 * Math.sin(t * 3) }),
    },
    {
      id: "mudpit", name: "Mud Pit", laps: 5, width: 170, difficulty: 4,
      ramps: [0.25, 0.6],
      points: loop({ samples: 70, base: 540, sx: 1.25, sy: 1.05, rot: 0.6,
        radiusFn: (t) => 1 + 0.22 * Math.sin(t * 4) + 0.08 * Math.cos(t * 2) }),
    },
    {
      id: "thunder", name: "Thunder Ridge", laps: 5, width: 200, difficulty: 5,
      ramps: [0.15, 0.45, 0.72, 0.9],
      points: loop({ samples: 72, base: 780, sx: 1.35, sy: 0.95, rot: 0.15,
        radiusFn: (t) => 1 + 0.12 * Math.sin(t * 5) + 0.06 * Math.cos(t * 3) }),
    },
  ];

  window.TRACKS = TRACKS;
  window.getTrack = (id) => TRACKS.find((t) => t.id === id) || TRACKS[0];
})();
