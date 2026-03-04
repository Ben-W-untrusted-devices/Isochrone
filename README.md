# Isochrone

Berlin isochrone web application with a Python preprocessing pipeline and a browser-based renderer.

## Quick start

```bash
make bootstrap
make precommit-install
make check
```

## Daily commands

```bash
make lint
make test
make build
```

## Repository structure
- `data_pipeline/`: Graph preprocessing and binary export logic
- `web/`: Browser app source, tests, and bundle output
- `docs/`: Design and process documentation
- `PLAN.md`: Delivery plan and architecture roadmap

## Agentic coding baseline
This repo is configured for autonomous-agent workflows with:
- single-command quality gates (`make check`)
- explicit agent rules in `AGENTS.md`
- CI for Python + web lint/test/build
- pre-commit hooks for fast local feedback
