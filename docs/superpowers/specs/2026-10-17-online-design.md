# Claudeline Champions: the online design (milestone 6)

Date: 2026-10-17
Status: approved design (batch #134 decision 1), in implementation
Owner: Thomas Mueller (sv-tmueller)

This extends section 7 of the
[design spec](2026-10-01-claudeline-champions-design.md) for the first online
cut. The decision it rests on is
[batch #134 decision 1](https://github.com/sv-tmueller/claudeline-champions/issues/134#issuecomment-6232034441).
The short record is
[ADR-006](../../architecture/decisions/ADR-006-online-first-cut.md), and the
living reference is [online.md](../../architecture/online.md). Built so far:
packages P1, `protocol`, and P2, `server` (section 13). Where this file and the
code disagree after a package lands, fix the code or amend this file with a
dated line.

## 1. Intent and non-goals

Intent: one to six people play the existing 2v2 or 3v3 together through a
browser, on a server that stays authoritative, with bots filling the empty
seats. One server process serves many rooms. A room is found by a short code.
There is no matchmaking: someone creates a room and tells the others the code.

Non-goals of this cut:

- Accounts, queues, matchmaking and ratings (milestone 7).
- Docker and deployment. They are parked, because they are outward-facing and
  need the owner's decision on a host and its cost (package P9).
- Client-side prediction, delta snapshots, binary snapshots (milestone 6
  later packages, P6a, P6b and P7, behind the protocol version).
- Spectating (milestone 9) and pausing online (decided in section 2).
- Rate limits and abuse handling beyond the baseline in section 11.

## 2. Decisions and amendments

| Decision | Choice | Alternatives rejected |
|----------|--------|-----------------------|
| Process model | A router owns the one public WebSocket port and forks one child process per room | One process per room with the code as a secret (no second room without a second port); one process for every room (breaks section 7 of the design spec) |
| Transport | `ws` on Node, the browser's `WebSocket` in the client, JSON text frames | WebRTC or UDP (signalling, STUN and TURN); Socket.IO or Colyseus (a larger dependency and protocol surface) |
| Snapshots | Full-state JSON every third tick (20 Hz), the events in per-tick batches | Binary or delta first (harder to debug, no resync) |
| Rendering | 6 ticks behind the newest snapshot, through the existing interpolation | Prediction first (see section 9) |
| Prediction | None in this cut | Rollback in the first cut |
| Reconnect | A server-issued token, the seat held | none weighed |
| Pause | Online play never pauses | none weighed |
| Packages | `protocol` holds a pure codec, `client` imports `protocol` | Types-only `protocol` |

[ADR-006](../../architecture/decisions/ADR-006-online-first-cut.md) records the
choices and what was rejected. The decisions below are the ones the lead took
in [batch #134 decision 1](https://github.com/sv-tmueller/claudeline-champions/issues/134#issuecomment-6232034441).

**Process model.** A router process owns the public port and the room-code
table, and forks one child process per room with `node:child_process`. The
child runs that room's lobby and its matches, one match at a time. The router
relays the JSON text without parsing it after the first message of a
connection. The reconnect token starts with the room code, so the router routes
a reconnect without any state. The `Room` module holds no process and no
transport, so the headless test runs it in one process without forking. This
keeps section 7's one match per process, gives one port for a later
deployment, and confines a crash or a slow bot think to one room.

**Package rules.** An amendment to design spec sections 3.2 and 7, mirrored in
[packages.md](../../architecture/packages.md) and
[online.md](../../architecture/online.md). The rules are in section 3. The
types-only `protocol` was rejected: each side would duplicate the decoder, and
the round-trip test would test nothing real. CLAUDE.md is not edited. Its
pointer to design spec section 3.2 stays true, because the amendment line sits
under 3.2.

Amended 2026-10-20 by [batch #147 decision 4](https://github.com/sv-tmueller/claudeline-champions/issues/147#issuecomment-6274855460): when
`protocol` landed, three lines of CLAUDE.md read wrong and were edited, and
nothing else in it: the workspaces sentence, the typecheck comment and the
bullet about future packages. The pointer to section 3.2 stays. The segment
bans of `sim` and `bots` in `eslint.config.js` also name `protocol`, so a
relative path into it is red, which enforces the rules of section 3 and does
not change them.

Amended 2026-10-26 by
[batch #177 decision 3](https://github.com/sv-tmueller/claudeline-champions/issues/177#issuecomment-6417634639),
for package P2 (#167): when `server` landed, the same three lines of
CLAUDE.md read wrong again and were edited: the workspaces sentence, the
typecheck comment and the bullet about the future `server`. By
[batch #177 decision 4](https://github.com/sv-tmueller/claudeline-champions/issues/177#issuecomment-6417677008),
package P4a (#168) edited one line more, the bullet that says what `client`
imports, to name `protocol`. Nothing else in CLAUDE.md changed, and the
pointer to section 3.2 stays. The segment bans of `sim` and `bots` in
`eslint.config.js` also name `server`, so a relative path into it is red,
which enforces the rules of section 3 and does not change them.

**No pause online.** Escape opens the menu over the running match. The menu
offers Leave where a local match offers Restart. The lines in
[rules.md](../../design/rules.md#6-controls) and [client.md](../../architecture/client.md#menu-and-keybinding)
that said pausing online was decided in milestone 6 point here.

## 3. Package layout and rules

```
packages/protocol/   message types, PROTOCOL_VERSION, pure JSON codec
packages/server/     router, room, match loop, ws transport
packages/client/     gains the net core (socket, buffer, clock) and the
                     online screens; keeps the local mode
```

The file names inside a package are the package's own choice. The rules are
fixed here.

### protocol

- Holds the message types of section 6, `PROTOCOL_VERSION`, and pure JSON
  encode and decode with validation. No I/O, no transport, no game logic.
- Imports relative paths and `@claudeline/sim` only (types, and `Button` if it
  needs the bit values). It cannot import `bots`, so it declares its own
  `'easy' | 'normal' | 'hard'` union for the difficulty. One-way assignment
  to the `Difficulty` type of `@claudeline/bots` would miss a new bots tier, so
  package P2 adds a two-way check in the server: a type that is `true` only
  when each union is assignable to the other, used in a declaration that fails
  to compile otherwise.
- Lint (a `packages/protocol/src/**` block in `eslint.config.js`): the import
  patterns of the bots block with `@claudeline/sim` as the one allowed package,
  the relative-path bans of the sim and bots blocks, no dynamic `import()` and
  no `import()` types, the sim's host bans (the globals `Date`, `performance`,
  `setTimeout`, `setInterval`, `window`, `document`, `fetch`, and the
  properties `Math.random`, `Date.now`, `performance.now`) and no Node
  built-ins. It does not get the sim's math ban, `**` ban or `noInlineConfig`,
  because the codec is not part of the determinism contract.
- Tests (`packages/protocol/test/**`): relative paths, `@claudeline/sim` and
  `vitest` only.
- tsconfig: extends `tsconfig.base.json` with `lib: ["ES2023"]`,
  `types: []` and `erasableSyntaxOnly`. The first two are sim's and bots',
  so any other browser or Node global is a type error. The server loads
  `protocol` from source through Node's type stripping (see server below), so
  syntax that needs a transform, an `enum` or a `namespace`, would fail at
  runtime: `ErrorCode` is a union of string literals.

### server

- Imports `@claudeline/sim`, `@claudeline/bots`, `@claudeline/protocol`, `ws`,
  `node:` built-ins and relative paths. It never imports `client`. It has Node
  globals and may read the wall clock.
- Lint (a `packages/server/src/**` block): its own import allowlist (the
  `balance` block's regex is the model, since `node:` is a prefix and not a
  package name), the relative-path bans, no dynamic `import()`. The
  `Date`, `performance` and timer bans are not applied.
- tsconfig: `lib: ["ES2023"]`, `types: ["node"]`, `erasableSyntaxOnly`. The
  server runs from its TypeScript source through Node's type stripping and a
  resolve hook, like `tools/balance/register.ts`, which needs Node 22.15 or
  later, as the `engines` field already requires. There is no build step.
- `tools/balance/register.ts` completes extensionless relative imports only
  inside the sim and bots source trees. The two new source trees join that
  list when the server first runs (package P3), or the hook moves to a shared
  path. Workspace packages resolve to their real path under `packages/`, not
  under `node_modules`, which is why type stripping accepts them today.

Amended 2026-10-26 for package P2 (#167): the server source block allows
relative paths, `node:` built-ins and exactly the entry points of
`@claudeline/sim`, `@claudeline/bots` and `@claudeline/protocol`, and the
segment ban on relative paths names `sim`, `bots`, `protocol` and `client`.
`ws` is not in the list: it joins with package P3, which adds the dependency,
and the lint row "server imports ws" is red until then. The source and test
blocks have the Node globals, and the test block adds `vitest`.

### client

- Imports `@claudeline/sim`, `@claudeline/bots` and `@claudeline/protocol`. It
  never imports `server`.
- `eslint.config.js` has no import rule for the client today, although
  packages.md says lint enforces the boundaries. Package P1 adds a
  `packages/client/**` block with two rules. A `no-restricted-imports` pattern
  denies `@claudeline/server` and any relative path with a `server` segment
  (the form of bots' `relativeIntoSim`, `^\.{1,2}/(.*/)?server(/|$)`). A
  `no-restricted-syntax` selector denies a dynamic import of the same
  sources: `ImportExpression[source.value=/<the same alternatives>/]`, and a
  `TSImportType` selector on `argument.literal.value` for `import()` types.
  The client keeps its one dynamic import, `main.ts`'s dev-only debug shot,
  because the selector anchors on the `server` segment: a trial of the two
  selectors on `import('./debug-shot')` and `import('./observer')` passes, and
  `import('@claudeline/server')`, `import('../../server/src/room')` and an
  `import()` type of `@claudeline/server` fail. The cost, as for bots and
  `sim`: a client file cannot be named `server`, so package P4a names its
  socket file otherwise.

Amended 2026-10-20 by [batch #147 decision 4](https://github.com/sv-tmueller/claudeline-champions/issues/147#issuecomment-6274855460), for
package P1: the `import()` type selector reads `source.value`, as the
`ImportExpression` selector does, and not `argument.literal.value`, because
typescript-eslint 8.71 deprecates `argument` on `TSImportType` in favour of
`source`. Both match today; the trial above holds for it.

### bots and sim

Unchanged. Nothing in this design weakens a `sim` or `bots` rule.

### Wiring

- Vitest gets the projects `protocol` and `server`, with the same `include`
  shape as `sim` (`packages/<name>/test/**/*.test.ts`).
- `npm run typecheck` gains `tsc -p packages/protocol` and
  `tsc -p packages/server`.
- `tests/lint-boundaries.test.ts` gains rows for each new block. Each rule has
  a firing row and an allowed row, as the existing ones do.
- `npm run server` starts the router from source. The default port is 8787 and
  the default host is `127.0.0.1`; `PORT` and `HOST` override them (defaults,
  see the table in section 4). 8787 is a port no other command of this repo
  uses: Vite holds 5173 with `strictPort` in `packages/client/vite.config.ts`,
  and the e2e server must run beside it.

## 4. The process model

```
browser --ws--> router (one port, the room-code table)
                  |  fork + IPC, one per room
                  +--> room child A (lobby, then a match, then the lobby)
                  +--> room child B
```

**Router.** It accepts a WebSocket and waits for the first message (at most 5 s,
a default). It decodes that message with the `protocol` codec and routes it:

- `createRoom`: draws an unused room code, forks a child for it, and hands the
  connection to the child. The server has a cap on rooms (a default, 16); beyond
  it the answer is `roomFull`.
- `joinRoom`: looks the code up in the table, `roomNotFound` if absent.
- `reconnect`: takes the room code from the front of the token and routes the
  same way, with no state of its own.

After that first message the router relays the text of each message between
the socket and the child's IPC channel without parsing it. The size limit of
section 6 is enforced at the socket (`ws` `maxPayload`), so a relayed message
is already bounded. The router removes a room from its table when the child
exits or reports that the room is empty.

IPC messages between router and child are internal, not part of `protocol`:
`open`, `text` and `close` per connection id in both directions, a `congested`
flag from the router per connection (section 8), and `empty` from the child.

**Child.** It runs a `Room` and a loop. `Room` takes its transport, its clock
and its entropy as injected parameters (`send(conn, text)`, `close(conn)`,
`now()`, `randomBytes(n)`), so the headless test drives it with a loopback and
a manual clock, in one process.

**Loop.** A fixed-step accumulator at 60 Hz on the wall clock, the same idea as
the client's `createFixedStepClock`: at most 5 steps per wake, and a longer
stall drops the backlog instead of catching up. The loop runs only while a
match runs. In the lobby the child only reacts to messages.

**Order within a tick**, per match tick:

1. Take one queued input per human seat (section 7). A seat that is
   disconnected within its grace period gets none (the sim's missing input).
2. Bots think for the bot seats and for human seats a bot has taken over. The
   bot's returned record goes straight into the inputs array, as
   `packages/client/src/bot-driver.ts` does, because `step` copies it. Only a
   recorder of the input stream copies it. Moving that driver into `bots` is an
   option for package P2.
3. `step(state, inputs)`.
4. If the step produced events, add a batch `{ tick, events }` to the pending
   list of every connected client. A tick with no events adds nothing.
5. On every third tick (`state.tick % 3 === 0`), and on the tick that produced
   `matchEnded`, send each client one snapshot with its pending batches
   (section 8).

Amended 2026-10-26 for package P2 (#167): the loop is the `wake()` method of
`Room`, which reads an injected `now()` into the accumulator and runs the
steps owed. Nothing in P2 calls a timer. The timer that calls `wake()` lands
with the child process in package P3.

The match ends when the step emits `matchEnded`. The room then sends
`matchEnd` after that final snapshot and returns to the lobby (section 5).

### Defaults a package may tune

The numbers marked "a default" in this design are starting values, not
decisions. The architecture does not depend on any of them. The package that
owns one may change it, with the new value and its reason written into this
table in the same pull request, and no amendment line is needed. Fixed by the
decision and not defaults: the 60 Hz tick, a snapshot every third tick
(20 Hz), the render delay of 6 ticks, and the address parameters of
section 9.

| Default | Value | Reason | Owner |
|---------|-------|--------|-------|
| Rooms per server | 16 | each room is one Node process, so the cap bounds processes and memory until a deployment measures them | P3 |
| First message | within 5 s | a socket that never speaks would hold a slot | P3 |
| Idle close | 30 s without a message | frees a dead socket; the 5 s ping keeps a lobby socket alive with margin | P3 |
| Client ping | every 5 s | keepalive and the round trip for the HUD | P4c |
| Bad messages | the 20th in a row closes | a buggy or hostile client stops costing parse time | P2 |
| Client message size | 1024 bytes | about ten times the largest `input` (104 characters), set as `ws` `maxPayload` | P1, P3 |
| Aim range | integers from -100 000 to 100 000 cm, both included | far outside any arena (tens of meters) and the sim does not clamp aim, so the decoder bounds it | P1 |
| Input queue | 6, oldest dropped | 6 ticks is 100 ms of input: more adds latency, fewer drops inputs on jitter | P2 |
| Congestion | 64 KB `bufferedAmount` (about 20 snapshots at the mean of 3222 B, about 8 at the largest of 8065 B), polled every 100 ms, closed after 120 ticks (2 s) of pending batches | skipping snapshots keeps the stream current; a longer backlog means the client cannot keep up | P3 (router), P2 (pending list) |
| Grace | 600 ticks (10 s) | long enough for a network blip, short enough that allies do not wait on a frozen champion | P5 |
| Empty room | closed after 3600 ticks (60 s) with no connected human | a match nobody watches should not run on | P5 |
| Reconnect backoff | 0.5 s doubling to 4 s, given up after 60 s | the same 60 s as the empty-room close, so retrying past it is pointless | P5 |
| Compression | `permessage-deflate` off | costs CPU on the 60 Hz loop; the mean stream is about 64 KB/s. Revisit when P2 has measured server CPU | P3 |
| Port and host | 8787, `127.0.0.1` | section 3 | P3 |
| Name length | 1 to 16 code points after trimming | fits a lobby row, and a message well under the size limit | P1 |
| New room | team size 2, the first arena by id with two spawns a team, difficulty `normal` | the smallest match; the host changes it with `settings` | P2 |

Amended 2026-10-26 by [batch #177 decision 4](https://github.com/sv-tmueller/claudeline-champions/issues/177), for package P4a: the owner of the client ping moves from P4a to P4c. The P4a row of section 13 never listed the ping, and its first user is the lobby keepalive of P4c, since inputs keep a match connection busy. The value and the reason are unchanged.

## 5. The lobby and the ready flow

- **Room code.** Five characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`: the
  letters and digits without 0, O, 1, I and L (31 characters, 28 629 151
  codes). Drawn by the router with `node:crypto` and rejection sampling, so no
  character is likelier than another. A collision with a live room draws
  again.
- **Seats.** A room has twice the team size in seats, numbered from 0. A seat
  is open, a human or a bot. A seat has a team once someone sits in it. A
  joiner takes the lowest open seat.
- **Host.** The creator is the host. If the host leaves, the human in the
  lowest seat becomes host. A lobby with no human closes and its child exits
  (a running match follows section 10).
- **Settings.** `{ teamSize, arenaId, difficulty }`, set by the host in the
  lobby. `teamSize` is 2 or 3, `arenaId` names an arena in the server's
  `data/arenas` with enough spawns for the team size, and `difficulty` is
  `easy`, `normal` or `hard`. `roundsToWin` is 3 (the sim's
  `DEFAULT_ROUNDS_TO_WIN`) and has no field in the message: a `Room` option
  overrides it in tests only. A new setting resets every ready flag. A
  `teamSize` change is refused with `teamFull` unless the humans still fit:
  each team has at most the new `teamSize` humans and no human sits in a seat
  numbered twice the new `teamSize` or higher (lowering 3 to 2 with a human in
  seat 4 or 5 is refused). Seats are never renumbered, so the `seat` in
  `welcome` stays the client's seat. The way out for a human in seat 4 or 5 is
  to `leave` and `joinRoom` again, which takes the lowest open seat; a lone
  human there closes the lobby by leaving and creates a new room.
  A new room opens on defaults, team size 2, the first arena by id that has
  two spawns a team and difficulty `normal` (section 4), and the host changes
  them with `settings` after `welcome`. `createRoom` carries no settings,
  because it is sent before `welcome` brings the server's `arenas`, and an id
  outside them is a fatal `badMessage` there.
- **Lists.** The lobby needs the roster and the arenas before any match, and
  `matchStart` comes too late. `welcome` carries them: `roster` is the champion
  ids in roster order, and `arenas` lists each arena with its name and the
  largest team size it has spawns for. The server is the authority on data, as
  with `matchStart`: a client built from older data cannot offer a choice the
  server would refuse, and one list has one source. A `championId` or
  `arenaId` outside the lists is `badMessage`; no further error code is
  needed. The client keeps its bundled models and look data for drawing, and an
  id it cannot draw is a client defect for P4c, not a protocol case.
- **Choices.** A human picks a team (A or B, at most `teamSize` humans a team)
  and a champion from `roster`. Duplicates are allowed, as in local
  play. A new joiner starts on the team with fewer humans (A on a tie) with
  the first champion in `roster`, which is the kit ids sorted, as `main.ts`
  sorts them. A change of team or champion resets that human's ready
  flag.
- **Ready.** The match starts as soon as every human in the room is ready and
  there is at least one.
- **Bot fill.** At the start, each team's open places fill with bots: the
  n-th bot, counting in champion id order, takes the n-th champion in roster
  order, wrapping. Bots play at the room's difficulty and are seeded
  `seed * 100 + championId`, as the client's `createBotDriver` does, from a
  match seed the server draws with `node:crypto`. The seed is not sent.
- **Ids.** `createMatch` takes `players[i]` as champion id `i`. The server
  lists the team A seats in seat order, then team B, and the position in that
  list is the champion id. `matchStart.you` is the receiving human's id.
- **Countdown.** The match starts at once. The sim's 3 s warmup
  (`WARMUP_TICKS`, 180 ticks) is the countdown, and champions cannot move in
  it. A joiner cannot take a seat in a running match (`matchRunning`).
- **After the match.** The room returns to the lobby with ready reset,
  keeping the settings and each human's choices. Humans who were disconnected
  at the end lose their seats.

The flow, message by message. Lobby (every row is one message from section 6):

| Step | From | Message |
|------|------|---------|
| Create | client | `createRoom` (no settings; the host sends `settings` after `welcome`) |
| | server | `welcome` (with `roster` and `arenas`), then `room` |
| Join | client | `joinRoom` |
| | server | `welcome` to the joiner, `room` to everyone |
| Failed first message | server | `error` (fatal), then the socket closes |
| Choose | client | `select` |
| Change settings | host | `settings` |
| Ready up | client | `ready` |
| | server | `room` to everyone after each of the three above |
| Refused | server | `error` (`notHost`, `notInLobby`, `teamFull`, `badMessage`) |
| Keepalive | client | `ping`; server: `pong` |
| Leave | client | `leave`; the server frees the seat, sends `room`, closes |

Match:

| Step | From | Message |
|------|------|---------|
| Start | server | `room` with `phase: 'match'` and the bots in their seats, then `matchStart` to each human |
| Play | client | `input`, one per sampled tick |
| | server | `snapshot` every third tick |
| End | server | the final `snapshot`, then `matchEnd`, then `room` with `phase: 'lobby'` |
| Leave | client | `leave`; a bot takes the seat for good |

The reconnect rows are in section 10.

## 6. The messages

Every message is one JSON object in one text frame, with a type field `t`.
The first message of a connection carries `v`, the protocol version
(`PROTOCOL_VERSION`, 1 at first). Later messages do not. Binary frames are
`badMessage`.

The types, for the codec to implement (TypeScript, from `@claudeline/sim`
where the names are the sim's):

```ts
type Difficulty = 'easy' | 'normal' | 'hard';
interface RoomSettings {
  teamSize: 2 | 3;
  arenaId: string;
  difficulty: Difficulty;
}
interface ArenaListing {
  id: string;
  name: string;
  maxTeamSize: 2 | 3;                // 3 only with three spawns a team
}
interface SeatInfo {
  seat: number;                      // 0 to 2 * teamSize - 1
  team: TeamId | null;               // null while the seat is open
  kind: 'open' | 'human' | 'bot';
  name: string;                      // '' while open
  championId: string | null;         // null while open
  ready: boolean;                    // false for open and bot seats
  connected: boolean;                // false for open and bot seats
}
type SnapshotState = Omit<GameState, 'arena' | 'kits' | 'events'>;
interface EventBatch { tick: number; events: SimEvent[] }
```

Client to server:

| `t` | Fields | When |
|-----|--------|------|
| `createRoom` | `v: number`, `name: string` | first message |
| `joinRoom` | `v: number`, `roomCode: string`, `name: string` | first message |
| `reconnect` | `v: number`, `token: string` | first message |
| `select` | `team: TeamId`, `championId: string` | lobby |
| `settings` | `settings: RoomSettings` | lobby, host only |
| `ready` | `ready: boolean` | lobby |
| `input` | `tick: number`, `input: PlayerInput` | match |
| `leave` | none | any time after `welcome` |
| `ping` | `id: number` | any time after `welcome` |

`PlayerInput` is the sim's record
(`packages/sim/src/input.ts`): `moveX` and `moveY` are -1, 0 or 1, `aimX` and
`aimY` are the aim point in whole centimeters, and `buttons` is the bitmask of
`Button` (M1 1, M2 2, SPACE 4, Q 8, E 16, R 32, F 64, SHIFT 128, so 0 to 255).
`TeamId` is `'A' | 'B'`. `tick` is a non-negative integer.

Server to client:

| `t` | Fields | When |
|-----|--------|------|
| `welcome` | `v: number`, `roomCode: string`, `seat: number`, `token: string`, `roster: string[]`, `arenas: ArenaListing[]` | answers `createRoom`, `joinRoom` and `reconnect` |
| `room` | `roomCode: string`, `phase: 'lobby' \| 'match'`, `hostSeat: number`, `settings: RoomSettings`, `seats: SeatInfo[]` | after `welcome`, then on every change |
| `matchStart` | `you: number`, `config: MatchConfig`, `arena: ArenaDef`, `kits: KitDef[]`, `snapshotEvery: 3`, `renderDelay: 6` | match start, and on a reconnect during a match |
| `snapshot` | `tick: number`, `ack: number`, `state: SnapshotState`, `events: EventBatch[]` | every third tick |
| `matchEnd` | `winner: TeamId`, `scoreA: number`, `scoreB: number` | after the final snapshot |
| `error` | `code: ErrorCode`, `fatal: boolean` | on a refused message |
| `pong` | `id: number`, `tick: number` | answers `ping` |

`you` is the receiving human's champion id. `arena` is the match's
`state.arena` and `kits` its `state.kits`, exactly (see "Data once" below).
`roster` is the champion ids in roster order and `arenas` the arenas the server
will accept, so the lobby choices come from the server (section 5, Lists).
`MatchConfig`
(`packages/sim/src/state.ts`) is `{ teamSize: 2 | 3, players: PlayerConfig[],
roundsToWin?: number, energyOrb?: { x: number, y: number } }`, and the server sends `roundsToWin: 3`
(amended 2026-10-31 by [#218](https://github.com/sv-tmueller/claudeline-champions/issues/218): and,
from the server package's step 2.2, the orb point of the arena, so `matchStart.config` carries it
and the server stays the authority on data; an absent key stays absent). `ack` is the
last input `tick` the server applied for that client, -1 before the first
(section 7). `pong.tick`
is the server's `state.tick`, 0 in the lobby.

Error codes (`ErrorCode`):

| Code | Meaning | Fatal |
|------|---------|-------|
| `version` | the first message's `v` is not the server's | yes |
| `badMessage` | not JSON, an unknown `t`, a wrong field type or value (a `championId` or `arenaId` outside the server's lists included), over the size limit in the codec, a non-text frame, or a message sent before `welcome` that is not a first message | before `welcome`; after it only on the twentieth in a row |
| `roomNotFound` | no room has that code | yes |
| `roomFull` | the room has no open seat, or the server is at its room cap | yes |
| `matchRunning` | `joinRoom` for a room that is playing | yes |
| `badToken` | `reconnect` with a token no seat holds | yes |
| `notHost` | `settings` from a non-host | no |
| `notInLobby` | `select`, `settings` or `ready` during a match | no |
| `teamFull` | `select` or `settings` that would put more humans on a team than it has places, or a lower `teamSize` with a human in a seat that would no longer exist (section 5) | no |

"Fatal" means the server sends the `error` and closes the socket. `teamFull`
is a team with no place left, which is not a full room, so it has its own
code.

Further rules:

- **Rounds and match events.** `roundStarted`, `suddenDeathStarted`,
  `roundEnded` and `matchEnded` travel in the snapshot's event batches with
  every other `SimEvent`. The table of events is in
  [simulation.md](../../architecture/simulation.md#state-and-api-surface); this
  design does not copy it, so it cannot go stale. `matchEnd` repeats the result
  of `matchEnded` for the client that has not read the batches.
- **Keepalive.** A client pings every 5 s (a default), so the idle rule of
  section 11 does not close a lobby connection. During a match the inputs keep
  it busy.
- **Data once.** `matchStart` carries the arena and the kits once, so the
  server is the authority on data and client and server cannot hold different
  kit versions. What it carries is exactly `state.arena` and `state.kits` of
  the match: `createMatch` keeps a copy of the arena and only the kits the
  players use, in the order they were given (`packages/sim/src/match.ts`), and
  the server gives it all its kits sorted by id. `checksum` covers both, so
  a client given the raw files, every kit, or another order could not
  rebuild the server's checksum. The measured 8303 B is for these.
- **Limits.** A client message is at most 1024 bytes (a default). An `input` is
  at most about 105 bytes (104 characters for a seven-digit `tick` and six-digit
  aim values), so the limit leaves room for a name and a token. `ws` closes an
  oversize frame itself with code 1009. `name` is 1 to 16 code points after
  trimming (a default), without control characters (U+0000 to U+001F and
  U+007F to U+009F). `roomCode` is five characters of the alphabet in section
  5. `token` is a room code, a dot and 22 base64url characters.
- **Validation.** The server's decoder checks every field of every client
  message against its type and range (`aimX` and `aimY` are integers from
  -100 000 to 100 000 cm, both included, a default, and `buttons` an integer
  from 0 to 255), keeps only the known fields, and builds a fresh object, so an
  extra field or a `__proto__` key reaches nothing. An invalid message is
  answered with `error` and ignored, never thrown on. The client's decoder
  checks the envelope and the scalar fields of each server message, and not the
  inside of `state`, `arena` and `kits`: the server is the authority on them.
- **Version.** One integer, `PROTOCOL_VERSION`. A server and a client with
  different versions refuse each other with `version`. Delta snapshots (P7)
  bump it.

## 7. Inputs

- `input.tick` is the client's input counter: 0 at `matchStart`, then one more
  for each sampled tick, and one message per sampled tick. It is not the
  server's tick. The client samples at 60 Hz, the rate of its fixed-step loop.
- The server keeps a FIFO per human seat, capped at 6 (a default), the oldest
  dropped. It drops any message with a `tick` at or below the last one received
  for that seat, so a duplicate or a reordered message does nothing. The mark
  starts at -1 at `matchStart`, and a `reconnect` resets it to -1, empties the
  queue and resets `ack` to -1, because the returning client counts from 0
  again (section 10); without the reset every input below the old mark would
  be dropped as stale.
- Each server tick takes one input from the queue. When the queue is empty, the
  server repeats the last move and aim with the buttons cleared, so a late
  packet does not stop a running champion and does not fire again.
- A seat with no connection inside its grace period gets no input at all (the
  sim's missing-input rule: no movement, no buttons, the aim unchanged).
- The seat comes from the connection. No message names a seat, so a client
  cannot send input for another champion. The sim's `resolveInput` sanitizes
  each input again.
- `ack` is the last input `tick` applied for that client, -1 before the first.
  Nothing reads it in this cut. It costs a few bytes and prediction (P6a and
  P6b) needs it to know which inputs the snapshot already contains.

## 8. Snapshots

- **Cadence.** Every third tick, 20 Hz, and once more on the tick of
  `matchEnded`. After a `matchStart` that follows a reconnect, one snapshot
  goes out at once.
- **Content.** `state` is `GameState` without `arena`, `kits` and `events`
  (`SnapshotState`). `GameState` is plain JSON, and the whole of it survives a
  JSON round trip. The client rebuilds the server's `GameState` from exactly
  three parts: the snapshot's `state`, the match's `state.arena` and
  `state.kits` as `matchStart` sent them (section 6, Data once), and the
  events of that tick, because `checksum` covers `state.events`: they are the
  last batch when its `tick` is the snapshot's, else an empty list. With those
  three the rebuilt state has the server's `checksum`; with the tick's events
  left out, 516 of 2448 snapshots of the arena02 run below did not match.
- **Off cadence.** The snapshot a returning client gets at once (section 10) is
  not on a third tick. Its pending list starts with the batch of the tick just
  stepped, when that tick had events, so the rule above holds for it too.
- **Events.** `events` holds the batches since the client's last snapshot, each
  tick exactly once and in tick order: up to three batches, one for each tick
  since the last snapshot that had events, and more after a skipped snapshot.
- **Cost.** The server serializes `state` once per snapshot and splices the
  string into each client's envelope, which differs by `ack` and `events`.
- **Backpressure.** The router measures each socket's `bufferedAmount` as it
  relays and every 100 ms, and tells the child (`congested`) when it crosses
  64 KB (65 536 B), which is about twenty snapshots at the mean message of
  3222 B and about eight at the largest measured, 8065 B. While a client is
  congested the child skips that client's snapshots and keeps its batches for
  the next snapshot it gets. A client with more than 120 ticks (2 s) of pending
  batches is closed and treated as a disconnect (section 10). The threshold,
  the poll and the 120 ticks are defaults (section 4).

Measured sizes. Method: a scratch script, run on the shipped sim, bots and
data with `node --experimental-strip-types --import
./tools/balance/register.ts`. It plays a 3v3 with the bots stepping the sim
(`createMatch` with `roundsToWin: 3`, bot of champion `id` seeded
`100 * seed + id`), builds the message of section 6 at every third tick
(`JSON.stringify`, measured in UTF-8 bytes, the `state` without `arena`, `kits`
and `events`, and only the ticks that had events in `events`) and plays until
`matchEnd`. Run 1: arena01, Hargrim, Quillon and Lumeth each side, normal
bots, seed 1: 19 530 ticks, 6510 snapshots. Run 2: arena02, the same
roster, hard bots, seed 7: 4215 ticks, 1405 snapshots. Run 3: arena02,
Skerrow, Quillon and Lumeth each side, hard bots, seed 7: 7346 ticks, 2448
snapshots (the match of the round trip below).

| What | Run 1 mean / max | Run 2 mean / max | Run 3 mean / max |
|------|------------------|------------------|------------------|
| `state` | 2829 / 5042 B | 2731 / 4675 B | 2797 / 5225 B |
| Event batches | 334 / 2341 B | 240 / 2260 B | 268 / 3458 B |
| Whole `snapshot` message | 3222 / 6366 B | 3029 / 6168 B | 3123 / 8065 B |
| `arena` and `kits`, sent once | 8303 B | 8537 B | 8126 B |

At 20 Hz the mean per client is about 64 KB/s in run 1, 61 KB/s in run 2 and
62 KB/s in run 3. The largest single message in the three runs is 8065 B (run
3), which at 20 Hz would be 161 KB/s if every snapshot were that large. Three
runs of one roster of four are a sample, not a bound: a snapshot grows with
the entities in play, so package P2 measures again with the roster to six
champions and the later kits. A client sends at most 60 `input` messages a
second at about 105 B, 6.3 KB/s. `permessage-deflate` is off in this cut (a
default, section 4), since it costs CPU on a 60 Hz loop. Server CPU is not
measured in these three runs: package P2 measured a tick with six seats, below.

Measured 2026-10-26 by package P2 (#167), with the roster at six champions, on
the shipped `Room`. Method: a scratch Vitest file, not committed, drives `Room`
on the loopback transport with the manual clock. Six scripted humans, three a
team, each pick a different champion of the six kits (`matchStart` then holds
all six), `roundsToWin` 3, hard difficulty. Sizes are of the snapshot message of
section 6, in UTF-8 bytes, as the three runs above measured them. Run 4:
arena01, 12 137 ticks, 4046 snapshots. Run 5: arena02, 23 772 ticks, 7924
snapshots. The humans are scripts that walk at an enemy and press slots, not
bots, so these runs are a sample, as the first three are, and not a bound.

| What | Run 4 mean / max | Run 5 mean / max |
|------|------------------|------------------|
| `state` | 2767 / 5440 B | 2817 / 6029 B |
| Event batches | 253 / 2661 B | 442 / 3102 B |
| Whole `snapshot` message | 3078 / 6590 B | 3318 / 7384 B |
| `arena` and `kits`, sent once | 15 772 B | 16 006 B |

Six kits do not grow the snapshot: the mean is 3.1 to 3.3 KB (3.0 to 3.2 KB
with three kits) and the largest message 7384 B, below the 8065 B of run 3.
The per-client stream is about 62 to 66 KB/s on average, and 148 KB/s if every
snapshot were the largest. `arena` and `kits` roughly double with the six kits,
from 8.1 to 8.5 KB to 15.8 to 16.0 KB, once per match and once per reconnect.

Server CPU, in the same runs: the time of one `wake()` that runs one step, that
is think, `step`, the copy of the events and, on every third tick, the snapshot
encoding for each client; the transport is not in it. Apple M5 Pro, Node 22.23.
With six humans (no bot think, six encodings a snapshot): a mean of 0.049 ms
(run 4) and 0.059 ms (run 5) a tick and a 99th percentile of 0.19 and 0.24 ms.
With one human and five hard bots on the same arenas (3147 and 3347 ticks): a
mean of 0.093 and 0.078 ms and a 99th percentile of 0.75 and 0.81 ms. The
largest single tick in the four runs was 50 ms, an isolated outlier (the 99th
percentile of the same run is 0.24 ms), not a steady cost. A tick has 16.7 ms, so the
99th percentile of the worst case is under 5 percent of it, and one core holds
several rooms. The loop is far from busy, so CPU is no reason to turn
`permessage-deflate` on. The default stays off: the cost of deflate itself was
not measured here, and the stream of about 66 KB/s a client is the number a
deployment weighs (package P3).

Round trip. A second script plays a 3v3 with a different roster (Skerrow,
Quillon and Lumeth each side), builds the snapshot message at every third tick,
parses it, rebuilds the state as above (the arena and kits copied once at the
start, the events of the tick from the batches) and compares its `checksum` with
the server's. Arena02, hard bots, seed 7 (run 3): 2448 snapshots up to
`matchEnd` at tick 7346, 0 mismatches. Arena01, normal bots, seed 1: 3674
snapshots, 0 mismatches. The scripts are scratch files and are not committed;
the headless test of section 12 holds the same check.

## 9. Client rendering

- **Render tick.** The estimated server tick minus 6 (`renderDelay`, 100 ms).
  Six ticks are two snapshot gaps, so one late snapshot is absorbed. The
  estimate is the newest snapshot's tick plus the time since it arrived,
  corrected gently toward each later arrival and never moving backward. Pings
  give the round trip for the HUD only.
- **Buffer.** The client keeps the last few snapshots. The render tick falls
  between a snapshot A and the next one B, and the existing
  `interpolatePoses`, and the projectile and area views, read an
  `AlphaClock`-shaped record, `{ alpha }`, with
  `alpha = (render tick - tick A) / (tick B - tick A)`. If no newer snapshot
  has arrived, the client holds the newest and does not extrapolate.
- **Events.** A batch is released when the render tick passes its tick, so a
  hit lines up with the projectile drawn. `routeEvents` and `routeSounds`
  read `state.tick` and `state.events`, so the net core feeds them a state
  whose events are the batch being released.
- **No prediction.** The local champion is drawn like every other. The cost,
  stated: input reaches the screen after a round trip plus about 100 ms.
- **Menu.** Escape opens the menu over the running match with no pause, and the
  menu offers Leave where a local match offers Restart. Leave sends `leave` and
  returns to the online start screen.
- **Address.** `?server=<ws or wss address>` selects online mode, `&room=<code>`
  joins that room instead of creating one, and `&name=<name>`. The look of the
  lobby screen follows the pre-match screen the local client gets; this design
  fixes the flow and the parameters only. Names are written with `textContent`.
  The lobby screen and the address are package P4c. Until then the online
  match path of P4b is reached only by its check: a client unit that drives
  the online start through a fake transport with a scripted snapshot
  sequence, and asserts the local id, the hooks and what the draw gets.
- **Assumptions packages P4a and P4b must remove.** The client has them today,
  from the local match. Each is assigned to the package that does the work
  (the sizes are in section 13):
  - `HUMAN_ID = 0` in `main.ts`: the human is champion 0, on team A. Online
    the local player can be any champion id on either team (`matchStart.you`).
    The projectile and area colours, the health bars, the HUD and the sound
    routing already take the local team or id as a parameter, but `main.ts`
    fills each from `HUMAN_ID` or `human.team`. P4b.
  - The `data-p0x`, `data-p0y` and `data-f0` hooks read champion 0. The e2e
    online row needs them for the local champion. P4b writes them for the
    local id, and P4c's e2e reads them.
  - The HUD score reads A : B (`scoreIndex(roundsToWin, scoreA, scoreB)`)
    whichever team the local player is on. Online it must read the local team
    first, or label the sides. P4b.
  - `updateAnims` reads the drawn time as `(state.tick + clock.alpha) / 60`
    from one state, and the poses come from the previous and the current
    state, one tick apart. Online the two states are a snapshot gap (three
    ticks) apart, so the drawn time must come from the render tick, not from
    `state.tick` and an alpha. `champion-anim.ts` has no DOM and is counted by
    the heap probe, so P4a changes it to take a drawn-time record and tests
    it with the render clock.
  - The entity views take previous positions from `capture`, called before a
    step, and current ones from `sync`, called after it, by entity id. Online
    the two calls get snapshot A and snapshot B, three ticks apart. An entity
    only in B gets a slot where B has it and does not move in between, and a
    projectile that lived and expired between two snapshots is never drawn,
    though its events still release. P4b feeds the views from the buffer P4a
    builds.
  - `main.ts` owns the fixed-step loop, the bots and the sim, in about 450
    lines. Online there is no sim in the client: the loop only samples input,
    sends it and draws. P4b splits the start-up into a local path and an
    online path that share the scene, HUD and draw code.
  - The menu's Restart and its pause. P4b: online, Escape opens the menu
    over the running match and Leave replaces Restart.
- **Heap probe.** The online receive path (`JSON.parse` per message) is outside
  the heap probe in this cut. The draw path that online shares with the local
  scenes stays counted there.

## 10. Reconnect

- **Token.** 16 random bytes from `node:crypto`, base64url (22 characters),
  prefixed with the room code and a dot. It is in `welcome`. The client keeps
  it in memory, so a page reload is a new join and, in a running match, gets
  `matchRunning`.
- **Held seat.** When a human's socket closes during a match, the seat stays.
  For a grace period of 600 ticks (10 s) the champion gets the sim's missing
  input and stands still. After that a bot drives the seat until the player
  returns. A room with no connected human for 3600 ticks (60 s) closes. The
  600 and 3600 ticks are defaults (section 4), owned by package P5.
- **Client.** It retries with backoff, 0.5 s doubling to 4 s, for 60 s (the
  same defaults table), and gives up on `badToken`. The retry sends
  `reconnect` with the token.
- **Lobby.** A disconnect in the lobby frees the seat at once, and the token
  dies with it, so a reconnect there is answered `badToken` and the client
  returns to the join screen.
- **Replacement.** A new socket on the same token closes the old one. The
  token dies with the room, on `leave`, and when a match ends for a human who
  was away.

| Step | From | Message |
|------|------|---------|
| Return | client | `reconnect` |
| | server | `welcome` with the same token and seat, and `roster` and `arenas` |
| | server | `room` |
| In a match | server | `matchStart`, then at once one `snapshot` |
| Bad token | server | `error` (`badToken`, fatal) |
| Room gone | server | `error` (`roomNotFound`, fatal) |

The returning client's input counter starts at 0 again. On `reconnect` the
server resets the seat's last-received input tick and its `ack` to -1 and
empties its queue (section 7), so the new counter is not dropped as stale. The
`matchStart` it gets is the same data as the first time (the match's
`state.arena` and `state.kits`), with the current state arriving in the
snapshot that follows, whose `events` start with the batch of the tick just
stepped (section 8).

## 11. Security baseline

- Server authority: the clients send inputs and nothing else about the game.
  No client-trusted state, and no hidden information to leak, because the game
  has none and the bots read the full state too.
- Every message is validated and size-capped (section 6). Twenty invalid
  messages in a row (a default) close the connection. The sim's `resolveInput`
  sanitizes every input once more, so a bad value cannot reach `step` even if
  the codec has a bug.
- The server derives seat and team from the connection and checks `championId`
  and `arenaId` against its own data.
- The first message must arrive within 5 s, and a connection silent for 30 s
  is closed (both defaults, section 4).
- The server binds 127.0.0.1 by default. A deployment sets its own host and
  checks the `Origin` header against an allowlist.
- The client treats the server as untrusted for rendering: an undecodable
  message closes the connection, and names are never inserted as HTML. A page
  address can point the client at any server through `?server=`; the client
  accepts only `ws:` and `wss:` addresses.
- Rate limits, connection caps per address and TLS are parked with deployment
  (P9). The cap of 16 rooms and the message limits (section 4) are the limits
  in this cut. The input queue cap already bounds what a flood of `input`
  messages can do: one input is used per tick, however many arrive.

## 12. Test strategy

Each layer, and what it asserts:

- **Protocol round trips** (`packages/protocol/test`): encode then decode
  gives the same message for every message type in both directions. A real
  3v3 snapshot rebuilds to an equal `checksum` (the check of section 8).
  Bad JSON, an unknown `t`, wrong field types, an oversize message and a
  version mismatch are rejected.
- **Server headless test** (`packages/server/test`): `Room` with an in-memory
  loopback transport that has an explicit `flush()`, no timers, and a
  manually driven clock.
  - Scripted clients create, join, select and ready.
  - Bots fill the empty seats: their count, champions and tier.
  - The match plays to `matchEnd`.
  - The client's rebuilt state has the server's `checksum` at every snapshot.
  - The event batches are complete: every tick's events appear once.
  - The server's recorded input stream replays through the sim to the same
    final `checksum`.
  - Reconnect: the grace period, the bot takeover, the return, and that the
    returning client's inputs from tick 0 apply (the counter reset). Amended
    2026-10-26 for package P2 (#167): these rows are package P5's; P2's test
    has none (a `reconnect` first message is a fatal `badToken` until then).
- **Socket test** (`packages/server/test`): a real `ws` server on a free port
  and Node's built-in `WebSocket` client (typed by `@types/node`): a client
  creates a room, a second joins by its code, they ready up and the first
  snapshot arrives. A second process, a forked room, is covered here once.
- **Client units** (`packages/client/src/*.test.ts`): the snapshot buffer, the
  render clock, the event release, the input tick counter, the anims time base.
- **Lint rows** (`tests/lint-boundaries.test.ts`): a firing row and an allowed
  row per new rule (section 3).
- **One Playwright e2e** (`e2e/online.spec.ts`, screenshot `online.png`): a
  `webServer` array starts Vite and `npm run server`. It asserts the lobby,
  the ready step, that bots fill the seats, the round phase, and that holding
  W moves the local champion. A full match is covered by the headless test,
  not by the e2e.

## 13. The package map

Sizes follow the planning scale (S, M, L). Each package is one pull request,
and every row is S or M, or parked.

| # | Package | Size | Blocked by |
|---|---------|------|------------|
| P1 | `protocol`: workspace, types, version, codec, round-trip tests, the protocol and client lint blocks with their rule rows, tsconfig, the typecheck line and the Vitest project. Lands with PR #157 (#151). | M | this spec |
| P2 | Server skeleton: `Room`, the lobby and ready flow, bot fill, the 60 Hz loop, the input queue, the snapshot cadence and batches, the server lint block, the loopback headless test. Lands with PR #180 (#167). | M | P1 |
| P3 | Server transport and processes: the `ws` dependency, the router and a fork per room, room codes and tokens, `npm run server`, the socket test | M | P2 |
| P4a | Client net core, no DOM: the socket transport, the snapshot buffer, the render clock, event release, the input sender, the anims time base, unit tests. Lands with PR #181 (#168): the transport is an interface and a test fake, and the browser `WebSocket` adapter comes with P4b or P4c; the anims time base is `updateAnimsAt` and `DrawnTime` next to an unchanged `updateAnims`, which the local path keeps until P4b. | M | P1 |
| P4b | Client online match path: `main.ts` split into a local and an online start (no sim in the online loop), any local id and team, the `data-p0*` hooks and the HUD score for the local team, the views fed from the buffer, the menu without pause and its Leave; its check is a client unit driving the online start through a fake transport | M | P4a |
| P4c | Client lobby: the address parameters and the lobby screen, the Playwright e2e and the CI server start | M | P3, P4b |
| P5 | Reconnect: the grace period, the bot takeover, the seat's input-counter reset, client backoff, loopback and e2e rows | M | P3, P4c |
| P6a | Prediction and reconciliation of the local champion, movement | M | P5 |
| P6b | Prediction of the local champion's casts | M | P6a |
| P7 | Delta snapshots, with a protocol version bump | M | P4c |
| P8 | Docker image | S | P3 |
| P9 | First deployment | parked: outward-facing, needs the owner's host and cost decision | P8 |

The milestone 6 items of the [roadmap](../../roadmap.md#6-online), and where
each lands:

- The `protocol` package: P1.
- Match server: P2 and P3.
- WebSocket transport: P3 and P4a.
- Lobby and ready flow: P2 and P4c.
- Snapshot interpolation: P4a and P4b.
- Prediction and reconciliation: P6a and P6b.
- Reconnect: P5.
- Server-side bots filling empty slots: P2.
- Docker image: P8.
- A first deployment: P9.

P6a can only be checked once the authoritative path and the interpolation work,
which is the order section 7 of the design spec already gives. P1 can start as
soon as this design is approved.
