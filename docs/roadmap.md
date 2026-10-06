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
| 2. Walking in the arena | Champion movement and collision in the sim, scene and input in the client | done ([batch #12](https://github.com/sv-tmueller/claudeline-champions/issues/12) and [batch #23](https://github.com/sv-tmueller/claudeline-champions/issues/23) merged) |
| 3. First blood | Effects toolkit, combat, match flow with sudden death, HUD, two champions | done ([batch #23](https://github.com/sv-tmueller/claudeline-champions/issues/23), [batch #32](https://github.com/sv-tmueller/claudeline-champions/issues/32), [batch #47](https://github.com/sv-tmueller/claudeline-champions/issues/47) and [batch #53](https://github.com/sv-tmueller/claudeline-champions/issues/53) merged): the effects toolkit, statuses and line of sight, the kit framework with cooldowns, windups and energy, combat rendering and the HUD, match flow with sudden death, the Hargrim and Quillon kits |
| 4. Bots 2v2, the first playable | Bot AI, champions three and four, champion select, match setup, result screen | done as the first playable ([batch #23](https://github.com/sv-tmueller/claudeline-champions/issues/23), [batch #32](https://github.com/sv-tmueller/claudeline-champions/issues/32), [batch #47](https://github.com/sv-tmueller/claudeline-champions/issues/47), [batch #53](https://github.com/sv-tmueller/claudeline-champions/issues/53) and [batch #63](https://github.com/sv-tmueller/claudeline-champions/issues/63) merged): bot navigation, utility intents, aim leading and three tiers, bots that cast from kit data with per-champion range profiles, the energy reserve and allocation-free thinks, the Skerrow kit, a 2v2 versus bots from the browser to the result screen and its champion select; carried to milestone 5: the Lumeth kit ([#70](https://github.com/sv-tmueller/claudeline-champions/issues/70)) and the Lumeth bot profile, a team-size and difficulty choice in the client (the team size in the select since [batch #91](https://github.com/sv-tmueller/claudeline-champions/issues/91); the difficulty in the address only), first-pass sound |
| 5. Feel and breadth | Rigs and animation, menus and keybinding, second arena, 3v3, roster to six, balance pass | in progress: arena02 as data and a committed model ([batch #63](https://github.com/sv-tmueller/claudeline-champions/issues/63)); [batch #80](https://github.com/sv-tmueller/claudeline-champions/issues/80): projectiles with ally effects, bot openers and escapes with the Skerrow rules, the live-match heap probe ([#77](https://github.com/sv-tmueller/claudeline-champions/issues/77)) and the arena select with the Escape menu and keybinding ([#82](https://github.com/sv-tmueller/claudeline-champions/issues/82)); [batch #91](https://github.com/sv-tmueller/claudeline-champions/issues/91): the Lumeth kit, which completes the v1 roster as data, 3v3 in match setup and the select on both arenas, the four roster models and the placeholder rigged with four clips (Idle, Run, Cast, Death), the pointer aim and the entity drawing allocation-free with the heap probe counting both, the bots' allocation-free plan search with the live probe's bots bound, Skerrow's wait in the 6 to 8 m band and the Quiet Dart opener, with no dash pressed on an escape think for any kit, and the Reaper's Dance pin ([#98](https://github.com/sv-tmueller/claudeline-champions/issues/98)); next: the animation state machine with the Attack and Hit clips, the Lumeth bot profile, a difficulty choice in the client, first-pass sound, roster to six, the balance pass |
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

- Carried from milestone 4: the Lumeth kit and bot profile, a team-size and
  difficulty choice in the client, first-pass sound (the kit and the team-size
  choice are in, [batch #91](https://github.com/sv-tmueller/claudeline-champions/issues/91)).
- Blender rigs and animation clips (one rig and Idle, Run, Cast and Death on
  every model, [batch #91](https://github.com/sv-tmueller/claudeline-champions/issues/91); Attack and Hit wait for the state machine).
- Animation state machine in the client, hit feedback.
- Menus and keybinding, settings persistence through the platform interface.
- A second arena (arena02 is playable from the arena select, [batch #80](https://github.com/sv-tmueller/claudeline-champions/issues/80)), 3v3 (in the select on both arenas, [batch #91](https://github.com/sv-tmueller/claudeline-champions/issues/91)), roster to six.
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
