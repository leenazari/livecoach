# LiveCoach delivery workflow

- Never push code directly to `main`.
- For user-authorized code changes, work on a branch, run the relevant checks, commit, push, open or update a pull request, mark it ready, and enable auto-merge after required checks pass.
- Do not ask for a separate commit, push, or merge confirmation once the user has requested the code change.
- Do not merge when local validation or required GitHub/Vercel checks fail.
- Still request explicit approval for destructive data operations, database migrations with data-loss risk, purchases, or changes outside the requested scope.

## User-facing CRM errors

- Use the shared CRM blocker response and fetch handler. Name the action, explain the known cause in plain English, and give a specific safe next step.
- For multi-step writes, state what was confirmed saved and which later step failed. A timeout or missing response means an unknown outcome, not proof that nothing changed.
- Never advise blindly retrying a send, charge, or creation. Ask the user to check the existing record or delivery status first. Preserve unsaved text where possible.
- Keep database messages, credentials and private records out of user-facing errors. Put technical codes and safe correlation references in secondary support details.
- Test read failures, validation, denied access, partial saves and interrupted responses when changing these paths. Do not relax permissions to make an error disappear.
