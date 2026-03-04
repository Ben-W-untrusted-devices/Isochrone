# AGENTS.md

This repository is configured for autonomous coding agents. Follow these rules every time.

## Primary workflow
1. Create or update tests first (TDD).
2. Implement the smallest change that makes tests pass.
3. Run `make check` locally before asking for review.
4. Keep commits small, isolated, and reversible.
5. Update docs when behavior or interfaces change.

## Definition of done
- `make lint` passes
- `make test` passes
- New behavior is covered by tests
- Existing behavior does not regress
- `README.md` and/or docs are updated when needed

## Project layout
- `data_pipeline/`: Python pipeline code and tests
- `web/`: Client-side web app code and tests
- `docs/`: Architecture and process docs
- `.github/workflows/`: CI quality gates

## Non-negotiables
- Prefer standard library or existing project utilities over new dependencies.
- Remove dead code and stale TODOs in touched areas.
- Avoid broad refactors unless the task explicitly requires them.
- Keep changes deterministic; avoid hidden side effects.

## Canonical commands
- Bootstrap: `make bootstrap`
- Lint/typecheck: `make lint`
- Tests: `make test`
- Full gate: `make check`
- Build web bundle: `make build`
