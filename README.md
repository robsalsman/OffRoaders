# OffRoaders 🏁

A small, self-contained **top-down arcade off-road racer** for the browser —
inspired by the classic 1989 arcade game *Ivan "Ironman" Stewart's Super Off Road*.
Race against AI rivals, finish high, earn cash, and spend it on vehicle upgrades
across a championship season. **Your career saves automatically** so you can pick
it back up later on the same device.

Plays on **desktop (keyboard)** and **phone/tablet (on-screen touch controls)**.

## Features

- **Top-down arcade physics** — gas, brake, steering with a hint of drift, and a **nitro** boost.
- **AI rivals** with stable skill profiles, so championship standings actually mean something.
- **5 tracks** of increasing difficulty (Sidewinder → Thunder Ridge), 4–5 laps each.
- **Career mode**: a championship season — earn cash & points by finishing position.
- **Garage / upgrade shop**: spend winnings on **Engine, Tires, Shocks, Nitro** (5 levels each). Difficulty scales as the season goes on.
- **Saved progress** via `localStorage` (money, upgrades, standings, current race).
- **Zero dependencies, no build step** — just static HTML/CSS/JS.

## How to run

### Option A — single file (easiest) ⭐
Download **`offroaders.html`** and double-click it. All CSS and JS are inlined
into that one file, so it runs anywhere with nothing else needed — perfect for
"download and play" on a PC or phone.

> ⚠️ Don't download `index.html` by itself — it loads `css/` and `js/` from
> sibling folders, so on its own it shows unstyled HTML with every menu stacked.
> Use `offroaders.html`, or keep the whole folder together.

Rebuild it after changing the source:
```bash
node build/inline.js   # regenerates offroaders.html
```

### Option B — the full folder
Keep the whole project together and open `index.html`. It uses plain
`<script>` tags, so it works from `file://` with no server.

### Option B — local server (recommended for phone testing on your LAN)
```bash
cd OffRoaders
python3 -m http.server 8000
# then visit http://<your-computer-ip>:8000 on your phone
```

### Option C — host free on GitHub Pages (play from anywhere, PC & phone)
1. Push this repo to GitHub.
2. Repo **Settings → Pages → Build and deployment → Source: Deploy from a branch**.
3. Pick your branch and the `/ (root)` folder, save.
4. Your game will be live at `https://<user>.github.io/<repo>/`.

> Note: career data is stored per-device in the browser. The same URL on your PC
> and phone will keep **separate** saves.

## Controls

| Action | Keyboard | Touch |
|--------|----------|-------|
| Accelerate | ↑ / W | **GAS** pedal |
| Brake / reverse | ↓ / S | **BRAKE** |
| Steer | ← → / A D | ◀ ▶ |
| Nitro | Space | **NITRO** |
| Pause | Esc | ⏸ button |

**Tips:** stay on the dirt — grass slows you down. Save nitro for the straights.
Upgrade aggressively; rivals get faster every race.

## Project structure

```
index.html        # markup: canvas, HUD, menus, shop, touch controls
css/style.css     # all styling (responsive, mobile-safe areas)
js/tracks.js      # parametric closed-loop course definitions
js/career.js      # save/load, money, upgrades, championship season
js/game.js        # the race engine: physics, AI, laps, rendering, input
js/app.js         # UI state machine wiring everything together
test/sim.js       # headless smoke test (node test/sim.js)
```

## Tests

A headless simulation (stubs the canvas/DOM) verifies physics, lap counting,
finishing, and the career flow:

```bash
node test/sim.js
```

## Design notes / origins

I researched the original arcade game and existing open-source racers before
building. Existing options weren't a good fit for "simple web app with a saved
career": [Dust Racing 2D](https://github.com/juzzlin/DustRacing2D) is the closest
gameplay match but is C++/Qt (not web), and JS racers like
[javascript-racer](https://github.com/jakesgordon/javascript-racer) use a
pseudo-3D *OutRun* perspective rather than the top-down view. So OffRoaders is a
clean-room, dependency-free implementation of the core mechanics: top-down
racing, nitro, AI, and the signature **win-cash-then-upgrade** loop.

Original game references:
[AutoGuide throwback](https://www.autoguide.com/auto/featured-articles/video-game-throwback-ivan-ironman-stewarts-super-off-road-44630056) ·
[Arcade Museum](https://www.arcade-museum.com/Videogame/ironman-ivan-stewarts-super-off-road) ·
[FRGCB retro blog](http://frgcb.blogspot.com/2022/07/ivan-ironman-stewarts-super-off-road.html)

This is a tribute/educational project and is not affiliated with the original rights holders.
