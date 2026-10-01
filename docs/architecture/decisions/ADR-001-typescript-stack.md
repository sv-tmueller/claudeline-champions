# ADR-001: TypeScript stack

## Status

Accepted.

## Context

The project is a long-running passion project built mostly by AI agents under
human direction. There is no deadline. Every design choice favours
reproducibility, testability and a tight agent feedback loop. The game must run
in the browser first, then online, then on Steam.

## Decision

TypeScript everywhere: Three.js client, Node server, Electron shell later. The
repository uses npm workspaces and no extra package manager.

Alternatives rejected:

- Godot 4 with web export. Web is its weakest target, and agents fight the
  scene and import pipeline.
- Bevy. No toolchain, weaker UI, moving API.
- Unity. Licensing, and an editor-centric workflow.

## Consequences

- One language and one toolchain for the sim, client, bots, server and desktop
  shell.
- The sim runs unchanged in the browser, in tests and on the server. See
  [ADR-002](ADR-002-server-authoritative-sim.md).
- Agents work with plain text files and command line tools.
- See [packages](../packages.md) for the repository layout.
