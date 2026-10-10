# Auto Party Story: working notes for Claude

## Start here
1. Read `plans/DESIGN.md` in full. It's the game design: loop, races, classes, combat, art direction, data model and milestone order.
2. Work through the milestones in order. **M0 (headless combat simulator) comes before any rendering.**
3. When a design decision changes, update `plans/DESIGN.md` in the same change.

## Plans stay private
- `plans/` is gitignored. Never `git add -f` it, and never copy plan details (race/class tables, numbers, story) into tracked files like README, code comments or commit messages.
- The repo is public and listed on the Vibe Arcade (`pwshfan1980h.github.io`), so anything tracked is visible.
- New planning docs go in `plans/` too.

## Stack and layout (target)
- TypeScript + Vite + Three.js, orthographic camera at the classic isometric angle. Same stack as `~/Projects/paperman-2`; borrow its Vite and Pages setup.
- `src/sim/`: pure combat and run logic, real time on a fixed tick. **No Three.js or DOM imports.** It outputs an event log (`{t, actor, ability, targets, dmg, crit}` plus position updates).
- `src/render/`: Three.js scenes that replay the sim's event log.
- `src/ui/`: town and menu screens.
- `data/*.json`: every balanceable number (races, classes, abilities, monsters, items, biomes, events). Nothing balance-related is hardcoded.
- `tools/sim.ts` → `npm run sim`: plays thousands of seeded runs and reports win rate by floor, damage per class and synergy strength. Tune numbers against this, not by feel.
- Seeded RNG everywhere, so any run can be replayed from its seed.

## Art and audio
- Style: everything is voxel at 32px-art fidelity (16px HAS sprites upscaled 2× with Scale2x, then voxelized; a unit is 32 voxels tall), seen through an isometric orthographic camera. Flat shading, vertex colours, half-resolution render upscaled with nearest filtering.
- **Unit models (heroes, monsters) are original**, built from a voxel parts kit in `src/art/` and animated procedurally. Heroic Asset Series units are inspiration only; never convert or copy them.
- Non-unit art (buildings, terrain, props, UI) comes from the Heroic Asset Series in `~/Projects/game-asset-cache`, converted to voxels by `npm run voxelize`. **Read the cache's `AGENTS.md` and the pack's guide first.** Never edit the cache originals.
- **The Heroic Asset Series is paid art. Never commit it, or voxel models made from it, to this public repo.** It lives in a private assets repo, cloned locally into gitignored `assets-private/` and pulled into the Pages build with a deploy key. Credit Aleksandr Makarov. The game must still run without it, using placeholder cubes.
- UI is diegetic by default: show state in the world (posture, wounds, effects, lighting), not with health bars or floating numbers. Any 2D UI that's needed uses the in-world pixel style. Build this in from the start.
- CC0 assets (Kenney sounds and particles) can be copied into `public/assets/`. Keep each pack's license file with the copy and add a line to `CREDITS.md`.

## Arcade listing
- The arcade card reads this repo's description, GitHub Pages URL and the page's `og:image`. Once something is playable:
  - deploy to GitHub Pages with a GitHub Actions workflow, like paperman-2
  - add `<meta property="og:image" content="https://pwshfan1980h.github.io/auto-party-story/preview.png">` with a 1200×630 `preview.png`
  - tell the user to remove `"status": "wip"` for this game from the arcade repo's `data/overrides.json`
