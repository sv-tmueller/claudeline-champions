# Packages

Repository layout, dependency rules and data flow. Source: spec sections 3.1,
3.2 and 3.3.

## Repository layout

```
package.json                npm workspaces root, scripts: dev, check, test, lint, typecheck, e2e
packages/sim/               pure TypeScript, zero runtime deps, no DOM types
packages/bots/              depends on sim only
packages/client/            Vite + Three.js, depends on sim and bots
packages/server/            Node authoritative match server (milestone 6)
packages/protocol/          shared network message types (milestone 6)
packages/desktop/           Electron shell + Steamworks (milestone 8)
tools/blender/              Python scripts run via Blender in background mode
data/arenas/                arena definitions (JSON), read by sim and by Blender scripts
data/kits/                  roster kit definitions (JSON, one `KitDef` per champion), read like arenas
assets/models/              generated .glb files, committed
docs/architecture/          living reference for humans and agents
docs/design/                game design documents (rules, roster, arenas)
docs/roadmap.md             living roadmap
docs/superpowers/specs/     approved designs (the design spec)
.github/workflows/ci.yml    typecheck, lint, unit tests and asset checks on code pull requests; build and e2e on ready pull requests and main
```

## Dependency rules

- `sim` imports nothing outside itself. Its tsconfig has no DOM lib. It never
  reads the wall clock, never calls `Math.random`, never touches `window`,
  `document`, `fetch` or Node built-ins.
- `bots` imports `sim` only.
- `client` imports `sim` and `bots`. It owns all rendering, input, audio and UI.
- `server` imports `sim`, `bots` and `protocol`. It never imports `client`.
- Lint enforces these boundaries. A violation fails `npm run check`.

## Data flow

```
keyboard+mouse -> client input mapper -> PlayerInput (per tick)
bots            -> bot.think(state)   -> PlayerInput (per tick)
PlayerInput[] + GameState -> sim.step() -> GameState' + events[]
GameState' -> client renderer (interpolated) + HUD
GameState' -> server snapshot -> remote clients          (milestone 6)
```

Locally the client, the bots and the sim live in one process, so there is zero
input latency. Online, the same sim runs on the server and clients send their
PlayerInput stream.

## Related

- [Simulation](simulation.md) for `PlayerInput`, `GameState` and `step`.
- [Client](client.md) for the input mapper and renderer.
- [Bots](bots.md) for `bot.think`.
- [Online](online.md) for snapshots and the server.
