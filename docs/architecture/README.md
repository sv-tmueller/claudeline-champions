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
  energy reserve; openers and escapes for Hargrim, Quillon and Skerrow (#81);
  aim leading and three tiers. A think allocates nothing in the steady state
  (`packages/bots/test/allocation.test.ts`). No Lumeth rules yet.
- `client`: one 2v2 with three bots, an ally and two enemies, on arena01 only
  (`main.ts` imports `arena01.json` only). `?champion=` picks any champion
  with a kit and `?difficulty=` picks the tier. The HUD has the ring warning
  and the kill feed, and the result screen has the champion select. Dev only:
  `?scene=sandbox`, `?timescale=` and the `__runProbeFrames` hook. The heap
  probe measures the sandbox scene. Not built: a pre-match screen, menus,
  keybinding, audio, the arena select, the `Platform` interface.
- Content: arena01 and arena02 (JSON and committed models); the Hargrim,
  Quillon and Skerrow kits; placeholder models for the four roster ids. The
  Lumeth kit is #70.
- `server`, `protocol`, `desktop`: not started (milestones 6 and 8).

## Index

Topics:

- [Packages](packages.md): repository layout, dependency rules, data flow.
- [Simulation](simulation.md): time and space, input, state, entities,
  statuses, abilities, match flow, determinism rules.
- [Client](client.md): loop, input, camera, scene, HUD, platform interface.
- [Bots](bots.md): navigation, decisions, aim, difficulty tiers.
- [Online](online.md): netcode and ladder principles.
- [Assets](assets.md): Blender pipeline, node naming, arena definition.
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
- The heap probe runs through the dev-only counted frame hook with a 640 B
  limit per window, on the sandbox scene:
  [batch #53 decision 9](https://github.com/sv-tmueller/claudeline-champions/issues/53#issuecomment-5996986020),
  [batch #53 decision 18](https://github.com/sv-tmueller/claudeline-champions/issues/53#issuecomment-5998600236).
  Recorded in [Testing](testing.md#the-heap-probe).
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

Planning:

- [Roadmap](../roadmap.md): the nine milestones and their candidate packages.
