import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism, loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from '@playwright/test';
import { originOf, readPort } from '../../e2e/port.ts';
import { botsNames, formatReport, parseTrace } from './parse.ts';

// `npm run trace` (#328): a hook-free trace of one match. It runs the unmodified client in
// Playwright's Chromium with only `--js-flags=--trace-opt --trace-deopt`, no hook and no CDP
// session (a session's sampling profiler forces a Mark-Compact that throws optimized code back, #304),
// drives the match to its end with the live probe's script, and prints where each function of
// packages/bots/src dropped out of optimized code and when it came back. The method is bots.md's,
// "The drops of #303, measured (#318)". It is manual: CI neither runs it nor builds it.
//
//   CLAUDELINE_PORT=<port> npm run trace -- [--champion <kit>] [--teamsize 2|3] [--arena <id>]
//     [--difficulty easy|normal|hard] [--log <file>]
//   npm run trace -- --parse <log>      re-parses a saved log, with no browser
//
// The defaults are the default match: hargrim, 2, arena01, normal. The tool starts its own dev server
// on CLAUDELINE_PORT (the hook `__runProbeFrames` and the unminified names exist only in dev) and
// refuses a port that already answers: that server may serve another checkout's code.

const USAGE =
  'usage: npm run trace -- [--champion <kit>] [--teamsize 2|3] [--arena <id>] [--difficulty easy|normal|hard] [--log <file>]\n' +
  '       npm run trace -- --parse <log>';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// The viewport of the heap probe: a sixteenth of the pixels of the screenshots' viewport.
const VIEWPORT = { width: 320, height: 180 };
const WINDOW_FRAMES = 30;
// The run fails past this tick: a match that never ends.
const TICK_BUDGET = 60_000;
const SERVER_TIMEOUT_MS = 60_000;
const CLOSE_TIMEOUT_MS = 15_000;

// A frozen copy of the drive of e2e/live-probe.spec.ts (`WALK`, `POINTERS` and `press`), as #318
// measured it. The recorded rows of bots.md belong to this drive, and the live probe may change
// later for its own reasons: change these only to re-measure.
const WALK = [['KeyW', 'KeyD'], ['KeyA'], ['KeyD']] as const;
const POINTERS = [
  { x: 63, y: 39 },
  { x: 45, y: 97 },
] as const;

interface Options {
  champion: string;
  teamsize: string;
  arena: string;
  difficulty: string;
  log: string | null;
  parse: string | null;
}

function parseArgs(args: readonly string[]): Options {
  const options: Options = { champion: 'hargrim', teamsize: '2', arena: 'arena01', difficulty: 'normal', log: null, parse: null };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i] as string;
    const value = args[i + 1];
    const take = (): string => {
      if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value\n${USAGE}`);
      i++;
      return value;
    };
    if (flag === '--champion') options.champion = take();
    else if (flag === '--teamsize') options.teamsize = take();
    else if (flag === '--arena') options.arena = take();
    else if (flag === '--difficulty') options.difficulty = take();
    else if (flag === '--log') options.log = take();
    else if (flag === '--parse') options.parse = take();
    else throw new Error(`unknown argument ${flag}\n${USAGE}`);
  }
  if (!/^[a-z0-9-]+$/.test(options.champion)) throw new Error(`bad --champion ${options.champion}`);
  if (!/^[a-z0-9-]+$/.test(options.arena)) throw new Error(`bad --arena ${options.arena}`);
  if (options.teamsize !== '2' && options.teamsize !== '3') throw new Error(`--teamsize is 2 or 3, got ${options.teamsize}`);
  if (!['easy', 'normal', 'hard'].includes(options.difficulty)) throw new Error(`--difficulty is easy, normal or hard, got ${options.difficulty}`);
  return options;
}

function sourceTexts(directory: string): string[] {
  const texts: string[] = [];
  for (const entry of readdirSync(join(ROOT, directory), { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue;
    texts.push(readFileSync(join(entry.parentPath, entry.name), 'utf8'));
  }
  return texts;
}

function currentNames() {
  return botsNames(sourceTexts('packages/bots/src'), [...sourceTexts('packages/sim/src'), ...sourceTexts('packages/client/src')]);
}

function load(): string {
  return loadavg()[0]?.toFixed(2) ?? '?';
}

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

/** The report between the header and the footer lines of the log, so a re-parse prints what the run printed. */
function printout(lines: readonly string[]): string {
  const header = lines.filter((line) => line.startsWith('# ')).map((line) => line.slice(2));
  const footer = lines.filter((line) => line.startsWith('#. ')).map((line) => line.slice(3));
  const report = formatReport(parseTrace(lines, currentNames()));
  return `${header.join('\n')}\n\n${report}\n${footer.join('\n')}\n`;
}

async function answers(origin: string): Promise<boolean> {
  try {
    await fetch(origin, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

function startServer(): ChildProcess {
  // Its own process group, so the whole tree (npm, the workspace script, vite) goes with it.
  return spawn('npm', ['run', 'dev'], { cwd: ROOT, stdio: 'ignore', detached: true, env: process.env });
}

function stopServer(server: ChildProcess): void {
  if (server.pid === undefined || server.exitCode !== null) return;
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    // The group is gone already.
  }
}

async function waitForServer(origin: string, server: ChildProcess): Promise<void> {
  const deadline = Date.now() + SERVER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`the dev server exited with code ${server.exitCode}`);
    if (await answers(origin)) return;
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`the dev server did not answer at ${origin} within ${SERVER_TIMEOUT_MS / 1000} s`);
}

interface Hooks {
  tick: number;
  phase: string;
  round: string;
}

async function readHooks(page: Page): Promise<Hooks> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) throw new Error('no canvas');
    const d = canvas.dataset;
    return { tick: Number(d['tick']), phase: d['phase'] ?? '', round: d['round'] ?? '' };
  });
}

/** One window of the live probe's driver: the pointer, then the keys of the round, then 30 frames. */
function createDriver(page: Page) {
  let held: readonly string[] = [];
  let round = '';
  let roundWindows = 0;
  let windows = 0;
  return async function runWindow(hooks: Hooks): Promise<void> {
    const pointer = POINTERS[windows++ % POINTERS.length] as (typeof POINTERS)[number];
    await page.evaluate(({ x, y }) => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y }));
    }, pointer);
    if (hooks.round !== round) {
      round = hooks.round;
      roundWindows = 0;
    }
    let keys: readonly string[] = [];
    if (hooks.phase === 'round') {
      const index = roundWindows++;
      keys = index === 0 ? (WALK[0] as readonly string[]) : (WALK[1 + ((index - 1) % 2)] as readonly string[]);
    }
    for (const key of held) if (!keys.includes(key)) await page.keyboard.up(key);
    for (const key of keys) if (!held.includes(key)) await page.keyboard.down(key);
    held = keys;
    await page.evaluate((frames) => {
      const hook = (globalThis as unknown as { __runProbeFrames?: (frames: number) => void }).__runProbeFrames;
      if (!hook) throw new Error('the dev-only frame hook is missing');
      hook(frames);
    }, WINDOW_FRAMES);
  };
}

async function run(options: Options): Promise<void> {
  const port = readPort();
  const origin = originOf(port);
  if (await answers(origin)) {
    throw new Error(
      `something already answers at ${origin}. It may serve another checkout's code, so the trace refuses it: stop it or pick another CLAUDELINE_PORT`,
    );
  }
  const url = `/?champion=${options.champion}&difficulty=${options.difficulty}&arena=${options.arena}&teamsize=${options.teamsize}`;
  const config = `${options.champion}-${options.teamsize}v${options.teamsize}-${options.arena}-${options.difficulty}`;
  const logPath = resolve(options.log ?? join(tmpdir(), 'claudeline-trace', `${config}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`));

  const log: string[] = [];
  const header = (text: string): void => {
    log.push(`# ${text}`);
  };
  const footer = (text: string): void => {
    log.push(`#. ${text}`);
  };
  const dirty = git('status', '--porcelain', '--', 'packages', 'data') !== '';
  header(`trace ${config}: ${origin}${url}`);
  header(`commit ${git('rev-parse', 'HEAD')}${dirty ? ' (packages/ or data/ has uncommitted changes)' : ''}`);

  const server = startServer();
  let browserServer: Awaited<ReturnType<typeof chromium.launchServer>> | null = null;
  let finished = false;
  const stop = (): void => {
    stopServer(server);
  };
  process.once('SIGINT', () => {
    stop();
    process.exit(130);
  });
  try {
    await waitForServer(origin, server);
    browserServer = await chromium.launchServer({ headless: true, args: ['--js-flags=--trace-opt --trace-deopt'] });
    // V8 prints a trace line to the stdout of the process that runs the function. The renderer
    // inherits the browser's pipes, so its lines come through the launched server's streams, in
    // arrival order with the markers that this process appends.
    const child = browserServer.process();
    const streams = [child.stdout, child.stderr].filter((stream) => stream !== null);
    const ended = Promise.all(streams.map((stream) => new Promise<void>((done) => stream.once('close', () => done()))));
    for (const stream of streams) {
      let rest = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => {
        const parts = (rest + chunk).split('\n');
        rest = parts.pop() ?? '';
        for (const part of parts) log.push(part.replace(/\r$/, ''));
      });
      stream.on('end', () => {
        if (rest !== '') log.push(rest);
        rest = '';
      });
    }
    const browser = await chromium.connect(browserServer.wsEndpoint());
    header(`chromium ${browser.version()}, flags --trace-opt --trace-deopt, ${availableParallelism()} cores`);
    header(`load at start ${load()}`);
    process.stderr.write(`${log.join('\n')}\n`);

    const page = await browser.newPage({ viewport: VIEWPORT });
    const problems: string[] = [];
    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(`console: ${message.text()}`);
    });
    // The loop never runs on its own: every frame is the hook's, so the ticks are deterministic.
    await page.addInitScript(() => {
      window.requestAnimationFrame = () => 0;
      window.cancelAnimationFrame = () => {};
    });
    await page.goto(`${origin}${url}`);
    await page.waitForSelector('canvas[data-arena][data-tick]');
    await page.mouse.down();
    const driver = createDriver(page);
    let hooks = await readHooks(page);
    if (hooks.tick !== 0) throw new Error(`the page ran ${hooks.tick} ticks of its own`);
    let windows = 0;
    while (hooks.phase !== 'matchEnd') {
      if (problems.length > 0) throw new Error(problems.join('\n'));
      if (hooks.tick > TICK_BUDGET) throw new Error(`no match end by tick ${hooks.tick}`);
      await driver(hooks);
      hooks = await readHooks(page);
      // After the read, not after the window's own call: the call's reply would otherwise be the
      // marker's only distance from the V8 lines of the window, one round trip less.
      log.push(`#window ${JSON.stringify(hooks)}`);
      if (++windows % 60 === 0) process.stderr.write(`tick ${hooks.tick}, round ${hooks.round}, load ${load()}\n`);
    }
    if (problems.length > 0) throw new Error(problems.join('\n'));
    footer(`load at end ${load()}`);
    await browser.close();
    await browserServer.close();
    browserServer = null;
    await Promise.race([ended, new Promise((done) => setTimeout(done, CLOSE_TIMEOUT_MS))]);
    finished = true;
  } finally {
    if (browserServer) await browserServer.close().catch(() => {});
    stop();
    mkdirSync(dirname(logPath), { recursive: true });
    writeFileSync(logPath, `${log.join('\n')}\n`);
    process.stdout.write(`log: ${logPath}${finished ? '' : ' (the run did not finish)'}\n`);
  }
  process.stdout.write(`${printout(log)}`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.parse !== null) {
    process.stdout.write(printout(readFileSync(options.parse, 'utf8').split('\n')));
    return;
  }
  await run(options);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
