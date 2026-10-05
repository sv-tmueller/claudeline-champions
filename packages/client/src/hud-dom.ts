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
 * `Hud` writes. The six `data-hud` elements carry the names of rules.md
 * section 8. States are data attributes that the e2e specs read: `data-ready`,
 * `data-windup` and `data-blocked` on a slot, `data-ready` on an energy mark,
 * `data-visible` on a kill-feed line and `data-team` on its names.
 * The timer also carries `data-sudden`, true while it shows the sudden death
 * text. `roundsToWin` is the "first to N" of the score. The ring warning, the
 * shield segment and the silence state are not built yet.
 */
export function buildHud(root: HTMLElement, roundsToWin: number): HudHandles {
  const health = make(root, 'div', { 'data-hud': 'health-bar' });
  const healthTrack = make(health, 'div', { 'data-part': 'track' });
  const healthFill = make(healthTrack, 'div', { 'data-part': 'fill' });
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
    slots,
    score: scoreText,
    timer,
    lines,
  };
}
