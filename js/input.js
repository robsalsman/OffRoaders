/* input.js — shared player input controller (window.Input).
 * Produces an analog control state read by both race engines:
 *   steer    -1 (left) .. +1 (right)
 *   throttle  0 .. 1
 *   brake     0 .. 1
 *   nitro     bool
 *
 * Desktop: keyboard (manual gas/brake/steer/nitro).
 * Mobile: AUTO-ACCELERATE + a wide analog steering bar across the bottom
 * (slide a thumb left/right to steer), plus NITRO and BRAKE buttons. This
 * frees the thumb to do nothing but steer, which is far easier one-handed.
 */
(function () {
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const I = { steer: 0, throttle: 0, brake: 0, nitro: false };
  const kb = { left: false, right: false, gas: false, brake: false, nitro: false };
  const js = { steer: 0, brake: 0, nitro: false }; // touch state
  let autoGas = false;

  function apply() {
    I.steer = clamp(js.steer + (kb.right ? 1 : 0) - (kb.left ? 1 : 0), -1, 1);
    I.brake = Math.max(js.brake, kb.brake ? 1 : 0);
    const auto = autoGas && I.brake <= 0 ? 1 : 0;
    I.throttle = Math.max(kb.gas ? 1 : 0, auto);
    I.nitro = js.nitro || kb.nitro;
  }

  // app enables auto-accelerate when racing on a touch device
  I.setAutoGas = function (on) { autoGas = !!on; apply(); };

  I.reset = function () {
    js.steer = js.brake = 0; js.nitro = false;
    for (const k in kb) kb[k] = false;
    apply();
    const knob = document.getElementById("steer-knob");
    if (knob) knob.style.left = "50%";
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
    bindBar();
    bindButton("btn-nitro", (v) => { js.nitro = v; });
    bindButton("btn-brake", (v) => { js.brake = v ? 1 : 0; });
  };

  // relative analog steering: wherever you grab the bar is centre; slide
  // left/right from there to steer (full lock after ~half the bar's reach).
  function bindBar() {
    const bar = document.getElementById("steerbar");
    const knob = document.getElementById("steer-knob");
    if (!bar) return;
    let id = null, ox = 0;
    const shape = (v) => Math.sign(v) * Math.pow(Math.min(1, Math.abs(v)), 1.35);
    const move = (x) => {
      const w = bar.getBoundingClientRect().width;
      const range = clamp(w * 0.42, 70, 240);
      js.steer = shape(clamp((x - ox) / range, -1, 1));
      if (knob) knob.style.left = (50 + js.steer * 42) + "%";
      apply();
    };
    const start = (x, pid) => { id = pid; ox = x; move(x); };
    const end = () => { id = null; js.steer = 0; if (knob) knob.style.left = "50%"; apply(); };

    if (window.PointerEvent) {
      bar.addEventListener("pointerdown", (e) => { start(e.clientX, e.pointerId); try { bar.setPointerCapture(e.pointerId); } catch (_) {} e.preventDefault(); }, { passive: false });
      bar.addEventListener("pointermove", (e) => { if (e.pointerId === id) { move(e.clientX); e.preventDefault(); } }, { passive: false });
      bar.addEventListener("pointerup", (e) => { if (e.pointerId === id) { end(); e.preventDefault(); } });
      bar.addEventListener("pointercancel", (e) => { if (e.pointerId === id) end(); });
    } else {
      bar.addEventListener("touchstart", (e) => { const t = e.changedTouches[0]; start(t.clientX, t.identifier); e.preventDefault(); }, { passive: false });
      bar.addEventListener("touchmove", (e) => { for (const t of e.changedTouches) if (t.identifier === id) move(t.clientX); e.preventDefault(); }, { passive: false });
      bar.addEventListener("touchend", (e) => { for (const t of e.changedTouches) if (t.identifier === id) end(); }, { passive: false });
      bar.addEventListener("touchcancel", (e) => { for (const t of e.changedTouches) if (t.identifier === id) end(); }, { passive: false });
    }
  }

  function bindButton(elId, setter) {
    const btn = document.getElementById(elId);
    if (!btn) return;
    const on = (e) => { setter(true); btn.classList.add("pressed"); apply(); if (e && e.preventDefault) e.preventDefault(); if (e && e.pointerId != null && btn.setPointerCapture) { try { btn.setPointerCapture(e.pointerId); } catch (_) {} } };
    const off = () => { setter(false); btn.classList.remove("pressed"); apply(); };
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
