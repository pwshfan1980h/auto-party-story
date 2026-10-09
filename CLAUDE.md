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
- `src/sim/`: pure combat and run logic. **No Three.js or DOM imports.** It outputs an event log (`{t, actor, ability, targets, dmg, crit}`).
- `src/render/`: Three.js scenes that replay the sim's event log.
- `src/ui/`: town and menu screens.
- `data/*.json`: every balanceable number (races, classes, abilities, monsters, items, biomes, events). Nothing balance-related is hardcoded.
- `tools/sim.ts` → `npm run sim`: plays thousands of seeded runs and reports win rate by floor, damage per class and synergy strength. Tune numbers against this, not by feel.
- Seeded RNG everywhere, so any run can be replayed from its seed.

## Art and audio
- Style: cartoon low-poly, flat-shaded, one shared palette texture, chunky big-headed proportions. The reference is the Overaction skeleton in `~/Projects/game-asset-cache`.
- Source assets from `~/Projects/game-asset-cache`. **Read its `AGENTS.md` and the pack's guide first.** Copy only the files you use into `public/assets/`, never edit the cache originals, keep each pack's license file with the copy, and add a line to `CREDITS.md`.
- Known gotchas: the Overaction skeleton FBX wants lowercase `textures/` (fix it in the copy) and has no death clip. Kenney dungeon GLBs reference an external `Textures/colormap.png`.

## Arcade listing
- The arcade card reads this repo's description, GitHub Pages URL and the page's `og:image`. Once something is playable:
  - deploy to GitHub Pages with a GitHub Actions workflow, like paperman-2
  - add `<meta property="og:image" content="https://pwshfan1980h.github.io/auto-party-story/preview.png">` with a 1200×630 `preview.png`
  - tell the user to remove `"status": "wip"` for this game from the arcade repo's `data/overrides.json`
