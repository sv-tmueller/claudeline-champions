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

- The type checker validates every ability.
- Kits may only use the toolkit primitives. New primitives are added to the
  toolkit through the design doc first, then the sim. See
  [simulation](../simulation.md).
- There is no interpreter or ability file format to maintain.
