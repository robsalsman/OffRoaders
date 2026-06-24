/* input.js — shared player input controller (window.Input).
 *
 * Desktop: keyboard (arrows/WASD steer, up/down gas/brake, space nitro).
 *
 * Mobile: a DIRECTIONAL joystick. You push the pad in the on-screen direction
 * you want the truck to go, and it steers to head that way — so pushing "down"
 * makes the truck drive down the screen (no more "up = gas" confusion). The
 * truck auto-accelerates; NITRO and BRAKE are separate buttons.
 *
 * Engines call Input.resolve(carAngle) to get { steer, throttle, brake, nitro }.
 */
(function () {
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const PI = Math.PI;
  const I = { steer: 0, throttle: 0, brake: 0, nitro: false };
  const kb = { left: false, right: false, gas: false, brake: false, nitro: false };
  const pad = { x: 0, y: 0, active: false }; // joystick vector (screen space, up = -y)
  const btn = { brake: false, nitro: false };
  let autoGas = false, smart = false, control = "pad";

  I.setAutoGas = function (on) { autoGas = !!on; };
  I.setSmartThrottle = function (on) { smart = !!on; };
  I.setControlMode = function (m) { control = m; }; // "pad" or "wheel"

  // Convert raw inputs into a control command for a car at the given heading.
  I.resolve = function (carAngle) {
    if (I.override) return { steer: I.steer, throttle: I.throttle, brake: I.brake, nitro: I.nitro };
    const brake = (btn.brake ? 1 : 0) || (kb.brake ? 1 : 0);
    const nitro = btn.nitro || kb.nitro;
    let steer = (kb.right ? 1 : 0) - (kb.left ? 1 : 0);
    let turn = Math.abs(steer);

    if (pad.active) { // directional: steer toward the pushed/dragged heading (pad or wheel)
      let diff = Math.atan2(pad.y, pad.x) - carAngle;
      while (diff > PI) diff -= 2 * PI;
      while (diff < -PI) diff += 2 * PI;
      steer = clamp(diff * 2.4, -1, 1);
      turn = Math.min(1, Math.abs(diff) / 1.2);
    }

    let throttle;
    if (autoGas) throttle = brake > 0 ? 0 : (smart ? 1 - 0.42 * Math.pow(turn, 1.3) : 1);
    else throttle = kb.gas ? 1 : 0;

    // expose for any legacy readers / HUD
    I.steer = steer; I.throttle = throttle; I.brake = brake; I.nitro = nitro;
    return { steer, throttle, brake, nitro };
  };

  I.reset = function () {
    pad.x = pad.y = 0; pad.active = false;
    btn.brake = btn.nitro = false;
    for (const k in kb) kb[k] = false;
    const knob = document.getElementById("stick-knob");
    if (knob) knob.style.transform = "translate(-50%,-50%)";
    const cv = document.getElementById("wheel-cv");
    if (cv) { cv.style.transition = "none"; cv.style.transform = "rotate(0deg)"; }
  };

  let inited = false;
  I.init = function () {
    if (inited) return; inited = true;
    const map = {
      ArrowUp: "gas", KeyW: "gas", ArrowDown: "brake", KeyS: "brake",
      ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right",
      Space: "nitro",
    };
    window.addEventListener("keydown", (e) => { if (map[e.code]) { kb[map[e.code]] = true; e.preventDefault(); } });
    window.addEventListener("keyup", (e) => { if (map[e.code]) { kb[map[e.code]] = false; e.preventDefault(); } });
    bindPad();
    bindWheel();
    bindButton("btn-nitro", (v) => { btn.nitro = v; });
  };

  // steering wheel: a directional dial. Drag toward where you want the truck to go
  // (same as the d-pad) — feeds `pad`; the wheel spins to point that way.
  const ISO_Y = 0.62; // un-foreshorten screen Y so the heading matches the tilted view
  function bindWheel() {
    const zone = document.getElementById("wheel");
    const cv = document.getElementById("wheel-cv");
    if (!zone || !cv) return;
    drawWheel(cv);
    let id = null;
    const apply = (x, y) => {
      const r = zone.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const dx = x - cx, dy = y - cy;
      if (Math.hypot(dx, dy) > 16) {
        pad.x = dx; pad.y = dy / ISO_Y; pad.active = true;
        const ang = Math.atan2(dy, dx);
        cv.style.transition = "none";
        cv.style.transform = `rotate(${ang + Math.PI / 2}rad)`;
      } else { pad.active = false; }
    };
    const release = () => {
      id = null; // hold the last heading — no auto-centre
    };
    if (window.PointerEvent) {
      zone.addEventListener("pointerdown", (e) => { id = e.pointerId; try { zone.setPointerCapture(e.pointerId); } catch (_) {} apply(e.clientX, e.clientY); e.preventDefault(); }, { passive: false });
      zone.addEventListener("pointermove", (e) => { if (e.pointerId === id) { apply(e.clientX, e.clientY); e.preventDefault(); } }, { passive: false });
      zone.addEventListener("pointerup", (e) => { if (e.pointerId === id) { release(); e.preventDefault(); } });
      zone.addEventListener("pointercancel", (e) => { if (e.pointerId === id) release(); });
    } else {
      zone.addEventListener("touchstart", (e) => { const t = e.changedTouches[0]; id = t.identifier; apply(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
      zone.addEventListener("touchmove", (e) => { for (const t of e.changedTouches) if (t.identifier === id) apply(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
      zone.addEventListener("touchend", (e) => { for (const t of e.changedTouches) if (t.identifier === id) release(); }, { passive: false });
    }
  }
  function drawWheel(cv) {
    const g = cv.getContext("2d"), S = cv.width, c = S / 2, R = c - 14;
    g.clearRect(0, 0, S, S);
    // outer rim
    g.lineWidth = 30; g.strokeStyle = "#23252b";
    g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 22; g.strokeStyle = "#3a3d45";
    g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.stroke();
    // red top marker
    g.lineWidth = 22; g.strokeStyle = "#d22f2f";
    g.beginPath(); g.arc(c, c, R, -Math.PI / 2 - 0.32, -Math.PI / 2 + 0.32); g.stroke();
    // spokes
    g.strokeStyle = "#2b2e35"; g.lineWidth = 22; g.lineCap = "round";
    for (const a of [Math.PI / 2, Math.PI / 2 + 2.094, Math.PI / 2 + 4.189]) {
      g.beginPath(); g.moveTo(c, c); g.lineTo(c + Math.cos(a) * R, c + Math.sin(a) * R); g.stroke();
    }
    // hub
    g.fillStyle = "#43474f"; g.beginPath(); g.arc(c, c, 34, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#d22f2f"; g.beginPath(); g.arc(c, c, 16, 0, Math.PI * 2); g.fill();
  }

  // permanent directional joystick: origin is the centre of the fixed pad
  function bindPad() {
    const zone = document.getElementById("stick");
    const base = document.getElementById("stick-base");
    const knob = document.getElementById("stick-knob");
    if (!zone || !base || !knob) return;
    const R = 64, dead = 0.2;
    let id = null, ox = 0, oy = 0;

    const setOrigin = () => { const r = base.getBoundingClientRect(); ox = r.left + r.width / 2; oy = r.top + r.height / 2; };
    const move = (x, y) => {
      let dx = x - ox, dy = y - oy;
      const len = Math.hypot(dx, dy);
      if (len > R) { dx = dx / len * R; dy = dy / len * R; }
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      const mag = Math.min(1, len / R);
      pad.active = mag > dead;
      pad.x = dx; pad.y = dy; // screen-space vector (up = negative y)
    };
    const start = (x, y, pid) => { id = pid; setOrigin(); move(x, y); };
    const end = () => { id = null; pad.active = false; pad.x = pad.y = 0; knob.style.transform = "translate(-50%,-50%)"; };

    if (window.PointerEvent) {
      zone.addEventListener("pointerdown", (e) => { start(e.clientX, e.clientY, e.pointerId); try { zone.setPointerCapture(e.pointerId); } catch (_) {} e.preventDefault(); }, { passive: false });
      zone.addEventListener("pointermove", (e) => { if (e.pointerId === id) { move(e.clientX, e.clientY); e.preventDefault(); } }, { passive: false });
      zone.addEventListener("pointerup", (e) => { if (e.pointerId === id) { end(); e.preventDefault(); } });
      zone.addEventListener("pointercancel", (e) => { if (e.pointerId === id) end(); });
    } else {
      zone.addEventListener("touchstart", (e) => { const t = e.changedTouches[0]; start(t.clientX, t.clientY, t.identifier); e.preventDefault(); }, { passive: false });
      zone.addEventListener("touchmove", (e) => { for (const t of e.changedTouches) if (t.identifier === id) move(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
      zone.addEventListener("touchend", (e) => { for (const t of e.changedTouches) if (t.identifier === id) end(); }, { passive: false });
      zone.addEventListener("touchcancel", (e) => { for (const t of e.changedTouches) if (t.identifier === id) end(); }, { passive: false });
    }
  }

  function bindButton(elId, setter) {
    const b = document.getElementById(elId);
    if (!b) return;
    const on = (e) => { setter(true); b.classList.add("pressed"); if (e && e.preventDefault) e.preventDefault(); if (e && e.pointerId != null && b.setPointerCapture) { try { b.setPointerCapture(e.pointerId); } catch (_) {} } };
    const off = () => { setter(false); b.classList.remove("pressed"); };
    if (window.PointerEvent) {
      b.addEventListener("pointerdown", on); b.addEventListener("pointerup", off);
      b.addEventListener("pointercancel", off); b.addEventListener("pointerleave", off);
    } else {
      b.addEventListener("touchstart", on, { passive: false }); b.addEventListener("touchend", off);
      b.addEventListener("mousedown", on); b.addEventListener("mouseup", off); b.addEventListener("mouseleave", off);
    }
  }

  window.Input = I;
})();
