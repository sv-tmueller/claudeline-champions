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
- Online, the same sim runs on the server (`server`, `protocol`). Clients send
  their input stream. The server stays authoritative.
- Arenas are JSON. The sim reads them for collision and Blender scripts read
  them to generate the committed `.glb` models.
- Roster kits are JSON too, under `data/kits/<id>.json`: plain data that the
  sim's casting code runs and `validateKit` checks (see
  [ADR-003](decisions/ADR-003-typed-ability-modules.md)).
- `npm run check` is the gate every package must pass.

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

Planning:

- [Roadmap](../roadmap.md): the nine milestones and their candidate packages.
