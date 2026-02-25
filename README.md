# AIFarm — Claude Buddy V3.0

A transparent Electron desktop companion that monitors your Claude Code sessions and brings them to life as a **Stardew Valley-style pixel art farming simulation**. The more you code, the more your world grows.

![AIFarm Screenshot](Images/screenshot-farm.png)

## How It Works

Claude Buddy watches your active Claude Code sessions via JSONL log files. Every coding event (tool use, thinking, text output) generates **energy** that drives your farm forward:

- Crops grow and get harvested automatically
- Animals unlock and roam the pasture
- Buildings appear in the town area
- Your buddies (one per session) walk around tending the farm
- **You** control a player character to explore, sell, and shop

## Features

### Player Character & Controls
- WASD / Arrow key movement with velocity + friction physics
- Gold hoodie "lord" character, distinct from buddy NPCs
- Sliding tile collision (4-corner hitbox)
- Smooth lerp camera follow (0.08)
- Sprint coming soon (Shift key)

### Resource Economy
- **Multi-resource system**: WOOD, STONE, GOLD, and per-crop resources
- **Shipping Bin**: Walk near and press [E] to sell crops/resources for GOLD
- **General Store**: Walk to Tool Shed, press [E] to open shop modal
  - Buy seeds (Strawberry, Wheat), speed potions, field expansion permits
- Resource HUD bar with emoji icons and bounce animations on change
- Resource pop-up sprites fly from harvest position to HUD with arc path

### Historical Session NPCs
- Past Claude Code sessions become NPC characters wandering the village
- Evolution tiers based on session duration:
  - **Newbie** (< 30min): Bright color, fast walk, bouncy
  - **Veteran** (30min - 2hr): Glasses accessory, moderate speed
  - **Sage** (> 2hr): White/gray, beard, golden glow, slow walk
- Click NPC to see project name, session duration, and date
- Up to 8 NPCs visible, selected for tier diversity

### Isometric Farm Engine
- 3/4 top-down perspective with 32x32 tile grid (20x18 map)
- Smooth camera pan, zoom (mouse wheel), and auto-pan idle tour
- Multi-layer Z-sorted rendering: terrain, entities, particles, weather, HUD
- Event Bus architecture for module decoupling

### Crop System (6+ types)
Carrot, Sunflower, Watermelon, Tomato, Corn, Pumpkin — each with 5 growth stages. 12 farm plots unlock progressively with energy milestones. New seeds available in shop.

### Animal System (6 types)
Chicken, Cow, Pig, Sheep, Cat, Dog — roam the pasture with idle animations, state-machine AI (wander, rest, react).

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

## Controls

| Input | Action |
|-------|--------|
| WASD / Arrow keys | Move player character |
| Mouse wheel | Zoom in/out |
| E | Interact (shop at Tool Shed / sell at Shipping Bin) |
| W/S + Enter | Navigate shop menu |
| Escape | Close shop |
| Click NPC | View session info |
| Click bulletin board | Open daily summary |
| Click camera button | Save farm snapshot |
| Ctrl+Shift+I | Toggle iso/classic view |
| Ctrl+Shift+D | Toggle debug pan |

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

## Development Progress

### Done

| Sprint | Name | Features |
|--------|------|----------|
| 11 | Tool Shed & Farm Log | Tool shed building, farm activity log, character accessories |
| 12 | Social Life | Buddy social bubbles, monument system, golden bird event |
| 13 | Atmosphere | Day/night cycle, snapshot mode, auto-pan idle tour |
| 14 | Seeds of Wealth | Resource inventory + Event Bus, resource HUD, shipping bin |
| 15 | Growth of Wisdom | Historical session NPCs, general store/shop, resource pop-up sprites |

### Todo (Roadmap)

| Phase | Sprint | Priority | Feature | Description |
|-------|--------|----------|---------|-------------|
| 3 | 16 | P0 | Chunk-based Infinite Map | 16x16 chunks, token-unlock expansion, seed-based terrain gen |
| 3 | 16 | P1 | Dynamic Lighting 2.0 | Night filter, radial glow on lamps/buildings/NPC windows |
| 3 | 16 | P2 | Sprint & Stamina | Shift to run, stamina bar, dust particle effects |
| 3 | 17+ | P2 | Fishing System | River/lake generation, fishing mini-game |
| 4 | TBD | P0 | Processing Buildings | Mill (wheat -> flour), Sawmill (wood -> lumber) |
| 4 | TBD | P1 | Tech Tree Upgrades | Tool efficiency, auto-watering, auto-harvest robots |
| 4 | TBD | P2 | House Customization | Player house interior decoration system |
| 5 | TBD | P1 | AI Broadcast Board | NPCs comment on git commits in real-time |
| 5 | TBD | P2 | Museum & Hall of Fame | Display all session stats and rare collectibles |
| 5 | TBD | P2 | Trade & Diplomacy | Inter-project resource trading simulation |

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
    iso-effects.js     # Floating text, harvest rewards, resource pop-ups
    iso-tooltip.js     # Hover tooltips for entities
    iso-ui.js          # Modal overlays (bulletin board)
    shop-ui.js         # General Store shop modal
    event-bus.js       # Pub/sub event system for module decoupling
    resource-inventory.js  # Multi-resource inventory (WOOD, STONE, GOLD, crops)
    npc-manager.js     # Historical session NPC system with evolution tiers
    player.js          # Player-controlled character with physics
    buddy-ai.js        # Autonomous buddy behavior (farming, social)
    farm.js            # Shared farm state store for renderer
    sprite-manager.js  # PNG sprite loading with procedural fallback
    character.js       # 8-color hoodie character sprites
    scene.js           # Classic 2D view background
    viewport.js        # Camera viewport management
    speech-bubble.js   # Chat bubble rendering
    state-machine.js   # Activity state machine
    train.js           # Classic 2D train
    renderer.js        # Main render loop, input handling, view management
  watcher/
    data-exporter.js   # JSONL export utilities
  scripts/
    recolor_sprites.py # Sprite recoloring via HSV hue-shift
```

## Tech Stack

- **Electron** — transparent always-on-top desktop window
- **Canvas 2D** — all rendering is pure canvas (no WebGL, no frameworks)
- **Node.js** — JSONL file watching, farm state persistence
- **Event Bus** — pub/sub decoupling for resource, shop, and NPC systems

## Dev Team

- **Joe** — Decision Maker, bridges all AI collaborators
- **Claude** — Primary developer/executor
- **Gemini CTO** — Architecture decisions and code review
- **Gemini PM** — Feature priorities and sprint planning

## License

MIT
