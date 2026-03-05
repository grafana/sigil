Babysit CI for the current branch PR until all checks pass.

Use `gh` for all GitHub interactions.

## Workflow

1. Run local quality checks relevant to your changes before touching CI.
   - Prefer targeted checks where possible; do not run the entire suite unless needed.
   - Common commands:
     - `mise run format`
     - `mise run lint`
     - `mise run check`
2. If any local command fails:
   - Fix what is reasonably fixable in this babysit pass.
   - Re-run the failing command(s) until green.
   - If the problem is broad, risky, or needs product/domain decisions, stop and ask for user interaction.
3. If you made changes, commit each logical fix separately with a brief Conventional Commit message.
4. Determine the current branch: `git branch --show-current`.
5. Push explicitly: `git push origin "$(git branch --show-current)"`.
6. Find the PR for this branch:
   - First try: `gh pr view --json number,url,headRefName,baseRefName,state`.
   - If that fails: `gh pr list --head "$(git branch --show-current)" --state open --json number,url,headRefName,baseRefName,state`.
7. Announce the PR number and URL.
8. Check cursorbot issues and fix any simple, low-risk items; then commit and push.
9. Watch CI in a loop until completion:
   - Poll with `gh pr checks <PR_NUMBER>`.
   - Sleep between polls (`sleep 10` or `sleep 15`) and re-check.
   - Continue until checks are all successful, or until any check fails and requires action.
10. If checks fail:
    - Identify failing jobs and fetch details/logs using `gh` (for example `gh run list`, `gh run view <run-id> --log-failed`).
    - Reproduce and fix the issue in the repo.
    - Re-run only the verification needed for confidence in the fix.
    - Commit with a clear Conventional Commit message and explain what changed and why.
    - Push explicitly: `git push origin "$(git branch --show-current)"`.
11. Resume watching checks after each push.
12. Repeat until CI is fully green.

## Rules

- Do not use force push.
- Do not amend commits unless explicitly requested.
- Keep commits focused and readable.
- Prefix babysitting commit messages with `babysit:` (for example, `chore: babysit: fix lint failures in plugin query parser`).
- Prefer small, low-risk fixes; escalate big/risky items for user interaction.
- Report each cycle briefly: current check status, detected failure, fix applied, commit hash, and push result.
