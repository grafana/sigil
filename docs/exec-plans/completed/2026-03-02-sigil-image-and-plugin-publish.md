---
owner: sigil-core
status: completed
last_reviewed: 2026-03-02
source_of_truth: true
audience: both
---

# Sigil Delivery: Image and Plugin Artifact Publishing

## Goal

Add assistant-style publish workflows for Sigil:

- publish a Sigil service image on `main`
- publish the Sigil plugin artifact through plugin CI/CD workflow reuse

This delivery is intentionally publish-only. It excludes Argo deployment hooks.

## Scope

- Add production container build recipe for Sigil service.
- Add GHCR image publish workflow for Sigil service.
- Add plugin artifact push workflow for `apps/plugin`.
- Update docs for workflow usage and image tag semantics.

## Out of scope

- Argo workflow triggers and environment deployment automation.
- Plugin production release gating across ops/prod.
- API, ingest, query, SDK, or chart contract changes.

## Decisions locked in implementation

- Parity mode: publish-only.
- Service image registry: GHCR (`ghcr.io/grafana/sigil`).
- Chart default image tag: `latest` (with docs recommending SHA pinning for production).
- Plugin publish environments from this workflow: `dev` on main only.
- Plugin scope: no cloud-only scope override (unscoped/default behavior).

## Checklist

### Track A: Service container image

- [x] Add production Dockerfile at `sigil/Dockerfile`.
- [x] Build `cmd/sigil` in a multi-stage Docker build.
- [x] Run final container as non-root user.

### Track B: Service image publish workflow

- [x] Add `.github/workflows/sigil-image-publish.yml`.
- [x] Trigger on `main` for Sigil/backend-relevant paths.
- [x] Publish tags `ghcr.io/grafana/sigil:<sha>` and `ghcr.io/grafana/sigil:latest`.
- [x] Configure buildx + registry cache.

### Track C: Plugin artifact publish workflow

- [x] Use `.github/workflows/plugins-push.yaml` for plugin CI/CD artifact publishing.
- [x] Reuse `grafana/plugin-ci-workflows/.github/workflows/cd.yml@ci-cd-workflows/v5.1.0`.
- [x] Run CI-only behavior on pull requests (`environment=none`).
- [x] Publish to `dev` on `main` only (`environment=dev`).
- [x] Keep deployment disabled (`trigger-argo=false`).
- [x] Disable GitHub release creation in this workflow.

### Track D: Documentation and governance

- [x] Update root README deployment section with workflow references and tag behavior.
- [x] Update chart README quick-start text for automated image publishing.
- [x] Set Helm chart default `image.tag` to `latest` to align with published image tags.
- [x] Add this execution plan record in `docs/exec-plans/completed/`.
- [x] Sync docs index entries for this completed plan.

## Risks and mitigations

- Reusable plugin workflow input compatibility:
  - mitigated by mirroring assistant workflow input patterns and versions.
- GHCR permission drift:
  - mitigated by explicit `packages: write` permission and repository gate condition.
- Over-triggering publish workflows:
  - mitigated by path filters on both new workflows.

## Exit criteria

- `sigil/Dockerfile` exists and is build-ready for CI publish.
- `sigil-image-publish.yml` publishes Sigil image on `main`.
- `plugins-push.yaml` performs PR CI and main-to-dev plugin artifact publish.
- Docs reflect workflow names and image tag contract.
