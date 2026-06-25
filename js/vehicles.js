/* vehicles.js — racing machines for all three circuits.
 * Each circuit (trucks / boats / helis) has its own 6 vehicles; the active set
 * is mirrored on window.VEHICLES by circuits.js. Stats are innate ratings 1..5
 * in the four categories (engine/tires/shocks/nitro); per-vehicle upgrades add
 * 0..5 more. The same four upgrade slots drive every circuit, so the garage,
 * career and physics are identical — only the art and theme change.
 *
 * `kind` ("truck" | "boat" | "heli") selects the top-down + iso drawer.
 */
(function () {
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  const TRUCKS = [
    { id: "stocker", name: "Stocker", blurb: "Balanced all-rounder", color: "#ffcf33", kind: "truck", body: "stock",
      stats: { engine: 3, tires: 3, shocks: 3, nitro: 3 } },
    { id: "buggy", name: "Sand Flea", blurb: "Light & razor-nimble", color: "#57d957", kind: "truck", body: "buggy",
      stats: { engine: 2, tires: 5, shocks: 4, nitro: 2 } },
    { id: "monster", name: "Bigfoot", blurb: "Raw power, huge tires", color: "#e8482c", kind: "truck", body: "monster",
      stats: { engine: 5, tires: 2, shocks: 4, nitro: 2 } },
    { id: "baja", name: "Baja Bandit", blurb: "Nitro specialist", color: "#ff8e2b", kind: "truck", body: "baja",
      stats: { engine: 3, tires: 3, shocks: 2, nitro: 5 } },
    { id: "crawler", name: "Boulder", blurb: "Grip & suspension", color: "#3aa0ff", kind: "truck", body: "crawler",
      stats: { engine: 2, tires: 5, shocks: 5, nitro: 1 } },
    { id: "sprinter", name: "Cheetah", blurb: "Top-speed missile", color: "#c46bff", kind: "truck", body: "sprinter",
      stats: { engine: 5, tires: 3, shocks: 3, nitro: 2 } },
  ];

  // Powerboats — same four stat slots (engine=top speed, tires=turn-in/grip,
  // shocks=acceleration, nitro=boost).
  const BOATS = [
    { id: "cutter", name: "Cutter", blurb: "Balanced runabout", color: "#ffd23a", kind: "boat", body: "runabout",
      stats: { engine: 3, tires: 3, shocks: 3, nitro: 3 } },
    { id: "skater", name: "Skater", blurb: "Twin-hull & nimble", color: "#54e0c8", kind: "boat", body: "cat",
      stats: { engine: 2, tires: 5, shocks: 4, nitro: 2 } },
    { id: "bruiser", name: "Bruiser", blurb: "Heavy offshore power", color: "#e8482c", kind: "boat", body: "offshore",
      stats: { engine: 5, tires: 2, shocks: 4, nitro: 2 } },
    { id: "boostwave", name: "Boostwave", blurb: "Hydroplane rocket", color: "#ff8e2b", kind: "boat", body: "hydro",
      stats: { engine: 3, tires: 3, shocks: 2, nitro: 5 } },
    { id: "keelhauler", name: "Keelhauler", blurb: "Sure-footed work hull", color: "#3aa0ff", kind: "boat", body: "tug",
      stats: { engine: 2, tires: 5, shocks: 5, nitro: 1 } },
    { id: "torpedo", name: "Torpedo", blurb: "Needle-nosed missile", color: "#c46bff", kind: "boat", body: "needle",
      stats: { engine: 5, tires: 3, shocks: 3, nitro: 2 } },
  ];

  // Racing helicopters — same stat slots (engine=top speed, tires=agility,
  // shocks=climb/accel, nitro=boost).
  const HELIS = [
    { id: "hornet", name: "Hornet", blurb: "Balanced scout", color: "#ffd23a", kind: "heli", body: "scout",
      stats: { engine: 3, tires: 3, shocks: 3, nitro: 3 } },
    { id: "sparrow", name: "Sparrow", blurb: "Feather-light & agile", color: "#57d957", kind: "heli", body: "light",
      stats: { engine: 2, tires: 5, shocks: 4, nitro: 2 } },
    { id: "goliath", name: "Goliath", blurb: "Heavy-lift powerhouse", color: "#e8482c", kind: "heli", body: "heavy",
      stats: { engine: 5, tires: 2, shocks: 4, nitro: 2 } },
    { id: "afterburn", name: "Afterburn", blurb: "Boost specialist", color: "#ff8e2b", kind: "heli", body: "gunship",
      stats: { engine: 3, tires: 3, shocks: 2, nitro: 5 } },
    { id: "titan", name: "Titan", blurb: "Stable sky-crane", color: "#3aa0ff", kind: "heli", body: "crane",
      stats: { engine: 2, tires: 5, shocks: 5, nitro: 1 } },
    { id: "dart", name: "Dart", blurb: "Top-speed racer", color: "#c46bff", kind: "heli", body: "racer",
      stats: { engine: 5, tires: 3, shocks: 3, nitro: 2 } },
  ];

  const VEHICLE_SETS = { trucks: TRUCKS, boats: BOATS, helis: HELIS };

  function shade(hex, f) {
    const c = hex.replace("#", "");
    let r = parseInt(c.substr(0, 2), 16), g = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16);
    r = clamp(Math.round(r * f), 0, 255); g = clamp(Math.round(g * f), 0, 255); b = clamp(Math.round(b * f), 0, 255);
    return `rgb(${r},${g},${b})`;
  }
  function rr(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  function tyre(g, x, y, w, h) {
    g.fillStyle = "#15110d"; rr(g, x, y, w, h, 2); g.fill();
    g.fillStyle = "#2a241d";
    for (let i = 0; i < Math.floor(w / 2.6); i++) g.fillRect(x + 1 + i * 2.6, y, 1.2, h);
  }

  // draw a top-down truck facing +x, centred at 0,0, in ~64x40 logical space
  function drawTruck(g, vehicle, color, isPlayer) {
    const body = vehicle ? vehicle.body : "stock";
    const grad = (x0, y0, x1, y1) => { const gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, shade(color, 1.35)); gr.addColorStop(0.5, color); gr.addColorStop(1, shade(color, 0.6)); return gr; };

    function bodyPlate(L, T, W, H, r) {
      g.fillStyle = "rgba(0,0,0,0.32)"; rr(g, L - 1, T + 2, W + 2, H, r); g.fill();
      g.fillStyle = grad(0, T, 0, T + H); rr(g, L, T, W, H, r); g.fill();
    }
    function cab(L, T, W, H) {
      g.fillStyle = "#10141c"; rr(g, L, T, W, H, 3); g.fill();
      g.fillStyle = "rgba(150,200,255,0.35)"; rr(g, L + 1, T + 1, W * 0.4, H - 2, 2); g.fill();
    }
    function outline(L, T, W, H, r) {
      g.strokeStyle = isPlayer ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.35)";
      g.lineWidth = isPlayer ? 2 : 1.2; rr(g, L, T, W, H, r); g.stroke();
    }

    switch (body) {
      case "buggy": { // light open-frame, big rear tyres
        tyre(g, -16, -16, 9, 6); tyre(g, -16, 10, 9, 6);
        tyre(g, 9, -17, 12, 7); tyre(g, 9, 10, 12, 7);
        bodyPlate(-18, -10, 36, 20, 6);
        g.strokeStyle = "rgba(230,230,230,0.7)"; g.lineWidth = 1.6; // roll cage
        g.strokeRect(-8, -8, 18, 16); g.beginPath(); g.moveTo(-8, 0); g.lineTo(10, 0); g.stroke();
        g.fillStyle = "#fff6c8"; g.beginPath(); g.arc(17, -6, 1.8, 0, 7); g.arc(17, 6, 1.8, 0, 7); g.fill();
        outline(-18, -10, 36, 20, 6); break;
      }
      case "monster": { // tall body, oversized tyres beyond the body
        tyre(g, -18, -19, 15, 9); tyre(g, -18, 10, 15, 9);
        tyre(g, 6, -19, 15, 9); tyre(g, 6, 10, 15, 9);
        bodyPlate(-18, -12, 40, 24, 6);
        cab(-2, -9, 16, 18);
        g.fillStyle = shade(color, 1.15); rr(g, 16, -8, 8, 16, 3); g.fill();
        g.fillStyle = "#fff6c8"; g.beginPath(); g.arc(22, -5, 2, 0, 7); g.arc(22, 5, 2, 0, 7); g.fill();
        outline(-18, -12, 40, 24, 6); break;
      }
      case "baja": { // long desert racer, light bar + spare tyre
        tyre(g, -18, -15, 11, 6); tyre(g, -18, 9, 11, 6);
        tyre(g, 9, -15, 11, 6); tyre(g, 9, 9, 11, 6);
        bodyPlate(-24, -12, 48, 24, 7);
        cab(-4, -8, 15, 16);
        tyre(g, -24, -7, 6, 14); // spare on tail
        g.fillStyle = "#ffe08a"; for (let i = -2; i <= 2; i++) g.fillRect(20 + 0, i * 4 - 1, 4, 2); // light bar
        g.fillStyle = "rgba(255,255,255,0.85)"; g.fillRect(-2, -2, 8, 4);
        outline(-24, -12, 48, 24, 7); break;
      }
      case "crawler": { // tall, knobby tyres, front winch bumper
        tyre(g, -17, -18, 14, 9); tyre(g, -17, 9, 14, 9);
        tyre(g, 6, -18, 14, 9); tyre(g, 6, 9, 14, 9);
        bodyPlate(-18, -13, 40, 26, 6);
        cab(-2, -9, 15, 18);
        g.fillStyle = "#888"; rr(g, 20, -10, 5, 20, 2); g.fill(); // winch bumper
        g.fillStyle = "#555"; g.beginPath(); g.arc(22, 0, 3, 0, 7); g.fill();
        outline(-18, -13, 40, 26, 6); break;
      }
      case "sprinter": { // sleek, tapered nose, rear wing
        tyre(g, -15, -14, 9, 5); tyre(g, -15, 9, 9, 5);
        tyre(g, 9, -14, 9, 5); tyre(g, 9, 9, 9, 5);
        g.fillStyle = "rgba(0,0,0,0.32)"; // taper body
        g.beginPath(); g.moveTo(-20, -10); g.lineTo(14, -7); g.lineTo(24, 0); g.lineTo(14, 7); g.lineTo(-20, 10); g.closePath(); g.fill();
        g.fillStyle = grad(0, -10, 0, 10);
        g.beginPath(); g.moveTo(-21, -11); g.lineTo(13, -8); g.lineTo(23, 0); g.lineTo(13, 8); g.lineTo(-21, 11); g.closePath(); g.fill();
        cab(-4, -6, 14, 12);
        g.fillStyle = shade(color, 0.5); rr(g, -23, -12, 5, 24, 2); g.fill(); // rear wing
        g.fillStyle = "rgba(255,255,255,0.8)"; g.fillRect(-12, -1.5, 22, 3);
        g.strokeStyle = isPlayer ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.35)"; g.lineWidth = isPlayer ? 2 : 1.2;
        g.beginPath(); g.moveTo(-21, -11); g.lineTo(13, -8); g.lineTo(23, 0); g.lineTo(13, 8); g.lineTo(-21, 11); g.closePath(); g.stroke();
        break;
      }
      default: { // stocker pickup
        tyre(g, -16, -15, 11, 6); tyre(g, -16, 9, 11, 6);
        tyre(g, 9, -15, 11, 6); tyre(g, 9, 9, 11, 6);
        bodyPlate(-22, -12, 44, 24, 6);
        cab(-2, -8, 16, 16);
        g.fillStyle = shade(color, 0.85); rr(g, -20, -9, 12, 18, 3); g.fill(); // bed
        g.fillStyle = "#fff6c8"; g.beginPath(); g.arc(20, -5, 2, 0, 7); g.arc(20, 5, 2, 0, 7); g.fill();
        g.fillStyle = "rgba(255,255,255,0.85)"; g.fillRect(0, -2, 8, 4);
        outline(-22, -12, 44, 24, 6);
      }
    }
  }

  // draw a top-down powerboat facing +x (bow = +x), centred at 0,0.
  // Framed within ~±30 x, ±18 y to match the truck sprite box.
  function drawBoat(g, vehicle, color, isPlayer) {
    const body = vehicle ? vehicle.body : "runabout";
    const hullGrad = (T, H) => { const gr = g.createLinearGradient(0, T, 0, T + H); gr.addColorStop(0, shade(color, 1.3)); gr.addColorStop(0.5, color); gr.addColorStop(1, shade(color, 0.62)); return gr; };
    const wake = () => { // stern wash hint (behind the boat, -x)
      g.fillStyle = "rgba(255,255,255,0.5)";
      g.beginPath(); g.moveTo(-22, -3); g.lineTo(-30, -8); g.lineTo(-27, 0); g.lineTo(-30, 8); g.lineTo(-22, 3); g.closePath(); g.fill();
    };
    const deckGlass = (L, T, W, H) => { g.fillStyle = "rgba(20,40,60,0.8)"; rr(g, L, T, W, H, 3); g.fill(); g.fillStyle = "rgba(150,200,255,0.4)"; rr(g, L + 1, T + 1, W * 0.45, H - 2, 2); g.fill(); };
    function hull(pts, fill) {
      g.fillStyle = "rgba(0,0,0,0.3)"; g.beginPath(); g.moveTo(pts[0][0], pts[0][1] + 2); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1] + 2); g.closePath(); g.fill();
      g.fillStyle = fill; g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath(); g.fill();
      g.strokeStyle = isPlayer ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.4)"; g.lineWidth = isPlayer ? 2 : 1.2; g.stroke();
    }

    switch (body) {
      case "cat": { // catamaran — two slim hulls + a deck bridge
        wake();
        const f = hullGrad(-15, 30);
        hull([[26, -2], [8, -13], [-20, -14], [-20, -9], [-2, -7], [-2, 7], [-20, 9], [-20, 14], [8, 13], [26, 2]], f);
        g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(-18, -4, 22, 8); // tunnel
        deckGlass(-6, -6, 14, 12);
        break;
      }
      case "offshore": { // heavy wide deep-V
        wake();
        const f = hullGrad(-16, 32);
        hull([[28, 0], [15, -13], [-18, -16], [-22, -10], [-22, 10], [-18, 16], [15, 13]], f);
        g.fillStyle = shade(color, 0.78); rr(g, -20, -7, 20, 14, 3); g.fill(); // engine cowl
        deckGlass(-2, -7, 16, 14);
        g.fillStyle = "rgba(255,255,255,0.8)"; g.fillRect(2, -1.5, 14, 3); // stripe
        break;
      }
      case "hydro": { // hydroplane — sponsons + rooster tail
        g.fillStyle = "rgba(255,255,255,0.5)"; // rooster tail (behind)
        g.beginPath(); g.moveTo(-20, -7); g.lineTo(-30, -14); g.lineTo(-25, 0); g.lineTo(-30, 14); g.lineTo(-20, 7); g.closePath(); g.fill();
        const f = hullGrad(-12, 24);
        hull([[28, 0], [12, -8], [-20, -9], [-20, 9], [12, 8]], f);
        // sponsons
        g.fillStyle = shade(color, 0.7); rr(g, 4, -16, 15, 7, 2); g.fill(); rr(g, 4, 9, 15, 7, 2); g.fill();
        deckGlass(-6, -5, 12, 10);
        g.fillStyle = shade(color, 0.5); rr(g, -20, -3, 5, 6, 1); g.fill(); // tail fin
        break;
      }
      case "tug": { // blunt sure-footed work hull
        wake();
        const f = hullGrad(-15, 30);
        hull([[22, -11], [24, 0], [22, 11], [-20, 13], [-22, 0], [-20, -13]], f);
        g.fillStyle = shade(color, 0.8); rr(g, -15, -10, 24, 20, 4); g.fill(); // cabin block
        deckGlass(-3, -7, 13, 14);
        g.fillStyle = "#2a2a2a"; g.beginPath(); g.arc(-13, 0, 3, 0, 7); g.fill(); // fender
        break;
      }
      case "needle": { // long thin missile hull
        wake();
        const f = hullGrad(-9, 18);
        hull([[30, 0], [16, -7], [-24, -8], [-24, 8], [16, 7]], f);
        deckGlass(-6, -4, 14, 8);
        g.fillStyle = "rgba(255,255,255,0.85)"; g.fillRect(-18, -1.5, 32, 3); // centre stripe
        g.fillStyle = shade(color, 0.5); rr(g, -24, -2, 5, 4, 1); g.fill();
        break;
      }
      default: { // runabout — classic pointed bow ski boat
        wake();
        const f = hullGrad(-13, 26);
        hull([[28, 0], [14, -11], [-20, -13], [-20, 13], [14, 11]], f);
        g.fillStyle = shade(color, 0.82); rr(g, -18, -9, 18, 18, 3); g.fill(); // open cockpit
        deckGlass(0, -7, 14, 14);
        g.fillStyle = "rgba(255,255,255,0.8)"; g.fillRect(-14, -1.5, 26, 3); // stripe
      }
    }
  }

  // draw a top-down helicopter facing +x (nose = +x), centred at 0,0.
  // Tail boom extends backward (-x); framed within ~±30 x, ±19 y.
  function drawHeli(g, vehicle, color, isPlayer) {
    const body = vehicle ? vehicle.body : "scout";
    const fuse = (pts, fill) => {
      g.fillStyle = "rgba(0,0,0,0.3)"; g.beginPath(); g.moveTo(pts[0][0], pts[0][1] + 2); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1] + 2); g.closePath(); g.fill();
      g.fillStyle = fill; g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath(); g.fill();
      g.strokeStyle = isPlayer ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.4)"; g.lineWidth = isPlayer ? 2 : 1.2; g.stroke();
    };
    const bodyGrad = (T, H) => { const gr = g.createLinearGradient(0, T, 0, T + H); gr.addColorStop(0, shade(color, 1.3)); gr.addColorStop(0.5, color); gr.addColorStop(1, shade(color, 0.6)); return gr; };
    const canopy = (L, T, W, H) => { g.fillStyle = "rgba(120,180,230,0.55)"; rr(g, L, T, W, H, 4); g.fill(); g.fillStyle = "rgba(220,240,255,0.5)"; rr(g, L + 1, T + 1, W * 0.4, H - 2, 2); g.fill(); };
    const skids = (back, front, off) => { g.strokeStyle = "rgba(20,20,20,0.85)"; g.lineWidth = 2; g.beginPath(); g.moveTo(back, -off); g.lineTo(front, -off); g.moveTo(back, off); g.lineTo(front, off); g.stroke(); };
    function tailBoom(len) { // len = how far back (positive); drawn toward -x
      g.strokeStyle = shade(color, 0.5); g.lineWidth = 6.5; g.lineCap = "round"; // dark, thick, clearly separate
      g.beginPath(); g.moveTo(6, 0); g.lineTo(-len, 0); g.stroke();
      g.strokeStyle = shade(color, 1.05); g.lineWidth = 2.5; // top highlight stripe along the boom
      g.beginPath(); g.moveTo(4, 0); g.lineTo(-len + 2, 0); g.stroke();
      g.fillStyle = shade(color, 0.45); // vertical tail fin
      g.beginPath(); g.moveTo(-len + 3, 0); g.lineTo(-len - 7, -11); g.lineTo(-len - 7, -3); g.closePath(); g.fill();
      // tail rotor — a small spinning disc (the universal "helicopter" tell)
      g.fillStyle = "rgba(225,232,242,0.32)"; g.beginPath(); g.arc(-len - 4, 4, 7, 0, 7); g.fill();
      g.strokeStyle = "rgba(30,34,42,0.85)"; g.lineWidth = 1.8;
      g.beginPath(); g.moveTo(-len - 4, -3); g.lineTo(-len - 4, 11); g.stroke();
      g.fillStyle = "#23262d"; g.beginPath(); g.arc(-len - 4, 4, 2, 0, 7); g.fill();
    }
    function rotor(rad) { // bold main rotor: bright disc + rim + 4 blades + sweep arc
      g.fillStyle = "rgba(228,236,248,0.2)"; g.beginPath(); g.arc(0, 0, rad, 0, 7); g.fill();
      g.strokeStyle = "rgba(235,242,252,0.5)"; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, rad, 0, 7); g.stroke(); // disc rim
      g.strokeStyle = "rgba(255,255,255,0.7)"; g.lineWidth = 3.4; g.lineCap = "round"; // bright leading sweep arc (implies spin)
      g.beginPath(); g.arc(0, 0, rad - 1.5, -0.5, 0.9); g.stroke();
      g.strokeStyle = "rgba(28,32,40,0.9)"; g.lineWidth = 3; // four blades
      for (const a of [0.5, 0.5 + Math.PI / 2, 0.5 + Math.PI, 0.5 + 3 * Math.PI / 2]) {
        g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * rad, Math.sin(a) * rad); g.stroke();
      }
      g.fillStyle = "#33373f"; g.beginPath(); g.arc(0, 0, 4, 0, 7); g.fill(); // hub
      g.fillStyle = "#8a9099"; g.beginPath(); g.arc(0, 0, 1.8, 0, 7); g.fill();
    }

    switch (body) {
      case "light": { // small bubble scout
        skids(-10, 12, 11);
        tailBoom(26);
        fuse([[18, 0], [10, -9], [-8, -9], [-10, 0], [-8, 9], [10, 9]], bodyGrad(-9, 18));
        canopy(2, -7, 14, 14);
        rotor(21); break;
      }
      case "heavy": { // big lifter with cargo box
        skids(-14, 16, 14);
        tailBoom(28);
        fuse([[24, 0], [15, -14], [-16, -15], [-18, 0], [-16, 15], [15, 14]], bodyGrad(-15, 30));
        g.fillStyle = shade(color, 0.7); rr(g, -14, -10, 12, 20, 3); g.fill(); // cargo box
        canopy(6, -10, 15, 20);
        rotor(20); break;
      }
      case "gunship": { // sleek attack/boost heli — stub wings
        skids(-12, 14, 10);
        tailBoom(28);
        g.fillStyle = shade(color, 0.62); rr(g, -2, -19, 10, 7, 2); g.fill(); rr(g, -2, 12, 10, 7, 2); g.fill(); // stub wings
        fuse([[28, 0], [14, -10], [-16, -11], [-18, 0], [-16, 11], [14, 10]], bodyGrad(-11, 22));
        canopy(8, -7, 15, 14);
        g.fillStyle = "#ffe08a"; g.fillRect(20, -2, 7, 4); // nose sensor
        rotor(21); break;
      }
      case "crane": { // sky-crane — open lattice frame
        skids(-14, 14, 13);
        tailBoom(28);
        fuse([[22, 0], [14, -12], [-18, -12], [-20, 0], [-18, 12], [14, 12]], bodyGrad(-12, 24));
        g.strokeStyle = "rgba(0,0,0,0.4)"; g.lineWidth = 1.6; g.strokeRect(-16, -8, 24, 16); // frame
        g.beginPath(); g.moveTo(-16, 0); g.lineTo(8, 0); g.stroke();
        canopy(7, -9, 14, 18);
        rotor(21); break;
      }
      case "racer": { // needle-nosed speed racer
        skids(-10, 12, 9);
        tailBoom(30);
        fuse([[30, 0], [14, -8], [-16, -9], [-18, 0], [-16, 9], [14, 8]], bodyGrad(-9, 18));
        canopy(6, -5, 16, 10);
        g.fillStyle = "rgba(255,255,255,0.85)"; g.fillRect(-12, -1.5, 28, 3); // racing stripe
        rotor(20); break;
      }
      default: { // scout — balanced bubble + boom
        skids(-12, 14, 12);
        tailBoom(27);
        fuse([[24, 0], [13, -11], [-14, -12], [-16, 0], [-14, 12], [13, 11]], bodyGrad(-12, 24));
        canopy(5, -8, 15, 16);
        g.fillStyle = "#fff6c8"; g.beginPath(); g.arc(21, 0, 2, 0, 7); g.fill(); // landing light
        rotor(20);
      }
    }
  }

  // dispatch the right drawer for a vehicle's kind
  function drawVehicle(g, vehicle, color, isPlayer) {
    const kind = vehicle ? vehicle.kind : "truck";
    if (kind === "boat") return drawBoat(g, vehicle, color, isPlayer);
    if (kind === "heli") return drawHeli(g, vehicle, color, isPlayer);
    return drawTruck(g, vehicle, color, isPlayer);
  }

  // cached top-down sprite for in-race rendering (facing +x)
  const spriteCache = {};
  function makeVehicleSprite(vehicleId, color, isPlayer) {
    const key = vehicleId + "|" + color + (isPlayer ? "|p" : "");
    if (spriteCache[key]) return spriteCache[key];
    const veh = getVehicle(vehicleId);
    const S = 4, w = 64, h = 40;
    const cv = document.createElement("canvas");
    cv.width = w * S; cv.height = h * S;
    const g = cv.getContext("2d");
    g.scale(S, S); g.translate(w / 2, h / 2);
    drawVehicle(g, veh, color || (veh ? veh.color : "#ccc"), isPlayer);
    cv._w = w; cv._h = h;
    spriteCache[key] = cv;
    return cv;
  }

  // card portrait for the select / garage panels
  function makeVehiclePortrait(id, px) {
    const veh = getVehicle(id);
    const S = 2;
    const cv = document.createElement("canvas");
    cv.width = px * S; cv.height = px * S;
    cv.style.width = px + "px"; cv.style.height = px + "px";
    const g = cv.getContext("2d");
    const bg = g.createLinearGradient(0, 0, 0, px * S);
    bg.addColorStop(0, shade(veh.color, 0.5)); bg.addColorStop(1, shade(veh.color, 0.25));
    g.fillStyle = bg; g.fillRect(0, 0, px * S, px * S);
    g.save();
    g.translate(px * S / 2, px * S / 2);
    const sc = (px * S) / 70; g.scale(sc, sc);
    g.rotate(-Math.PI / 2); // point the vehicle "up" in the card
    drawVehicle(g, veh, veh.color, false);
    g.restore();
    return cv;
  }

  function getVehicle(id) {
    const set = window.VEHICLES || TRUCKS;
    return set.find((v) => v.id === id) || set[0];
  }

  window.VEHICLE_SETS = VEHICLE_SETS;
  window.VEHICLES = TRUCKS; // default; circuits.js repoints this to the active set
  window.getVehicle = getVehicle;
  window.makeVehicleSprite = makeVehicleSprite;
  window.makeTruckSprite = makeVehicleSprite; // engines call this name
  window.makeVehiclePortrait = makeVehiclePortrait;
})();
