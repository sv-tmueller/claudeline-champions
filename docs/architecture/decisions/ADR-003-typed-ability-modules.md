# ADR-003: typed ability modules

## Status

Accepted.

## Context

Each champion kit needs abilities with cooldowns, windups and effects. A single
authoring team writes all kits.

## Decision

Abilities are typed TypeScript modules composed from a small effects toolkit.

Alternative rejected: a JSON ability language plus an interpreter. That is a
DSL to maintain for a single authoring team.

## Consequences

- The type checker validates every ability. Superseded 2026-10-05 by the last
  bullet ([batch #53 decision 6](https://github.com/sv-tmueller/claudeline-champions/issues/53#issuecomment-5996621415)): the
  type checker checks the contract and the code; `validateKit` and the roster
  tests check the data.
- Kits may only use the toolkit primitives. New primitives are added to the
  toolkit through the design doc first, then the sim. See
  [simulation](../simulation.md).
- There is no interpreter or ability file format to maintain. Superseded
  2026-10-05 by the last bullet ([batch #53 decision 6](https://github.com/sv-tmueller/claudeline-champions/issues/53#issuecomment-5996621415)):
  kit data has a file format (`data/kits/<id>.json`), but there is still no
  ability language or interpreter.
- Kits are typed plain data (`KitDef` in `kit.ts`), stored in the state and run by a
  `switch` over a closed effect union in `cast.ts` (batch #32 decision 4, #43). The
  union is the toolkit, not an ability language: it has no expressions, references,
  kit code or kit-defined control flow, so the rejected ability language stays
  rejected. Roster kit data lives as JSON in `data/kits/<id>.json`. The type checker
  checks the contract and the code; `validateKit` (run by `createMatch`) and the
  roster tests check the data (batch #53 decision 1).
