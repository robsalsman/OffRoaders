/* career.js — persistent career: money, vehicle upgrades, driver + driver
 * training, championship season. The 6 characters fill the race grid; you play
 * one and the other five are your AI rivals. Saved to localStorage.
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

  function freshSeason() {
    const order = window.TRACKS.map((t) => t.id);
    const standings = window.CHARACTERS.map((ch) => ({ characterId: ch.id, name: ch.name, points: 0 }));
    return { raceIndex: 0, order, standings, done: false, season: 1 };
  }

  function freshTraining() {
    const t = {};
    window.CHARACTERS.forEach((ch) => (t[ch.id] = { launch: 0, handling: 0, drift: 0, nitro: 0 }));
    return t;
  }
  function freshVehicleUpgrades() {
    const u = {};
    window.VEHICLES.forEach((v) => (u[v.id] = { engine: 0, tires: 0, shocks: 0, nitro: 0 }));
    return u;
  }

  function freshState() {
    return {
      version: 3,
      money: 800,
      vehicle: window.VEHICLES[0].id,
      vehicleUpgrades: freshVehicleUpgrades(),
      driver: window.CHARACTERS[0].id,
      training: freshTraining(),
      graphics: "enhanced",
      records: {},
      season: freshSeason(),
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
          // migration / safety
          const s = this.state;
          if (!s.season || !s.season.order) s.season = freshSeason();
          if (!s.graphics) s.graphics = "enhanced";
          if (!s.records) s.records = {};
          if (!s.driver) s.driver = window.CHARACTERS[0].id;
          if (!s.training) s.training = freshTraining();
          window.CHARACTERS.forEach((ch) => { if (!s.training[ch.id]) s.training[ch.id] = { launch: 0, handling: 0, drift: 0, nitro: 0 }; });
          if (!s.vehicle) s.vehicle = window.VEHICLES[0].id;
          if (!s.vehicleUpgrades) s.vehicleUpgrades = freshVehicleUpgrades();
          window.VEHICLES.forEach((v) => { if (!s.vehicleUpgrades[v.id]) s.vehicleUpgrades[v.id] = { engine: 0, tires: 0, shocks: 0, nitro: 0 }; });
          // migrate an old single upgrade set onto the starting truck
          if (s.upgrades) { s.vehicleUpgrades[s.vehicle] = s.upgrades; delete s.upgrades; }
          if (!s.season.standings || !s.season.standings[0] || !s.season.standings[0].characterId)
            s.season.standings = window.CHARACTERS.map((ch) => ({ characterId: ch.id, name: ch.name, points: 0 }));
          return this.state;
        }
      } catch (e) { /* corrupt — start fresh */ }
      this.state = freshState();
      this.save();
      return this.state;
    },

    save() { try { localStorage.setItem(KEY, JSON.stringify(this.state)); } catch (e) {} },

    newCareer() { this.state = freshState(); this.save(); return this.state; },

    newSeason() {
      const next = (this.state.season.season || 1) + 1;
      this.state.season = freshSeason();
      this.state.season.season = next;
      this.save();
    },

    currentTrack() {
      const s = this.state.season;
      return window.getTrack(s.order[Math.min(s.raceIndex, s.order.length - 1)]);
    },
    raceLabel() {
      const s = this.state.season;
      return `Race ${s.raceIndex + 1} / ${s.order.length}`;
    },

    // ---- graphics ----
    graphics() { return this.state.graphics || "enhanced"; },
    toggleGraphics() {
      this.state.graphics = this.graphics() === "enhanced" ? "classic" : "enhanced";
      this.save(); return this.state.graphics;
    },

    // ---- driver selection ----
    driverId() { return this.state.driver; },
    driver() { return window.getCharacter(this.state.driver); },
    setDriver(id) {
      if (!window.getCharacter(id)) return;
      this.state.driver = id;
      if (!this.state.training[id]) this.state.training[id] = { launch: 0, handling: 0, drift: 0, nitro: 0 };
      this.save();
    },

    // ---- driver training (per character) ----
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

    // ---- lap & track records ----
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

    // ---- truck selection ----
    vehicleId() { return this.state.vehicle; },
    vehicle() { return window.getVehicle(this.state.vehicle); },
    setVehicle(id) {
      if (!window.getVehicle(id)) return;
      this.state.vehicle = id;
      if (!this.state.vehicleUpgrades[id]) this.state.vehicleUpgrades[id] = { engine: 0, tires: 0, shocks: 0, nitro: 0 };
      this.save();
    },

    // ---- per-truck upgrades ----
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

    // truck performance multipliers (innate stats + upgrades), 1..10 per category
    performanceFor(truckId) {
      const v = window.getVehicle(truckId);
      const up = this.vehicleUpgrades(truckId);
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
      const s = this.state.season;
      return 0.93 + 0.022 * s.raceIndex + 0.025 * ((s.season || 1) - 1);
    },

    // Build the 6-car grid: the player's driver+truck, plus the other five
    // drivers each paired with one of the other trucks.
    buildRoster() {
      const playerDriver = this.state.driver, playerVeh = this.state.vehicle;
      const drivers = [window.getCharacter(playerDriver)].concat(window.CHARACTERS.filter((c) => c.id !== playerDriver));
      const trucks = [window.getVehicle(playerVeh)].concat(window.VEHICLES.filter((v) => v.id !== playerVeh));
      const aiS = this.aiStrength();
      return drivers.map((ch, i) => {
        const truck = trucks[i] || trucks[0];
        const isPlayer = ch.id === playerDriver;
        const t = this.performanceFor(truck.id);
        const d = this.driverFactors(ch.id);
        const sp = isPlayer ? 1 : aiS;
        const perf = {
          maxSpeed: t.maxSpeed * d.maxSpeed * sp,
          accel: t.accel * d.accel * sp,
          turn: t.turn * d.turn,
          grip: t.grip * d.grip,
          offroad: t.offroad,
          nitroPower: t.nitroPower * d.nitroPower,
          nitroRefill: t.nitroRefill * d.nitroRefill,
          drift: d.drift,
        };
        return { characterId: ch.id, name: ch.name, vehicleId: truck.id, color: truck.color, isPlayer, perf };
      });
    },

    // finishOrder: array of {isPlayer, characterId} in finishing order
    recordResult(finishOrder) {
      const s = this.state.season;
      let playerPos = finishOrder.findIndex((c) => c.isPlayer);
      if (playerPos < 0) playerPos = finishOrder.length - 1;
      finishOrder.forEach((car, idx) => {
        const st = s.standings.find((x) => x.characterId === car.characterId);
        if (st) st.points += POINTS[idx] || 0;
      });
      const prize = PRIZE[playerPos] || 100;
      this.state.money += prize;
      s.raceIndex++;
      if (s.raceIndex >= s.order.length) s.done = true;
      this.save();
      return { playerPos, prize };
    },

    sortedStandings() {
      const drv = this.state.driver;
      return this.state.season.standings
        .map((x) => ({ characterId: x.characterId, name: x.name, points: x.points, you: x.characterId === drv }))
        .sort((a, b) => b.points - a.points);
    },

    seasonDone() { return this.state.season.done; },
  };

  window.Career = Career;
})();
