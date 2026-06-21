/* characters.js — the 6 playable drivers: data, bios, innate skills, and
 * procedurally-drawn N64-style portraits (window.makeDriverPortrait).
 * Skills are innate ratings 1..5 (personality); training adds 0..5 more.
 */
(function () {
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  const CHARACTERS = [
    {
      id: "hotrod", name: "Hot Rod", color: "#e8482c",
      tagline: "Reckless speed demon",
      bio: "A flat-out hotshot who never lifts. Blistering launches and fearless dives, but finesse? That's for the pit crew. If there's a gap, Hot Rod's already through it.",
      skills: { launch: 5, handling: 2, drift: 4, nitro: 3 },
      look: { skin: "#e8b48c", hair: "#3a2a18", hat: "helmet", hatColor: "#e8482c", accent: "#ffcf33" },
    },
    {
      id: "rob", name: "Rockin' Rob", color: "#c46bff",
      tagline: "Showboat with a beat",
      bio: "Rolls into every round to his own soundtrack. Lives for the slide — the bigger and louder the drift, the better. Style first, trophies somehow follow.",
      skills: { launch: 3, handling: 3, drift: 5, nitro: 4 },
      look: { skin: "#d9a06e", hair: "#7a2bd6", hat: "mohawk", hatColor: "#c46bff", accent: "#2fd0ff" },
    },
    {
      id: "west", name: "Wild West", color: "#ff8e2b",
      tagline: "Master of the rough",
      bio: "Raised on dust and gravel. Where others spin out, Wild West just digs in and hauls. Unflappable hands and the best grip in the desert.",
      skills: { launch: 3, handling: 5, drift: 3, nitro: 2 },
      look: { skin: "#c98a5a", hair: "#5a3a1a", hat: "cowboy", hatColor: "#9c6b3a", accent: "#b03030" },
    },
    {
      id: "atrain", name: "A-Train", color: "#3aa0ff",
      tagline: "Unstoppable momentum",
      bio: "Big, blue, and built like a freight engine. Once A-Train gets rolling and the nitro lights up, good luck slowing it down. Pure horsepower.",
      skills: { launch: 4, handling: 3, drift: 2, nitro: 5 },
      look: { skin: "#a8754c", hair: "#1a1a1a", hat: "cap", hatColor: "#3aa0ff", accent: "#ffffff" },
    },
    {
      id: "olddog", name: "Old Dog", color: "#ffcf33",
      tagline: "Smooth and cunning",
      bio: "Forgot more about racing than the rookies will ever learn. No wasted motion, never rattled, always on the fast line. Old tricks still win races.",
      skills: { launch: 2, handling: 5, drift: 4, nitro: 3 },
      look: { skin: "#d8b48c", hair: "#cccccc", hat: "trucker", hatColor: "#c9a23a", accent: "#6b4a29" },
    },
    {
      id: "drg", name: "Dr. G", color: "#57d957",
      tagline: "Calculated precision",
      bio: "Treats every corner as an equation and every nitro charge as a controlled experiment. Cold, methodical, and devastatingly efficient with a boost.",
      skills: { launch: 3, handling: 4, drift: 3, nitro: 5 },
      look: { skin: "#cfa978", hair: "#2a2a2a", hat: "goggles", hatColor: "#57d957", accent: "#eaffea" },
    },
  ];

  const SKILLS = [
    { key: "launch", name: "Launch", desc: "Off-the-line acceleration" },
    { key: "handling", name: "Handling", desc: "Cornering grip & control" },
    { key: "drift", name: "Drift", desc: "Drift control & exit speed" },
    { key: "nitro", name: "Nitro", desc: "Boost power & refill rate" },
  ];

  // ---- portrait drawing (logical 100x100 space) ----
  function rr(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  function shade(hex, f) {
    const c = hex.replace("#", "");
    let r = parseInt(c.substr(0, 2), 16), gg = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16);
    r = clamp(Math.round(r * f), 0, 255); gg = clamp(Math.round(gg * f), 0, 255); b = clamp(Math.round(b * f), 0, 255);
    return `rgb(${r},${gg},${b})`;
  }

  function drawFace(g, ch) {
    const L = ch.look;
    // background
    const bg = g.createLinearGradient(0, 0, 0, 100);
    bg.addColorStop(0, shade(ch.color, 0.55)); bg.addColorStop(1, shade(ch.color, 0.28));
    g.fillStyle = bg; g.fillRect(0, 0, 100, 100);
    // shoulders / jersey
    g.fillStyle = shade(ch.color, 0.9);
    g.beginPath(); g.ellipse(50, 108, 42, 30, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = ch.color;
    g.beginPath(); g.ellipse(50, 112, 34, 26, 0, 0, Math.PI * 2); g.fill();
    // collar
    g.fillStyle = L.accent;
    g.beginPath(); g.moveTo(38, 90); g.lineTo(50, 100); g.lineTo(62, 90); g.lineTo(56, 86); g.lineTo(44, 86); g.closePath(); g.fill();

    // neck
    g.fillStyle = shade(L.skin, 0.85);
    g.fillRect(43, 74, 14, 14);
    // head
    g.fillStyle = L.skin;
    g.beginPath(); g.ellipse(50, 50, 22, 26, 0, 0, Math.PI * 2); g.fill();
    // ears
    g.beginPath(); g.ellipse(28, 52, 4, 6, 0, 0, Math.PI * 2); g.ellipse(72, 52, 4, 6, 0, 0, Math.PI * 2); g.fill();
    // cheek shading
    g.fillStyle = shade(L.skin, 0.92);
    g.beginPath(); g.ellipse(50, 58, 18, 16, 0, 0, Math.PI * 2); g.fill();

    // eyes
    g.fillStyle = "#fff";
    g.beginPath(); g.ellipse(42, 48, 5, 4, 0, 0, Math.PI * 2); g.ellipse(58, 48, 5, 4, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#1a1a1a";
    g.beginPath(); g.arc(43, 48, 2.1, 0, 7); g.arc(59, 48, 2.1, 0, 7); g.fill();
    // brows
    g.strokeStyle = L.hair; g.lineWidth = 2.2; g.lineCap = "round";
    g.beginPath(); g.moveTo(37, 41); g.lineTo(47, 42); g.moveTo(53, 42); g.lineTo(63, 41); g.stroke();
    // nose
    g.strokeStyle = shade(L.skin, 0.7); g.lineWidth = 2;
    g.beginPath(); g.moveTo(50, 50); g.lineTo(50, 58); g.lineTo(53, 60); g.stroke();
    // mouth
    g.strokeStyle = "#7a3b2b"; g.lineWidth = 2.4;
    g.beginPath(); g.arc(50, 63, 7, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();

    // persona-specific details
    drawPersona(g, ch);
  }

  function drawPersona(g, ch) {
    const L = ch.look;
    switch (L.hat) {
      case "helmet": { // Hot Rod — racing helmet + flame + shades
        g.fillStyle = L.hatColor;
        g.beginPath(); g.arc(50, 42, 26, Math.PI, 2 * Math.PI); g.fill();
        g.fillRect(24, 40, 52, 8);
        g.fillStyle = L.accent; // flame stripe
        g.beginPath(); g.moveTo(30, 30); g.lineTo(45, 26); g.lineTo(40, 34); g.lineTo(55, 28); g.lineTo(50, 36); g.lineTo(66, 31); g.lineTo(58, 40); g.lineTo(30, 40); g.closePath(); g.fill();
        g.fillStyle = "rgba(0,0,0,0.8)"; // shades
        rr(g, 36, 45, 12, 6, 2); g.fill(); rr(g, 52, 45, 12, 6, 2); g.fill();
        g.fillRect(48, 47, 4, 2);
        break;
      }
      case "mohawk": { // Rockin' Rob — mohawk + shades + stubble
        g.fillStyle = L.hatColor;
        for (let i = -3; i <= 3; i++) { g.beginPath(); g.moveTo(50 + i * 4, 30); g.lineTo(50 + i * 4 - 2, 14 - Math.abs(i)); g.lineTo(50 + i * 4 + 3, 30); g.closePath(); g.fill(); }
        g.fillStyle = shade(L.hair, 0.8); g.fillRect(30, 28, 40, 8);
        g.fillStyle = "rgba(0,0,0,0.55)"; // shading stubble
        g.beginPath(); g.ellipse(50, 66, 14, 8, 0, 0, Math.PI); g.fill();
        g.fillStyle = "rgba(20,20,20,0.85)"; // shades
        rr(g, 35, 44, 13, 7, 3); g.fill(); rr(g, 52, 44, 13, 7, 3); g.fill();
        break;
      }
      case "cowboy": { // Wild West — hat + mustache + bandana
        g.fillStyle = L.accent; // bandana
        g.beginPath(); g.moveTo(34, 70); g.lineTo(66, 70); g.lineTo(50, 84); g.closePath(); g.fill();
        g.strokeStyle = "#5a3a1a"; g.lineWidth = 3; // mustache
        g.beginPath(); g.moveTo(42, 62); g.quadraticCurveTo(50, 68, 58, 62); g.stroke();
        g.fillStyle = L.hatColor; // hat
        g.beginPath(); g.ellipse(50, 34, 36, 8, 0, 0, Math.PI * 2); g.fill();
        rr(g, 34, 16, 32, 20, 6); g.fill();
        g.fillStyle = shade(L.hatColor, 0.7); g.fillRect(34, 30, 32, 5);
        break;
      }
      case "cap": { // A-Train — engineer cap, strong jaw
        g.fillStyle = shade(L.skin, 0.8); g.fillRect(40, 70, 20, 10); // jaw
        g.fillStyle = L.hatColor;
        g.beginPath(); g.arc(50, 36, 24, Math.PI, 2 * Math.PI); g.fill();
        g.fillRect(26, 34, 48, 6);
        g.fillStyle = shade(L.hatColor, 0.7); g.fillRect(24, 38, 36, 5); // brim
        g.fillStyle = L.accent; g.fillRect(46, 24, 8, 8); // badge
        break;
      }
      case "trucker": { // Old Dog — grey hair + beard + cap
        g.fillStyle = L.hair; // hair sides
        g.beginPath(); g.ellipse(30, 50, 6, 12, 0, 0, Math.PI * 2); g.ellipse(70, 50, 6, 12, 0, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.ellipse(50, 70, 20, 14, 0, 0.05 * Math.PI, Math.PI); g.fill(); // beard
        g.fillStyle = L.hatColor;
        g.beginPath(); g.arc(50, 38, 24, Math.PI, 2 * Math.PI); g.fill();
        g.fillRect(26, 36, 48, 6);
        g.fillStyle = shade(L.hatColor, 0.75); g.fillRect(22, 40, 40, 5);
        break;
      }
      case "goggles": { // Dr. G — short hair, goggles on forehead, goatee
        g.fillStyle = L.hair; g.beginPath(); g.arc(50, 34, 23, Math.PI, 2 * Math.PI); g.fill(); g.fillRect(27, 32, 46, 5);
        g.strokeStyle = "#222"; g.lineWidth = 3; g.fillStyle = L.hatColor; // goggles
        rr(g, 33, 30, 13, 9, 3); g.fill(); g.stroke(); rr(g, 54, 30, 13, 9, 3); g.fill(); g.stroke();
        g.beginPath(); g.moveTo(46, 34); g.lineTo(54, 34); g.stroke();
        g.fillStyle = L.hair; g.beginPath(); g.ellipse(50, 68, 6, 7, 0, 0, Math.PI * 2); g.fill(); // goatee
        break;
      }
    }
  }

  function makeDriverPortrait(id, px) {
    const ch = CHARACTERS.find((c) => c.id === id) || CHARACTERS[0];
    const S = 2; // supersample
    const cv = document.createElement("canvas");
    cv.width = px * S; cv.height = px * S;
    cv.style.width = px + "px"; cv.style.height = px + "px";
    const g = cv.getContext("2d");
    g.scale((px * S) / 100, (px * S) / 100);
    drawFace(g, ch);
    return cv;
  }

  window.CHARACTERS = CHARACTERS;
  window.DRIVER_SKILLS = SKILLS;
  window.getCharacter = (id) => CHARACTERS.find((c) => c.id === id) || CHARACTERS[0];
  window.makeDriverPortrait = makeDriverPortrait;
})();
