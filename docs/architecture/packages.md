# Packages

Repository layout, dependency rules and data flow. Source: spec sections 3.1,
3.2 and 3.3, and the dated amendment under 3.2
([batch #134 decision 1](https://github.com/sv-tmueller/claudeline-champions/issues/134#issuecomment-6232034441)).

## Repository layout

```
package.json                npm workspaces root and the npm scripts
packages/sim/               pure TypeScript, zero runtime deps, no DOM types
packages/bots/              depends on sim only
packages/client/            Vite + Three.js, depends on sim, bots and (milestone 6) protocol
packages/server/            Node authoritative match server (milestone 6)
packages/protocol/          shared network message types and pure codec (milestone 6)
packages/desktop/           Electron shell + Steamworks (milestone 8)
tools/blender/              Python scripts run via Blender in background mode
tools/balance/              bot-versus-bot win-rate harness, `npm run balance`
tools/fixtures/             scripted roster fixture search, `npm run fixtures:search`
data/arenas/                arena definitions (JSON), read by sim and by Blender scripts
data/kits/                  roster kit definitions (JSON, one `KitDef` per champion), read like arenas
assets/models/              generated .glb files, committed
docs/architecture/          living reference for humans and agents
docs/design/                game design documents (rules, roster, arenas)
docs/roadmap.md             living roadmap
docs/superpowers/specs/     approved designs (the design spec)
.github/workflows/ci.yml    typecheck, lint, unit tests and asset checks on code pull requests; build and e2e on ready pull requests and main
.github/workflows/balance.yml  manual run that reproduces the balance report
```

## Dependency rules

- `sim` imports nothing outside itself. Its tsconfig has no DOM lib. It never
  reads the wall clock, never calls `Math.random`, never touches `window`,
  `document`, `fetch` or Node built-ins.
- `bots` imports `sim` only.
- `client` imports `sim` and `bots`. It owns all rendering, input, audio and UI.
- Designed for milestone 6 and not built yet (the amendment under spec section
  3.2, [online design section 3](../superpowers/specs/2026-10-17-online-design.md#3-package-layout-and-rules)):
  - `protocol` holds the message types, `PROTOCOL_VERSION` and pure JSON encode
    and decode with validation: no I/O, no transport, no game logic. It imports
    relative paths and `@claudeline/sim` only. It has the host bans of `sim`:
    the globals `Date`, `performance`, `setTimeout`, `setInterval`, `window`,
    `document` and `fetch`, the properties `Math.random`, `Date.now` and
    `performance.now`, no Node built-ins, and no dynamic `import()` or
    `import()` types. It does not have sim's math ban. Its tsconfig has
    `lib: ["ES2023"]`, `types: []` and `erasableSyntaxOnly`.
  - `server` imports `sim`, `bots`, `protocol`, `ws` and `node:` built-ins, with
    Node globals. It never imports `client`, and it may read the wall clock.
  - `client` then imports `sim`, `bots` and `protocol`, and never `server`. A
    lint deny rule says so, for static and dynamic imports:
    `eslint.config.js` has no import rule for the client today, so the first
    package adds it.
- `tools/balance` imports relative paths, `node:` builtins, `vitest` and the
  entry points of `@claudeline/sim` and `@claudeline/bots`. It reads `data/`
  and never a package's own files.
- `tools/fixtures` imports relative paths, `node:` builtins, `vitest` and the
  entry point of `@claudeline/sim`, and two sim test support modules by
  relative path, `packages/sim/test/roster-fixture.ts` and
  `packages/sim/test/ability-watch.ts`, so that the search and
  `roster-fixtures.test.ts` share one definition of the fixture format, the
  replay loop, the coverage and the oracle. It imports no other file of a
  package, no `@claudeline/bots` and nothing under `node_modules`, `tests` or
  `e2e`. It reads `data/` and writes `packages/sim/test/fixtures/` by file path.
  The sim test lint is unchanged: the sim suite does not import the tool.
- Lint enforces these boundaries. A violation fails `npm run check`. Today
  that holds for `sim`, `bots`, `tools/balance` and `tools/fixtures`; the
  blocks for `protocol`, `server` and the client arrive with milestone 6.

## Data flow

```
keyboard+mouse -> client input mapper -> PlayerInput (per tick)
bots            -> bot.think(state)   -> PlayerInput (per tick)
PlayerInput[] + GameState -> sim.step() -> GameState' + events[]
GameState' -> client renderer (interpolated) + HUD
GameState' -> server snapshot -> remote clients          (milestone 6)
remote client -> PlayerInput + tick -> socket -> server   (milestone 6)
```

Locally the client, the bots and the sim live in one process, so there is zero
input latency. Online, the same sim runs on the server and clients send their
PlayerInput stream, one message per sampled tick, over a WebSocket. The server
queues them per seat, steps the sim, and sends a full snapshot every third
tick, which the client renders 6 ticks behind through the interpolation (see
[Online](online.md#netcode)).

## Related

- [Simulation](simulation.md) for `PlayerInput`, `GameState` and `step`.
- [Client](client.md) for the input mapper and renderer.
- [Bots](bots.md) for `bot.think`.
- [Online](online.md) for snapshots and the server.
