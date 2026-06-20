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
    openGarage();
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
    $("#next-race").innerHTML = `
      <div class="rname">${track.name}</div>
      <div class="meta">${Career.raceLabel()} • ${track.laps} laps • Difficulty ${stars}</div>
      <div class="meta records">${recTxt}</div>`;

    // upgrades
    const wrap = $("#upgrades");
    wrap.innerHTML = "";
    Career.UPGRADE_DEFS.forEach((def) => {
      const lvl = Career.upgradeLevel(def.key);
      const cost = Career.upgradeCostFor(def.key);
      const maxed = cost === null;
      const pips = Array.from({ length: Career.MAX_LEVEL }, (_, i) =>
        `<div class="pip ${i < lvl ? "on" : ""}"></div>`).join("");
      const el = document.createElement("div");
      el.className = "upg";
      el.innerHTML = `
        <div class="upg-top"><span class="upg-name">${def.name}</span><span class="upg-lvl">Lv ${lvl}/${Career.MAX_LEVEL}</span></div>
        <div class="upg-desc">${def.desc}</div>
        <div class="pips">${pips}</div>
        <button ${maxed || !Career.canBuy(def.key) ? "disabled" : ""}>
          ${maxed ? "MAXED" : "Upgrade — 💰 " + cost.toLocaleString()}
        </button>`;
      el.querySelector("button").onclick = () => {
        if (Career.buy(def.key)) renderGarage();
      };
      wrap.appendChild(el);
    });

    // graphics toggle label
    const g = Career.graphics();
    $("#btn-graphics").textContent = "Graphics: " + (g === "enhanced" ? "Enhanced ✨" : "Classic");

    // standings
    renderStandings($("#standings"), Career.sortedStandings());
  }

  function renderStandings(table, rows) {
    table.innerHTML = "";
    rows.forEach((r, i) => {
      const tr = document.createElement("tr");
      if (r.you) tr.className = "you";
      tr.innerHTML = `<td>${i + 1}</td><td>${r.name}</td><td>${r.points} pts</td>`;
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

  // ---------------- Race ----------------
  function startRace() {
    const track = Career.currentTrack();
    hideOverlay();
    hud.classList.remove("hidden");
    touch.classList.toggle("hidden", !isTouch);

    // set up lap-record tracking for this race
    liveBestLap = Career.getRecord(track.id).lap;
    prevLapsDone = 0;
    $("#hud-bestlap").textContent = fmtLap(liveBestLap);
    $("#hud-laptime").textContent = "0:00.0";
    $("#lapflash").classList.add("hidden");

    const Engine = (Career.graphics() === "classic" || !window.RacePro) ? Race : RacePro;
    race = new Engine(canvas, {
      track,
      perf: Career.performance(),
      aiStrength: Career.aiStrength(),
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

    lastResult = Career.recordResult(order);
    lastResult.bestLap = bestLap;
    lastResult.raceTime = raceTime;
    lastResult.lapIsRecord = lapIsRecord;
    lastResult.raceIsRecord = raceIsRecord;
    endRaceCleanup();
    showResults(order, track);
  }

  // ---------------- Results ----------------
  function showResults(order, track) {
    const rivals = Career.RIVALS;
    const table = $("#results-table");
    table.innerHTML = "";
    order.forEach((car, idx) => {
      const name = car.isPlayer ? "You" : (rivals[car.rivalIndex] || "Rival");
      const tr = document.createElement("tr");
      if (car.isPlayer) tr.className = "you";
      tr.innerHTML = `<td class="pos">${ordinal(idx + 1)}</td>
        <td><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${car.color};margin-right:8px;vertical-align:middle"></span>${name}</td>
        <td style="text-align:right">${Career.POINTS[idx] || 0} pts</td>`;
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
    $("#results-reward").innerHTML =
      `Prize: <b>💰 ${lastResult.prize.toLocaleString()}</b> &nbsp;•&nbsp; +${Career.POINTS[pos] || 0} championship pts`;
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
