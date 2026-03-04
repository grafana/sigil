Babysit CI for the current branch PR until all checks pass.

Use `gh` for all GitHub interactions.

Workflow:
1. Determine the current branch: `git branch --show-current`.
2. Find the PR for this branch:
   - First try: `gh pr view --json number,url,headRefName,baseRefName,state`.
   - If that fails, use: `gh pr list --head "$(git branch --show-current)" --state open --json number,url,headRefName,baseRefName,state` and select the matching open PR.
3. Announce the PR number and URL.
4. Check cursorbot issues, and see if any are simple enough to fix quickly. Then fix, and commit, and push.
5. Watch CI in a loop with sleeps between checks until everything completes:
   - Poll check status with `gh pr checks <PR_NUMBER>`.
   - Sleep between polls (`sleep 10` or `sleep 15`) and re-check.
   - Continue until checks are all successful, or until any check fails and requires action.
6. If checks fail:
   - Identify failing jobs and fetch details/logs using `gh` (for example `gh run list`, `gh run view <run-id> --log-failed`, and related commands).
   - Reproduce/fix the issue in the repo.
   - Run relevant local verification (at least targeted tests/lint for changed area; use repo standard commands when appropriate).
   - Commit with a clear Conventional Commit message explaining what changed and why.
   - Push to the same branch.
7. Resume watching checks with sleeps after each push.
8. While waiting, look for cursorbot issues, and see if any are worth quick fixing. Anything very complicated, leave.
9. Repeat until CI is fully green.

Rules:
- Do not use force push.
- Do not amend commits unless explicitly requested.
- Keep commits focused and readable.
- Report each cycle briefly: current check status, detected failure, fix applied, commit hash, and push result.
