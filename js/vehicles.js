/* vehicles.js — the 6 trucks: data, base stats, and distinct top-down sprites.
 * Stats are innate ratings 1..5 in the four vehicle categories; per-truck
 * upgrades add 0..5 more. Final performance = truck x driver.
 */
(function () {
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  const VEHICLES = [
    { id: "stocker", name: "Stocker", blurb: "Balanced all-rounder", color: "#ffcf33", body: "stock",
      stats: { engine: 3, tires: 3, shocks: 3, nitro: 3 } },
    { id: "buggy", name: "Sand Flea", blurb: "Light & razor-nimble", color: "#57d957", body: "buggy",
      stats: { engine: 2, tires: 5, shocks: 4, nitro: 2 } },
    { id: "monster", name: "Bigfoot", blurb: "Raw power, huge tires", color: "#e8482c", body: "monster",
      stats: { engine: 5, tires: 2, shocks: 4, nitro: 2 } },
    { id: "baja", name: "Baja Bandit", blurb: "Nitro specialist", color: "#ff8e2b", body: "baja",
      stats: { engine: 3, tires: 3, shocks: 2, nitro: 5 } },
    { id: "crawler", name: "Boulder", blurb: "Grip & suspension", color: "#3aa0ff", body: "crawler",
      stats: { engine: 2, tires: 5, shocks: 5, nitro: 1 } },
    { id: "sprinter", name: "Cheetah", blurb: "Top-speed missile", color: "#c46bff", body: "sprinter",
      stats: { engine: 5, tires: 3, shocks: 3, nitro: 2 } },
  ];

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

  // cached top-down sprite for in-race rendering (facing +x)
  const spriteCache = {};
  function makeTruckSprite(vehicleId, color, isPlayer) {
    const key = vehicleId + "|" + color + (isPlayer ? "|p" : "");
    if (spriteCache[key]) return spriteCache[key];
    const veh = VEHICLES.find((v) => v.id === vehicleId);
    const S = 4, w = 64, h = 44;
    const cv = document.createElement("canvas");
    cv.width = w * S; cv.height = h * S;
    const g = cv.getContext("2d");
    g.scale(S, S); g.translate(w / 2, h / 2);
    drawTruck(g, veh, color || (veh ? veh.color : "#ccc"), isPlayer);
    spriteCache[key] = cv;
    return cv;
  }

  // card portrait for the select / garage panels
  function makeVehiclePortrait(id, px) {
    const veh = VEHICLES.find((v) => v.id === id) || VEHICLES[0];
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
    g.rotate(-Math.PI / 2); // point the truck "up" in the card
    drawTruck(g, veh, veh.color, false);
    g.restore();
    return cv;
  }

  window.VEHICLES = VEHICLES;
  window.getVehicle = (id) => VEHICLES.find((v) => v.id === id) || VEHICLES[0];
  window.makeTruckSprite = makeTruckSprite;
  window.makeVehiclePortrait = makeVehiclePortrait;
})();
