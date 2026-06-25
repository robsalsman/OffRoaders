/* circuits.js — three racing series share one engine, garage and career.
 *
 * Each circuit owns its own track set (window.TRACK_SETS) and vehicle set
 * (window.VEHICLE_SETS); the 6 drivers are shared across all of them. Switching
 * the active circuit simply re-points window.TRACKS / window.VEHICLES at that
 * circuit's data so every existing reader (Career, the engines, the UI) keeps
 * working unchanged — only the content and theme differ.
 */
(function () {
  const CIRCUITS = [
    { id: "trucks", name: "Super Off-Road", short: "Trucks", noun: "Truck",
      tagline: "Stadium off-road trucks", accent: "#ff8e2b" },
    { id: "boats", name: "Powerboat Series", short: "Boats", noun: "Boat",
      tagline: "Offshore powerboat racing", accent: "#3aa0ff" },
    { id: "helis", name: "Chopper Cup", short: "Helis", noun: "Heli",
      tagline: "Low-altitude helicopter racing", accent: "#c46bff" },
  ];

  const Circuits = {
    list: CIRCUITS,
    active: "trucks",

    get(id) { return CIRCUITS.find((c) => c.id === (id || this.active)) || CIRCUITS[0]; },
    ids() { return CIRCUITS.map((c) => c.id); },
    indexOf(id) { return Math.max(0, this.ids().indexOf(id || this.active)); },
    nextId(id) { const ids = this.ids(); return ids[(this.indexOf(id) + 1) % ids.length]; },

    // Point the shared globals at the chosen circuit's data.
    setActive(id) {
      const c = this.get(id);
      this.active = c.id;
      if (window.TRACK_SETS && window.TRACK_SETS[c.id]) window.TRACKS = window.TRACK_SETS[c.id];
      if (window.VEHICLE_SETS && window.VEHICLE_SETS[c.id]) window.VEHICLES = window.VEHICLE_SETS[c.id];
      return c.id;
    },
  };

  // establish the default active set immediately (before Career loads)
  Circuits.setActive("trucks");

  window.CIRCUITS = CIRCUITS;
  window.Circuits = Circuits;
})();
