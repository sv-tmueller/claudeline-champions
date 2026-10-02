# Roadmap

This is the living roadmap. The approved source is section 11 of the
[design spec](superpowers/specs/2026-10-01-claudeline-champions-design.md).
Architecture notes live in [architecture/README.md](architecture/README.md).

Each milestone is several batches of up to six independent packages. Package
lists are candidates, sliced batch by batch at dispatch time.

## Milestones

| Milestone | Scope | Status |
|-----------|-------|--------|
| 1. Foundations | Monorepo scaffold, check suite and CI, architecture docs, roadmap, rules and roster docs, Blender bootstrap | done ([batch #6](https://github.com/sv-tmueller/claudeline-champions/issues/6) merged) |
| 2. Walking in the arena | Champion movement and collision in the sim, scene and input in the client | in progress: sim core and client scene merged ([batch #12](https://github.com/sv-tmueller/claudeline-champions/issues/12)); walking and bot navigation in [batch #23](https://github.com/sv-tmueller/claudeline-champions/issues/23) |
| 3. First blood | Effects toolkit, combat, match flow with sudden death, HUD, two champions | planned |
| 4. Bots 2v2, the first playable | Bot AI, champions three and four, champion select, match setup, result screen | planned |
| 5. Feel and breadth | Rigs and animation, menus and keybinding, second arena, 3v3, roster to six, balance pass | planned |
| 6. Online | Protocol, match server, WebSocket transport, prediction, reconnect, deployment | planned |
| 7. Ladder | Accounts, matchmaking, casual and ranked queues, Glicko-2, seasons, leaderboard | planned |
| 8. Steam | Electron desktop package, Steamworks, three desktop platforms, gamepad support | planned |
| 9. Live | Replays, spectating, telemetry, balance tooling, more content and modes | planned |

## Candidate packages

### 1. Foundations (batch 1)

- Monorepo scaffold with the check suite and CI.
- Architecture reference docs and the living roadmap.
- Game rules and controls doc.
- Roster v1 doc.
- Blender pipeline bootstrap with arena 1 definition and placeholder models.

### 2. Walking in the arena

- Sim: champion entity, movement, obstacle and boundary collision, arena
  loading from JSON, replay fixtures.
- Client: scene bootstrap, arena model, placeholder champion, camera, input
  mapper, fixed step loop with interpolation, debug overlay.
- CI runs asset validation.

### 3. First blood

- Sim: effects toolkit, projectiles, areas, line of sight, statuses, health
  and death, energy, cooldowns and windups, match flow with sudden death.
- Client: HUD, projectile and area rendering, events to effects, two complete
  champions.

### 4. Bots 2v2, the first playable

- Bots: grid navigation, steering, utility intents, aim leading, difficulty
  tiers, bot-versus-bot integration tests.
- Content: champions three and four, bot profiles for all four.
- Client: champion select, match setup (team size, bot difficulty), result
  screen, first pass effects and sound.

### 5. Feel and breadth

- Blender rigs and animation clips.
- Animation state machine in the client, hit feedback.
- Menus and keybinding, settings persistence through the platform interface.
- A second arena, 3v3, roster to six.
- A balance pass with a recorded bot-versus-bot win-rate report.

### 6. Online

- `protocol` package, match server, WebSocket transport.
- Lobby and ready flow.
- Snapshot interpolation, client prediction and reconciliation, reconnect.
- Server-side bots filling empty slots.
- Docker image and a first deployment.

### 7. Ladder

- Accounts and sessions, profiles.
- Matchmaking service, casual and ranked queues.
- Glicko-2 ratings, seasons, leaderboard, match history.

### 8. Steam

- `desktop` package with Electron.
- Steamworks platform implementation (identity, achievements, rich presence).
- Builds for macOS, Windows and Linux.
- Gamepad support, store-ready packaging.

### 9. Live

- Replays from input streams, spectating.
- Telemetry, balance tooling.
- More champions and arenas, additional modes such as 1v1.
