---
owner: sigil-core
status: completed
last_reviewed: 2026-03-05
source_of_truth: true
audience: both
---

# Sigil Delivery: Automatic Dev/Ops Deployment via Argo

## Goal

Deploy Sigil service images automatically to both `dev` and `ops` after image publish from `main`, using the same Argo updater flow pattern used by Grafana Assistant.

## Scope

- Add a dedicated Sigil Argo workflow template (`sigil-cd`) in `deployment_tools`.
- Trigger that workflow from Sigil image publish workflow.
- Ensure rollout pins immutable SHA-tagged GHCR images in deployment tools.
- Update documentation to reflect automatic deploy behavior.

## Out of scope

- Production rollout automation.
- Plugin deployment workflow changes.
- Runtime/service contract changes in Sigil itself.

## Decisions locked in implementation

- Deployment image reference: `ghcr.io/grafana/sigil:<git-sha>` (immutable SHA pin).
- Rollout order: `dev` first, then `ops`, both automatic.
- Notifications: `#hackathon-16-sigil-actually-useful-ai-o11y-deploys`.
- Argo trigger instance: `ops`.

## Checklist

- [x] Add `sigil-cd` workflow template in `deployment_tools` with `deploy-sigil-stack`.
- [x] Add `grafana/sigil` trigger service-account permissions for `sigil-cd`.
- [x] Regenerate `argo-workflows-repos.tf.json` generated files in `deployment_tools`.
- [x] Update Sigil CI image publish workflow to trigger `deploy-sigil-stack`.
- [x] Keep GHCR publish tags (`<sha>` + `latest`) unchanged.
- [x] Update README deployment section to mention automatic dev/ops rollout.
- [x] Record this completed execution plan.

## Exit criteria

- A push to `main` that builds/pushes Sigil image also triggers Argo deployment.
- Argo updater changes Sigil dev/ops image pins in deployment tools to the new SHA tag.
- Ops deployment runs only after dev deployment step succeeds.
