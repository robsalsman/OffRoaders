/* career.js — persistent career across three circuits (trucks / boats / helis).
 * Money, the chosen driver, driver training, vehicle upgrades and lap records are
 * shared; each circuit keeps its OWN selected vehicle and championship season.
 * The 6 characters fill every grid; you play one and the other five are rivals.
 * Saved to localStorage.
 */
(function () {
  const KEY = "offroaders_career_v1";
  const POINTS = [10, 8, 6, 5, 4, 3, 2, 1]; // championship points by finish position
  const PRIZE = [1200, 800, 550, 400, 300, 200, 150, 120]; // cash by finish position
  const MAX_LEVEL = 5;

  const UPGRADE_DEFS = [
    { key: "engine", name: "Engine", desc: "Higher top speed" },
    { key: "tires", name: "Tires", desc: "Sharper grip & turning" },
    { key: "shocks", name: "Shocks", desc: "Faster acceleration & better off-road" },
    { key: "nitro", name: "Nitro", desc: "Bigger boost & faster refill" },
  ];

  const cost = (level) => 500 + level * 300; // shared by vehicle upgrades & driver training
  const circuitIds = () => (window.Circuits ? window.Circuits.ids() : ["trucks"]);
  const trackSetFor = (cid) => (window.TRACK_SETS && window.TRACK_SETS[cid]) || window.TRACKS;
  const vehicleSetFor = (cid) => (window.VEHICLE_SETS && window.VEHICLE_SETS[cid]) || window.VEHICLES;

  function freshSeason(cid) {
    const order = trackSetFor(cid).map((t) => t.id);
    const standings = window.CHARACTERS.map((ch) => ({ characterId: ch.id, name: ch.name, points: 0 }));
    return { order, completed: [], selected: order[0], standings, done: false, season: 1 };
  }
  function freshCircuit(cid) {
    return { vehicle: vehicleSetFor(cid)[0].id, season: freshSeason(cid) };
  }
  function freshTraining() {
    const t = {};
    window.CHARACTERS.forEach((ch) => (t[ch.id] = { launch: 0, handling: 0, drift: 0, nitro: 0 }));
    return t;
  }
  function freshVehicleUpgrades() {
    const u = {};
    const sets = window.VEHICLE_SETS || { trucks: window.VEHICLES };
    Object.values(sets).forEach((set) => set.forEach((v) => (u[v.id] = { engine: 0, tires: 0, shocks: 0, nitro: 0 })));
    return u;
  }

  function freshState() {
    const circuits = {};
    circuitIds().forEach((cid) => (circuits[cid] = freshCircuit(cid)));
    return {
      version: 4,
      money: 800,
      driver: window.CHARACTERS[0].id,
      training: freshTraining(),
      graphics: "enhanced",
      assist: "full", // touch auto-gas: "full" or "smart" (eases in corners)
      records: {},
      vehicleUpgrades: freshVehicleUpgrades(),
      circuit: "trucks",
      circuits,
    };
  }

  const Career = {
    state: null,
    POINTS, PRIZE, MAX_LEVEL, UPGRADE_DEFS,

    hasSave() { try { return !!localStorage.getItem(KEY); } catch (e) { return false; } },

    load() {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) {
          this.state = JSON.parse(raw);
          this._migrate();
          if (window.Circuits) window.Circuits.setActive(this.state.circuit);
          return this.state;
        }
      } catch (e) { /* corrupt — start fresh */ }
      this.state = freshState();
      if (window.Circuits) window.Circuits.setActive(this.state.circuit);
      this.save();
      return this.state;
    },

    // bring any older save up to the current multi-circuit shape
    _migrate() {
      const s = this.state;
      if (!s.graphics) s.graphics = "enhanced";
      if (!s.assist) s.assist = "full";
      if (!s.records) s.records = {};
      if (!s.driver) s.driver = window.CHARACTERS[0].id;
      if (!s.training) s.training = freshTraining();
      window.CHARACTERS.forEach((ch) => { if (!s.training[ch.id]) s.training[ch.id] = { launch: 0, handling: 0, drift: 0, nitro: 0 }; });
      if (!s.vehicleUpgrades) s.vehicleUpgrades = freshVehicleUpgrades();

      // v3 (single circuit) -> v4 (per-circuit): fold the old season + vehicle into "trucks"
      if (!s.circuits) {
        const trucksCircuit = freshCircuit("trucks");
        if (s.season && s.season.order) trucksCircuit.season = s.season;
        if (s.vehicle) trucksCircuit.vehicle = s.vehicle;
        if (s.upgrades) { s.vehicleUpgrades[s.vehicle || trucksCircuit.vehicle] = s.upgrades; delete s.upgrades; }
        s.circuits = { trucks: trucksCircuit };
        delete s.season; delete s.vehicle;
      }
      // ensure every known circuit exists and is well-formed
      circuitIds().forEach((cid) => {
        if (!s.circuits[cid]) s.circuits[cid] = freshCircuit(cid);
        const c = s.circuits[cid];
        if (!c.vehicle) c.vehicle = vehicleSetFor(cid)[0].id;
        if (!c.season || !c.season.order) c.season = freshSeason(cid);
        const sn = c.season;
        if (!sn.completed) sn.completed = [];
        if (!sn.selected) sn.selected = sn.order.find((id) => !sn.completed.includes(id)) || sn.order[0];
        if (!sn.standings || !sn.standings[0] || !sn.standings[0].characterId)
          sn.standings = window.CHARACTERS.map((ch) => ({ characterId: ch.id, name: ch.name, points: 0 }));
      });
      // make sure upgrade entries exist for every vehicle in every set
      const sets = window.VEHICLE_SETS || { trucks: window.VEHICLES };
      Object.values(sets).forEach((set) => set.forEach((v) => { if (!s.vehicleUpgrades[v.id]) s.vehicleUpgrades[v.id] = { engine: 0, tires: 0, shocks: 0, nitro: 0 }; }));
      if (!s.circuit || !s.circuits[s.circuit]) s.circuit = "trucks";
      s.version = 4;
    },

    save() { try { localStorage.setItem(KEY, JSON.stringify(this.state)); } catch (e) {} },

    newCareer() { this.state = freshState(); if (window.Circuits) window.Circuits.setActive(this.state.circuit); this.save(); return this.state; },

    // ---- circuit (series) ----
    circuit() { return this.state.circuit; },
    circuitInfo() { return window.Circuits ? window.Circuits.get(this.state.circuit) : { id: "trucks", name: "Super Off-Road", noun: "Truck" }; },
    cur() {
      const id = this.state.circuit;
      if (!this.state.circuits[id]) this.state.circuits[id] = freshCircuit(id);
      return this.state.circuits[id];
    },
    setCircuit(id) {
      if (!window.Circuits || !window.Circuits.get(id)) return false;
      window.Circuits.setActive(id);
      this.state.circuit = id;
      if (!this.state.circuits[id]) this.state.circuits[id] = freshCircuit(id);
      this.save();
      return true;
    },
    cycleCircuit() { return this.setCircuit(window.Circuits.nextId(this.state.circuit)); },

    newSeason() {
      const cid = this.state.circuit, c = this.cur();
      const next = (c.season.season || 1) + 1;
      c.season = freshSeason(cid);
      c.season.season = next;
      this.save();
    },

    currentTrack() {
      const s = this.cur().season;
      const id = s.selected || s.order.find((t) => !s.completed.includes(t)) || s.order[0];
      return window.getTrack(id);
    },
    raceLabel() {
      const s = this.cur().season;
      return `Race ${s.completed.length + 1} / ${s.order.length}`;
    },

    // ---- track selection ----
    trackList() {
      const s = this.cur().season;
      return s.order.map((id) => ({
        track: window.getTrack(id),
        completed: s.completed.includes(id),
        selected: id === s.selected,
      }));
    },
    selectTrack(id) {
      const s = this.cur().season;
      if (!s.order.includes(id) || s.completed.includes(id)) return false;
      s.selected = id; this.save(); return true;
    },

    // ---- graphics ----
    graphics() { return this.state.graphics || "enhanced"; },
    toggleGraphics() {
      // 3D only where WebGL/Three is available; otherwise cycle the 2D modes
      const order = (window.Race3D ? ["3d", "enhanced", "iso", "classic"] : ["enhanced", "iso", "classic"]);
      const i = order.indexOf(this.graphics());
      this.state.graphics = order[(i + 1) % order.length];
      this.save(); return this.state.graphics;
    },

    // ---- throttle assist (touch auto-gas) ----
    assist() { return this.state.assist || "full"; },
    toggleAssist() {
      this.state.assist = this.assist() === "full" ? "smart" : "full";
      this.save(); return this.state.assist;
    },

    // ---- driver selection (shared across circuits) ----
    driverId() { return this.state.driver; },
    driver() { return window.getCharacter(this.state.driver); },
    setDriver(id) {
      if (!window.getCharacter(id)) return;
      this.state.driver = id;
      if (!this.state.training[id]) this.state.training[id] = { launch: 0, handling: 0, drift: 0, nitro: 0 };
      this.save();
    },

    // ---- driver training (per character, shared) ----
    trainedSkills(id) { return this.state.training[id] || { launch: 0, handling: 0, drift: 0, nitro: 0 }; },
    trainLevel(id, skill) { return this.trainedSkills(id)[skill] || 0; },
    trainCostFor(id, skill) {
      const lvl = this.trainLevel(id, skill);
      return lvl >= MAX_LEVEL ? null : cost(lvl);
    },
    canTrain(id, skill) {
      const c = this.trainCostFor(id, skill);
      return c !== null && this.state.money >= c;
    },
    train(id, skill) {
      if (!this.canTrain(id, skill)) return false;
      this.state.money -= this.trainCostFor(id, skill);
      this.state.training[id][skill] = (this.state.training[id][skill] || 0) + 1;
      this.save();
      return true;
    },

    // ---- lap & track records (keyed by unique track id, shared) ----
    getRecord(trackId) { return (this.state.records && this.state.records[trackId]) || { lap: null, race: null }; },
    _rec(trackId) {
      if (!this.state.records) this.state.records = {};
      return this.state.records[trackId] || (this.state.records[trackId] = { lap: null, race: null });
    },
    submitLap(trackId, t) {
      if (!t || t <= 0) return false;
      const r = this._rec(trackId); const beat = r.lap == null || t < r.lap;
      if (beat) r.lap = t; this.save(); return beat;
    },
    submitRace(trackId, t) {
      if (!t || t <= 0) return false;
      const r = this._rec(trackId); const beat = r.race == null || t < r.race;
      if (beat) r.race = t; this.save(); return beat;
    },

    // ---- vehicle selection (per circuit) ----
    vehicleId() { return this.cur().vehicle; },
    vehicle() { return window.getVehicle(this.cur().vehicle); },
    setVehicle(id) {
      if (!window.getVehicle(id)) return;
      this.cur().vehicle = id;
      if (!this.state.vehicleUpgrades[id]) this.state.vehicleUpgrades[id] = { engine: 0, tires: 0, shocks: 0, nitro: 0 };
      this.save();
    },

    // ---- per-vehicle upgrades (shared map keyed by unique vehicle id) ----
    vehicleUpgrades(id) { return this.state.vehicleUpgrades[id] || { engine: 0, tires: 0, shocks: 0, nitro: 0 }; },
    upgradeLevel(id, key) { return this.vehicleUpgrades(id)[key] || 0; },
    upgradeCostFor(id, key) {
      const lvl = this.upgradeLevel(id, key);
      return lvl >= MAX_LEVEL ? null : cost(lvl);
    },
    canBuy(id, key) { const c = this.upgradeCostFor(id, key); return c !== null && this.state.money >= c; },
    buy(id, key) {
      if (!this.canBuy(id, key)) return false;
      this.state.money -= this.upgradeCostFor(id, key);
      this.state.vehicleUpgrades[id][key] = (this.state.vehicleUpgrades[id][key] || 0) + 1;
      this.save(); return true;
    },

    // vehicle performance multipliers (innate stats + upgrades), 1..10 per category
    performanceFor(vehId) {
      const v = window.getVehicle(vehId);
      const up = this.vehicleUpgrades(vehId);
      const e = (k) => v.stats[k] + (up[k] || 0);
      return {
        maxSpeed: 1 + 0.02 * e("engine"),
        turn: 1 + 0.018 * e("tires"),
        grip: 1 + 0.022 * e("tires"),
        accel: 1 + 0.022 * e("shocks"),
        offroad: 1 + 0.03 * e("shocks"),
        nitroPower: 1 + 0.02 * e("nitro"),
        nitroRefill: 1 + 0.04 * e("nitro"),
      };
    },

    // driver-skill performance multipliers (innate + trained), 1..10 per skill
    driverFactors(id) {
      const ch = window.getCharacter(id);
      const tr = this.trainedSkills(id);
      const e = (k) => ch.skills[k] + (tr[k] || 0);
      return {
        maxSpeed: 1 + 0.012 * e("launch"),
        accel: 1 + 0.02 * e("launch"),
        turn: 1 + 0.015 * e("handling"),
        grip: 1 + 0.02 * e("handling"),
        drift: 1 + 0.03 * e("drift"),
        nitroPower: 1 + 0.015 * e("nitro"),
        nitroRefill: 1 + 0.03 * e("nitro"),
      };
    },

    aiStrength() {
      const s = this.cur().season;
      return 0.93 + 0.022 * (s.completed ? s.completed.length : 0) + 0.025 * ((s.season || 1) - 1);
    },

    // Build the 6-car grid: the player's driver+vehicle, plus the other five
    // drivers each paired with one of the other vehicles in the active set.
    buildRoster(trackId) {
      const playerDriver = this.state.driver, playerVeh = this.cur().vehicle;
      const drivers = [window.getCharacter(playerDriver)].concat(window.CHARACTERS.filter((c) => c.id !== playerDriver));
      const vehicles = [window.getVehicle(playerVeh)].concat(window.VEHICLES.filter((v) => v.id !== playerVeh));
      const aiS = this.aiStrength();
      const home = trackId ? (window.getTrack(trackId).home) : null;
      return drivers.map((ch, i) => {
        const veh = vehicles[i] || vehicles[0];
        const isPlayer = ch.id === playerDriver;
        const t = this.performanceFor(veh.id);
        const d = this.driverFactors(ch.id);
        const sp = isPlayer ? 1 : aiS;
        const homeBoost = ch.id === home ? 1.06 : 1; // home-track advantage
        const perf = {
          maxSpeed: t.maxSpeed * d.maxSpeed * sp * homeBoost,
          accel: t.accel * d.accel * sp * homeBoost,
          turn: t.turn * d.turn,
          grip: t.grip * d.grip * (ch.id === home ? 1.04 : 1),
          offroad: t.offroad,
          nitroPower: t.nitroPower * d.nitroPower,
          nitroRefill: t.nitroRefill * d.nitroRefill,
          drift: d.drift,
        };
        return { characterId: ch.id, name: ch.name, vehicleId: veh.id, color: veh.color, isPlayer, perf };
      });
    },

    // finishOrder: array of {isPlayer, characterId} in finishing order
    recordResult(finishOrder, bonus = 0) {
      const s = this.cur().season;
      let playerPos = finishOrder.findIndex((c) => c.isPlayer);
      if (playerPos < 0) playerPos = finishOrder.length - 1;
      finishOrder.forEach((car, idx) => {
        const st = s.standings.find((x) => x.characterId === car.characterId);
        if (st) st.points += POINTS[idx] || 0;
      });
      const prize = PRIZE[playerPos] || 100;
      bonus = Math.max(0, Math.round(bonus));
      this.state.money += prize + bonus;
      if (!s.completed.includes(s.selected)) s.completed.push(s.selected);
      s.selected = s.order.find((id) => !s.completed.includes(id)) || null;
      if (s.completed.length >= s.order.length) s.done = true;
      this.save();
      return { playerPos, prize, bonus };
    },

    sortedStandings() {
      const drv = this.state.driver;
      return this.cur().season.standings
        .map((x) => ({ characterId: x.characterId, name: x.name, points: x.points, you: x.characterId === drv }))
        .sort((a, b) => b.points - a.points);
    },

    seasonDone() { return this.cur().season.done; },
  };

  window.Career = Career;
})();
