# ADR-006: the first online cut

## Status

Accepted by [batch #134 decision 1](https://github.com/sv-tmueller/claudeline-champions/issues/134#issuecomment-6232034441).
Design only, except P1: `packages/protocol` is built (#151). The full design is the
[online design spec](../../superpowers/specs/2026-10-17-online-design.md).

## Context

[ADR-002](ADR-002-server-authoritative-sim.md) fixed the shape: one sim on a
fixed tick, server-authoritative, clients sending their `PlayerInput`
stream. Milestone 6 has to decide the rest before any code: the process
model, the transport, what a snapshot holds, how the client renders it, how a
player returns after a drop, and which packages exist. Design spec section 7
says each match runs in its own server process, and that `protocol` holds
message types only. A lobby by room code has to live somewhere, and the
protocol tests and the checks on untrusted messages need a real codec.

## Decision

- Each match runs in its own Node process on the shared sim at 60 Hz, with
  server bots filling the empty seats. A router process owns the one public
  port and the room-code table and forks one child process per room. The child
  runs that room's lobby and its matches, one at a time.
- Clients send one `PlayerInput` per tick with its tick number over a
  WebSocket: `ws` on Node, the browser's `WebSocket` in the client.
- The server sends full-state JSON snapshots every third tick (20 Hz). Clients
  render them 6 ticks (100 ms) behind through the existing interpolation.
- No client prediction in the first cut. Reconnect is by a server-issued token
  that starts with the room code.
- `protocol` holds the message types, `PROTOCOL_VERSION` and a pure JSON
  encode and decode with validation. The client imports `protocol` and never
  `server`. This amends design spec sections 3.2 and 7.
- Online play never pauses. Escape opens the menu over the running match and
  the menu offers Leave in place of Restart.

Alternatives rejected:

- Binary or delta snapshots first. JSON full snapshots are easy to debug and
  exact against `checksum`, because `GameState` survives a JSON round trip
  unchanged. Every snapshot is also a full resync, which keeps reconnect
  simple. At the measured 3 KB mean and 8 KB largest a snapshot, in three
  runs, they are affordable. Deltas come later, behind a protocol version
  bump.
- Prediction in the first cut. It adds rollback and correction smoothing, and
  it can only be checked once the authoritative path and the interpolation
  work, which is the order section 7 of the design spec already gives. The
  latency cost is accepted.
- Many matches in one process, or worker threads. Tick jitter would be shared,
  one crash would end every match, and the matchmaker's allocation model
  (milestone 7) would not fit.
- One process per room with the room code as a join secret. It is the simplest
  server, but a second room needs a second process and port, and launching
  processes moves to the milestone 7 matchmaker.
- A types-only `protocol`. Each side would duplicate the decoder and the
  round-trip test would have nothing real to test.
- WebRTC or UDP. They need signalling, STUN and TURN. TCP head-of-line
  blocking is accepted for now.
- Socket.IO or Colyseus. A larger dependency and protocol surface than `ws`.
- Lockstep. Already rejected by [ADR-002](ADR-002-server-authoritative-sim.md).

## Consequences

- A new `protocol` package and a `server` package. The client imports
  `protocol` (the dated amendment under design spec section 3.2, mirrored in
  [packages](../packages.md)). The server reads the wall clock and the sim
  still never does.
- Snapshots carry the event batches, since `checksum` covers `state.events`.
- The online receive path (`JSON.parse` per message) is not covered by the
  heap probe.
- Latency equals a round trip plus 100 ms until prediction lands.
- Each room costs one Node process, so the router caps the number of rooms.
- Deployment is parked: it is outward-facing and needs the owner's decision.
- See [online](../online.md) for the reference and the design spec for the
  messages, the tests and the package map P1 to P9.
