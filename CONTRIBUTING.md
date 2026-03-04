# Contributing

## Setup
1. Install Python 3.11+ and Node.js 18+.
2. Run `make bootstrap`.
3. Run `make precommit-install`.

## Development process
1. Start from a focused branch.
2. Write or update tests first.
3. Implement the change.
4. Run `make check`.
5. Open a pull request with a short risk summary.

## Commit style
Use concise, imperative commit messages. Example: `Add binary writer padding tests`.

## Pull request checklist
- [ ] Tests added or updated
- [ ] `make check` passes locally
- [ ] Docs updated where needed
- [ ] No unrelated file changes included
