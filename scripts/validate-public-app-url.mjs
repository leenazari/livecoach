import assert from "node:assert/strict";
import { publicAppOrigin } from "../lib/public-app-url.ts";

const keys = [
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "NEXT_PUBLIC_APP_URL",
];
const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

function reset() {
  for (const key of keys) delete process.env[key];
}

try {
  reset();
  process.env.VERCEL = "1";
  process.env.VERCEL_ENV = "production";
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  process.env.VERCEL_PROJECT_PRODUCTION_URL = "livecoach-alpha.vercel.app";
  assert.equal(
    publicAppOrigin("http://localhost:3000"),
    "https://livecoach-alpha.vercel.app",
    "production email links must reject localhost"
  );

  reset();
  process.env.VERCEL = "1";
  process.env.VERCEL_ENV = "production";
  process.env.NEXT_PUBLIC_APP_URL = "https://livecoach-alpha.vercel.app/settings";
  assert.equal(
    publicAppOrigin(),
    "https://livecoach-alpha.vercel.app",
    "configured production links must be reduced to their origin"
  );

  reset();
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  assert.equal(
    publicAppOrigin("http://localhost:3001"),
    "http://localhost:3000",
    "local development must remain usable"
  );

  console.log("public app URL validation passed");
} finally {
  reset();
  for (const [key, value] of Object.entries(previous)) {
    if (value !== undefined) process.env[key] = value;
  }
}

