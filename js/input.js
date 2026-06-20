/* input.js — shared player input controller (window.Input).
 * Produces an analog control state read by both race engines:
 *   steer    -1 (left) .. +1 (right)
 *   throttle  0 .. 1   (how far the stick is pushed up)
 *   brake     0 .. 1   (how far the stick is pushed down)
 *   nitro     bool
 * Sources: keyboard (digital) + a virtual thumbstick & NITRO button (touch).
 */
(function () {
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const I = { steer: 0, throttle: 0, brake: 0, nitro: false };
  const kb = { left: false, right: false, gas: false, brake: false, nitro: false };
  const js = { steer: 0, throttle: 0, brake: 0, nitro: false };

  function apply() {
    I.steer = clamp(js.steer + (kb.right ? 1 : 0) - (kb.left ? 1 : 0), -1, 1);
    I.throttle = Math.max(js.throttle, kb.gas ? 1 : 0);
    I.brake = Math.max(js.brake, kb.brake ? 1 : 0);
    I.nitro = js.nitro || kb.nitro;
  }

  I.reset = function () {
    js.steer = js.throttle = js.brake = 0; js.nitro = false;
    for (const k in kb) kb[k] = false;
    apply();
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
    window.addEventListener("keydown", (e) => { if (map[e.code]) { kb[map[e.code]] = true; apply(); e.preventDefault(); } });
    window.addEventListener("keyup", (e) => { if (map[e.code]) { kb[map[e.code]] = false; apply(); e.preventDefault(); } });

    bindStick();
    bindNitro();
  };

  function bindStick() {
    const zone = document.getElementById("stick");
    const base = document.getElementById("stick-base");
    const knob = document.getElementById("stick-knob");
    if (!zone || !base || !knob) return;
    const R = 58, dead = 0.16;
    let id = null, ox = 0, oy = 0;

    // response curve: gentle near centre for fine control, full at the edge
    const shape = (v, p) => {
      const a = Math.abs(v);
      if (a < dead) return 0;
      const t = Math.min(1, (a - dead) / (1 - dead));
      return Math.sign(v) * Math.pow(t, p);
    };

    // origin is the centre of the visible (fixed) d-pad
    const setOrigin = () => { const r = base.getBoundingClientRect(); ox = r.left + r.width / 2; oy = r.top + r.height / 2; };
    const move = (x, y) => {
      let dx = x - ox, dy = y - oy;
      const len = Math.hypot(dx, dy);
      if (len > R) { dx = dx / len * R; dy = dy / len * R; }
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      js.steer = shape(dx / R, 1.7);          // softer steering near centre
      const up = -dy / R;
      // throttle reaches full at ~half-up so steering diagonally still keeps speed
      js.throttle = up > dead ? Math.min(1, (up - dead) / (0.5 - dead)) : 0;
      js.brake = -up > dead ? Math.min(1, (-up - dead) / (0.5 - dead)) : 0;
      apply();
    };
    const start = (x, y, pid) => { id = pid; setOrigin(); move(x, y); };
    const end = () => { id = null; js.steer = js.throttle = js.brake = 0; knob.style.transform = "translate(-50%,-50%)"; apply(); };

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

  function bindNitro() {
    const btn = document.getElementById("btn-nitro");
    if (!btn) return;
    const on = (e) => { js.nitro = true; apply(); if (e.preventDefault) e.preventDefault(); if (e.pointerId != null && btn.setPointerCapture) { try { btn.setPointerCapture(e.pointerId); } catch (_) {} } };
    const off = () => { js.nitro = false; apply(); };
    if (window.PointerEvent) {
      btn.addEventListener("pointerdown", on); btn.addEventListener("pointerup", off);
      btn.addEventListener("pointercancel", off); btn.addEventListener("pointerleave", off);
    } else {
      btn.addEventListener("touchstart", on, { passive: false }); btn.addEventListener("touchend", off);
      btn.addEventListener("mousedown", on); btn.addEventListener("mouseup", off); btn.addEventListener("mouseleave", off);
    }
  }

  window.Input = I;
})();
