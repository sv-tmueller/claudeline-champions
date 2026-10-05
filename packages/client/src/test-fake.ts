import type { HudElement } from './hud';

// A stand-in for an element that logs every write, so a test can say how often
// and with what the HUD or the result screen touched the DOM. No jsdom: the
// client tests run in node. A test-only module, which main.ts never imports.
export type Fake = HudElement & { log: string[] };

export function fake(): Fake {
  const log: string[] = [];
  let text: string | null = '';
  let transform = '';
  return {
    log,
    // No `dataset`: the HUD writes attributes with setAttribute, see HudElement.
    setAttribute(name: string, value: string) {
      log.push(`${name}=${value}`);
    },
    style: {
      get transform() {
        return transform;
      },
      set transform(value: string) {
        log.push(`transform=${value}`);
        transform = value;
      },
    },
    get textContent() {
      return text;
    },
    set textContent(value: string | null) {
      log.push(`text=${String(value)}`);
      text = value;
    },
  };
}

