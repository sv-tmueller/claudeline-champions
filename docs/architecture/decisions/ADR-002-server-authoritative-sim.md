# ADR-002: server-authoritative simulation

## Status

Accepted.

## Context

Online play must not be retrofitted late. The game needs one simulation that
behaves the same locally, in tests, in bots and online.

## Decision

Server-authoritative simulation on a fixed tick. One pure TypeScript sim
package runs identically in the browser, in tests, in bots and on the server.

Alternatives rejected:

- Deterministic lockstep. It needs bit-exact cross-machine floats and input
  delay, and it is easier to cheat.
- Client-authoritative. It is unfixable later.

## Consequences

- `packages/sim` has zero runtime dependencies and no DOM types. See
  [simulation](../simulation.md).
- Locally the client, the bots and the sim live in one process, so input
  latency is zero.
- Online, the same sim runs on the server and clients send their `PlayerInput`
  stream. See [online](../online.md).
- Server authority is the anti-cheat baseline.
- Floating-point drift between client and server is irrelevant while the server
  is authoritative. Snapshots correct prediction errors.
