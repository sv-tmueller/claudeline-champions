# Game rules and controls

Status: v1 rules, pre-implementation
Source of truth for numbers: [design spec](../superpowers/specs/2026-10-01-claudeline-champions-design.md), sections 4, 5, 6 and 10
Companion document: [arena design principles](arenas.md)

This document defines how a match plays and how it is controlled. The sim, the client and the bots implement it. Champion kits and arena layouts are not covered here.

## 0. How to read the numbers

- `[spec]` marks a value copied from the design spec. It does not change here.
- `[tuned]` marks a value this document chose, either inside a range the spec gives or where the spec is silent. These values may move in balance passes.
- The sim counts time in integer ticks at 60 Hz (`TICK_RATE = 60`, `DT = 1 / 60`). Seconds in this document convert to ticks once, at match creation: `ticks = seconds * 60`.
- Where this document and the issue acceptance criteria seem to disagree, the spec governs. One such case is in section 3.2.
- Difficulty tiers for bots (easy, normal, hard) change only reaction delay,
  aim error and dodge probability. They do not change any rule in this
  document `[spec]`. The select in the result panel and in the menu offers
  the three tiers, and the address (`?difficulty=`) picks one, normal by
  default `[tuned]`.

## 1. Match and round flow

A match is a state machine: `warmup -> round -> roundEnd -> (round | matchEnd)` `[spec]`.

| Phase | Length | What happens |
|-------|--------|--------------|
| Warmup | 3 s (180 ticks) `[spec]` | Champions stand at their spawn points. Movement and casting are locked. |
| Round | 90 s (5400 ticks) `[spec]` | Normal play. The round timer counts down from 90 s. |
| Sudden death | 30 s of shrinking, then a hold | Starts when the round timer reaches 0. See section 1.1. |
| Round end pause | 3 s (180 ticks) `[spec]` | Starts on the tick a round is decided. Then the reset happens. |
| Match end | n/a | The match is over once a team has 3 round wins and the round end pause has finished. |

Notes on the flow:

- Warmup happens once, before round 1. Between rounds the state goes from `roundEnd` straight to `round`, as in the spec's state machine. The 3 s round end pause is the only break between rounds.
- During the round end pause, movement and casting are locked. Projectiles and areas are removed on the tick the round is decided. No damage, healing or status effect is applied during the pause `[tuned]`.
- The match has no cap on the number of rounds. Draws score nothing, so a match can run longer than five rounds.

### 1.1 Sudden death

- When the round timer expires, a ring centred on the arena starts to shrink.
- The ring radius goes linearly from 18 m to 3 m over 30 s (1800 ticks) `[spec]`. That is 1/120 m per tick.
- A champion outside the ring takes 10 damage per second `[spec]`. The sim applies this every tick as 10 / 60 damage.
- "Outside" means the centre of the champion circle is farther from the ring centre than the current radius `[tuned]`. The champion radius is 0.5 m `[spec]`.
- After 30 s the ring holds at 3 m until the round is decided `[spec]`. There is no further time limit.
- Ring damage ignores shields and gives no energy to anyone `[tuned]`. The invulnerable status blocks it.
- The ring values (`startRadius`, `endRadius`, `damagePerSecond`) are stored per arena in the arena definition. The v1 values are 18, 3 and 10.

### 1.2 What resets between rounds

At the end of the round end pause, before the next round starts, the sim does this `[spec]`:

- Every champion is fully healed to its max health.
- Every cooldown is reset to 0.
- Energy is set to 0.
- Every champion respawns at its team's spawn point.

The sim also does this `[tuned]`:

- Every status is removed.
- A cast in progress is dropped.
- The round timer is set to 90 s and the ring is removed.

Round wins are the only thing that carries over.

### 1.3 Win conditions and draws

- A team wins a round when every enemy champion is dead `[spec]`.
- A team wins the match when it reaches 3 round wins `[spec]`. The value is the `roundsToWin` field of `MatchConfig`.
- Draw rule `[spec]`: if both teams lose their last living champion on the same tick, the round is a draw. Nobody scores. The next round starts after the normal round end pause.
- Dead champions stay dead until the round ends. There is no respawn during a round. A dead champion does not collide with anything and cannot be hit `[tuned]`.
- There is no win by timer. If both teams are alive when the timer expires, sudden death decides the round.

## 2. Abilities

### 2.1 Slot layout

| Slot | Button | Role |
|------|--------|------|
| M1 | Left mouse | Basic attack |
| M2 | Right mouse | Secondary attack |
| SPACE | Space | Mobility |
| Q | Q | Utility |
| E | E | Offense |
| R | R | Defense |
| F | F | Ultimate |

`[spec]` The roles follow the Bloodline layout from the spec: Q, E and R are utility, offense and defense.

### 2.2 EX variants and the ultimate

- Holding Shift with a slot casts that slot's EX variant, where the kit defines one `[spec]`.
- Each kit defines exactly two EX variants `[spec]`. They sit on two of the slots M1, M2, SPACE, Q, E and R `[tuned]`. The ultimate has no EX variant.
- An EX variant costs 25 energy `[spec]`.
- The ultimate is on F and costs 100 energy `[spec]`.
- Shift with a slot that has no EX variant is ignored, and the normal ability casts `[tuned]`.
- If energy is below the cost of the EX variant, the cast is rejected. It does not fall back to the normal ability `[tuned]`. The client plays a "not enough energy" cue.
- Energy is paid when the cast starts, not when the windup ends. An interrupted cast does not refund energy `[tuned]`.

### 2.3 Cooldowns and casting

- Every ability has a cooldown in ticks, a windup in ticks (0 for instant), a movement rule during the windup and a list of effects `[spec]`.
- There is no global cooldown `[spec]`. Using one slot never puts another slot on cooldown.
- The cooldown starts when the cast starts, and it keeps counting down during the windup `[tuned]`.
- An EX variant and the normal ability of the same slot share one cooldown `[tuned]`.
- Casting is blocked `[spec]`:
  - while another windup is in progress,
  - while the champion is stunned,
  - while the champion is silenced. This includes the mobility slot.
- Casting is also blocked while the champion is dead, during warmup and during the round end pause, while the slot is on cooldown, and while energy is too low `[tuned]`.
- A rooted champion cannot start a cast of an ability that contains a `dash` effect. The cast is rejected and costs nothing `[tuned]`.
- If root lands during the windup of such a cast, the cast continues, but its `dash` effect is skipped. The cast's other effects still apply `[tuned]`.
- A `teleport` effect stays allowed under root `[tuned]`.
- Buttons are held, not pressed once. On every tick where a button is held and its slot is ready, the cast starts `[tuned]`. Holding M1 repeats the basic attack.
- If several slots are ready on the same tick, one cast starts. The order is F, R, E, Q, SPACE, M2, M1 `[tuned]`.
- Effects fire when the windup ends. They use the aim position from that tick `[tuned]`.

### 2.4 Windup and movement rules

Every ability picks one movement rule for its windup `[spec]`:

| Rule | Effect during the windup |
|------|--------------------------|
| free | The champion moves at its normal speed. |
| slowed | The champion moves at 50 percent of its current speed `[tuned]`. This multiplies after slow and haste. |
| locked | The champion cannot walk. Its walking velocity is zero. |

A windup is interrupted when `[tuned]`:

- the champion is stunned,
- the champion dies,
- the round is decided.

Silence, root, slow and knockback do not interrupt a windup. Root skips only the `dash` effect of a cast that is already winding up, as described in section 2.3. Knockback still moves a champion with a locked windup, because it is an outside impulse and not walking.

An interrupted cast fires no effects. Its cooldown stays running and its energy cost is not refunded.

### 2.5 The self-cast rule

When a cast fires a projectile that has ally effects, and the aim position of that tick lies within the caster's own circle (a distance of at most 0.5 m from the caster's centre, the boundary included), the projectile does not spawn. Its ally effects land on the caster instead `[spec]`.

- A heal, and each pulse of a heal over time, restores 60 percent of its amount `[tuned]`. The other ally effects, such as a shield or a haste, land in full.
- The effects meant for enemies do nothing, because no projectile exists to meet one.
- Energy is unchanged: healing yourself gives nothing (section 3.1), and the cast pays no more than any other cast of that slot.
- A wound status, which cuts healing, multiplies the reduced amount: the self-cast factor comes first, then the wound cut.
- A player who holds the mouse on their own champion triggers the rule, as the aim position alone decides it.

## 3. Energy economy

- Energy goes from 0 to 100 `[spec]`. Gains above the cap are lost.
- Energy is earned only by landing abilities on enemies and, for support kits, by healing allies `[spec]`.
- Energy resets to 0 at the start of each round `[spec]`.
- The sim applies the table in section 3.1 on its own whenever an ability lands. Kits do not carry `energyGain` for these standard hits `[tuned]`.
- A kit uses the `energyGain` effect only for an extra grant on top of the table. Kits add no other energy sources `[tuned]`.

### 3.1 Gain values `[tuned]`

| Event | Energy gained |
|-------|---------------|
| M1 hit on an enemy | 5 |
| Skill hit on an enemy (M2, SPACE, Q, E, R) | 10 |
| EX variant hit on an enemy | 10 |
| Ultimate hit on an enemy | 15 per enemy hit |
| M1 heal that restores health to an ally (support kits only) | 5 |
| Skill or EX heal that restores health to an ally (support kits only) | 10 |
| Ultimate heal that restores health to an ally (support kits only) | 15 per ally healed |

Detail rules:

- A shield or a status alone gives nothing. Only a hit that lands on an enemy, or a heal that restores health to an ally, gives energy.
- One cast gives energy at most once per target, however many of its effects or area pulses touch that target.
- A hit counts when it lands. A hit that a shield fully absorbs still gives energy.
- A hit on an invulnerable champion gives no energy.
- A heal gives energy only if it restores at least some health. Healing a full-health ally or healing yourself gives nothing.
- Damage over time and heal over time ticks give no energy. The cast that applied them gives energy once, when it lands.
- Ring damage gives no energy.
- Energy spent on an EX variant or the ultimate comes out of the same pool.

### 3.2 Worked example

The numbers below describe one typical kit. They are an illustration, not a balance simulation.

Assume that in every 10 s of active combat the player lands 2 basic hits and 1 skill hit on enemies.

- 2 basic hits give 2 x 5 = 10 energy.
- 1 skill hit gives 10 energy.
- That is 20 energy per 10 s, or 2 energy per second.
- The ultimate is ready after 50 s of active combat if no EX variant is cast.

| Round | Active combat | Energy at the end | Result |
|-------|---------------|-------------------|--------|
| 1 | 40 s | 80 | Ultimate not ready. |
| 2 | 55 s | 100 at 50 s | Ultimate cast at about 52 s. |
| 3 | 45 s | 90 | Ultimate not ready. |

Each EX cast costs 25 energy and delays the ultimate by about 12 s of active combat.

A support kit lands the same total: 2 M1 heals on hurt allies (10) plus 1 skill heal (10) per 10 s of active combat.

Note on the acceptance criterion "reaches its ultimate within two to three rounds of landed hits": the spec resets energy to 0 every round (sections 4.6 and 4.7), so energy cannot carry over between rounds. The spec governs. This document reads the criterion as follows. A typical kit reaches 100 energy in a round that holds about 50 s of active combat. The ultimate is available in roughly one round out of every two to three. Rounds that end early do not reach it.

## 4. Statuses

Every status has a remaining tick count `[spec]`. The catalog below is the full v1 list `[spec]`.

Stacking rules:

- The source of a status is the pair (casting champion, ability slot) `[tuned]`. An EX variant has the same source as its normal slot.
- Spec rule: the same status from the same source refreshes its duration rather than stacking `[spec]`. A refresh also replaces the strength (percent, amount or impulse) with the new value `[tuned]`.
- Spec rule: different sources stack unless this document says otherwise for that status `[spec]`. The table gives the rule per status.
- No v1 ability removes statuses. A status ends when its time runs out, when the champion dies, or at a round reset `[tuned]`.

### 4.1 Catalog `[tuned]`

The ranges in the Duration range column bind kits. Every ability must pick its durations and strengths inside them.

| Status | Duration range | Blocks | Stacking across different sources |
|--------|------------------|--------|-----------------------------------|
| Stun | 0.5 to 2.0 s (30 to 120 ticks) | Movement and casting `[spec]`. Interrupts a windup. | Does not stack. The longest remaining time wins. Remaining stun is capped at 2.0 s. |
| Root | 1.0 to 2.5 s (60 to 150 ticks) | Movement only `[spec]`. That means walking and abilities with a `dash` effect. | Does not stack. The longest remaining time wins. |
| Silence | 1.0 to 3.0 s (60 to 180 ticks) | Casting only `[spec]`, including the mobility slot. Movement stays allowed. | Does not stack. The longest remaining time wins. |
| Slow | 20 to 60 percent, 1.0 to 3.0 s (60 to 180 ticks) | Nothing. It lowers move speed. | Stacks. Percents add, capped at 70 percent in total. Each source keeps its own timer. |
| Haste | 20 to 50 percent, 1.0 to 4.0 s (60 to 240 ticks) | Nothing. It raises move speed. | Stacks. Percents add, capped at 50 percent in total. Each source keeps its own timer. |
| Shield | 20 to 60 absorb, 3 to 6 s (180 to 360 ticks) | Nothing. It absorbs damage. | Stacks. Absorb amounts add. Damage uses up the oldest shield first. A shield that times out loses its remaining absorb. |
| Damage over time | 1.0 to 4.0 s (60 to 240 ticks), one tick every 0.5 s (30 ticks) | Nothing. | Stacks. Each source ticks on its own. |
| Heal over time | 2.0 to 5.0 s (120 to 300 ticks), one tick every 0.5 s (30 ticks) | Nothing. | Stacks. Each source ticks on its own. |
| Knockback | 1 to 4 m of push over 6 to 15 ticks (0.1 to 0.25 s) | Nothing. It moves the champion. Root does not stop it. | Stacks. Impulses add. The total remaining push is capped at 6 m. |
| Invulnerable | 0.5 to 2.0 s (30 to 120 ticks) | No actions; blocks incoming damage and hostile statuses, see below | Does not stack. The longest remaining time wins. |

Per-status details:

- Move speed: base speed is 5.5 m/s `[spec]`. Speed is `5.5 * (1 + haste - slow)`, where haste is at most 0.5 and slow is at most 0.7. The result is never below 30 percent or above 150 percent of base speed.
- Stun: a stunned champion cannot move or cast. A stun that arrives during a windup cancels the cast. A stunned champion is still pushed by knockback `[tuned]`.
- Root: a rooted champion can still aim and can cast anything without a `dash` effect. A `teleport` effect is not blocked. Root cannot start a dash cast, and it skips the `dash` effect of a dash cast that is already winding up (section 2.3). A rooted champion is still pushed by knockback.
- Silence: a silenced champion can still move. A windup already running when silence arrives is not interrupted.
- Shield: damage goes to shields before health.
- Damage over time: the total damage of one application stays inside the 8 to 30 per hit range `[tuned]`. The range is from the spec, but applying it to the total of a damage over time is a choice made here. A refresh resets the remaining time and takes the new damage per tick. It keeps the current tick timer.
- Heal over time: the total healing of one application also stays inside 8 to 30 `[tuned]`. Refresh works like damage over time.
- Knockback: a champion moves along the push direction with a linearly decaying speed. An obstacle or the arena wall stops the push. Pushes deal no damage.
- Invulnerable: blocks all damage, including ring damage. Blocks new stun, root, silence, slow, damage over time and knockback. Does not block healing, shields or haste. It does not remove statuses that are already running, but damage over time deals no damage while it lasts.

## 5. Health

- Max health is 120 for ranged and support kits and 160 for melee kits `[spec]`. A kit that mixes roles may use a value between the two, in steps of 10 `[tuned]`. The roster document decides.
- Health does not regenerate during a round. Only healing effects restore it `[spec]`.
- Healing cannot raise health above max health `[tuned]`.
- Health is a number with a fraction. A champion dies when health is 0 or lower. The HUD shows health rounded up `[tuned]`.
- Ability damage is 8 to 30 per hit, and ultimates go up to 60 `[spec]`.

## 6. Controls

Default controls `[spec]`:

| Input | Action |
|-------|--------|
| W, A, S, D | Move. W is screen-up, which is `+y` in the sim. |
| Mouse | Aim. The aim point is where the mouse ray hits the ground plane. |
| Left mouse button | M1 |
| Right mouse button | M2 |
| Space | Mobility |
| Q, E, R | Q, E and R slots |
| F | Ultimate |
| Shift (held) | EX variant of the slot that is cast |
| C (held) | Self-cast |
| Tab | Scoreboard |
| Escape | Menu |

- Rebinding arrives in milestone 5 `[spec]`. The ten keys of the movement, the slots and the self-cast can be rebound in the menu's keys view: W, A, S, D, Space, Q, E, R, F and C `[tuned]`. The mouse buttons, Shift, Tab, Escape and the debug keys stay fixed `[tuned]`. A key that another action already uses is refused, and so is a reserved key (Escape, Tab, F3, F4, Shift, Control, Alt and Meta) `[tuned]`. Reset restores the table above `[tuned]`. The bindings are saved through the platform and read back on the next launch `[tuned]`.
- Hold C to self-cast `[spec]`. Hold it and cast a slot: while C is held the aim is the champion's own position, so a projectile with ally effects lands on her at once (section 2.5). Releasing C before the cast fires returns the aim to the mouse. Shift, C and a slot self-cast the EX variant. The rule reaches every ally projectile that ships: Lumeth's Mend Bolt (M1), Soothing Surge (M2) and its EX; there is no exception. The ally effects of an area or on the caster already include her, so C changes nothing for Aegis Veil, Dawnbloom, Hargrim's haste circle or any shield or haste the champion puts on herself. Any other aimed ability cast with C lands at her feet, which is the player's choice. C sets no button bit.
- Sound is generated in code, with no sound files and no music `[tuned]`. It
  plays a hit (a projectile that touches a champion, and a melee arc with at
  least one target), a cast (the local champion's casts only), a death
  (every death), a round start and a round end, and nothing for the match
  end `[tuned]`. The browser starts it on the first key press or mouse press
  `[tuned]`. The menu's sound toggle mutes all of it, and the mute is saved
  through the platform with the bindings and read back on the next launch
  `[tuned]`.
- Tab shows the scoreboard while it is held `[tuned]`. The scoreboard lists every champion with its team, its champion, alive or dead, kills and deaths.
  The kills and deaths are totals of the match, not of the round `[tuned]`. A
  death always counts for the champion that died; a kill counts for the
  champion that dealt the last damage, so a death by the sudden death ring
  counts a death and no kill `[tuned]`. It shows in every phase, over the
  result panel too, where the final tally is the useful one `[tuned]`, and
  not while the menu is open (Tab then moves focus in the menu) `[tuned]`.
- In local matches the menu pauses the sim `[tuned]`. It opens in every phase
  and has these actions: Resume (Escape again does the same), Restart the
  match with the same champion, difficulty, arena and team size, back to the
  champion, arena, team size and difficulty select, the keys view and the
  sound toggle `[tuned]`. Online play never pauses: Escape opens the menu over
  the running match, and the menu offers Leave in place of Restart
  ([batch #134 decision 1](https://github.com/sv-tmueller/claudeline-champions/issues/134#issuecomment-6232034441), designed in the
  [online design](../superpowers/specs/2026-10-17-online-design.md#9-client-rendering)).
- The browser context menu is suppressed on the game canvas so the right mouse button can cast M2 `[tuned]`.
- The input mapper turns this into one `PlayerInput` per tick: `moveX` and `moveY` in -1, 0 or 1, the aim in whole centimeters, and a button bitmask for M1, M2, SPACE, Q, E, R, F and SHIFT `[spec]`. While C is held the aim is the champion's own position in whole centimeters, on every tick, and C sets no bit `[spec]`.
- The debug overlay toggles with F3 `[tuned]`. It is a developer tool and not a gameplay control.

## 7. Camera

- The camera is fixed `[spec]`.
- It is tilted about 55 degrees from horizontal `[spec]`.
- It is placed so the whole arena fits the viewport with margin `[spec]`.
- There is no rotation and no zoom in v1 `[spec]`.
- Rendering uses resolution-independent camera framing and a device-pixel-ratio aware canvas, so it scales from a browser tab to a fullscreen 4K window `[spec]`.

## 8. HUD

The HUD is an HTML and CSS overlay `[spec]`. It has these elements:

| Element | Content |
|---------|---------|
| Health bar | Current and max health of the local champion, in detail. A shield shows as an extra segment. |
| Energy bar | Energy from 0 to 100. Marks at 25 (EX ready) and 100 (ultimate ready). |
| Cooldown icons | One icon per slot: M1, M2, SPACE, Q, E, R, F. Each shows the remaining cooldown, and whether it is blocked by silence or low energy. |
| Round score | Round wins of both teams, with the 3 needed to win the match. |
| Round timer | Time left in the round. After it reaches 0 it shows sudden death. |
| Ring warning | A countdown from 10 s before sudden death starts `[tuned]`. During sudden death a red edge warning shows when the local champion is outside the ring. |
| Kill feed | A line per death, showing the killer (or "ring") and the victim. Shows up to 5 lines. Each line stays for 5 s `[tuned]`. |
| Debug overlay | Draws collision circles, obstacles, projectiles and line of sight `[spec]`. Off by default. |

Every champion also carries a world-space health bar above its model. It is green for allies and red for enemies `[tuned]`. The HUD health bar is the detailed view of the local champion only.

## 9. 2v2 and 3v3

`MatchConfig` sets the team size to 2 or 3 `[spec]`. Both teams always have the same size `[tuned]`.

| Aspect | 2v2 | 3v3 |
|--------|-----|-----|
| Champions per team | 2 | 3 |
| Spawn points used | The first two of the team's spawn points | All three of the team's spawn points |
| Spawn assignment | Players take spawn points in team order | Players take spawn points in team order |
| Everything else | Same | Same |

- Arena definitions list up to three spawn points per team, and a 2v2 uses the first two `[spec]`.
- The round and ring timings, energy values, health values and status rules are the same in both modes.
- The scoreboard shows more entries in 3v3. The kill feed keeps its five lines and the HUD layout is the same `[tuned]`.
- Local matches offer both sizes in the select (the result panel and the menu) and in the address (`?teamsize=`), and the default is 2v2 `[tuned]`. A 3v3 is the human with two ally bots against three enemy bots, so five bots play. An arena with two spawn points per team plays 2v2, and its 3v3 choice is greyed `[tuned]`.
