---
name: launch-app
description: Launch the local Sigil stack for runtime validation.
---

# Launch App

1. Ensure the repo has an env file:
   ```bash
   [ -f .env ] || cp .env.example .env
   ```

2. Start the local stack in detached mode:
   ```bash
   DEVELOPMENT=true docker compose --profile core up --build --remove-orphans -d
   ```

3. Verify the API and Grafana are reachable:
   ```bash
   curl -sf http://localhost:8080/healthz
   curl -sf http://localhost:3000 >/dev/null
   ```

4. For UI validation, open:
   - `http://localhost:3000/a/grafana-sigil-app/conversations`

5. If plugin queries fail in Grafana, sign in with:
   - username: `admin`
   - password: `admin`
   - skip the forced password change prompt

6. If Grafana does not respond on `:3000`, apply the documented startup workaround inside the Grafana container:
   ```bash
   supervisorctl stop delve
   kill -CONT <grafana-bash-pid>
   ```

7. If validation needs live synthetic conversation data, restart with the traffic profile:
   ```bash
   DEVELOPMENT=true docker compose --profile core --profile traffic up --build --remove-orphans -d
   ```
   Wait about 30 seconds for conversations to appear in the UI.

8. For debugging:
   ```bash
   docker compose logs -f grafana
   docker compose logs -f sigil
   docker compose logs -f plugin
   ```

9. Stop the stack when validation is done:
   ```bash
   docker compose down
   ```
