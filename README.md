# Neon Siege — Prototype

A premium-looking 2D mobile-first arcade roguelike built with plain HTML5 Canvas and vanilla JavaScript.

## How to Run

1. Open `index.html` in any modern browser (Chrome, Firefox, Edge, Safari).
2. No server, build step, or installation required.
3. On mobile: open in the browser directly or use a local server.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Game shell, all screens (menu, game, pause, game-over, upgrades) |
| `styles.css` | Neon arcade visual style, responsive layout |
| `game.js` | All game logic — blocks, balls, launcher, particles, saves |
| `README.md` | This file |

## Controls

- **Desktop**: Click and drag on the canvas to aim, release to shoot.
- **Mobile**: Touch and drag to aim, lift finger to shoot.
- **Lightning ⚡**: Tap the button during IDLE phase to hit 5 random blocks.
- **Bomb 💣**: Tap to damage a 3×3 area in the densest block zone.
- **Pause ⏸**: Top-right HUD button.

## What Works Now

- Full shoot-bounce-descend loop
- 5 block types: Normal, Explosive, Shield, Crystal, Boss Core
- Roguelike upgrade cards every 5 stages (10 possible upgrades)
- 3 permanent upgrades purchasable with Neon Shards
- localStorage persistence (best stage, total shards, perm upgrades)
- Lightning and Bomb powers (1 each per run)
- Particle effects on block break and explosion
- Screen shake on explosions/boss deaths
- Danger line — blocks reaching it triggers game over
- Boss Core block every 10 stages
- Neon glow visual style with grid background
- Mobile-friendly portrait layout
- Aim dots and launcher barrel animation

## What to Improve Next

1. **Ball return position**: Store the X of the last ball that exits the bottom and snap the launcher there next turn.
2. **Coin/shard pop-up**: Floating "+N shards" text when crystals break.
3. **More block types**: Mirror block, teleport block, healing block.
4. **Boss fight**: Dedicated multi-phase boss every 10 stages with movement.
5. **Sound effects**: Web Audio API pings and explosions.
6. **Skin system**: Different ball skins unlockable with shards.
7. **Daily challenge**: Seeded random stage for leaderboard.
8. **Ad placeholder**: Banner slot at bottom when in menu (not implemented).
9. **Tutorial overlay**: First-run pointer arrows.
10. **Difficulty scaling**: Better formula beyond stage * 0.8 HP.

## Architecture Notes

- `Game` class owns all state and the update/draw loop.
- `Block`, `Ball`, `Launcher`, `Particle` are separate classes.
- `Save` object wraps localStorage with try/catch.
- `Screens` manages which screen div is visible.
- `PERM_UPGRADES` and `RUN_UPGRADES` arrays are data-driven — easy to extend.
