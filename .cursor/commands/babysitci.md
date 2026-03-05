Babysit CI for the current branch PR until all checks pass.

Use `gh` for all GitHub interactions.

Workflow:
1. Determine the current branch: `git branch --show-current`.
2. Find the PR for this branch:
   - First try: `gh pr view --json number,url,headRefName,baseRefName,state`.
   - If that fails, use: `gh pr list --head "$(git branch --show-current)" --state open --json number,url,headRefName,baseRefName,state` and select the matching open PR.
3. Announce the PR number and URL.
4. Proactively gather AI-generated review feedback before CI babysitting:
   - Check Bugbot/Cursorbot/other AI review comments and unresolved threads early.
   - Prioritize by severity and merge risk (correctness, security, flaky tests, then style/minor cleanup).
   - Pick only quick, low-risk fixes for this babysit pass; escalate risky or product-sensitive changes.
5. Fix prioritized AI issues one at a time:
   - Make one focused fix per issue.
   - Run targeted local validation for changed files first; expand scope only if needed.
   - Commit each issue separately with a brief Conventional Commit message.
   - Push after each commit so feedback is addressed incrementally.
6. Run local-first quality gates before entering CI watch mode (target changed files when possible):
   - `mise run format`
   - `mise run lint`
7. If any local command fails:
   - Fix what is reasonably fixable in this babysit pass.
   - Re-run the failing command(s) until green.
   - If the problem is broad, risky, or needs product/domain decisions, stop and ask for user interaction.
8. If local fixes were made:
   - Commit one fix at a time with a Conventional Commit message prefixed with `babysit:` (example: `chore: babysit: fix lint failures in plugin query parser`).
   - Push explicitly: `git push origin "$(git branch --show-current)"`.
9. Sync before the CI loop:
   - Push all pending local commits.
   - Refresh PR state/comments/checks with `gh` so you start from the latest remote state.
10. Watch CI in a loop with sleeps between checks until everything completes:
   - Poll check status with `gh pr checks <PR_NUMBER>`.
   - Sleep between polls (`sleep 10` or `sleep 15`) and re-check.
   - Continue until checks are all successful, or until any check fails or new high-priority AI comments appear.
11. If checks fail:
   - Identify failing jobs and fetch details/logs using `gh` (for example `gh run list`, `gh run view <run-id> --log-failed`, and related commands).
   - Reproduce/fix the issue in the repo.
   - Resolve issues before pushing.
   - Commit with a clear Conventional Commit message prefixed with `babysit:` and explain what changed and why.
   - Push explicitly: `git push origin "$(git branch --show-current)"`.
12. If new Bugbot/Cursorbot/AI comments appear during CI:
   - Re-prioritize and fix the most important quick wins first.
   - Commit one issue at a time, push, then resume CI monitoring.
13. Repeat until CI is fully green and high-priority AI comments are resolved.

Rules:
- Do not use force push.
- Do not amend commits unless explicitly requested.
- Keep commits focused and readable.
- Use `[/babysit]` as a prefix in every babysitting commit message.
- Prefer small, low-risk fixes; escalate big/risky items for user interaction.
- Address important AI-generated comments early, before long CI polling.
- Commit one issue per commit whenever possible.
- Report each cycle briefly: current check status, detected failure/comment, fix applied, commit hash, and push result.
