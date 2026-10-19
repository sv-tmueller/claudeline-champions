import type { TeamId } from '@claudeline/sim';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindScoreboard, buildScoreboard, scoreboardEntries } from './scoreboard-dom';

interface KeyInit {
  code: string;
  repeat?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}

function key(type: 'keydown' | 'keyup', init: KeyInit): Event {
  return Object.assign(new Event(type, { cancelable: true }), {
    repeat: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    ...init,
  });
}

function setup(menuOpen = false) {
  const calls: string[] = [];
  const state = { menuOpen };
  const win = new EventTarget();
  const unbind = bindScoreboard(
    win,
    { show: () => calls.push('show'), hide: () => calls.push('hide') },
    () => state.menuOpen,
  );
  return { calls, state, win, unbind };
}

describe('bindScoreboard', () => {
  it('shows on Tab down and stops the browser default', () => {
    const { calls, win } = setup();
    const event = key('keydown', { code: 'Tab' });
    win.dispatchEvent(event);
    expect(calls).toEqual(['show']);
    expect(event.defaultPrevented).toBe(true);
  });

  it('shows again on the repeats of a held Tab, and stops their default too', () => {
    const { calls, win } = setup();
    win.dispatchEvent(key('keydown', { code: 'Tab' }));
    const repeat = key('keydown', { code: 'Tab', repeat: true });
    win.dispatchEvent(repeat);
    expect(calls).toEqual(['show', 'show']);
    expect(repeat.defaultPrevented).toBe(true);
  });

  it('hides on Tab up', () => {
    const { calls, win } = setup();
    win.dispatchEvent(key('keydown', { code: 'Tab' }));
    win.dispatchEvent(key('keyup', { code: 'Tab' }));
    expect(calls).toEqual(['show', 'hide']);
  });

  it('ignores the other keys', () => {
    const { calls, win } = setup();
    const down = key('keydown', { code: 'KeyW' });
    win.dispatchEvent(down);
    win.dispatchEvent(key('keyup', { code: 'KeyW' }));
    expect(calls).toEqual([]);
    expect(down.defaultPrevented).toBe(false);
  });

  it('ignores Tab with Ctrl, Alt or Meta held, and leaves the default to the browser', () => {
    const { calls, win } = setup();
    for (const modifier of ['ctrlKey', 'altKey', 'metaKey'] as const) {
      const event = key('keydown', { code: 'Tab', [modifier]: true });
      win.dispatchEvent(event);
      expect(event.defaultPrevented, modifier).toBe(false);
    }
    expect(calls).toEqual([]);
  });

  it('shows with Shift held, since Shift+Tab is the same key to the player', () => {
    const { calls, win } = setup();
    win.dispatchEvent(Object.assign(key('keydown', { code: 'Tab' }), { shiftKey: true }));
    expect(calls).toEqual(['show']);
  });

  it('does nothing while the menu is open, and does not stop the default', () => {
    const { calls, win } = setup(true);
    const down = key('keydown', { code: 'Tab' });
    win.dispatchEvent(down);
    win.dispatchEvent(key('keyup', { code: 'Tab' }));
    expect(calls).toEqual([]);
    expect(down.defaultPrevented).toBe(false);
  });

  it('acts again once the menu has closed', () => {
    const { calls, state, win } = setup(true);
    win.dispatchEvent(key('keydown', { code: 'Tab' }));
    state.menuOpen = false;
    const event = key('keydown', { code: 'Tab' });
    win.dispatchEvent(event);
    expect(calls).toEqual(['show']);
    expect(event.defaultPrevented).toBe(true);
  });

  it('hides when the window loses focus', () => {
    const { calls, win } = setup();
    win.dispatchEvent(key('keydown', { code: 'Tab' }));
    win.dispatchEvent(new Event('blur'));
    expect(calls).toEqual(['show', 'hide']);
  });

  it('hides when the page changes visibility: the event bubbles from the document to the window', () => {
    const { calls, win } = setup();
    win.dispatchEvent(key('keydown', { code: 'Tab' }));
    win.dispatchEvent(new Event('visibilitychange'));
    expect(calls).toEqual(['show', 'hide']);
  });

  it('stops listening after the returned function runs', () => {
    const { calls, win, unbind } = setup();
    unbind();
    win.dispatchEvent(key('keydown', { code: 'Tab' }));
    win.dispatchEvent(key('keyup', { code: 'Tab' }));
    win.dispatchEvent(new Event('blur'));
    expect(calls).toEqual([]);
  });
});

const TEAMS_2V2: { championId: string; team: TeamId }[] = [
  { championId: 'hargrim', team: 'A' },
  { championId: 'quillon', team: 'A' },
  { championId: 'lumeth', team: 'B' },
  { championId: 'skerrow', team: 'B' },
];
const TEAMS_3V3: { championId: string; team: TeamId }[] = [
  { championId: 'hargrim', team: 'A' },
  { championId: 'quillon', team: 'A' },
  { championId: 'lumeth', team: 'A' },
  { championId: 'hargrim', team: 'B' },
  { championId: 'quillon', team: 'B' },
  { championId: 'lumeth', team: 'B' },
];

describe('scoreboardEntries', () => {
  it('lists the local team first, each team in id order', () => {
    expect(scoreboardEntries(TEAMS_2V2, 'A').map((entry) => [entry.id, entry.side])).toEqual([
      [0, 'ally'],
      [1, 'ally'],
      [2, 'enemy'],
      [3, 'enemy'],
    ]);
  });

  it('puts team B first when it is the local team, and calls it ally', () => {
    expect(scoreboardEntries(TEAMS_2V2, 'B').map((entry) => [entry.id, entry.side])).toEqual([
      [2, 'ally'],
      [3, 'ally'],
      [0, 'enemy'],
      [1, 'enemy'],
    ]);
  });

  it('carries the champion id, and lists six rows of a 3v3', () => {
    const entries = scoreboardEntries(TEAMS_3V3, 'A');
    expect(entries).toHaveLength(6);
    expect(entries.map((entry) => entry.championId)).toEqual(TEAMS_3V3.map((champion) => champion.championId));
  });
});

// A document that builds fake elements, so buildScoreboard can run in node and the test reads what
// it built: the attributes, the text and the children, in order.
interface BuiltElement {
  tag: string;
  attributes: Record<string, string>;
  textContent: string | null;
  children: BuiltElement[];
  setAttribute(name: string, value: string): void;
  appendChild(child: BuiltElement): void;
}

function builtElement(tag: string): BuiltElement {
  const element: BuiltElement = {
    tag,
    attributes: {},
    textContent: null,
    children: [],
    setAttribute(name, value) {
      element.attributes[name] = value;
    },
    appendChild(child) {
      element.children.push(child);
    },
  };
  return element;
}

describe('buildScoreboard', () => {
  afterEach(() => vi.unstubAllGlobals());

  function build(champions: typeof TEAMS_2V2, localTeam: TeamId) {
    vi.stubGlobal('document', { createElement: builtElement });
    const root = builtElement('div');
    const handles = buildScoreboard(root as unknown as HTMLElement, champions, localTeam);
    const board = root.children[0] as BuiltElement;
    return { root, board, handles };
  }

  it('builds the hidden board with a header and six rows of a 3v3, handles by champion id', () => {
    const { root, board, handles } = build(TEAMS_3V3, 'A');
    expect(root.children).toHaveLength(1);
    expect(board.attributes).toEqual({ 'data-hud': 'scoreboard', 'data-visible': 'false' });
    expect(board.children.map((row) => row.attributes['data-row'])).toEqual(['header', '0', '1', '2', '3', '4', '5']);
    expect(handles.rows).toHaveLength(6);
    expect(handles.root).toBe(board);
    const [, ...rows] = board.children;
    expect(rows.map((row) => row.attributes['data-team'])).toEqual(['ally', 'ally', 'ally', 'enemy', 'enemy', 'enemy']);
    for (const row of rows) expect(row.attributes['data-alive']).toBe('true');
  });

  it('writes the start values into the cells, and the handles are the page elements', () => {
    const { board, handles } = build(TEAMS_2V2, 'A');
    const lumeth = board.children[3] as BuiltElement;
    expect(lumeth.children.map((cell) => [cell.attributes['data-part'], cell.textContent])).toEqual([
      ['team', 'Enemy'],
      ['name', 'Lumeth'],
      ['state', 'Alive'],
      ['kills', '0'],
      ['deaths', '0'],
    ]);
    expect(handles.rows[2]?.row).toBe(lumeth);
  });

  it('orders the page rows by the local team but keeps the handles by champion id', () => {
    const { board, handles } = build(TEAMS_2V2, 'B');
    expect(board.children.map((row) => row.attributes['data-row'])).toEqual(['header', '2', '3', '0', '1']);
    expect((board.children[1] as BuiltElement).attributes['data-team']).toBe('ally');
    expect(handles.rows[0]?.row).toBe(board.children[3]);
  });
});
