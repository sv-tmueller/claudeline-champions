// The parser of `npm run trace` (#328): the lines of a hook-free Chromium trace in, the stints of
// the bots' functions out. Pure, and it imports nothing: no file, no browser, no clock. The runner
// (run.ts) reads the files, drives the match and passes the texts and the lines in. The method is
// bots.md's, "The drops of #303, measured (#318)", step 3.
//
// The log has two kinds of line. V8's start with `[`. The runner's marker lines start with `#`:
// `#window {"tick":T,"phase":P,"round":R}`, appended after each window's read of the canvas
// hooks. A V8 line takes the tick of the first marker after it.

export interface BotsNames {
  bots: Set<string>;
  ambiguous: Set<string>;
}

export interface Stint {
  name: string;
  /** The name is also a function of sim or client source (or `think`), so the line may be another one's. */
  ambiguous: boolean;
  /** `deopt` is a bailout line, `marked` a "marking dependent code" line. */
  how: 'deopt' | 'marked';
  /** deopt-eager, deopt-lazy or deopt-soft; of the bailout line, so a mark that a lazy bailout follows has it too. */
  kind?: string;
  /** The bytecode offset of the bailout line. */
  offset?: number;
  reason: string;
  dropTick: number;
  /** The tick of the window of the first recompile line after the drop line; null when none follows. */
  backTick: number | null;
  backTarget?: 'MAGLEV' | 'TURBOFAN_JS';
  /** backTick - dropTick. */
  ticks: number | null;
  /** The drop begins after the warm-up end. */
  afterWarmUp: boolean;
}

export interface TraceReport {
  /** The first read of each round, in order. */
  roundStarts: { round: string; tick: number }[];
  warmUpEnd: number | null;
  matchEnd: number | null;
  stints: Stint[];
  /** The lines of bots functions after the last marker: printed, never dropped. */
  afterLastWindow: string[];
}

/** The warm-up of live-probe.spec.ts: the first round that begins after this tick ends it. */
export const WARM_UP_TICKS = 2100;

const DECLARATION = /\b(?:function|const)\s+([A-Za-z_$][\w$]*)/g;

function declared(texts: readonly string[]): Set<string> {
  const names = new Set<string>();
  for (const text of texts) for (const match of text.matchAll(DECLARATION)) names.add(match[1] as string);
  return names;
}

/**
 * The names a trace line may belong to: the `function` and `const` names of the bots sources, plus
 * `think` and `inspect`. A name is ambiguous when the same scan finds it in `others` (sim and client
 * source), and `think` always is, since the client's `BotDriver.think` method shares it.
 */
export function botsNames(bots: readonly string[], others: readonly string[]): BotsNames {
  const names = declared(bots);
  names.add('think');
  names.add('inspect');
  const elsewhere = declared(others);
  const ambiguous = new Set<string>(['think']);
  for (const name of names) if (elsewhere.has(name)) ambiguous.add(name);
  return { bots: names, ambiguous };
}

const BAILOUT = /^\[bailout \(kind: ([\w-]+), reason: (.*?)\): begin\..*?<JSFunction (\S+)[^>]*>/;
const OFFSET = /bytecode offset (\d+)/;
const MARKING = /^\[marking dependent code .*?<SharedFunctionInfo (\S+?)>.*reason: (.*?)\]\s*$/;
const COMPILED = /^\[completed compiling .*?<JSFunction (\S+)[^>]*> \(target (MAGLEV|TURBOFAN_JS)\)(.*)$/;
const WINDOW_MARKER = /^#window (\{.*\})\s*$/;

type Event =
  | { type: 'bailout'; name: string; kind: string; reason: string; offset: number | undefined; line: string }
  | { type: 'marking'; name: string; reason: string; line: string }
  | { type: 'compiled'; name: string; target: 'MAGLEV' | 'TURBOFAN_JS'; line: string };

function readEvent(line: string, names: ReadonlySet<string>): Event | null {
  if (!line.startsWith('[')) return null;
  const bailout = BAILOUT.exec(line);
  if (bailout) {
    const name = bailout[3] as string;
    if (!names.has(name)) return null;
    const offset = OFFSET.exec(line);
    return {
      type: 'bailout',
      name,
      kind: bailout[1] as string,
      reason: bailout[2] as string,
      offset: offset ? Number(offset[1]) : undefined,
      line,
    };
  }
  const marking = MARKING.exec(line);
  if (marking) {
    const name = marking[1] as string;
    return names.has(name) ? { type: 'marking', name, reason: marking[2] as string, line } : null;
  }
  const compiled = COMPILED.exec(line);
  if (compiled) {
    const name = compiled[1] as string;
    // An on-stack replacement compile is no recompile of the function for its next call.
    if (!names.has(name) || /\bOSR\b/.test(compiled[3] as string)) return null;
    return { type: 'compiled', name, target: compiled[2] as 'MAGLEV' | 'TURBOFAN_JS', line };
  }
  return null;
}

interface Read {
  tick: number;
  phase: string;
  round: string;
}

function readMarker(line: string): Read | null {
  const match = WINDOW_MARKER.exec(line);
  if (!match) return null;
  const value = JSON.parse(match[1] as string) as { tick: number; phase: string; round: string };
  return { tick: Number(value.tick), phase: String(value.phase), round: String(value.round) };
}

export function parseTrace(
  lines: readonly string[],
  names: { bots: ReadonlySet<string>; ambiguous: ReadonlySet<string> },
  warmUpTicks: number = WARM_UP_TICKS,
): TraceReport {
  const reads: Read[] = [];
  for (const line of lines) {
    const read = readMarker(line);
    if (read) reads.push(read);
  }
  const roundStarts: { round: string; tick: number }[] = [];
  let warmUpEnd: number | null = null;
  let matchEnd: number | null = null;
  reads.forEach((read, i) => {
    const before = reads[i - 1];
    if (!before || before.round !== read.round) roundStarts.push({ round: read.round, tick: read.tick });
    // live-probe.spec.ts's condition: a round phase read at or after the warm-up ticks that is not
    // the same round as the read before.
    if (warmUpEnd === null && read.tick >= warmUpTicks && read.phase === 'round' && (!before || before.phase !== 'round' || before.round !== read.round)) {
      warmUpEnd = read.tick;
    }
    if (matchEnd === null && read.phase === 'matchEnd') matchEnd = read.tick;
  });

  const stints: Stint[] = [];
  const open = new Map<string, Stint>();
  const afterLastWindow: string[] = [];
  let pending: Event[] = [];

  const apply = (event: Event, tick: number): void => {
    const current = open.get(event.name);
    if (event.type === 'compiled') {
      if (!current) return;
      current.backTick = tick;
      current.backTarget = event.target;
      current.ticks = tick - current.dropTick;
      open.delete(event.name);
      return;
    }
    if (current) {
      // A mark that a lazy bailout of the same function follows is one stint, dated at the mark.
      if (event.type === 'bailout' && current.how === 'marked' && current.kind === undefined) {
        current.kind = event.kind;
        if (event.offset !== undefined) current.offset = event.offset;
      }
      return;
    }
    const stint: Stint = {
      name: event.name,
      ambiguous: names.ambiguous.has(event.name),
      how: event.type === 'bailout' ? 'deopt' : 'marked',
      reason: event.reason,
      dropTick: tick,
      backTick: null,
      ticks: null,
      afterWarmUp: warmUpEnd !== null && tick > warmUpEnd,
    };
    if (event.type === 'bailout') {
      stint.kind = event.kind;
      if (event.offset !== undefined) stint.offset = event.offset;
    }
    stints.push(stint);
    open.set(event.name, stint);
  };

  for (const line of lines) {
    const read = readMarker(line);
    if (read) {
      for (const event of pending) apply(event, read.tick);
      pending = [];
      continue;
    }
    const event = readEvent(line, names.bots);
    if (event) pending.push(event);
  }
  for (const event of pending) afterLastWindow.push(event.line);

  return { roundStarts, warmUpEnd, matchEnd, stints, afterLastWindow };
}

function label(stint: Stint): string {
  const kind = stint.how === 'marked' ? `marked${stint.kind ? ` ${stint.kind}` : ''}` : (stint.kind ?? 'deopt');
  return stint.offset === undefined ? kind : `${kind} @${stint.offset}`;
}

function stintLine(stint: Stint, matchEnd: number | null): string {
  const head = `  ${label(stint)} ${stint.reason}: drop ${stint.dropTick}, `;
  if (stint.backTick !== null) return `${head}back ${stint.backTick} in ${stint.backTarget} (${stint.ticks} ticks)`;
  if (matchEnd === null) return `${head}open (no match end was read)`;
  return `${head}open to the match end at ${matchEnd} (${matchEnd - stint.dropTick} ticks)`;
}

export function formatReport(report: TraceReport): string {
  const out: string[] = [];
  out.push(`Rounds: ${report.roundStarts.map((r) => `${r.round} at ${r.tick}`).join(', ') || 'none'}`);
  out.push(`Warm-up end ${report.warmUpEnd ?? 'not reached'}, match end ${report.matchEnd ?? 'not reached'}`);
  out.push('');
  const groups = new Map<string, Stint[]>();
  for (const stint of report.stints) {
    const group = groups.get(stint.name);
    if (group) group.push(stint);
    else groups.set(stint.name, [stint]);
  }
  for (const [name, stints] of groups) {
    out.push(`${name}${stints[0]?.ambiguous ? '*' : ''}`);
    for (const stint of stints) out.push(stintLine(stint, report.matchEnd));
  }
  if (groups.size === 0) out.push('No drop of a bots function.');
  out.push('');
  out.push('* The name is also a function of sim or client source (or `think`): the line may be that one.');
  out.push('"open" means no compile line of the function\'s own after the drop; it may be inlined into its caller.');
  out.push('A tick is that of the window whose read follows the line: 29, 59, ... , 30k + 29.');
  if (report.afterLastWindow.length > 0) {
    out.push('');
    out.push(`Lines of bots functions after the last window (${report.afterLastWindow.length}):`);
    for (const line of report.afterLastWindow) out.push(`  ${line}`);
  }
  out.push('');
  const late = report.stints.filter((s) => s.afterWarmUp);
  const summary = late.map((s) => `${s.name}${s.ambiguous ? '*' : ''}${s.offset === undefined ? '' : ` @${s.offset}`} at ${s.dropTick}`);
  out.push(`Drops after the warm-up end ${report.warmUpEnd ?? '(not reached)'}: ${summary.length > 0 ? summary.join(', ') : 'none'}`);
  return `${out.join('\n')}\n`;
}
