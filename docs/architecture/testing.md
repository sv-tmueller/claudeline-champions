# Testing and quality gates

Source: spec section 9.

## Check suite

`npm run check` runs lint, typecheck, unit tests, the asset checks
(`assets:validate` and `assets:test`) and the Playwright smoke test. It is the
check suite every package must pass.

CI is split by cost:

- Typecheck, lint, unit tests and the asset checks run on pull requests that
  touch code, drafts included, and on pushes to main.
- Build and the Playwright smoke test run on pull requests that are ready for
  review and on pushes to main. They skip draft pull requests. They start only
  after the typecheck, lint, unit test and asset check job passes.
- Changes that touch only `docs/` or Markdown files do not trigger CI.

## Test types

- Unit tests (Vitest): sim math, collision, statuses, abilities, match flow,
  replay fixtures with checksums. See [simulation](simulation.md).
- Integration tests: bot-versus-bot headless matches. See [bots](bots.md).
- Smoke tests (Playwright): the client loads, renders a frame, and a screenshot
  is written to the test output for human review.
- Asset validation: `validate_glb.py` over `assets/models/`. See
  [assets](assets.md).
- Strict TypeScript, ESLint with the dependency-boundary rule. See
  [packages](packages.md).
