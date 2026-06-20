/* career.js — persistent career: money, upgrades, championship season.
 * Saved to localStorage so progress continues across sessions & devices(local).
 */
(function () {
  const KEY = "offroaders_career_v1";
  const RIVALS = ["Vasquez", "Dakota", "Brago", "Kira", "Mongoose"];
  const POINTS = [10, 8, 6, 5, 4, 3, 2, 1]; // championship points by finish position
  const PRIZE = [1200, 800, 550, 400, 300, 200, 150, 120]; // cash by finish position
  const MAX_LEVEL = 5;

  const UPGRADE_DEFS = [
    { key: "engine", name: "Engine", desc: "Higher top speed" },
    { key: "tires", name: "Tires", desc: "Sharper grip & turning" },
    { key: "shocks", name: "Shocks", desc: "Faster acceleration & better off-road" },
    { key: "nitro", name: "Nitro", desc: "Bigger boost & faster refill" },
  ];

  function upgradeCost(level) {
    // 0->1 costs 500, then 800, 1100, 1400, 1700
    return 500 + level * 300;
  }

  function freshSeason() {
    const order = window.TRACKS.map((t) => t.id);
    const standings = [{ name: "You", points: 0, you: true }];
    RIVALS.forEach((n) => standings.push({ name: n, points: 0, you: false }));
    return { raceIndex: 0, order, standings, done: false, season: 1 };
  }

  function freshState() {
    return {
      version: 1,
      money: 800, // a little starting cash for a first upgrade
      upgrades: { engine: 0, tires: 0, shocks: 0, nitro: 0 },
      season: freshSeason(),
    };
  }

  const Career = {
    state: null,
    RIVALS, POINTS, PRIZE, MAX_LEVEL, UPGRADE_DEFS,

    hasSave() {
      try { return !!localStorage.getItem(KEY); } catch (e) { return false; }
    },

    load() {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) {
          this.state = JSON.parse(raw);
          // light migration / safety
          if (!this.state.season || !this.state.season.order) this.state.season = freshSeason();
          if (!this.state.upgrades) this.state.upgrades = { engine: 0, tires: 0, shocks: 0, nitro: 0 };
          return this.state;
        }
      } catch (e) { /* corrupt save — start fresh */ }
      this.state = freshState();
      this.save();
      return this.state;
    },

    save() {
      try { localStorage.setItem(KEY, JSON.stringify(this.state)); } catch (e) {}
    },

    newCareer() {
      this.state = freshState();
      this.save();
      return this.state;
    },

    newSeason() {
      const next = (this.state.season.season || 1) + 1;
      this.state.season = freshSeason();
      this.state.season.season = next;
      this.save();
    },

    currentTrack() {
      const s = this.state.season;
      const id = s.order[Math.min(s.raceIndex, s.order.length - 1)];
      return window.getTrack(id);
    },

    raceLabel() {
      const s = this.state.season;
      return `Race ${s.raceIndex + 1} / ${s.order.length}`;
    },

    // ---- upgrades ----
    upgradeLevel(key) { return this.state.upgrades[key] || 0; },
    upgradeCostFor(key) {
      const lvl = this.upgradeLevel(key);
      return lvl >= MAX_LEVEL ? null : upgradeCost(lvl);
    },
    canBuy(key) {
      const cost = this.upgradeCostFor(key);
      return cost !== null && this.state.money >= cost;
    },
    buy(key) {
      if (!this.canBuy(key)) return false;
      this.state.money -= this.upgradeCostFor(key);
      this.state.upgrades[key]++;
      this.save();
      return true;
    },

    // Numeric performance multipliers derived from upgrade levels.
    performance() {
      const u = this.state.upgrades;
      return {
        maxSpeed: 1 + 0.07 * u.engine,
        turn: 1 + 0.08 * u.tires,
        grip: 1 + 0.10 * u.tires,
        accel: 1 + 0.09 * u.shocks,
        offroad: 1 + 0.12 * u.shocks, // reduces off-track penalty
        nitroPower: 1 + 0.10 * u.nitro,
        nitroRefill: 1 + 0.18 * u.nitro,
      };
    },

    // Difficulty scales with how far into the season we are (and across seasons).
    aiStrength() {
      const s = this.state.season;
      return 0.93 + 0.022 * s.raceIndex + 0.025 * ((s.season || 1) - 1);
    },

    /* Record the result of a race.
     * finishOrder: array of car objects in finishing order, each {isPlayer, rivalIndex}
     * Returns { playerPos, prize } */
    recordResult(finishOrder) {
      const s = this.state.season;
      let playerPos = finishOrder.findIndex((c) => c.isPlayer);
      if (playerPos < 0) playerPos = finishOrder.length - 1;

      // Award championship points using each car's persistent identity.
      finishOrder.forEach((car, idx) => {
        const pts = POINTS[idx] || 0;
        if (car.isPlayer) {
          this.state.season.standings[0].points += pts;
        } else {
          const rivalStanding = this.state.season.standings[1 + car.rivalIndex];
          if (rivalStanding) rivalStanding.points += pts;
        }
      });

      const prize = PRIZE[playerPos] || 100;
      this.state.money += prize;
      s.raceIndex++;
      if (s.raceIndex >= s.order.length) s.done = true;
      this.save();
      return { playerPos, prize };
    },

    sortedStandings() {
      return [...this.state.season.standings].sort((a, b) => b.points - a.points);
    },

    seasonDone() { return this.state.season.done; },
  };

  window.Career = Career;
})();
