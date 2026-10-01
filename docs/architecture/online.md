# Online and ladder

Principles only, implemented from milestone 6. Source: spec section 7. See the
[roadmap](../roadmap.md) for milestones 6 and 7.

## Netcode

- Each match runs in its own server process on the same sim at 60 Hz. Clients
  send `PlayerInput` with a tick number. The server sends snapshots at 20 Hz,
  full at first, deltas later. Clients render opponents about 100 ms behind
  and interpolate. Client-side prediction and reconciliation for the local
  champion come after interpolation works.
- `protocol` holds message types only. `sim` knows nothing about networking.

## Ladder

- A separate matchmaking service owns accounts, queues and ratings. Casual and
  ranked queues share one matchmaker. Only ranked updates the visible Glicko-2
  rating; casual uses a hidden rating for fairness.

## Anti-cheat

Server authority is the anti-cheat baseline. No client-trusted state.

## Related

- [Simulation](simulation.md) for `PlayerInput` and `GameState`.
- [Packages](packages.md) for where `server` and `protocol` sit.
