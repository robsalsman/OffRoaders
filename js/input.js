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
  let autoGas = false, smart = false;

  I.setAutoGas = function (on) { autoGas = !!on; };
  I.setSmartThrottle = function (on) { smart = !!on; };

  // Convert raw inputs into a control command for a car at the given heading.
  I.resolve = function (carAngle) {
    if (I.override) return { steer: I.steer, throttle: I.throttle, brake: I.brake, nitro: I.nitro };
    const brake = (btn.brake ? 1 : 0) || (kb.brake ? 1 : 0);
    const nitro = btn.nitro || kb.nitro;
    let steer = (kb.right ? 1 : 0) - (kb.left ? 1 : 0);
    let turn = Math.abs(steer);

    if (pad.active) { // directional joystick steers toward the pushed heading
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
    bindButton("btn-nitro", (v) => { btn.nitro = v; });
    bindButton("btn-brake", (v) => { btn.brake = v; });
  };

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
