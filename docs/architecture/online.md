# Online and ladder

Milestone 6 design. P1, P2 and P4a are built: `packages/protocol` (#151), the
`packages/server` skeleton (#167) and the client's net core (#168, no DOM, in
`packages/client/src/net/`). The rest is not: the server's transport and
processes (P3) and the client's online match path do not exist. The approved
source is the [online design](../superpowers/specs/2026-10-17-online-design.md)
(batch #134 decision 1), recorded in
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
  at the largest message). With the roster at six champions (P2) the mean is
  3.1 to 3.3 KB, the largest 7.4 KB, and `arena` and `kits` are 16 KB once per
  match. A tick at six seats takes 0.05 to 0.09 ms on average and under 1 ms at
  the 99th percentile on an Apple M5 Pro, against the 16.7 ms it has
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
  `types: []` and `erasableSyntaxOnly`. The API is three total decoders
  (`decodeFirstMessage` and `decodeClientMessage` for the server,
  `decodeServerMessage` for the client), which return `{ ok, message }` or
  `{ ok: false, code, reason }` and never throw, two encoders that write the
  keys in the spec's order, and `snapshotStateJson` with `encodeSnapshot`, the
  splice of section 8, byte-equal to the full encoder.
- `server` (built as the P2 skeleton, #167) imports `sim`, `bots`, `protocol`
  and `node:` built-ins, never `client`, and may read the wall clock. `ws`
  joins with P3, which adds the dependency, and the lint row "server imports
  ws" is red until then. It runs from TypeScript source through Node's type
  stripping, with no build step: its tsconfig has `erasableSyntaxOnly`, so no
  parameter properties, `enum` or `namespace`, and its relative imports have no
  extension (P3's resolve hook completes them). What P2 has is below.
- `client` imports `sim`, `bots` and `protocol`, never `server`. A lint deny
  rule covers static and dynamic imports, and is built.
- `sim` and `bots` are unchanged, except that their lint segment bans now name
  `protocol` and `server`.

The rules and the lint blocks are in
[packages.md](packages.md#dependency-rules) and
[section 3](../superpowers/specs/2026-10-17-online-design.md#3-package-layout-and-rules)
of the design.

## The server skeleton (P2)

`packages/server` holds `Room`, the lobby and ready flow, bot fill, the loop,
the input queue, the snapshot cadence and batches, and a loopback test. It has
no transport, no process and no timer. The pieces and the rules the package
picked where the spec leaves them open:

- **`Room`.** It takes its transport, clock and entropy as options
  (`send(conn, text)`, `close(conn)`, `now()`, `randomBytes(n)`), an `empty()`
  callback and the room code, and is driven by `open`, `message` and `closed`
  per connection id and by `wake()`. It never throws on input: the decoders are
  total and every branch is total over decoded messages. The room code is
  passed in (the router draws it in P3). The token is the code, a dot and the
  base64url of 16 injected bytes, so `welcome` carries one that decodes. An
  optional observer (`matchStarted`, `stepped`) is the test's hook and is empty
  in production.
- **The loop.** `wake()` reads `now()` into a fixed-step accumulator with the
  client's epsilon: at most 5 steps per wake, a longer stall drops the backlog,
  and none while no match runs, so `now += 1000 / 60` gives exactly one step.
  Nothing in P2 calls a timer. The timer that calls `wake()` lands with the
  child process in P3.
- **Data.** `loadRoomData` reads `data/kits` (all of them, sorted by id, which
  is the roster order) and `data/arenas` through `parseArenaDef`, sorted by id.
  An arena's `maxTeamSize` is the smaller spawn count capped at 3, and an
  arena under 2 is left out.
- **Bot driver.** It stays in `server`, as the client's rule: the bot of
  champion `id` is `createBot(id, difficulty, matchSeed * 100 + id)`, and its
  record goes straight into the inputs array. The match seed is a uint32 from 4
  injected bytes, so `seed * 100 + id` is a safe integer.
- **Bot fill.** The open seats, in seat order, fill team A's missing places
  first and then team B's. Champion ids follow: team A's seats in seat order,
  then team B's. The n-th bot by id takes `roster[n % roster.length]`. A bot
  seat is named `Bot` in the `room` message.
- **Inputs.** The queue is 6 deep with the oldest dropped. A message with a
  `tick` at or below the last received is dropped. An empty queue repeats the
  last move and aim with the buttons cleared, and a seat that has not sent an
  input yet gets the sim's missing input (undefined, not a zeroed record). An
  `input` outside a match (the race after `matchEnd`) is dropped silently and
  counts as valid.
- **Host.** One rule, `moveHost` in `lobby.ts`, for every way a host goes: when
  the host's seat stops being a human's, the human in the lowest seat becomes
  host, or no one (`hostSeat` -1) when none is left. The paths are `leave` in the
  lobby, a closed socket in the lobby, the 20th bad message, `leave` during a
  match (the bot takes the seat and the host moves at once) and the end of a
  match that frees a disconnected seat. A host whose socket closes during a
  match stays host until the match ends (nobody can send `settings` then). If
  the only human leaves a running match there is no host, the match plays on and
  `empty()` is called at its end.
- **Bad messages.** The counter counts every `badMessage` answer after
  `welcome`: a codec failure, a `championId` or `arenaId` outside the lists, and
  an arena whose `maxTeamSize` is below the team size. Answers 1 to 19 are
  `fatal: false`, the 20th is `fatal: true` and then the seat closes (in the
  lobby that frees the seat, sends `room` and moves the host). Any other
  message resets the count to 0, including those refused with `notHost`,
  `notInLobby` or `teamFull`. Before `welcome`, any failure is fatal.
- **Snapshots.** `snapshotStateJson` once per snapshot, then `encodeSnapshot`
  per client with that client's `ack` and its pending batches. A pending batch
  holds a copy of the events, because `step` clears `state.events` in place.
  P2 has one pending list a client: the `congested` flag and the 120-tick close
  come with the router in P3.
- **What P2 does in place of P3 and P5.** `reconnect` as a first message is a
  fatal `badToken`. A socket closed during a match leaves the seat with the
  sim's missing input until the match ends, and the seat is freed then (no
  grace period and no takeover). `leave` during a match gives the seat to a
  bot for good. A second `createRoom` into a room that has a host is a fatal
  `badMessage` (the router never sends one). An empty lobby calls `empty()`; the
  IPC message that carries it is P3, and the close of a match nobody watches
  after 3600 ticks is P5, so until then a match whose humans are all gone plays
  on to its end.
- **Not built.** The energy orb: roster v3 says the online server sets
  `MatchConfig.energyOrb`, which does not exist yet, and the protocol's
  `matchStart` encoder copies only `teamSize`, `players` and `roundsToWin`. The
  orb package owns both.

## Tests

One line a layer
([section 12](../superpowers/specs/2026-10-17-online-design.md#12-test-strategy)):

- Protocol (the `protocol` Vitest project, built): every message encodes and
  decodes to itself and to one golden text, a real 3v3 on arena02 rebuilds to
  the server's `checksum` at every snapshot, and a table rejects each bound
  with its edge pair (size in UTF-8 bytes, aim, buttons, names in code points,
  room codes, tokens, the version and every server field).
- Server headless test (the `server` Vitest project, built in P2): `Room` on a
  loopback transport and a manual clock, from create and ready to `matchEnd`,
  with a checksum match at every snapshot. The reconnect rows are P5's.
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
