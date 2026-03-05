Babysit CI for the current branch PR until all checks pass.

Use `gh` for all GitHub interactions.

Workflow:
1. Run local-first quality gates before touching CI:
   - `mise run format`
   - `mise run lint`
   - `mise run check`
2. If any local command fails:
   - Fix what is reasonably fixable in this babysit pass.
   - Re-run the failing command(s) until green.
   - If the problem is broad, risky, or needs product/domain decisions, stop and ask for user interaction.
3. Determine the current branch: `git branch --show-current`.
4. If local fixes were made:
   - Commit with a Conventional Commit message prefixed with `babysit:` (example: `chore: babysit: fix lint failures in plugin query parser`).
   - Push explicitly: `git push origin "$(git branch --show-current)"`.
5. Find the PR for this branch:
   - First try: `gh pr view --json number,url,headRefName,baseRefName,state`.
   - If that fails, use: `gh pr list --head "$(git branch --show-current)" --state open --json number,url,headRefName,baseRefName,state` and select the matching open PR.
6. Announce the PR number and URL.
7. Check cursorbot issues, and see if any are simple enough to fix quickly. Then fix, and commit, and push.
8. Watch CI in a loop with sleeps between checks until everything completes:
   - Poll check status with `gh pr checks <PR_NUMBER>`.
   - Sleep between polls (`sleep 10` or `sleep 15`) and re-check.
   - Continue until checks are all successful, or until any check fails and requires action.
9. If checks fail:
   - Identify failing jobs and fetch details/logs using `gh` (for example `gh run list`, `gh run view <run-id> --log-failed`, and related commands).
   - Reproduce/fix the issue in the repo.
   - Run local verification in this order unless unnecessary for the scoped change:
     - `mise run format`
     - `mise run lint`
     - `mise run check`
   - Resolve issues before pushing.
   - Commit with a clear Conventional Commit message prefixed with `babysit:` and explain what changed and why.
   - Push explicitly: `git push origin "$(git branch --show-current)"`.
10. Resume watching checks with sleeps after each push.
11. While waiting, look for cursorbot issues, and see if any are worth quick fixing. Anything very complicated, leave for user interaction.
12. Repeat until CI is fully green.

Rules:
- Do not use force push.
- Do not amend commits unless explicitly requested.
- Keep commits focused and readable.
- Use `babysit:` in every babysitting commit message.
- Prefer small, low-risk fixes; escalate big/risky items for user interaction.
- Report each cycle briefly: current check status, detected failure, fix applied, commit hash, and push result.
