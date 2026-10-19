import { SLOTS } from '@claudeline/sim';
import type { HudElement, HudHandles } from './hud';
import { KILL_FEED_LINES } from './kill-feed';

export function make(parent: HTMLElement, tag: string, attributes: Record<string, string> = {}, text = ''): HTMLElement {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  if (text) element.textContent = text;
  parent.appendChild(element);
  return element;
}

/**
 * Builds the HUD under `root`, once at startup, and returns the elements the
 * `Hud` writes. The seven `data-hud` elements built here carry the names of
 * rules.md section 8 (the eighth, the scoreboard, is built by scoreboard-dom.ts).
 * States are data attributes that the e2e specs read: `data-ready`,
 * `data-windup`, `data-blocked` and `data-silenced` on a slot (the silence is
 * the same for all seven), `data-ready` on an energy mark,
 * `data-visible` on a kill-feed line and `data-team` on its names.
 * The shield segment sits inside the health track: `data-part="shield"` carries
 * `data-visible` and `data-absorb`, and its `shield-fill` child the width.
 * The timer also carries `data-sudden`, true while it shows the sudden death
 * text. The ring warning carries `data-visible`, `data-counting` (the countdown
 * before the ring) and `data-outside` (the red edge). `roundsToWin` is the
 * "first to N" of the score.
 */
export function buildHud(root: HTMLElement, roundsToWin: number): HudHandles {
  const health = make(root, 'div', { 'data-hud': 'health-bar' });
  const healthTrack = make(health, 'div', { 'data-part': 'track' });
  const healthFill = make(healthTrack, 'div', { 'data-part': 'fill' });
  // Built hidden at 0 absorb, which `Hud` starts from, so the first update writes nothing for it.
  const shield = make(healthTrack, 'div', { 'data-part': 'shield', 'data-visible': 'false', 'data-absorb': '0' });
  const shieldFill = make(shield, 'div', { 'data-part': 'shield-fill' });
  const healthText = make(health, 'span', { 'data-part': 'health-text' });

  const energy = make(root, 'div', { 'data-hud': 'energy-bar' });
  const energyTrack = make(energy, 'div', { 'data-part': 'track' });
  const energyFill = make(energyTrack, 'div', { 'data-part': 'fill' });
  const exMark = make(energyTrack, 'div', { 'data-mark': 'ex' });
  const ultimateMark = make(energyTrack, 'div', { 'data-mark': 'ultimate' });

  const icons = make(root, 'div', { 'data-hud': 'cooldown-icons' });
  const slots = SLOTS.map((slot) => {
    const icon = make(icons, 'div', { 'data-slot': slot });
    make(icon, 'span', { 'data-part': 'key' }, slot);
    const seconds = make(icon, 'span', { 'data-part': 'seconds' });
    return { icon: icon as HudElement, seconds: seconds as HudElement };
  });

  const score = make(root, 'div', { 'data-hud': 'round-score' });
  const scoreText = make(score, 'span', { 'data-part': 'score' });
  make(score, 'span', { 'data-part': 'goal' }, `first to ${roundsToWin}`);
  const timer = make(root, 'div', { 'data-hud': 'round-timer' });

  // The warning's root covers the viewport so that it can draw the red edge. Its text
  // sits on a panel of its own. Built hidden, not counting and not outside.
  const warning = make(root, 'div', {
    'data-hud': 'ring-warning',
    'data-visible': 'false',
    'data-counting': 'false',
    'data-outside': 'false',
  });
  const warningPanel = make(warning, 'div', { 'data-part': 'ring-panel' });
  const count = make(warningPanel, 'div', { 'data-part': 'ring-count' });
  make(count, 'span', {}, 'Sudden death in');
  const countdown = make(count, 'span', { 'data-part': 'ring-countdown' });
  const size = make(warningPanel, 'div', { 'data-part': 'ring-size' });
  make(size, 'span', {}, 'Ring');
  const radius = make(size, 'span', { 'data-part': 'ring-radius' });
  const away = make(size, 'span', { 'data-part': 'ring-away' });
  const distance = make(away, 'span', { 'data-part': 'ring-distance' });
  make(away, 'span', {}, 'outside');

  const feed = make(root, 'div', { 'data-hud': 'kill-feed' });
  const lines: HudHandles['lines'][number][] = [];
  for (let i = 0; i < KILL_FEED_LINES; i++) {
    const line = make(feed, 'div', { 'data-line': String(i) });
    const killer = make(line, 'span', { 'data-part': 'killer' });
    make(line, 'span', { 'data-part': 'arrow' }, '>');
    const victim = make(line, 'span', { 'data-part': 'victim' });
    lines.push({ line, killer, victim });
  }

  return {
    healthText,
    healthFill,
    energyFill,
    exMark,
    ultimateMark,
    shield: { root: shield as HudElement, fill: shieldFill as HudElement },
    slots,
    score: scoreText,
    timer,
    ring: {
      root: warning as HudElement,
      countdown: countdown as HudElement,
      radius: radius as HudElement,
      distance: distance as HudElement,
    },
    lines,
  };
}
