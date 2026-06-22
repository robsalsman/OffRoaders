/* app.js — UI state machine: menus, garage/shop, results, and launching races. */
(function () {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const screens = {
    menu: $("#screen-menu"),
    garage: $("#screen-garage"),
    results: $("#screen-results"),
    champion: $("#screen-champion"),
    howto: $("#screen-howto"),
    driver: $("#screen-driver"),
    vehicle: $("#screen-vehicle"),
    track: $("#screen-track"),
    pause: $("#screen-pause"),
  };
  const overlay = $("#overlay");
  const hud = $("#hud");
  const touch = $("#touch");
  const canvas = $("#game");

  let race = null;
  let lastResult = null;
  let liveBestLap = null;   // best lap to beat during the current race (record or this-race best)
  let prevLapsDone = 0;
  let lapFlashTimer = null;

  const isTouch = ("ontouchstart" in window) || navigator.maxTouchPoints > 0;

  function show(name) {
    overlay.classList.remove("hidden");
    Object.entries(screens).forEach(([k, el]) => el.classList.toggle("hidden", k !== name));
  }
  function hideOverlay() { overlay.classList.add("hidden"); }

  function ordinal(n) {
    const s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function fmtTime(t) {
    const m = Math.floor(t / 60), s = Math.floor(t % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }
  // lap/record time: M:SS.cc
  function fmtLap(t) {
    if (t == null || !isFinite(t)) return "—";
    const m = Math.floor(t / 60), s = Math.floor(t % 60), cc = Math.floor((t % 1) * 100);
    return `${m}:${String(s).padStart(2, "0")}.${String(cc).padStart(2, "0")}`;
  }

  // ---------------- Menu ----------------
  function initMenu() {
    if (window.Input) window.Input.init();
    Career.load();
    $("#btn-continue").classList.toggle("hidden", !Career.hasSave());
    show("menu");
  }

  $("#btn-continue").onclick = () => { Career.load(); openGarage(); };
  $("#btn-new").onclick = () => {
    if (Career.hasSave() && !confirm("Start a new career? This erases your saved progress.")) return;
    Career.newCareer();
    openDriverSelect("vehicle"); // pick driver, then truck, then garage
  };
  $("#btn-howto").onclick = () => show("howto");
  $("#btn-howto-back").onclick = () => show(Career.hasSave() ? "menu" : "menu");

  // ---------------- Garage ----------------
  function openGarage() {
    if (Career.seasonDone()) { showChampion(); return; }
    renderGarage();
    show("garage");
  }

  function renderGarage() {
    $("#cash").textContent = Career.state.money.toLocaleString();

    const track = Career.currentTrack();
    const stars = "★".repeat(track.difficulty) + "☆".repeat(5 - track.difficulty);
    const rec = Career.getRecord(track.id);
    const recTxt = (rec.lap != null || rec.race != null)
      ? `🏁 Best lap ${fmtLap(rec.lap)} &nbsp;•&nbsp; 🏆 Best race ${fmtTime(rec.race)}`
      : "No records yet — set one!";
    const homeCh = window.getCharacter(track.home);
    const nr = $("#next-race");
    nr.innerHTML = "";
    nr.appendChild(window.makeTrackPreview(track.id, 84));
    const meta = document.createElement("div");
    meta.className = "nr-meta";
    meta.innerHTML = `<div class="rname">${track.name}</div>
      <div class="meta">${Career.raceLabel()} • ${track.laps} laps • ${stars}</div>
      <div class="meta">⚑ ${track.feature} • 🏠 ${homeCh.name}'s home</div>
      <div class="meta records">${recTxt}</div>`;
    nr.appendChild(meta);

    renderVehiclePanel();

    // graphics toggle label
    const g = Career.graphics();
    $("#btn-graphics").textContent = "Graphics: " + (g === "enhanced" ? "Enhanced ✨" : "Classic");
    $("#btn-throttle").textContent = "Throttle: " + (Career.assist() === "smart" ? "Smart 🅰" : "Full");

    renderDriverPanel();

    // standings
    renderStandings($("#standings"), Career.sortedStandings());
  }

  function starBar(filled, total) {
    let s = '<span class="skill-stars">';
    for (let i = 0; i < total; i++) s += `<span class="star ${i < filled ? "" : "off"}">★</span>`;
    return s + "</span>";
  }

  function renderVehiclePanel() {
    const v = Career.vehicle();
    const prof = $("#vehicle-profile");
    prof.innerHTML = "";
    prof.appendChild(window.makeVehiclePortrait(v.id, 76));
    const info = document.createElement("div");
    info.className = "dp-info";
    info.innerHTML = `<div class="dp-name">${v.name}</div><div class="dp-tag">${v.blurb}</div>`;
    prof.appendChild(info);

    const wrap = $("#upgrades");
    wrap.innerHTML = "";
    Career.UPGRADE_DEFS.forEach((def) => {
      const innate = v.stats[def.key];
      const lvl = Career.upgradeLevel(v.id, def.key);
      const cost = Career.upgradeCostFor(v.id, def.key);
      const maxed = cost === null;
      const pips = Array.from({ length: Career.MAX_LEVEL }, (_, i) =>
        `<div class="pip ${i < lvl ? "on" : ""}"></div>`).join("");
      const el = document.createElement("div");
      el.className = "upg";
      el.innerHTML = `
        <div class="upg-top"><span class="upg-name">${def.name} ${starBar(innate, 5)}</span><span class="upg-lvl">+${lvl}</span></div>
        <div class="upg-desc">${def.desc}</div>
        <div class="pips">${pips}</div>
        <button ${maxed || !Career.canBuy(v.id, def.key) ? "disabled" : ""}>
          ${maxed ? "MAXED" : "Upgrade — 💰 " + cost.toLocaleString()}
        </button>`;
      el.querySelector("button").onclick = () => { if (Career.buy(v.id, def.key)) renderGarage(); };
      wrap.appendChild(el);
    });
  }

  function renderDriverPanel() {
    const ch = Career.driver();
    const prof = $("#driver-profile");
    prof.innerHTML = "";
    prof.appendChild(window.makeDriverPortrait(ch.id, 76));
    const info = document.createElement("div");
    info.className = "dp-info";
    info.innerHTML = `<div class="dp-name">${ch.name}</div>
      <div class="dp-tag">${ch.tagline}</div>
      <div class="dp-bio">${ch.bio}</div>`;
    prof.appendChild(info);

    // training (per-skill): innate stars + trained pips + train button
    const tr = $("#driver-training");
    tr.innerHTML = "";
    window.DRIVER_SKILLS.forEach((def) => {
      const innate = ch.skills[def.key];
      const lvl = Career.trainLevel(ch.id, def.key);
      const cost = Career.trainCostFor(ch.id, def.key);
      const maxed = cost === null;
      const pips = Array.from({ length: Career.MAX_LEVEL }, (_, i) =>
        `<div class="pip ${i < lvl ? "on" : ""}"></div>`).join("");
      const el = document.createElement("div");
      el.className = "upg";
      el.innerHTML = `
        <div class="upg-top"><span class="upg-name">${def.name} ${starBar(innate, 5)}</span><span class="upg-lvl">+${lvl}</span></div>
        <div class="upg-desc">${def.desc}</div>
        <div class="pips">${pips}</div>
        <button ${maxed || !Career.canTrain(ch.id, def.key) ? "disabled" : ""}>
          ${maxed ? "MAXED" : "Train — 💰 " + cost.toLocaleString()}
        </button>`;
      el.querySelector("button").onclick = () => { if (Career.train(ch.id, def.key)) renderGarage(); };
      tr.appendChild(el);
    });
  }

  function renderStandings(table, rows) {
    // current driver->truck pairing, so each driver shows the truck they race
    const pairing = {};
    Career.buildRoster(Career.currentTrack().id).forEach((r) => (pairing[r.characterId] = r.vehicleId));
    table.innerHTML = "";
    rows.forEach((r, i) => {
      const tr = document.createElement("tr");
      if (r.you) tr.className = "you";
      const td0 = document.createElement("td"); td0.textContent = i + 1;
      const td1 = document.createElement("td"); td1.className = "name-cell";
      const vid = pairing[r.characterId];
      if (vid) td1.appendChild(window.makeVehiclePortrait(vid, 22));
      const nm = document.createElement("span"); nm.textContent = r.name + (r.you ? " (You)" : "");
      td1.appendChild(nm);
      const td2 = document.createElement("td"); td2.textContent = r.points + " pts";
      tr.appendChild(td0); tr.appendChild(td1); tr.appendChild(td2);
      table.appendChild(tr);
    });
  }

  $("#btn-menu").onclick = () => show("menu");
  $("#btn-reset").onclick = () => {
    if (confirm("Reset your entire career (money, upgrades, championship)?")) {
      Career.newCareer();
      renderGarage();
    }
  };
  $("#btn-race").onclick = startRace;
  $("#btn-graphics").onclick = () => { Career.toggleGraphics(); renderGarage(); };
  $("#btn-throttle").onclick = () => { Career.toggleAssist(); renderGarage(); };
  $("#btn-change-driver").onclick = () => openDriverSelect("garage");

  // ---------------- Driver select ----------------
  let driverPick = null;
  let driverReturnTo = "garage";

  function openDriverSelect(returnTo) {
    driverReturnTo = returnTo || "garage";
    driverPick = Career.driverId();
    const grid = $("#driver-grid");
    grid.innerHTML = "";
    window.CHARACTERS.forEach((ch) => {
      const card = document.createElement("div");
      card.className = "dcard" + (ch.id === driverPick ? " sel" : "");
      card.dataset.id = ch.id;
      card.appendChild(window.makeDriverPortrait(ch.id, 96));
      const nm = document.createElement("div"); nm.className = "dc-name"; nm.textContent = ch.name;
      const tg = document.createElement("div"); tg.className = "dc-tag"; tg.textContent = ch.tagline;
      card.appendChild(nm); card.appendChild(tg);
      card.onclick = () => selectDriverCard(ch.id);
      grid.appendChild(card);
    });
    renderDriverDetail();
    show("driver");
  }

  function selectDriverCard(id) {
    driverPick = id;
    $$("#driver-grid .dcard").forEach((c) => c.classList.toggle("sel", c.dataset.id === id));
    renderDriverDetail();
  }

  function renderDriverDetail() {
    const ch = window.getCharacter(driverPick);
    const skills = window.DRIVER_SKILLS
      .map((d) => `${d.name} ${starBar(ch.skills[d.key], 5)}`).join(" &nbsp; ");
    $("#driver-detail").innerHTML = `<div class="dd-bio">${ch.bio}</div><div style="margin-top:8px">${skills}</div>`;
  }

  $("#btn-driver-confirm").onclick = () => {
    Career.setDriver(driverPick);
    if (driverReturnTo === "vehicle") openVehicleSelect("garage");
    else openGarage();
  };

  // ---------------- Truck select ----------------
  let vehiclePick = null;

  function openVehicleSelect() {
    vehiclePick = Career.vehicleId();
    const grid = $("#vehicle-grid");
    grid.innerHTML = "";
    window.VEHICLES.forEach((v) => {
      const card = document.createElement("div");
      card.className = "dcard" + (v.id === vehiclePick ? " sel" : "");
      card.dataset.id = v.id;
      card.appendChild(window.makeVehiclePortrait(v.id, 96));
      const nm = document.createElement("div"); nm.className = "dc-name"; nm.textContent = v.name;
      const tg = document.createElement("div"); tg.className = "dc-tag"; tg.textContent = v.blurb;
      card.appendChild(nm); card.appendChild(tg);
      card.onclick = () => selectVehicleCard(v.id);
      grid.appendChild(card);
    });
    renderVehicleDetail();
    show("vehicle");
  }
  function selectVehicleCard(id) {
    vehiclePick = id;
    $$("#vehicle-grid .dcard").forEach((c) => c.classList.toggle("sel", c.dataset.id === id));
    renderVehicleDetail();
  }
  function renderVehicleDetail() {
    const v = window.getVehicle(vehiclePick);
    const stats = Career.UPGRADE_DEFS
      .map((d) => `${d.name} ${starBar(v.stats[d.key], 5)}`).join(" &nbsp; ");
    $("#vehicle-detail").innerHTML = `<div class="dd-bio">${v.blurb}</div><div style="margin-top:8px">${stats}</div>`;
  }
  $("#btn-vehicle-confirm").onclick = () => { Career.setVehicle(vehiclePick); openGarage(); };
  $("#btn-change-vehicle").onclick = () => openVehicleSelect();

  // ---------------- Track select ----------------
  let trackPick = null;

  function openTrackSelect() {
    trackPick = Career.currentTrack().id;
    const grid = $("#track-grid");
    grid.innerHTML = "";
    Career.trackList().forEach(({ track, completed }) => {
      const card = document.createElement("div");
      card.className = "dcard" + (track.id === trackPick ? " sel" : "") + (completed ? " done" : "");
      card.dataset.id = track.id;
      card.appendChild(window.makeTrackPreview(track.id, 96));
      const nm = document.createElement("div"); nm.className = "dc-name"; nm.textContent = track.name;
      const tg = document.createElement("div"); tg.className = "dc-tag";
      tg.textContent = completed ? "✓ Completed" : track.feature;
      card.appendChild(nm); card.appendChild(tg);
      if (!completed) card.onclick = () => selectTrackCard(track.id);
      grid.appendChild(card);
    });
    renderTrackDetail();
    show("track");
  }
  function selectTrackCard(id) {
    trackPick = id;
    $$("#track-grid .dcard").forEach((c) => c.classList.toggle("sel", c.dataset.id === id));
    renderTrackDetail();
  }
  function renderTrackDetail() {
    const t = window.getTrack(trackPick);
    const home = window.getCharacter(t.home);
    const stars = "★".repeat(t.difficulty) + "☆".repeat(5 - t.difficulty);
    $("#track-detail").innerHTML =
      `<div class="dd-bio">${t.name} — ${t.feature}</div>
       <div style="margin-top:6px">${t.laps} laps • Difficulty ${stars} • 🏠 ${home.name}'s home track</div>`;
  }
  $("#btn-choose-track").onclick = openTrackSelect;
  $("#btn-track-confirm").onclick = () => { Career.selectTrack(trackPick); openGarage(); };
  $("#btn-track-back").onclick = openGarage;

  // ---------------- Race ----------------
  function startRace() {
    const track = Career.currentTrack();
    hideOverlay();
    hud.classList.remove("hidden");
    touch.classList.toggle("hidden", !isTouch);
    if (window.Input) { // the truck auto-accelerates everywhere; you just steer
      window.Input.setAutoGas(true);
      window.Input.setSmartThrottle(Career.assist() === "smart");
    }

    // set up lap-record tracking for this race
    liveBestLap = Career.getRecord(track.id).lap;
    prevLapsDone = 0;
    $("#hud-bestlap").textContent = fmtLap(liveBestLap);
    $("#hud-laptime").textContent = "0:00.0";
    $("#lapflash").classList.add("hidden");

    // player's truck icon on the HUD
    const ic = $("#hud-truck");
    ic.innerHTML = "";
    ic.appendChild(window.makeVehiclePortrait(Career.vehicleId(), 34));

    const Engine = (Career.graphics() === "classic" || !window.RacePro) ? Race : RacePro;
    race = new Engine(canvas, {
      track,
      touch: isTouch,
      roster: Career.buildRoster(track.id),
      onUpdate: updateHud,
      onFinish: onRaceFinish,
    });
    race.start();
  }

  function updateHud(s) {
    $("#hud-lap").textContent = `${s.lap}/${s.laps}`;
    $("#hud-pos").textContent = `${s.pos}/${s.total}`;
    $("#hud-time").textContent = fmtTime(s.time);
    $("#hud-nitro").style.width = s.nitro + "%";
    $("#hud-speed").style.width = (s.speed * 100) + "%";
    $("#hud-laptime").textContent = fmtLap(s.lapTime || 0);

    // a lap just completed?
    if (s.lapsDone > prevLapsDone && s.lastLap != null) {
      prevLapsDone = s.lapsDone;
      const isRecord = liveBestLap == null || s.lastLap < liveBestLap;
      if (isRecord) liveBestLap = s.lastLap;
      $("#hud-bestlap").textContent = fmtLap(liveBestLap);
      flashLap(`LAP ${s.lapsDone}  ${fmtLap(s.lastLap)}`, isRecord);
    }
  }

  function flashLap(text, isRecord) {
    const el = $("#lapflash");
    el.textContent = isRecord ? "★ " + text + "  RECORD!" : text;
    el.classList.toggle("record", !!isRecord);
    el.classList.remove("hidden");
    el.style.opacity = "1";
    clearTimeout(lapFlashTimer);
    lapFlashTimer = setTimeout(() => { el.style.opacity = "0"; }, 1600);
  }

  function endRaceCleanup() {
    if (race) { race.stop(); race = null; }
    hud.classList.add("hidden");
    touch.classList.add("hidden");
  }

  function onRaceFinish(order) {
    const track = Career.currentTrack();
    // capture the player's times before tearing the race down
    const p = race && race.player;
    const bestLap = p ? p.bestLapThisRace : null;
    const raceTime = p ? p.finishTime : null;
    const lapIsRecord = bestLap != null && Career.submitLap(track.id, bestLap);
    const raceIsRecord = raceTime != null && Career.submitRace(track.id, raceTime);
    const pickupBonus = race ? (race.cashCollected || 0) : 0;

    lastResult = Career.recordResult(order, pickupBonus);
    lastResult.bestLap = bestLap;
    lastResult.raceTime = raceTime;
    lastResult.lapIsRecord = lapIsRecord;
    lastResult.raceIsRecord = raceIsRecord;
    endRaceCleanup();
    showResults(order, track);
  }

  // ---------------- Results ----------------
  function showResults(order, track) {
    const table = $("#results-table");
    table.innerHTML = "";
    order.forEach((car, idx) => {
      const name = (car.name || "Rival") + (car.isPlayer ? " (You)" : "");
      const tr = document.createElement("tr");
      if (car.isPlayer) tr.className = "you";
      const td0 = document.createElement("td"); td0.className = "pos"; td0.textContent = ordinal(idx + 1);
      const td1 = document.createElement("td"); td1.className = "name-cell";
      if (car.vehicleId) td1.appendChild(window.makeVehiclePortrait(car.vehicleId, 24));
      const nm = document.createElement("span"); nm.textContent = name;
      td1.appendChild(nm);
      const td2 = document.createElement("td"); td2.style.textAlign = "right"; td2.textContent = (Career.POINTS[idx] || 0) + " pts";
      tr.appendChild(td0); tr.appendChild(td1); tr.appendChild(td2);
      table.appendChild(tr);
    });

    // lap / track record summary
    const lapTxt = lastResult.bestLap != null
      ? `Best lap: <span class="${lastResult.lapIsRecord ? "new" : "rec"}">${fmtLap(lastResult.bestLap)}</span>${lastResult.lapIsRecord ? " 🏁 NEW LAP RECORD" : ""}`
      : "";
    const raceTxt = lastResult.raceTime != null
      ? `Race time: <span class="${lastResult.raceIsRecord ? "new" : "rec"}">${fmtTime(lastResult.raceTime)}</span>${lastResult.raceIsRecord ? " 🏆 NEW TRACK RECORD" : ""}`
      : "";
    $("#results-records").innerHTML = [lapTxt, raceTxt].filter(Boolean).join("<br>");

    const pos = lastResult.playerPos;
    $("#results-title").textContent = pos === 0 ? "🏆 WINNER!" : `Finished ${ordinal(pos + 1)}`;
    const bonusTxt = lastResult.bonus ? ` &nbsp;•&nbsp; $ pickups: <b>💰 ${lastResult.bonus.toLocaleString()}</b>` : "";
    $("#results-reward").innerHTML =
      `Prize: <b>💰 ${lastResult.prize.toLocaleString()}</b>${bonusTxt} &nbsp;•&nbsp; +${Career.POINTS[pos] || 0} championship pts`;
    show("results");
  }

  $("#btn-next").onclick = () => {
    if (Career.seasonDone()) showChampion();
    else openGarage();
  };

  // ---------------- Champion ----------------
  function showChampion() {
    const standings = Career.sortedStandings();
    const winner = standings[0];
    const youPos = standings.findIndex((r) => r.you);
    const body = $("#champion-body");
    body.innerHTML = `
      <div class="trophy">${winner.you ? "🏆" : "🏁"}</div>
      <div>Season Champion</div>
      <div class="who">${winner.name}</div>
      <div>You finished <b>${ordinal(youPos + 1)}</b> with ${standings[youPos].points} points.</div>
    `;
    const table = document.createElement("table");
    table.className = "standings";
    table.style.margin = "16px auto 0";
    renderStandings(table, standings);
    body.appendChild(table);
    $("#champion-title").textContent = winner.you ? "YOU ARE THE CHAMPION!" : "SEASON COMPLETE";
    show("champion");
  }

  $("#btn-newseason").onclick = () => { Career.newSeason(); openGarage(); };
  $("#btn-champion-menu").onclick = () => show("menu");

  // ---------------- Pause ----------------
  function togglePause(force) {
    if (!race || !race.running) return;
    const willPause = force !== undefined ? force : !race.paused;
    race.setPaused(willPause);
    if (willPause) { overlay.classList.remove("hidden"); show("pause"); }
    else { hideOverlay(); }
  }
  $("#pauseBtn").onclick = () => togglePause(true);
  $("#btn-resume").onclick = () => togglePause(false);
  $("#btn-restart").onclick = () => { endRaceCleanup(); startRace(); };
  $("#btn-quit").onclick = () => { endRaceCleanup(); openGarage(); };
  window.addEventListener("keydown", (e) => {
    if (e.code === "Escape" && race && race.running) togglePause();
  });

  // keep canvas sized
  window.addEventListener("resize", () => { if (race) race._resize(); });

  initMenu();
})();
