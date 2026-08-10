import { NextRequest, NextResponse } from "next/server";
import { GET as sendProgressDigest } from "../daily-digest/route";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

const TIME_ZONE = "Europe/London";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "not authorised" }, { status: 401 });
  }

  const londonNow = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    weekday: "long",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const weekday = londonNow.find((part) => part.type === "weekday")?.value;
  const hour = Number(londonNow.find((part) => part.type === "hour")?.value);

  // Vercel schedules in UTC. Running at both 06:00 and 07:00 UTC and allowing
  // only 07:00 Europe/London keeps the delivery time stable across BST/GMT.
  if (weekday !== "Sunday" || hour !== 7) {
    return NextResponse.json({
      ok: true,
      skipped: "waiting for Sunday 07:00 Europe/London",
    });
  }

  return sendProgressDigest(req);
}
