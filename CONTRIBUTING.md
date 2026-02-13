# Contributing to Sigil

Thanks for contributing.

## Before You Start

- Search existing issues and pull requests to avoid duplicates.
- Open an issue for significant changes before implementation.
- Read the project docs index: `docs/index.md`.

## Fork and Branch Workflow

1. Fork the repository on GitHub.
2. Clone your fork.
3. Create a feature branch from `main`.

```bash
git clone https://github.com/<your-org>/sigil.git
cd sigil
git checkout -b <topic-branch>
```

## Development Setup

```bash
mise trust
mise install
mise run doctor:go
mise run deps
mise run up
```

## Validate Changes

Run the full quality suite before opening a PR:

```bash
mise run format
mise run lint
mise run check
```

## Pull Request Guidelines

- Use clear Conventional Commit messages.
- Explain what changed and why in the PR description.
- Add or update tests for behavior changes.
- Update docs when contracts, APIs, or architecture change.

## Documentation Expectations

When relevant, update:

- `ARCHITECTURE.md` for architecture or contract changes.
- `docs/` pages for design, references, and execution plans.

## Code of Conduct and Security

- For security disclosures, see `docs/SECURITY.md`.
