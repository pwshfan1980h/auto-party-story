# Auto Party Story

An isometric party-management dungeon crawler. Run a town, build a party from a big roster of races and classes, then send them into the dungeon, where they fight on their own in an auto-battler. Get back out before the torch burns down to keep the loot.

**Status:** early development, for desktop play. [Play it here](https://pwshfan1980h.github.io/auto-party-story/). Hire heroes in town, pick a Leader, watch the delve room by room, and review what the company brought home. It saves in your browser, and the fallen stay fallen. The battle viewer is at [`viewer.html`](https://pwshfan1980h.github.io/auto-party-story/viewer.html).

## Loop

Town → manage the party → dungeon run (auto-battles) → push deeper or retreat → back to town with XP and loot → rest, recruit, upgrade → repeat.

Returns show banked loot, hero progress, casualties, route changes, and the Leader’s reason for coming home. First clears have persistent reward choices, and final completion leaves a company standard in town. Commission a needed class, compare equipment services, or salvage spare duplicates before the next expedition. Settings remember battle playback, camera, clarity, reduced motion, and sound preferences.

## Tech

TypeScript, Three.js (orthographic isometric camera), Vite. It's a static browser game, deployed to GitHub Pages.

## Credits

The voxel art and synthesized sound are original. See [CREDITS.md](CREDITS.md).

## Development

```sh
npm ci
npm test               # unit tests: sim, unit art kit, golden seeds
npm run sim -- smoke   # quick health check: data, fights, runs, determinism
npm run sim -- all     # full balance report into reports/
npm run golden         # regenerate golden-seed snapshots after an intended change
npm run baselines      # re-measure the room risk table Leaders plan with
npm run tune           # auto-tuner: proposes data changes into reports/ (--apply to write them)
npm run dev            # the game at /, the battle viewer at /viewer.html, unit models at /gallery.html
npm run balance:orders -- --seeds 200 --quick --gate
npm run balance:viability -- --seeds 200 --gate
npm run campaign -- --runs 75 --gate  # actual paid town actions and save/reload
npx playwright install chromium firefox
APS_BROWSERS=chromium,firefox npm run test:browser
npm run build
npm run test:build      # checks the built game, viewer, gallery, and distributed credits
```

The combat and run simulation lives in `src/sim/` and has no rendering dependencies. Balance numbers live in `data/`. Unit models are original, built from the voxel parts kit in `src/art/`.

Reports are written under ignored `reports/`. `--gate` makes unmet balance targets fail the command; exploratory reports without it still list findings. The company campaign supports `prepared`, `simple`, and `risky` policies. Its simulated fight duration excludes player deliberation and interface travel time.

On Linux CI, Firefox runs in a virtual desktop with software graphics. To use the same browser setup locally, run `APS_BROWSERS=chromium,firefox APS_FIREFOX_HEADED=1 LIBGL_ALWAYS_SOFTWARE=1 xvfb-run -a npm run test:browser` after installing the browser system dependencies. Test failures report the browser, scenario, and graphics support in the CI diagnostics.

Saves stay in the current browser and hostname. Use **Export save** before moving browsers or hosts, then **Import save** on the new one. Closing an active delve lets the Leader finish it; deaths are permanent. Damaged saves are preserved for recovery, and blocked storage is shown visibly.
