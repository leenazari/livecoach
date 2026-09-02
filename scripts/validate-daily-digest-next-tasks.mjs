import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { selectNextDayTasks } from "../lib/daily-digest-tasks.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const now = new Date("2026-09-02T18:00:00.000Z");
const task = (id, overrides = {}) => ({
  id,
  text: `Task ${id}`,
  company_id: null,
  kind: "next_step",
  due_at: null,
  created_at: "2026-09-02T12:00:00.000Z",
  payload: null,
  ...overrides,
});

const selected = selectNextDayTasks(
  [
    task("tomorrow-late", {
      due_at: "2026-09-03T14:30:00.000Z",
      payload: { scheduledTime: true },
    }),
    task("tomorrow-early", { due_at: "2026-09-03T08:00:00.000Z" }),
    task("carry-over", { due_at: "2026-09-01T09:00:00.000Z" }),
    task("pinned", { payload: { pinned: true } }),
    task("ordinary"),
    task("sixth"),
    task("future", { due_at: "2026-09-04T09:00:00.000Z" }),
    task("waiting-on-them", {
      kind: "counterparty_commitment",
      due_at: "2026-09-03T09:00:00.000Z",
    }),
  ],
  { now, timeZone: "Europe/London", limit: 5 }
);

assert.equal(selected.length, 5, "the next-day task list must never exceed five");
assert.deepEqual(
  selected.slice(0, 2).map((item) => item.id),
  ["tomorrow-early", "tomorrow-late"],
  "tasks explicitly due tomorrow must lead in due-time order"
);
assert.match(selected[1].digestReason, /^Due tomorrow at 15:30$/);
assert.ok(selected.some((item) => item.id === "carry-over"));
assert.ok(selected.some((item) => item.id === "pinned"));
assert.ok(!selected.some((item) => item.id === "future"));
assert.ok(!selected.some((item) => item.id === "waiting-on-them"));

const digest = read("app/api/cron/daily-digest/route.ts");
assert.match(digest, /selectNextDayTasks\(openTasks/);
assert.match(digest, /limit:\s*5/);
assert.match(digest, /Next five tasks for tomorrow/);
assert.match(digest, /nextDayTaskIds/);
assert.match(digest, /\.filter\(\(task: any\) => !nextDayTaskIds\.has\(task\.id\)\)/);
assert.match(
  digest,
  /from\("tasks"\)[\s\S]{0,320}\.eq\("workspace_id", account\.workspaceId\)[\s\S]{0,120}\.eq\("owner_id", account\.userId\)/
);
assert.match(digest, /esc\(capitaliseSentenceStarts\(task\.text\)\)/);

console.log("Daily digest next-day task checks passed");
