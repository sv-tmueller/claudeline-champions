# Claudeline Champions

A top-down arena fighter. The approved design is in
`docs/superpowers/specs/2026-10-01-claudeline-champions-design.md`. The living
architecture reference is in `docs/architecture/`.

The repo is an npm workspaces monorepo: `packages/sim`, `packages/bots` and
`packages/client`. TypeScript is `~6.0` only. Node `^22.15` or `>=24`.

## Useful commands

```bash
npm ci                           # install from the lockfile
npx playwright install chromium  # one-time per machine; check and e2e fail without it
npm run dev                      # dev server at http://127.0.0.1:5173
npm run check                    # lint, typecheck, unit tests, asset checks, Playwright e2e: the check suite
npm run test                     # Vitest unit tests (all projects)
npm run lint                     # ESLint, includes the package boundary rules
npm run typecheck                # tsc for sim, bots, client and the tools/tests config
npm run e2e                      # Playwright e2e; screenshots scene.png,
                                 # arena.png, arena-overlay.png, walk.png,
                                 # combat.png, death.png, match.png, result.png,
                                 # ring.png, scene-arena02.png,
                                 # match-arena02.png, match-3v3.png,
                                 # match-3v3-arena02.png, menu.png,
                                 # scoreboard.png in test-results/*/
npm run balance                  # bot-versus-bot win-rate report: plays 4800
                                 # matches and writes the block of
                                 # docs/design/balance.md, about 5.5 minutes on
                                 # Apple silicon. Flags after `--`: --check
                                 # compares a fresh run with the committed
                                 # block, --out <file> writes there instead,
                                 # --seeds N plays the seeds 1 to N. Needs Node
                                 # 22.15. The manual workflow
                                 # .github/workflows/balance.yml runs --check on
                                 # a runner, 12 to 16 minutes.
npm run fixtures:search -- <kit>   # rebuild a kit's scripted roster fixture; Node 22.15+
npm run assets:validate          # validate_glb.py over assets/models (Python 3.9+, no Blender)
npm run assets:test              # tools/blender unit tests; the Blender ones skip without Blender
npm run build                    # production client bundle; CI runs it, check does not
```

CI runs typecheck, lint, unit tests and the asset checks on pull requests that
touch code and on pushes to main. Build and e2e run only on ready pull requests
and on main.

## Package dependency rules

- `sim` imports nothing outside itself. It has no DOM lib. It never reads the
  wall clock, never calls `Math.random`, and never touches `window`,
  `document`, `fetch` or Node built-ins.
- `bots` imports `sim` only.
- `client` imports `sim` and `bots`. It owns rendering, input, audio and UI.
- Lint (`eslint.config.js`) enforces the import rules, including relative
  paths into `node_modules`, `packages`, `tests` or `e2e`, and relative paths
  from bots source and bots tests into sim. In sim and bots source it also bans
  dynamic `import()` and `import()` types. In `packages/bots/src` it also bans
  `Date`, `performance`, `Math.random`, `Date.now` and `performance.now`; the
  sim's math ban is not copied. In `packages/sim/src` it also bans `Date`,
  `performance`, `Math.random`, `setTimeout`, `setInterval`, `window`,
  `document` and `fetch`, ignores inline `eslint-disable` comments, and bans
  V8's transcendental math, which differs in the last bit between CPUs:
  `Math.atan2`, `atan`, `sin`, `cos`, `tan`, `asin`, `acos`, `exp`, `log`,
  `log2`, `log10`, `pow`, `hypot`, `cbrt`, `expm1`, `log1p`, `sinh`, `cosh`,
  `tanh` and the `**` operator. Use the fdlibm ports in
  `packages/sim/src/dmath.ts` (`atan`, `atan2`, and `sin` and `cos` for
  |x| < 1647099) or a constant in kit data. `tests/lint-boundaries.test.ts`
  checks that each rule fires.
- The sim and bots tsconfigs (`lib: ["ES2023"]`, `types: []`) make any other
  browser or Node global a type error.
- Review, the replay tests and the dmath bit-pattern fixtures enforce the other
  determinism rules (spec section 4.8).
- Rules for future packages (`server`, `protocol`) are in spec section 3.2.
