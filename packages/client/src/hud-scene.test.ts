import { Button, SLOTS, createMatch, debug, parseArenaDef, step, type GameState, type PlayerInput } from '@claudeline/sim';
import { describe, expect, it } from 'vitest';
import arena01Json from '../../../data/arenas/arena01.json';
import { createAnims } from './champion-anim';
import { CombatFeedback, routeEvents } from './feedback';
import { Hud, type HudHandles } from './hud';
import { createImpactRings } from './impact-rings';
import { KILL_FEED_LINES, createKillFeed } from './kill-feed';
import { Scoreboard } from './scoreboard';
import { fake, type Fake } from './test-fake';
import { HARGRIM_KIT, QUILLON_KIT, SKERROW_KIT } from './test-kits';

// The scripted scene of the shield, the silence and the scoreboard, headless: the real sim, the
// real routeEvents, CombatFeedback, Hud and Scoreboard, with counting fakes for the elements. No
// local scene can silence the local champion in a browser (Skerrow is never an enemy of the
// sandbox with a kit), so the silence flag is shown here and e2e/hud.spec.ts reads it false
// (decision 6 of batch #134). The local champion is Hargrim (0); Skerrow (3) is on team B with her
// kit and Lumeth (2) has none.

const HUMAN = 0;
const LUMETH = 2;
const SKERROW = 3;

interface Scene {
  state: GameState;
  hud: Hud;
  board: Scoreboard;
  feedback: CombatFeedback;
  shield: { root: Fake; fill: Fake };
  slots: { icon: Fake; seconds: Fake }[];
  boardRoot: Fake;
  rows: { row: Fake; state: Fake; kills: Fake; deaths: Fake }[];
  /** One sim tick with the buttons of champions 0 and 3, then the event pass and both writers. */
  tick(buttons0?: number, buttons3?: number): void;
}

function scene(): Scene {
  const state = createMatch(
    {
      teamSize: 2,
      players: [
        { championId: 'hargrim', team: 'A' },
        { championId: 'quillon', team: 'A' },
        { championId: 'lumeth', team: 'B' },
        { championId: 'skerrow', team: 'B' },
      ],
      roundsToWin: 3,
    },
    parseArenaDef(arena01Json),
    1,
    [HARGRIM_KIT, QUILLON_KIT, SKERROW_KIT],
  );
  const shield = { root: fake(), fill: fake() };
  const slots = SLOTS.map(() => ({ icon: fake(), seconds: fake() }));
  const elements = {
    healthText: fake(),
    healthFill: fake(),
    energyFill: fake(),
    exMark: fake(),
    ultimateMark: fake(),
    shield,
    slots,
    score: fake(),
    timer: fake(),
    ring: { root: fake(), countdown: fake(), radius: fake(), distance: fake() },
    lines: Array.from({ length: KILL_FEED_LINES }, () => ({ line: fake(), killer: fake(), victim: fake() })),
  };
  const feed = createKillFeed();
  const handles: HudHandles = elements;
  const hud = new Hud(handles, state.champions, HUMAN, feed, 3);
  const feedback = new CombatFeedback(state.champions, 'A', createImpactRings(), feed, createAnims(4));
  const boardRoot = fake();
  const rows = state.champions.map(() => ({ row: fake(), state: fake(), kills: fake(), deaths: fake() }));
  const board = new Scoreboard({ root: boardRoot, rows }, feedback);
  hud.update(state);
  board.update(state);
  const inputs: PlayerInput[] = state.champions.map(() => ({ moveX: 0, moveY: 0, aimX: 0, aimY: 0, buttons: 0 }));
  return {
    state,
    hud,
    board,
    feedback,
    shield,
    slots,
    boardRoot,
    rows,
    tick(buttons0 = 0, buttons3 = 0) {
      const human = state.champions[HUMAN];
      const skerrow = state.champions[SKERROW];
      if (!human || !skerrow) throw new Error('no champions');
      // Each side aims at the other, in whole centimetres.
      inputs[HUMAN] = { moveX: 0, moveY: 0, aimX: Math.round(skerrow.x * 100), aimY: Math.round(skerrow.y * 100), buttons: buttons0 };
      inputs[SKERROW] = { moveX: 0, moveY: 0, aimX: Math.round(human.x * 100), aimY: Math.round(human.y * 100), buttons: buttons3 };
      step(state, inputs);
      routeEvents(state, feedback);
      hud.update(state);
      board.update(state);
    },
  };
}

/** Steps through the warmup and puts Hargrim and Skerrow 8 m apart on open ground. */
function startRound(s: Scene): void {
  while (s.state.match?.phase === 'warmup') s.tick();
  const human = s.state.champions[HUMAN];
  const skerrow = s.state.champions[SKERROW];
  if (!human || !skerrow) throw new Error('no champions');
  human.x = -4;
  human.y = 3;
  skerrow.x = 4;
  skerrow.y = 3;
}

function entries(element: Fake, prefix: string): string[] {
  return element.log.filter((entry) => entry.startsWith(prefix));
}

describe('the shield, the silence and the scoreboard in a scripted scene', () => {
  it('shows the shield of R at 40, and 32 after a dart has hit it', () => {
    const s = scene();
    startRound(s);
    expect(entries(s.shield.root, 'data-absorb')).toEqual([]);
    s.tick(Button.R);
    expect(entries(s.shield.root, 'data-absorb')).toEqual(['data-absorb=40']);
    expect(entries(s.shield.root, 'data-visible')).toEqual(['data-visible=true']);
    // Hargrim stands at full health, so 40 of 160 is the last quarter of the track.
    expect(entries(s.shield.root, 'transform')).toEqual(['transform=translateX(75%)']);
    expect(entries(s.shield.fill, 'transform')).toEqual(['transform=scaleX(0.25)']);
    for (let i = 0; i < 60 && entries(s.shield.root, 'data-absorb').length < 2; i++) {
      s.tick(0, i === 0 ? Button.Q : 0);
    }
    expect(entries(s.shield.root, 'data-absorb')).toEqual(['data-absorb=40', 'data-absorb=32']);
    // The dart did no damage to the health: the shield took all 8.
    expect(s.state.champions[HUMAN]?.health).toBe(160);
    expect(entries(s.shield.fill, 'transform').at(-1)).toBe(`transform=scaleX(${32 / 160})`);
  });

  it('silences all seven slots for the 90 ticks of the dart, then lifts it', () => {
    const s = scene();
    startRound(s);
    s.tick(Button.R);
    for (const slot of s.slots) expect(entries(slot.icon, 'data-silenced')).toEqual(['data-silenced=false']);
    let hitTick = -1;
    for (let i = 0; i < 60 && hitTick < 0; i++) {
      s.tick(0, i === 0 ? Button.Q : 0);
      if (entries(s.slots[0]?.icon as Fake, 'data-silenced').length === 2) hitTick = s.state.tick;
    }
    expect(hitTick).toBeGreaterThan(0);
    for (const slot of s.slots) {
      expect(entries(slot.icon, 'data-silenced')).toEqual(['data-silenced=false', 'data-silenced=true']);
    }
    // F stays blocked by its energy and no other slot is: the silence has its own flag.
    expect(s.slots.map((slot) => entries(slot.icon, 'data-blocked').at(-1))).toEqual([
      'data-blocked=false',
      'data-blocked=false',
      'data-blocked=false',
      'data-blocked=false',
      'data-blocked=false',
      'data-blocked=false',
      'data-blocked=true',
    ]);
    let liftTick = -1;
    for (let i = 0; i < 200 && liftTick < 0; i++) {
      s.tick();
      if (entries(s.slots[0]?.icon as Fake, 'data-silenced').length === 3) liftTick = s.state.tick;
    }
    expect(liftTick - hitTick).toBe(90);
    for (const slot of s.slots) {
      expect(entries(slot.icon, 'data-silenced')).toEqual(['data-silenced=false', 'data-silenced=true', 'data-silenced=false']);
    }
  });

  it('counts a scripted kill on the scoreboard: a kill for Hargrim and a death for Lumeth, and the row dead', () => {
    const s = scene();
    startRound(s);
    const lumeth = s.state.champions[LUMETH];
    if (!lumeth) throw new Error('no champion 2');
    debug.spawnProjectile(s.state, {
      ownerId: HUMAN,
      x: lumeth.x - 3,
      y: lumeth.y,
      dirX: 1,
      dirY: 0,
      speed: 10,
      radius: 0.25,
      lifetimeTicks: 180,
      pierce: false,
      effects: [{ type: 'damage', amount: 500 }],
    });
    for (let i = 0; i < 90 && s.feedback.deaths === 0; i++) s.tick();
    expect(s.feedback.deaths).toBe(1);
    expect(s.rows.map((r) => entries(r.kills, 'text'))).toEqual([['text=1'], [], [], []]);
    expect(s.rows.map((r) => entries(r.deaths, 'text'))).toEqual([[], [], ['text=1'], []]);
    expect(entries(s.rows[LUMETH]?.row as Fake, 'data-alive')).toEqual(['data-alive=false']);
    expect(entries(s.rows[LUMETH]?.state as Fake, 'text')).toEqual(['text=Dead']);
    // The scoreboard wrote while hidden; showing it adds the one visibility write.
    expect(s.boardRoot.log).toEqual([]);
    s.board.show();
    expect(s.boardRoot.log).toEqual(['data-visible=true']);
  });

  it('writes nothing to the scoreboard or the shield on ticks where nothing changed', () => {
    const s = scene();
    startRound(s);
    s.tick();
    const before = [s.boardRoot.log.length, ...s.rows.map((r) => r.row.log.length + r.state.log.length + r.kills.log.length + r.deaths.log.length), s.shield.root.log.length, s.shield.fill.log.length];
    for (let i = 0; i < 30; i++) s.tick();
    const after = [s.boardRoot.log.length, ...s.rows.map((r) => r.row.log.length + r.state.log.length + r.kills.log.length + r.deaths.log.length), s.shield.root.log.length, s.shield.fill.log.length];
    expect(after).toEqual(before);
  });
});
