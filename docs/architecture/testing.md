# Testing and quality gates

Source: spec section 9.

## Check suite

`npm run check` runs lint, typecheck, unit tests, the asset checks
(`assets:validate` and `assets:test`) and the Playwright e2e specs
(`e2e/*.spec.ts`). It is the check suite every package must pass.

CI is split by cost:

- Typecheck, lint, unit tests and the asset checks run on pull requests that
  touch code, drafts included, and on pushes to main.
- Build and the Playwright e2e specs (`e2e/*.spec.ts`) run on pull requests
  that are ready for review and on pushes to main. They skip draft pull
  requests. They start only after the typecheck, lint, unit test and asset
  check job passes.
- Changes that touch only `docs/` or Markdown files do not trigger CI.

## Test types

- Unit tests (Vitest): sim math, collision, statuses, abilities, match flow,
  replay fixtures with checksums. See [simulation](simulation.md).
- Integration tests: bot-versus-bot headless matches. See [bots](bots.md).
- E2e tests (Playwright, `e2e/*.spec.ts`): the client loads, renders the arena
  and responds to input; each spec writes its screenshots to the test output
  for human review.
- Asset validation: `validate_glb.py` over `assets/models/`. See
  [assets](assets.md).
- Strict TypeScript, ESLint with the dependency-boundary rule. See
  [packages](packages.md).

## Cross-platform determinism

The sim gives the same bits on every platform (spec section 4.8, rule 4).

- Every port in `packages/sim/src/dmath.ts` has a committed bit-pattern fixture
  over 2000 seeded inputs. The fixtures are authored on ARM macOS and checked
  by CI on Linux x86.
- Fixture inputs use exact operations only, so every CPU builds the same inputs.
- V8's transcendental functions may appear in sim tests as accuracy
  references within an ulp tolerance. They are never the source of an exact
  expected value.
- A change that moves a dmath fixture or a replay checksum is also run in a
  `linux/amd64` container before its pull request goes ready.
