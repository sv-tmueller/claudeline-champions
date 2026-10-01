# Claudeline Champions

A top-down arena fighter. The approved design is in
`docs/superpowers/specs/2026-10-01-claudeline-champions-design.md`. The living
architecture reference is in `docs/architecture/`.

The repo is an npm workspaces monorepo: `packages/sim`, `packages/bots` and
`packages/client`. TypeScript is `~6.0` only. Node `^22.13` or `>=24`.

## Useful commands

```bash
npm ci                           # install from the lockfile
npx playwright install chromium  # one-time per machine; check and e2e fail without it
npm run dev                      # dev server at http://127.0.0.1:5173
npm run check                    # lint, typecheck, unit tests, asset checks, Playwright smoke: the check suite
npm run test                     # Vitest unit tests (all projects)
npm run lint                     # ESLint, includes the package boundary rules
npm run typecheck                # tsc for sim, bots, client and the tools/tests config
npm run e2e                      # Playwright smoke test; screenshot at test-results/*/ground-plane.png
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
- Lint (`eslint.config.js`) enforces the import rules, including dynamic
  `import()`, `import()` types and relative paths into `node_modules`,
  `packages`, `tests` or `e2e`. In `packages/sim/src` it also bans `Date`,
  `performance`, `Math.random`, `setTimeout`, `setInterval`, `window`,
  `document` and `fetch`. `tests/lint-boundaries.test.ts` checks that each rule
  fires.
- The sim and bots tsconfigs (`lib: ["ES2023"]`, `types: []`) make any other
  browser or Node global a type error.
- Review and the replay tests enforce the other determinism rules (spec
  section 4.8).
- Rules for future packages (`server`, `protocol`) are in spec section 3.2.
