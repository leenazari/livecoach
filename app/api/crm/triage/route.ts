import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { upsertTasks } from "@/lib/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CLASSIFICATIONS = new Set([
  "prospect",
  "partner",
  "customer",
  "in_house",
  "irrelevant",
]);

const ACTIVE_PROSPECT_STAGES = new Set([
  "New",
  "Discovery",
  "Qualified",
  "Proposal",
  "Negotiation",
]);

const stageFor = (classification: string, currentStage: string | null) => {
  if (classification === "partner") return "Partner";
  if (classification === "customer") return "Customer";
  if (classification === "in_house") return "In House";
  if (classification === "irrelevant") return "Dormant";
  return currentStage && ACTIVE_PROSPECT_STAGES.has(currentStage)
    ? currentStage
    : "New";
};

// One click reviews up to five clients. The server merges its small triage
// marker into the existing profile instead of trusting the browser to replace
// the whole JSON document. Nothing is deleted: irrelevant records become
// Dormant and their open reminders are dismissed, while all history remains.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const items = Array.isArray(body.items) ? body.items.slice(0, 5) : [];
    if (!items.length) {
      return NextResponse.json({ error: "Choose at least one client" }, { status: 400 });
    }

    const clean: { id: string; classification: string; nextAction: string }[] =
      items.map((item: any) => {
        const id = String(item?.id || "");
        const classification = String(item?.classification || "");
        const nextAction =
          typeof item?.nextAction === "string"
            ? item.nextAction.trim().slice(0, 500)
            : "";
        if (!UUID_RE.test(id) || !CLASSIFICATIONS.has(classification)) {
          throw new Error("One of the triage choices is invalid");
        }
        return { id, classification, nextAction };
      });

    const ids = clean.map((item) => item.id);
    if (new Set(ids).size !== ids.length) {
      return NextResponse.json(
        { error: "The same client cannot appear twice in one triage batch." },
        { status: 400 }
      );
    }
    const [{ data: companies, error: companyError }, { data: openDeals, error: dealError }] =
      await Promise.all([
        supabaseAdmin
          .from("companies")
          .select("id,name,stage,profile")
          .in("id", ids),
        supabaseAdmin
          .from("opportunities")
          .select("company_id")
          .in("company_id", ids)
          .eq("status", "open")
          .eq("opportunity_type", "revenue"),
      ]);
    if (companyError) throw companyError;
    if (dealError) throw dealError;
    if ((companies || []).length !== new Set(ids).size) {
      return NextResponse.json(
        { error: "One of these clients no longer exists. Refresh and try again." },
        { status: 409 }
      );
    }

    const dealCompanyIds = new Set((openDeals || []).map((deal: any) => deal.company_id));
    const companyById = new Map((companies || []).map((company: any) => [company.id, company]));
    for (const item of clean) {
      if (item.classification === "irrelevant" && dealCompanyIds.has(item.id)) {
        return NextResponse.json(
          { error: `${companyById.get(item.id)?.name || "That client"} has an open opportunity and cannot be archived from triage.` },
          { status: 409 }
        );
      }
    }

    const reviewedAt = new Date().toISOString();
    const results: { id: string; name: string; stage: string; classification: string }[] = [];
    for (const item of clean) {
      const company: any = companyById.get(item.id);
      const profile =
        company.profile && typeof company.profile === "object" ? company.profile : {};
      const stage = stageFor(item.classification, company.stage || null);
      const archived = item.classification === "irrelevant";
      const { error } = await supabaseAdmin
        .from("companies")
        .update({
          stage,
          profile: {
            ...profile,
            archived,
            triage: {
              classification: item.classification,
              reviewedAt,
              source: "client_triage",
            },
            updated: reviewedAt,
          },
          updated_at: reviewedAt,
        })
        .eq("id", item.id);
      if (error) throw error;

      if (archived) {
        const { error: taskError } = await supabaseAdmin
          .from("tasks")
          .update({ status: "dismissed", updated_at: reviewedAt })
          .eq("company_id", item.id)
          .eq("status", "open");
        if (taskError) throw taskError;
      } else if (item.nextAction) {
        await upsertTasks(item.id, [
          {
            text: item.nextAction,
            kind: "next_step",
            linkKind: "client",
            source: "client_triage",
            sourceRef: `triage:${item.id}`,
          },
        ]);
      }

      results.push({
        id: item.id,
        name: company.name,
        stage,
        classification: item.classification,
      });
    }

    return NextResponse.json(
      { ok: true, reviewedAt, results },
      {
        headers: {
          "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
        },
      }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "failed to save client triage" },
      { status: 500 }
    );
  }
}
