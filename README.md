# AIFarm — Claude Buddy V2.0

A transparent Electron desktop companion that monitors your Claude Code sessions and brings them to life as a **Harvest Moon-style pixel art farm**. The more you use Claude Code, the more your farm grows.

![AIFarm Screenshot](Images/screenshot-farm.png)

## How It Works

Claude Buddy watches your active Claude Code sessions via JSONL log files. Every coding event (tool use, thinking, text output) generates **energy** that drives your farm forward:

- Crops grow and get harvested automatically
- Animals unlock and roam the pasture
- Buildings appear in the town area
- Your buddies (one per session) walk around tending the farm

## Features

### Isometric Farm Engine
- 3/4 top-down perspective with 32x32 tile grid (20x18 map)
- Smooth camera pan (arrow keys), zoom (mouse wheel), and auto-pan idle tour
- Multi-layer Z-sorted rendering: terrain, entities, particles, weather, HUD

### Crop System (6 types)
Carrot, Sunflower, Watermelon, Tomato, Corn, Pumpkin — each with 5 growth stages. 12 farm plots unlock progressively with energy milestones.

### Animal System (6 types)
Chicken, Cow, Pig, Sheep, Cat, Dog — roam the pasture with idle animations. Each unlocks at different energy thresholds.

### Building System (7 structures)
Well, Barn, Windmill, Market, Clock Tower, Town Hall, Statue — populate the town row as you hit milestones.

### BuddyAI Behavior
Each Claude Code session spawns a buddy character that autonomously:
- Picks up tools from the tool shed
- Waters crops and tends animals
- Harvests mature crops (with particle effects and floating reward text)
- Socializes with other buddies when nearby (emoji chat bubbles)

### Weather & Day/Night Cycle
- Four seasons with unique sky gradients, ground tints, and particle effects
- Full day/night cycle: dawn, day, dusk, night with smooth transitions
- Twinkling stars at night, warm lamp post glow along the farm path

### Interactive Elements
- **Bulletin Board**: Click to open daily summary modal (usage stats, farm progress, activity log)
- **Golden Bird**: Rare random visitor on the fence — click it for bonus sparkles
- **Monument**: Unlocks at 10,000 energy with pulsing crystal and total token display
- **Snapshot Mode**: Camera button in HUD captures farm as PNG with watermark

### Train System
New buddies arrive by train at the station. Achievement unlocks trigger golden train events.

### Prestige / Generation System
Reset and expand your farm across multiple generations for long-term progression.

### Vibe System
Real-time mood detection from coding patterns (productive, focused, creative, frustrated, calm, idle) affects weather and animal behavior.

## Energy Milestones

| Energy | Milestone | Unlocks |
|--------|-----------|---------|
| 50 | First Seed | Carrot, plots 1-3 |
| 150 | Gardener | Sunflower |
| 300 | Green Thumb | Watermelon |
| 500 | Farmer | Tomato, plots 4-6, Chicken |
| 800 | Rancher | Corn, Cow |
| 1,200 | Pioneer | Pumpkin, Pig, Well |
| 1,800 | Villager | Sheep, Barn |
| 2,500 | Town Builder | Cat, Windmill |
| 3,500 | Prosperous | Dog, Market |
| 5,000 | Thriving | Clock Tower, plots 7-9 |
| 7,500 | Metropolis | Town Hall |
| 10,000 | Legend | Statue, Monument |

## Controls

| Input | Action |
|-------|--------|
| Arrow keys | Pan camera |
| Mouse wheel | Zoom in/out |
| Click bulletin board | Open daily summary |
| Click camera button | Save farm snapshot |
| Ctrl+Shift+I | Toggle iso/classic view |
| Ctrl+Shift+D | Toggle debug pan |

## Quick Start

```bash
npm install
npm start
```

Requires an active Claude Code session writing JSONL logs to `~/.claude/projects/`.

## Architecture

```
claude-buddy/
  main.js              # Electron main process, session watcher, IPC
  preload.js           # Bridge between main and renderer
  farm/
    farm-config.js     # Constants: energy values, crops, animals, milestones
    farm-state.js      # Farm state management, growth logic, persistence
    achievement-manager.js  # Achievement tracking and unlock logic
  renderer/
    iso-engine.js      # Tile-based rendering engine, camera, particles
    iso-farm.js        # Farm layout, entities, HUD, snapshot, auto-pan
    iso-entity-manager.js  # Entity lifecycle (characters, animals, statics)
    iso-weather.js     # Seasons, weather particles, day/night cycle
    iso-train.js       # Train arrival/departure animations
    iso-effects.js     # Floating text, harvest rewards
    iso-tooltip.js     # Hover tooltips for entities
    iso-ui.js          # Modal overlays (bulletin board)
    buddy-ai.js        # Autonomous buddy behavior (farming, social)
    farm.js            # Shared farm state store for renderer
    sprite-manager.js  # PNG sprite loading with procedural fallback
    character.js       # 8-color hoodie character sprites
    scene.js           # Classic 2D view background
    viewport.js        # Camera viewport management
    speech-bubble.js   # Chat bubble rendering
    state-machine.js   # Activity state machine
    train.js           # Classic 2D train
  watcher/
    data-exporter.js   # JSONL export utilities
  scripts/
    recolor_sprites.py # Sprite recoloring via HSV hue-shift
```

## Tech Stack

- **Electron** — transparent always-on-top desktop window
- **Canvas 2D** — all rendering is pure canvas (no WebGL, no frameworks)
- **Node.js** — JSONL file watching, farm state persistence

## License

MIT
