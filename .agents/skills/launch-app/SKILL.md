---
name: launch-app
description: Launch or reuse a worktree-safe local Sigil stack for runtime validation.
---

# Launch App

Prefer the worktree-safe stack for app validation. It derives a unique Compose
project name from the checkout, bootstraps `.env` from a shared local source,
and avoids fixed host-port collisions by using OrbStack DNS.

1. Print the derived URLs for the current checkout:
   ```bash
   ./scripts/run-sigil-worktree.sh url
   ```

2. Start the worktree stack if it is not already running:
   ```bash
   mise run up:worktree:detached
   ```

3. Wait for the first cold start to finish. `plugin-precache` may take a bit on
   an empty volume, and Grafana can lag the API by another few seconds.

4. Verify the stack:
   ```bash
   ./scripts/run-sigil-worktree.sh ps
   curl -sf http://sigil.<worktree>.orb.local/healthz
   curl -I http://grafana.<worktree>.orb.local/login
   ```

5. Sign in to Grafana before validating Sigil UI behavior:
   - username: `admin`
   - password: `admin`
   - skip the forced password change prompt

6. For UI validation, open:
   - `http://grafana.<worktree>.orb.local/a/grafana-sigil-app/conversations`

7. If the page is empty and you need sample data, start the lightweight traffic
   sidecar:
   ```bash
   mise run up:worktree:traffic-lite
   ```

8. If the local worktree stack does not reproduce the problem and you need
   prod-like scale, many real versions, or existing ops-backed data shape, use
   the ops-backed worktree stack instead:
   ```bash
   mise run worktree:ops
   ```
   This keeps the checkout worktree-safe and requires
   `SIGIL_API_AUTH_TOKEN_OPS` in `.env`.

9. To capture a screenshot after login succeeds:
   ```bash
   mise run capture:ui-proof
   ```
   This signs in with `admin` / `admin` when needed and writes a PNG to
   `output/playwright/`.

10. For feature-level visual proof across several interactions, use the
   `ui-proof` skill instead of stopping at a single smoke screenshot.

11. If Grafana does not respond, apply the documented startup
   workaround inside the Grafana container:
   ```bash
   docker compose --project-name "$(basename "$PWD")" exec grafana supervisorctl stop delve
   kill -CONT <grafana-bash-pid>
   ```

12. For debugging:
   ```bash
   mise run logs:worktree
   ```

13. Stop the traffic sidecar when you no longer need sample data:
   ```bash
   mise run down:worktree:traffic-lite
   ```

14. Stop the worktree stack when you are done:
   ```bash
   mise run down:worktree
   ```

15. If you are done with the whole workspace and want to remove all Compose
    resources for it, including named volumes:
    ```bash
    mise run down:worktree:destroy
    ```
