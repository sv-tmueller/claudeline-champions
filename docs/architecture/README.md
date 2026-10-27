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
- Online (milestone 6, designed in the
  [online design](../superpowers/specs/2026-10-17-online-design.md); only
  `protocol`, the client's net core and the `server` skeleton are built so
  far), the same sim runs on the server (`server`): clients send their input
  stream, the server stays authoritative, and both sides read and write the
  messages through the `protocol` codec.
- Arenas are JSON. The sim reads them for collision and Blender scripts read
  them to generate the committed `.glb` models.
- Roster kits are JSON too, under `data/kits/<id>.json`: plain data that the
  sim's casting code runs and `validateKit` checks (see
  [ADR-003](decisions/ADR-003-typed-ability-modules.md)).
- `npm run check` is the gate every package must pass.

## Status on main

- `sim`: the 60 Hz step with movement and collision; the effects toolkit
  (projectiles, areas, melee arcs, statuses, forced motion), with projectile
  ally effects since #69, the self-cast rule (an ally projectile aimed at its
  caster lands on her at 60 percent heal) since #191 and the `wound` status (10
  percent less healing per stack, up to 3 stacks) since #158; kits with casting,
  cooldowns, windups and energy; match flow with rounds and the sudden-death
  ring, opt-in through `roundsToWin`; angles through `dmath.ts`; the sweep's
  heap check in `packages/sim/test/allocation.test.ts`.
- `bots`: the navigation grid, A-star and the path follower; engage, kite and
  retreat by utility with the finisher and deadlock rules; the clear-shot
  test; casting from kit data with range profiles for all six roster ids; the
  energy reserve; openers and escapes for Hargrim, Quillon and Skerrow (#81),
  Skerrow's wait at 6 to 8 m and her Quiet Dart opener, and no dash pressed on
  an escape think for any kit (#98); aim leading and three tiers. A think
  allocates nothing in the steady state and a plan search only its path
  (`packages/bots/test/allocation.test.ts`). Lumeth has Binding Sigil beside an
  ally, the 3 m escape trigger with Lantern Burst and Glide, and her ally
  slots: Mend Bolt, Soothing Surge, Aegis Veil and Dawnbloom pressed at the
  ally that needs them, with the bolts aimed at it through their windup. Her
  leash to an ally and the EX variants of M2 and R are not built. Ondrel has
  Undertow on a target walking away, Reed Step and Reed Screen as escapes and
  rangeMin 5; Brimwick Flash Powder on a target walking toward her, Flare Step
  and Smoke Pot as escapes, rangeMin 7 and Grand Finale held for a target at 55
  health or less or a cornered one (#165). One escape streak gates the whole
  escape order, and the areas lead at the nominal 20 m/s (measured, see
  [bots](bots.md), Aim).
- `client`: a 2v2 with three bots or a 3v3 with five (`?teamsize=`), on either
  arena (`main.ts` reads every file under `data/arenas`). `?champion=` picks any
  champion with a kit, `?difficulty=` picks the tier and `?arena=` picks the
  arena. The HUD has the ring warning and the kill feed, and the result screen
  has the champion, arena, team size and difficulty select. Escape opens a menu
  that pauses the match (Resume, Restart, the select again, a keys view that
  rebinds the nine movement and slot keys and the held self-cast key C, and a
  sound toggle). The first-pass sound is generated in code (a hit, a cast, a
  death, a round start and a round end) and is counted by the heap probe. The
  `Platform` interface has its two settings methods, asynchronous, and a `sound`
  sub-object; the browser platform keeps the bindings and the mute in
  `localStorage`. Dev only: `?scene=sandbox`, `?timescale=` and the
  `__runProbeFrames` hook. The heap probe measures two scenes, the sandbox and
  the live match with a moving pointer, and bounds the bots' bytes in the live
  match. No raw double crosses a call in the aim sampling, the champion placing,
  the entity drawing, the overlay circles, the ring records, the animation state
  machine or the clip sampler, and a heal bolt's ring takes the projectile
  colour of its team. The six clips play: a state machine per champion (Idle and
  Run, an Attack, Cast or Hit over the upper body, Death held) and a sampler of
  our own on the clip data, with `data-anim0` to `data-animN` hooks, both
  counted by the heap probe. A bare address opens the pre-match select
  (champion, arena, team size and difficulty), and any launch key plays a match
  as before. Not built: music, the other three `Platform` methods (`identity`,
  `unlockAchievement`, `openUrl`).
- Content: arena01 and arena02 (JSON and committed models); the Hargrim,
  Quillon, Skerrow and Lumeth kits, and the Ondrel and Brimwick kits (bot
  profiles since #165); models for the seven roster ids and the placeholder,
  each rigged, with six clips (the client registers and plays six of the seven
  roster ids, and Durnhal's model waits for roadmap step 1.3).
  The v1 kits carry the first tuning pass's two numbers, Skerrow's Rend damage
  and Lumeth's Binding Sigil radius (see [balance.md](../design/balance.md)).
- `tools/balance`: the balance harness. `npm run balance` plays every champion
  pairing bot against bot, in 2v2 and 3v3 on both arenas, over a seed set and
  writes the win-rate report into [balance.md](../design/balance.md); `--check`
  compares a fresh run with the committed block. Each cell plays about 200
  matches (seeds per config from the cell's fills, per mode), and
  `--mode 2v2|3v3` plays and checks one mode, which the manual workflow runs as
  two jobs. Its unit tests are the `tools` Vitest project, and a manual workflow
  reproduces the report on a runner (see [Testing](testing.md)). It needs Node
  22.15 or later. It plays the six kits of `data/kits`, the `HARNESS_KITS` of
  `tools/balance/inputs.ts`: 60 cells and 11 760 matches, about 14 minutes on
  Apple silicon (the report of batch 15, #189).
- `tools/fixtures`: the scripted roster fixture search. `npm run
  fixtures:search -- <kit>` plays the seeded random player of the header of
  `roster-fixtures.test.ts` until an attempt covers everything the test
  requires, and writes that kit's fixture in the committed layout; it shares
  the format, the replay, the coverage and the oracle with the test through
  `packages/sim/test/roster-fixture.ts`. Its tests reproduce the six committed
  fixtures byte for byte (see [Testing](testing.md#fixture-search)). It needs
  Node 22.15 or later.
- `protocol`: the message types of the online design, `PROTOCOL_VERSION`, three
  total decoders (first message, session message, server message), the
  encoders in the spec's key order and the snapshot splice, with the lint
  blocks that keep it to `@claudeline/sim` and relative paths (see
  [Online](online.md)). The client's net core imports it (#168); `main.ts` does
  not yet. The `server` imports it.
- `server`: the P2 skeleton (#167): `Room` with the lobby and ready flow, bot
  fill, a 60 Hz accumulator loop on an injected clock, the input queue, the
  snapshot cadence and event batches, the 20-bad-messages close, the two-way
  `Difficulty` check, and a loopback test that plays a 2v2 and a 3v3 to a
  result through the codec. No transport, no process and no timer yet, and no
  `ws` dependency: they come with P3 (see [Online](online.md)).
- `desktop`: not started (milestone 8).

## Index

Topics:

- [Packages](packages.md): repository layout, dependency rules, data flow.
- [Simulation](simulation.md): time and space, input, state, entities,
  statuses, abilities, match flow, determinism rules.
- [Client](client.md): loop, input, camera, scene, HUD, platform interface.
- [Bots](bots.md): navigation, decisions, aim, difficulty tiers.
- [Online](online.md): the milestone 6 netcode design, its packages and tests,
  and the ladder principles. The approved source is the
  [online design](../superpowers/specs/2026-10-17-online-design.md).
- [Assets](assets.md): Blender pipeline, node naming, arena definition, the
  champion rig and clips.
- [Testing](testing.md): check suite, test types, the heap probe and the
  manual balance workflow.
- [Balance](../design/balance.md) (a design doc): the bands, the report that
  `npm run balance` writes and the tuning passes.

Decisions:

- [ADR-001: TypeScript stack](decisions/ADR-001-typescript-stack.md)
- [ADR-002: server-authoritative simulation](decisions/ADR-002-server-authoritative-sim.md)
- [ADR-003: typed ability modules](decisions/ADR-003-typed-ability-modules.md)
- [ADR-004: script-driven Blender assets](decisions/ADR-004-script-driven-blender-assets.md)
- [ADR-005: original content](decisions/ADR-005-original-content.md)
- [ADR-006: the first online cut](decisions/ADR-006-online-first-cut.md)

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
  median, below the smallest mutation the scene gates), and 18 000 B for the
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

- The online process model and package rules: a router forks one process per
  room, `protocol` holds a pure codec, the client imports `protocol`, and
  online play never pauses:
  [batch #134 decision 1](https://github.com/sv-tmueller/claudeline-champions/issues/134#issuecomment-6232034441).
  Recorded in [ADR-006](decisions/ADR-006-online-first-cut.md), with dated
  amendment lines under the design spec's sections 2, 3.2 and 7, in
  [Online](online.md) and in [Packages](packages.md#dependency-rules).

Planning:

- [Roadmap](../roadmap.md): the nine milestones and their candidate packages.
