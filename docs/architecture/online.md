# Online and ladder

Milestone 6 design. Nothing here is built yet: `packages/server` and
`packages/protocol` do not exist. The approved source is the
[online design](../superpowers/specs/2026-10-17-online-design.md) (batch #134
decision 1), recorded in
[ADR-006](decisions/ADR-006-online-first-cut.md), and it extends section 7 of
the [design spec](../superpowers/specs/2026-10-01-claudeline-champions-design.md).
See the [roadmap](../roadmap.md#6-online) for the packages and milestone 7.

## Netcode

The first cut, with the numbers (each bullet links the design section that
decides it; timeouts, caps and limits are defaults the owning package may tune,
listed in
[section 4](../superpowers/specs/2026-10-17-online-design.md#defaults-a-package-may-tune)):

- **Process model.** A router process owns the one public WebSocket port and
  the room-code table, and forks one child process per room. The child runs the
  room's lobby and its matches, one at a time, on the same sim at 60 Hz. The
  router relays the JSON text without parsing it after a connection's first
  message
  ([section 4](../superpowers/specs/2026-10-17-online-design.md#4-the-process-model)).
- **Transport.** `ws` on Node, the browser's `WebSocket` in the client, one
  JSON object per text frame, at most 1024 bytes from a client
  ([section 6](../superpowers/specs/2026-10-17-online-design.md#6-the-messages)).
- **Lobby.** A room is found by a five-character code. The host sets the team
  size, arena and difficulty, humans pick a team and a champion and ready up,
  and bots fill the empty seats when everyone is ready. The sim's 3 s warmup is
  the countdown
  ([section 5](../superpowers/specs/2026-10-17-online-design.md#5-the-lobby-and-the-ready-flow)).
- **Inputs.** The client sends one `PlayerInput` per sampled tick with its own
  tick counter. The server keeps up to 6 per seat and uses one a tick, and a
  reconnect resets the seat's counter. `ack` in
  each snapshot is the last input tick applied
  ([section 7](../superpowers/specs/2026-10-17-online-design.md#7-inputs)).
- **Snapshots.** The server sends the full `GameState` as JSON every third tick
  (20 Hz), without `arena`, `kits` and `events`, which travel once at match
  start and in per-tick batches. In three measured 3v3 runs a snapshot
  averaged 2.7 to 2.8 KB of state and 3.0 to 3.2 KB with its events, and the
  largest message was 8.1 KB (about 61 to 64 KB/s a client on average, 161 KB/s
  at the largest message)
  ([section 8](../superpowers/specs/2026-10-17-online-design.md#8-snapshots)).
- **Rendering.** The client draws 6 ticks (100 ms) behind the estimated server
  tick, through the existing interpolation, and releases events when the render
  tick passes them. It holds the newest snapshot when none is newer and does not
  extrapolate
  ([section 9](../superpowers/specs/2026-10-17-online-design.md#9-client-rendering)).
- **No prediction yet.** The local champion is not predicted, so input reaches
  the screen after a round trip plus about 100 ms. Prediction and reconciliation
  come after the interpolation works (packages P6a and P6b), and delta
  snapshots after that (P7), behind a protocol version bump.
- **Reconnect.** A server-issued token, which starts with the room code, holds
  the seat. For 600 ticks (10 s) the champion stands still, then a bot drives
  the seat until the player returns
  ([section 10](../superpowers/specs/2026-10-17-online-design.md#10-reconnect)).
- **No pause online.** Escape opens the menu over the running match, and the
  menu offers Leave where a local match offers Restart
  ([section 9](../superpowers/specs/2026-10-17-online-design.md#9-client-rendering)).

`sim` knows nothing about networking.

## Packages

- `protocol` holds the message types, `PROTOCOL_VERSION` and a pure JSON encode
  and decode with validation. No I/O, no transport, no game logic. It imports
  relative paths and `@claudeline/sim` only. It has the host bans of `sim`: the
  globals `Date`, `performance`, `setTimeout`, `setInterval`, `window`,
  `document` and `fetch`, the properties `Math.random`, `Date.now` and
  `performance.now`, no Node built-ins, and no dynamic `import()` or `import()`
  types. It does not have sim's math ban. Its tsconfig has `lib: ["ES2023"]`,
  `types: []` and `erasableSyntaxOnly`.
- `server` imports `sim`, `bots`, `protocol`, `ws` and `node:` built-ins, never
  `client`, and may read the wall clock. It runs from TypeScript source through
  Node's type stripping, with no build step.
- `client` imports `sim`, `bots` and `protocol`, never `server`. A lint deny
  rule covers static and dynamic imports.
- `sim` and `bots` are unchanged.

The rules and the lint blocks are in
[packages.md](packages.md#dependency-rules) and
[section 3](../superpowers/specs/2026-10-17-online-design.md#3-package-layout-and-rules)
of the design.

## Tests

One line a layer
([section 12](../superpowers/specs/2026-10-17-online-design.md#12-test-strategy)):

- Protocol round trips: every message encodes and decodes to itself, a real 3v3
  snapshot rebuilds to the server's `checksum`, bad messages are rejected.
- Server headless test: `Room` on a loopback transport and a manual clock, from
  create and ready to `matchEnd`, with a checksum match at every snapshot and
  the reconnect rows.
- Socket test: a real `ws` server and Node's `WebSocket` client on a free port.
- Client units: the snapshot buffer, the render clock, event release, input
  ticks.
- One Playwright e2e against a local server: the lobby, ready, bots, the round
  phase and a moving champion.

## Ladder

- A separate matchmaking service owns accounts, queues and ratings. Casual and
  ranked queues share one matchmaker. Only ranked updates the visible Glicko-2
  rating; casual uses a hidden rating for fairness.

## Anti-cheat

Server authority is the anti-cheat baseline. No client-trusted state. The
server validates each message and caps its size, takes the seat from the
connection, and the sim sanitizes each input again. Rate limits wait for
deployment
([section 11](../superpowers/specs/2026-10-17-online-design.md#11-security-baseline)).

## Related

- [Online design](../superpowers/specs/2026-10-17-online-design.md) and
  [ADR-006](decisions/ADR-006-online-first-cut.md).
- [Simulation](simulation.md) for `PlayerInput`, `GameState` and the event
  table.
- [Packages](packages.md) for where `server` and `protocol` sit.
- [Client](client.md#menu-and-keybinding) for the menu.
