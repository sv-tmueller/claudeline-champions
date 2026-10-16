# Architecture

Claudeline Champions is an original top-down arena brawler: WASD movement,
mouse-aimed skillshots, no auto-targeting, cooldown-based kits with an
energy-fuelled ultimate, short best-of rounds in small symmetric arenas.

This directory is the living reference for humans and agents. The approved
source is the
[design spec](../superpowers/specs/2026-10-01-claudeline-champions-design.md).
If this directory and the spec disagree, fix this directory or change the spec
first.

## How the pieces fit

- One pure TypeScript simulation (`sim`) holds all game rules. It runs at a
  fixed 60 Hz tick and knows nothing about rendering, input or networking.
- `bots` reads the full game state and produces the same `PlayerInput` record
  a human produces.
- `client` maps keyboard and mouse to `PlayerInput`, steps the sim, and renders
  the result with Three.js and an HTML HUD.
- Online (milestone 6, not built yet), the same sim runs on the server
  (`server`, `protocol`): clients send their input stream and the server stays
  authoritative.
- Arenas are JSON. The sim reads them for collision and Blender scripts read
  them to generate the committed `.glb` models.
- Roster kits are JSON too, under `data/kits/<id>.json`: plain data that the
  sim's casting code runs and `validateKit` checks (see
  [ADR-003](decisions/ADR-003-typed-ability-modules.md)).
- `npm run check` is the gate every package must pass.

## Status on main

- `sim`: the 60 Hz step with movement and collision; the effects toolkit
  (projectiles, areas, melee arcs, statuses, forced motion), with projectile
  ally effects since #69; kits with casting, cooldowns, windups and energy;
  match flow with rounds and the sudden-death ring, opt-in through
  `roundsToWin`; angles through `dmath.ts`; the sweep's heap check in
  `packages/sim/test/allocation.test.ts`.
- `bots`: the navigation grid, A-star and the path follower; engage, kite and
  retreat by utility with the finisher and deadlock rules; the clear-shot
  test; casting from kit data with range profiles for all four roster ids; the
  energy reserve; openers and escapes for Hargrim, Quillon and Skerrow (#81),
  Skerrow's wait at 6 to 8 m and her Quiet Dart opener, and no dash pressed on
  an escape think for any kit (#98); aim leading and three tiers. A think
  allocates nothing in the steady state and a plan search only its path
  (`packages/bots/test/allocation.test.ts`). Lumeth has Binding Sigil beside an
  ally, the 3 m escape trigger with Lantern Burst and Glide, and her ally
  slots: Mend Bolt, Soothing Surge, Aegis Veil and Dawnbloom pressed at the
  ally that needs them, with the bolts aimed at it through their windup. Her
  leash to an ally and the EX variants of M2 and R are not built.
- `client`: a 2v2 with three bots or a 3v3 with five (`?teamsize=`), on either
  arena (`main.ts` reads every file under `data/arenas`). `?champion=` picks
  any champion with a kit, `?difficulty=` picks the tier and `?arena=` picks
  the arena. The HUD has the ring warning and the kill feed, and the result
  screen has the champion, arena, team size and difficulty select. Escape
  opens a menu that pauses the match (Resume, Restart, the select again, a
  keys view that rebinds the nine movement and slot keys, and a sound
  toggle). The first-pass sound is generated in code (a hit, a cast, a death,
  a round start and a round end) and is counted by the heap probe. The
  `Platform` interface has its two settings methods, asynchronous, and a
  `sound` sub-object; the browser platform keeps the bindings and the mute in
  `localStorage`. Dev only: `?scene=sandbox`, `?timescale=` and
  the `__runProbeFrames` hook. The heap probe measures two scenes, the
  sandbox and the live match with a moving pointer, and bounds the bots' bytes
  in the live match. No raw double crosses a call in the aim sampling, the
  champion placing, the entity drawing, the overlay circles, the ring records,
  the animation state machine or the clip sampler, and a heal bolt's ring takes
  the projectile colour of its team. The six clips play: a state machine per
  champion (Idle and Run, an Attack, Cast or Hit over the upper body, Death
  held) and a sampler of our own on the clip data, with `data-anim0` to
  `data-animN` hooks, both counted by the heap probe. Not built: a pre-match
  screen, music, the scoreboard, the other three `Platform` methods
  (`identity`, `unlockAchievement`, `openUrl`).
- Content: arena01 and arena02 (JSON and committed models); the Hargrim,
  Quillon, Skerrow and Lumeth kits; models for the four roster ids and the
  placeholder, each rigged, with six clips the client plays.
- `server`, `protocol`, `desktop`: not started (milestones 6 and 8).

## Index

Topics:

- [Packages](packages.md): repository layout, dependency rules, data flow.
- [Simulation](simulation.md): time and space, input, state, entities,
  statuses, abilities, match flow, determinism rules.
- [Client](client.md): loop, input, camera, scene, HUD, platform interface.
- [Bots](bots.md): navigation, decisions, aim, difficulty tiers.
- [Online](online.md): netcode and ladder principles.
- [Assets](assets.md): Blender pipeline, node naming, arena definition, the
  champion rig and clips.
- [Testing](testing.md): check suite and test types.

Decisions:

- [ADR-001: TypeScript stack](decisions/ADR-001-typescript-stack.md)
- [ADR-002: server-authoritative simulation](decisions/ADR-002-server-authoritative-sim.md)
- [ADR-003: typed ability modules](decisions/ADR-003-typed-ability-modules.md)
- [ADR-004: script-driven Blender assets](decisions/ADR-004-script-driven-blender-assets.md)
- [ADR-005: original content](decisions/ADR-005-original-content.md)

Batch decisions that shaped the structure (none of them is a new ADR):

- Kits are JSON data:
  [batch #32 decision 4](https://github.com/sv-tmueller/claudeline-champions/issues/32#issuecomment-5945491586),
  [batch #53 decision 1](https://github.com/sv-tmueller/claudeline-champions/issues/53#issuecomment-5954741436),
  [batch #53 decision 6](https://github.com/sv-tmueller/claudeline-champions/issues/53#issuecomment-5996621415).
  Recorded in [ADR-003](decisions/ADR-003-typed-ability-modules.md) and
  [Simulation](simulation.md#kit-contract-and-registration).
- The heap probe runs through the dev-only counted frame hook on two scenes,
  asserting the median of five windows: 600 B for the sandbox and 780 B for the
  live match, both by the limit rule (about 100 B above the largest clean
  median, below the smallest mutation the scene gates), and 12 000 B for the
  bots' bytes in the live match (50 percent above the largest clean median):
  [batch #53 decision 9](https://github.com/sv-tmueller/claudeline-champions/issues/53#issuecomment-5996986020),
  [batch #53 decision 18](https://github.com/sv-tmueller/claudeline-champions/issues/53#issuecomment-5998600236),
  [batch #91 decision 2](https://github.com/sv-tmueller/claudeline-champions/issues/91#issuecomment-6014685854),
  [batch #91 decision 3](https://github.com/sv-tmueller/claudeline-champions/issues/91#issuecomment-6014761763),
  [batch #91 decision 7](https://github.com/sv-tmueller/claudeline-champions/issues/91#issuecomment-6015519796),
  [batch #91 decision 12](https://github.com/sv-tmueller/claudeline-champions/issues/91#issuecomment-6019121228),
  [batch #91 decision 18](https://github.com/sv-tmueller/claudeline-champions/issues/91#issuecomment-6020995527),
  [its addendum](https://github.com/sv-tmueller/claudeline-champions/issues/91#issuecomment-6021485382).
  Recorded in [Testing](testing.md#the-heap-probe) and
  [Bots](bots.md#in-the-browser).
- arena01's two deviations are grandfathered:
  [batch #63 decision 14](https://github.com/sv-tmueller/claudeline-champions/issues/63#issuecomment-6002137472).
  Recorded in [the arena design](../design/arenas.md#8-the-arenas) and pinned
  in `tools/blender/test_arena_principles.py`.
- The bot think allocates nothing, returns the bot's own record, and has a heap
  check and an identity harness:
  [batch #53 decision 7](https://github.com/sv-tmueller/claudeline-champions/issues/53#issuecomment-5996786969),
  [batch #63 decision 4](https://github.com/sv-tmueller/claudeline-champions/issues/63#issuecomment-6001535132),
  [batch #63 decision 19](https://github.com/sv-tmueller/claudeline-champions/issues/63#issuecomment-6003600257),
  [the harness](https://github.com/sv-tmueller/claudeline-champions/pull/72#issuecomment-6003754462).
  Recorded in [Bots](bots.md#allocation) and its [API](bots.md#api).
- The `Platform` settings methods are asynchronous, so the Electron port reaches
  files over IPC without a signature change, and only those two are built:
  [batch #80 decision 15](https://github.com/sv-tmueller/claudeline-champions/issues/80#issuecomment-6012436842).
  Recorded in [Client](client.md#platform-interface).
- `Platform` gains a `sound` sub-object, `SoundOutput`, so a desktop build can
  swap it, with a dated amendment line under the design spec's section 5, and
  sound runs as a second allocation-free pass, `routeSounds`, right after
  `routeEvents`:
  [batch #105 decision 4](https://github.com/sv-tmueller/claudeline-champions/issues/105#issuecomment-6140641300).
  Recorded in [Client](client.md#platform-interface) and its
  [audio](client.md#audio).
- One rig and six clips for every champion model, the placeholder included,
  each clip keying only the channels it moves, checked by the validator against
  the tables, the floor held at 0 between keys by two pose rules:
  [batch #91 decision 6](https://github.com/sv-tmueller/claudeline-champions/issues/91#issuecomment-6015246696),
  [batch #91 decision 9](https://github.com/sv-tmueller/claudeline-champions/issues/91#issuecomment-6015774432),
  [batch #91 decision 11](https://github.com/sv-tmueller/claudeline-champions/issues/91#issuecomment-6019098915),
  [batch #105 decision 2](https://github.com/sv-tmueller/claudeline-champions/issues/105#issuecomment-6031281041).
  Recorded in [Assets](assets.md#rig) and its [clips](assets.md#clips).
- The address is the whole setup, the team size included: every select link
  writes `teamsize`, 2 too, and the arena decides what plays
  (`playableTeamSize`):
  [batch #91 decision 5](https://github.com/sv-tmueller/claudeline-champions/issues/91#issuecomment-6015194380).
  Recorded in [Client](client.md#launch-and-match) and its
  [select](client.md#result-screen-and-champion-select).

- The six clips play through our own LINEAR sampler on the clip data, counted
  by the heap probe, with three's `AnimationMixer` as the test oracle and not
  the frame path; the state machine's transitions are tuned constants in ticks,
  its triggers ride `routeEvents`' pass and its doubles live in typed arrays:
  [batch #105 decision 11](https://github.com/sv-tmueller/claudeline-champions/issues/105#issuecomment-6221276811).
  Recorded in [Client](client.md#animation) and [Assets](assets.md#clips).

Planning:

- [Roadmap](../roadmap.md): the nine milestones and their candidate packages.
