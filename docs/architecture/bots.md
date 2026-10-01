# Bots

`packages/bots`. Source: spec section 6. Bots import `sim` only. See
[packages](packages.md).

## API

`createBot(playerId, difficulty, seed) -> { think(state: GameState): PlayerInput }`.
Bots run inside the same process as the sim (browser locally, server online).
They read the full state; fairness comes from difficulty tiers, not hidden
information.

## Navigation

A-star over a coarse grid (0.5 m cells) baked from the arena definition, plus
local steering to avoid champions and projectiles.

## Decisions

Utility scoring over candidate intents: engage, kite, dodge a predicted
projectile, retreat, peel for an ally, hold position, use the ultimate. Each
champion kit ships a small bot profile describing preferred range and which
slots are openers, escapes and finishers.

## Aim

Lead moving targets using their current velocity; add a tier-dependent angular
error.

## Difficulty tiers

Easy, normal, hard. They differ in reaction delay (ticks between a change in
the world and a change in intent), aim error, and dodge probability.

## Testing

Bot-versus-bot headless matches are integration tests: a full match must
finish, invariants must hold, and no `NaN` may appear. See
[testing](testing.md).
