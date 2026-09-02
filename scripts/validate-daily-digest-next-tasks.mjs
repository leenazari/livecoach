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

const allTomorrow = Array.from({ length: 25 }, (_, index) =>
  task(`tomorrow-${index + 1}`, {
    due_at: new Date(
      Date.parse("2026-09-03T08:00:00.000Z") + index * 60_000
    ).toISOString(),
  })
);
const selected = selectNextDayTasks(
  [
    task("tomorrow-late", {
      due_at: "2026-09-03T14:30:00.000Z",
      payload: { scheduledTime: true },
    }),
    task("tomorrow-early", { due_at: "2026-09-03T08:00:00.000Z" }),
    ...allTomorrow,
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
  { now, timeZone: "Europe/London" }
);

assert.equal(selected.length, 27, "every task explicitly due tomorrow must be included");
assert.equal(selected[0].id, "tomorrow-early");
assert.match(
  selected.find((item) => item.id === "tomorrow-late")?.digestReason || "",
  /^Due tomorrow at 15:30$/
);
assert.ok(!selected.some((item) => item.id === "carry-over"));
assert.ok(!selected.some((item) => item.id === "pinned"));
assert.ok(!selected.some((item) => item.id === "ordinary"));
assert.ok(!selected.some((item) => item.id === "future"));
assert.ok(!selected.some((item) => item.id === "waiting-on-them"));

const digest = read("app/api/cron/daily-digest/route.ts");
assert.match(digest, /selectNextDayTasks\(tomorrowTasksRes\.data \|\| \[\]/);
assert.doesNotMatch(digest, /selectNextDayTasks\([\s\S]{0,160}limit:\s*5/);
assert.match(digest, /Tasks due tomorrow/);
assert.match(digest, /nextDayTaskIds/);
assert.match(digest, /\.filter\(\(task: any\) => !nextDayTaskIds\.has\(task\.id\)\)/);
assert.match(
  digest,
  /from\("tasks"\)[\s\S]{0,320}\.eq\("workspace_id", account\.workspaceId\)[\s\S]{0,120}\.eq\("owner_id", account\.userId\)/
);
assert.match(digest, /esc\(capitaliseSentenceStarts\(task\.text\)\)/);
assert.match(digest, /\.lte\("due_at", tomorrowTaskHorizon\)/);

console.log("Daily digest next-day task checks passed");
