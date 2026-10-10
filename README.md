# Auto Party Story

An isometric party-management dungeon crawler. Run a town, build a party from a big roster of races and classes, then send them into the dungeon, where they fight on their own in an auto-battler. Get back out before the torch burns down to keep the loot.

**Status:** early development. Nothing playable yet.

## Loop

Town → manage the party → dungeon run (auto-battles) → push deeper or retreat → back to town with XP and loot → rest, recruit, upgrade → repeat.

## Tech

TypeScript, Three.js (orthographic isometric camera), Vite. It's a static browser game, deployed to GitHub Pages.

## Credits

Art and sound come from CC0 packs. `CREDITS.md` will list each one as it's added.

## Development

```sh
npm install
npm test               # unit tests: sim, unit art kit, golden seeds
npm run sim -- smoke   # quick health check: data, fights, runs, determinism
npm run sim -- all     # full balance report into reports/
npm run golden         # regenerate golden-seed snapshots after an intended change
npm run baselines      # re-measure the room risk table Leaders plan with
npm run tune           # auto-tuner: proposes data changes into reports/ (--apply to write them)
npm run dev            # then open /gallery.html to review the unit models
```

The combat and run simulation lives in `src/sim/` and has no rendering dependencies. Balance numbers live in `data/`. Unit models are original, built from the voxel parts kit in `src/art/`.
