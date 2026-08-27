import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const privacy = await readFile("app/privacy/page.tsx", "utf8");
const login = await readFile("app/login/page.tsx", "utf8");
const middleware = await readFile("middleware.ts", "utf8");

assert.match(privacy, /export const metadata/);
assert.match(privacy, /LiveCoach CRM is operated by Lee Nazari/);
assert.match(privacy, /Google, Microsoft and LinkedIn connections/);
assert.match(privacy, /permissions LinkedIn has approved/);
assert.match(privacy, /Retention and deletion/);
assert.match(privacy, /request deletion/);
assert.match(privacy, /Information Commissioner/);
assert.match(login, /href="\/privacy"/);
assert.doesNotMatch(middleware, /path\.startsWith\("\/privacy"\)/);

console.log("Public privacy policy validation passed");
