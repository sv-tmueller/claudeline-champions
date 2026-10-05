import type { HudElement } from './hud';

// A stand-in for an element that logs every write, so a test can say how often
// and with what the HUD or the result screen touched the DOM. No jsdom: the
// client tests run in node. A test-only module, which main.ts never imports.
export type Fake = HudElement & { log: string[] };

export function fake(): Fake {
  const log: string[] = [];
  const dataset = new Proxy<Record<string, string | undefined>>(
    {},
    {
      set(target, key, value: string) {
        log.push(`data-${String(key)}=${value}`);
        target[key as string] = value;
        return true;
      },
    },
  );
  let text: string | null = '';
  let transform = '';
  return {
    log,
    dataset,
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

