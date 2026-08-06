# LiveCoach delivery workflow

- Never push code directly to `main`.
- For user-authorized code changes, work on a branch, run the relevant checks, commit, push, open or update a pull request, mark it ready, and enable auto-merge after required checks pass.
- Do not ask for a separate commit, push, or merge confirmation once the user has requested the code change.
- Do not merge when local validation or required GitHub/Vercel checks fail.
- Still request explicit approval for destructive data operations, database migrations with data-loss risk, purchases, or changes outside the requested scope.
