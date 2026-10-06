import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALLY_BAR_COLOUR, ENEMY_BAR_COLOUR } from './health-bars';

// The HUD and the result panel are drawn over the same screenshots that the e2e specs count pixels
// in: arena.spec counts magenta overlay pixels, combat.spec counts white flash
// pixels and yellow ring pixels. Their palette must stay out of those boxes,
// and away from the champion body colours.

type Rgb = readonly [number, number, number];

// The body colours of tools/blender/README.md (placeholder, hargrim, quillon,
// lumeth, skerrow), copied the way test_champion_models.py copies the client's.
const BODY_COLOURS: Record<string, string> = {
  placeholder: '#7ca0cb',
  hargrim: '#a63027',
  quillon: '#009589',
  lumeth: '#95c827',
  skerrow: '#303030',
};
const MIN_BODY_DISTANCE = 80;
// combat.spec: WHITE is 255 within 5 per channel, RING is #ffd23f within 8.
const WHITE_MIN = 250;
const RING_BOX = { min: [0xff - 8, 0xd2 - 8, 0x3f - 8], max: [255, 0xd2 + 8, 0x3f + 8] } as const;

interface Rule {
  selector: string;
  declarations: { property: string; value: string }[];
}

function parseRules(source: string): Rule[] {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  for (const match of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declarations = (match[2] ?? '')
      .split(';')
      .map((text) => text.trim())
      .filter((text) => text.length > 0)
      .map((text) => {
        const colon = text.indexOf(':');
        return { property: text.slice(0, colon).trim(), value: text.slice(colon + 1).trim() };
      });
    rules.push({ selector: (match[1] ?? '').trim(), declarations });
  }
  return rules;
}


/** A stylesheet whose rules are checked: its root element and the custom property names it owns. */
interface Sheet {
  file: string;
  root: string;
  prefix: string;
  unit: string;
}

const SHEETS: readonly Sheet[] = [
  { file: 'hud.css', root: '#hud', prefix: '--hud-', unit: '--hud-u' },
  { file: 'result.css', root: '#result', prefix: '--result-', unit: '--result-u' },
  { file: 'menu.css', root: '#menu', prefix: '--menu-', unit: '--menu-u' },
];

function load(sheet: Sheet) {
  const css = readFileSync(fileURLToPath(new URL(`./${sheet.file}`, import.meta.url)), 'utf8');
  const rules = parseRules(css);
  const rootRule = rules.find(
    (rule) => rule.selector === sheet.root && rule.declarations.some((d) => d.property.startsWith(sheet.prefix)),
  );
  /** The colours: every custom property of the root rule that is a hex literal. */
  const colours = (rootRule?.declarations ?? []).filter((d) => d.property.startsWith(sheet.prefix) && d.value.startsWith('#'));
  return { rules, rootRule, colours };
}

function rgbOf(hex: string): Rgb {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function alphaOf(hex: string): number {
  return hex.length === 9 ? Number.parseInt(hex.slice(7, 9), 16) : 255;
}

function distance(a: Rgb, b: Rgb): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

describe.each(SHEETS)('palette of $file', (sheet) => {
  const { rules, rootRule, colours } = load(sheet);

  function colour(name: string): string {
    const found = colours.find((d) => d.property === name);
    if (!found) throw new Error(`no colour ${name}`);
    return found.value.toLowerCase();
  }

  it('defines its colours as custom properties on its root', () => {
    expect(rootRule).toBeDefined();
    expect(colours.length).toBeGreaterThanOrEqual(2);
  });

  it('writes every colour as a 6 or 8 digit hex literal', () => {
    for (const { property, value } of colours) {
      expect(value, property).toMatch(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/);
    }
    const colourCustomProperties = (rootRule?.declarations ?? []).filter(
      (d) => d.property.startsWith(sheet.prefix) && d.property !== sheet.unit,
    );
    expect(colourCustomProperties.map((d) => d.property)).toEqual(colours.map((d) => d.property));
  });

  it('uses no colour literal, colour function or colour name outside those custom properties', () => {
    const named = /\b(black|white|red|green|blue|yellow|orange|purple|magenta|cyan|pink|gray|grey|silver|gold|lime|teal|navy|maroon|olive|aqua|fuchsia)\b/i;
    for (const rule of rules) {
      for (const { property, value } of rule.declarations) {
        if (property.startsWith(sheet.prefix) && rule.selector === sheet.root) continue;
        expect(value, `${rule.selector} { ${property} }`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(value, `${rule.selector} { ${property} }`).not.toMatch(/\b(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|color-mix)\(/i);
        expect(value, `${rule.selector} { ${property} }`).not.toMatch(named);
      }
    }
  });

  it('makes translucent colours neutral grey or black', () => {
    const translucent = colours.filter((d) => alphaOf(d.value) < 255);
    expect(translucent.length).toBeGreaterThanOrEqual(1);
    for (const { property, value } of translucent) {
      const [r, g, b] = rgbOf(value);
      expect(r === g && g === b, property).toBe(true);
    }
  });

  it('keeps the text off-white, below 250 in every channel', () => {
    const [r, g, b] = rgbOf(colour(`${sheet.prefix}text`));
    expect(Math.max(r, g, b)).toBeLessThan(WHITE_MIN);
    expect(Math.min(r, g, b)).toBeGreaterThanOrEqual(200);
  });

  it('has no blue, purple or magenta: blue at most 50 above green, and never the arena magenta relation', () => {
    for (const { property, value } of colours) {
      const [r, g, b] = rgbOf(value);
      expect(b - g, property).toBeLessThanOrEqual(50);
      // arena.spec counts a pixel as overlay when red and blue are both more than 50 above green.
      expect(r - g > 50 && b - g > 50, property).toBe(false);
    }
  });

  it('keeps every colour and its blends with black out of the white and ring boxes', () => {
    for (const { property, value } of colours) {
      const [r, g, b] = rgbOf(value);
      for (let step = 0; step <= 64; step++) {
        const scaled = [r, g, b].map((channel) => (channel * step) / 64);
        const white = scaled.every((channel) => channel >= WHITE_MIN);
        const ring = scaled.every((channel, i) => channel >= RING_BOX.min[i]! && channel <= RING_BOX.max[i]!);
        expect(white, `${property} at ${step}/64 is in the white box`).toBe(false);
        expect(ring, `${property} at ${step}/64 is in the ring box`).toBe(false);
      }
    }
  });

  it('keeps every colour at least 80 away from every champion body colour', () => {
    for (const { property, value } of colours) {
      for (const [name, body] of Object.entries(BODY_COLOURS)) {
        expect(distance(rgbOf(value), rgbOf(body)), `${property} against ${name}`).toBeGreaterThanOrEqual(
          MIN_BODY_DISTANCE,
        );
      }
    }
  });

  it('sizes everything from one viewport unit, so it scales with the window', () => {
    expect(rootRule?.declarations.find((d) => d.property === sheet.unit)?.value).toBe('min(1vw, 1.78vh)');
    for (const rule of rules) {
      for (const { property, value } of rule.declarations) {
        if (property.startsWith(sheet.prefix)) continue;
        expect(value, `${rule.selector} { ${property} }`).not.toMatch(/\d(px|rem|em)\b/);
      }
    }
  });
});

describe('HUD colours (hud.css)', () => {
  const { rules, colours } = load(SHEETS[0] as Sheet);

  function colour(name: string): string {
    const found = colours.find((d) => d.property === name);
    if (!found) throw new Error(`no colour ${name}`);
    return found.value.toLowerCase();
  }

  it('uses the health bar colours for allies and enemies', () => {
    expect(colour('--hud-ally')).toBe(ALLY_BAR_COLOUR);
    expect(colour('--hud-enemy')).toBe(ENEMY_BAR_COLOUR);
    const team = (side: string): string =>
      rules.find((rule) => rule.selector.includes(`data-team='${side}'`) || rule.selector.includes(`data-team="${side}"`))
        ?.declarations.find((d) => d.property === 'color')?.value ?? '';
    expect(team('ally')).toBe('var(--hud-ally)');
    expect(team('enemy')).toBe('var(--hud-enemy)');
  });

  it('draws the sudden death timer in the enemy colour', () => {
    const sudden = rules.find((rule) => rule.selector.includes("data-sudden='true'"));
    expect(sudden?.declarations.find((d) => d.property === 'color')?.value).toBe('var(--hud-enemy)');
  });
});

describe('ring warning (hud.css)', () => {
  const { rules } = load(SHEETS[0] as Sheet);

  function value(selectorPart: string, property: string): string | undefined {
    return rules
      .find((rule) => rule.selector.includes(selectorPart))
      ?.declarations.find((d) => d.property === property)?.value;
  }

  it('draws the red edge as a shadow in the enemy colour while outside', () => {
    const shadow = value("[data-hud='ring-warning'][data-outside='true']", 'box-shadow');
    expect(shadow).toContain('var(--hud-enemy)');
    expect(shadow).toMatch(/^inset /);
  });

  it('draws the outside text in the enemy colour', () => {
    expect(value("[data-hud='ring-warning'][data-outside='true'] [data-part='ring-size']", 'color')).toBe(
      'var(--hud-enemy)',
    );
  });

  it('puts the text on a panel and leaves the edge on none', () => {
    expect(value("[data-part='ring-panel']", 'background')).toBe('var(--hud-panel)');
    expect(value("[data-hud='ring-warning']", 'background')).toBe('none');
  });

  it('hides the warning while it is not visible', () => {
    expect(value("[data-hud='ring-warning'][data-visible='false']", 'display')).toBe('none');
  });
});

describe('pointer events', () => {
  it('reach the menu panel only while it is visible', () => {
    const { rules } = load(SHEETS[2] as Sheet);
    const root = rules.find((rule) => rule.selector === '#menu');
    expect(root?.declarations.find((d) => d.property === 'pointer-events')?.value).toBe('none');
    const taking = rules.filter((rule) => rule.declarations.some((d) => d.property === 'pointer-events' && d.value !== 'none'));
    expect(taking.map((rule) => rule.selector)).toEqual(["#menu [data-menu='panel'][data-visible='true']"]);
    expect(taking[0]?.declarations.find((d) => d.property === 'pointer-events')?.value).toBe('auto');
  });

  it('never reach the HUD, so a right click still reaches the canvas', () => {
    const { rules } = load(SHEETS[0] as Sheet);
    const hud = rules.find((rule) => rule.selector === '#hud');
    expect(hud?.declarations.find((d) => d.property === 'pointer-events')?.value).toBe('none');
    for (const rule of rules) {
      for (const { property, value } of rule.declarations) {
        if (property === 'pointer-events') expect(value, rule.selector).toBe('none');
      }
    }
  });

  it('reach the result panel only while it is visible', () => {
    const { rules } = load(SHEETS[1] as Sheet);
    const root = rules.find((rule) => rule.selector === '#result');
    expect(root?.declarations.find((d) => d.property === 'pointer-events')?.value).toBe('none');
    const taking = rules.filter((rule) => rule.declarations.some((d) => d.property === 'pointer-events' && d.value !== 'none'));
    expect(taking.map((rule) => rule.selector)).toEqual(["#result [data-result='panel'][data-visible='true']"]);
    expect(taking[0]?.declarations.find((d) => d.property === 'pointer-events')?.value).toBe('auto');
  });
});
