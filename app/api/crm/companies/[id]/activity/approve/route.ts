import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { actionToLinkKind, upsertTasks } from "@/lib/tasks";
import { getCommercialMemory } from "@/lib/commercial-memory";
import type { ActivityIntelligence } from "@/lib/activity-intelligence";

export const runtime = "nodejs";

const labelRole = (role: string) => role.replace(/_/g, " ");

// Applies only the server-saved recommendation for the named source note. The
// browser cannot provide arbitrary endpoints or replacement recommendation
// data. This keeps the one-click plan inside a small CRM allow-list.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const contextId =
      typeof body.contextId === "string" ? body.contextId.trim() : "";
    if (!contextId) {
      return NextResponse.json({ error: "activity is required" }, { status: 400 });
    }

    const { data: company, error: companyError } = await supabaseAdmin
      .from("companies")
      .select("id, name, profile, stage")
      .eq("id", params.id)
      .maybeSingle();
    if (companyError) throw companyError;
    if (!company) {
      return NextResponse.json({ error: "client not found" }, { status: 404 });
    }

    const profile =
      company.profile && typeof company.profile === "object" ? company.profile : {};
    const activityStore =
      (profile as any).activity_intelligence &&
      typeof (profile as any).activity_intelligence === "object"
        ? (profile as any).activity_intelligence
        : {};
    const intelligence = activityStore.latest as ActivityIntelligence | undefined;
    if (!intelligence || intelligence.contextId !== contextId) {
      return NextResponse.json(
        { error: "That activity plan is no longer the latest one. Log it again if needed." },
        { status: 409 }
      );
    }
    if (intelligence.status === "applied") {
      return NextResponse.json({
        intelligence,
        applied: intelligence.applied || [],
        warnings: intelligence.warnings || [],
        alreadyApplied: true,
      });
    }

    const [{ data: opportunityRows }, { data: upcomingRows }, { data: contacts }] =
      await Promise.all([
        supabaseAdmin
          .from("opportunities")
          .select("id, title")
          .eq("company_id", params.id)
          .eq("status", "open")
          .eq("opportunity_type", "revenue")
          .order("updated_at", { ascending: false })
          .limit(1),
        supabaseAdmin
          .from("upcoming_calls")
          .select("id, title, intent, prep")
          .eq("company_id", params.id)
          .is("completed_at", null)
          .gte("scheduled_at", new Date().toISOString())
          .order("scheduled_at", { ascending: true })
          .limit(1),
        supabaseAdmin
          .from("contacts")
          .select("id, name, attributes")
          .eq("company_id", params.id)
          .limit(30),
      ]);

    const applied: string[] = [];
    const warnings: string[] = [];
    const opportunity = opportunityRows?.[0] || null;
    const upcoming = upcomingRows?.[0] || null;

    const classificationByStage: Record<string, string> = {
      "Product Trial": "product_trial",
      Partner: "partner",
      Customer: "customer",
      "In House": "in_house",
    };
    const relationshipStage = intelligence.relationshipStage || null;
    if (relationshipStage) {
      applied.push(`Classified ${company.name} as ${relationshipStage}`);
    }

    if (intelligence.nextAction) {
      const next = intelligence.nextAction;
      if (opportunity) {
        const { error } = await supabaseAdmin
          .from("opportunities")
          .update({
            next_action: next.text,
            next_action_owner: next.owner,
            next_action_due_at: next.dueAt ? `${next.dueAt}T12:00:00Z` : null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", opportunity.id);
        if (error) warnings.push(`Deal next action did not save: ${error.message}`);
        else applied.push(`Updated the next action on ${opportunity.title}`);
      } else {
        const created = await upsertTasks(params.id, [
          {
            text: next.text,
            kind:
              next.owner === "buyer"
                ? "counterparty_commitment"
                : "next_step",
            linkKind: actionToLinkKind(next.action),
            source: "client_activity",
            sourceRef: contextId,
            dueAt: next.dueAt,
            payload: {
              ownerType:
                next.owner === "buyer"
                  ? "counterparty"
                  : next.owner === "joint"
                    ? "joint"
                    : "me",
              ownerName:
                next.owner === "buyer"
                  ? "They"
                  : next.owner === "joint"
                    ? "Joint"
                    : "You",
            },
          },
        ]);
        applied.push(
          created.length
            ? "Created the priority next step"
            : "The priority next step was already on the CRM"
        );
      }
    }

    if (intelligence.followUp?.body) {
      const { error } = await supabaseAdmin.from("follow_ups").insert({
        company_id: params.id,
        draft_subject: intelligence.followUp.subject || "Follow-up",
        draft_body: intelligence.followUp.body,
        status: "draft",
      });
      if (error) warnings.push(`Follow-up draft did not save: ${error.message}`);
      else applied.push("Created a follow-up draft for review");
    }

    for (const suggestion of intelligence.stakeholderUpdates || []) {
      const matches = (contacts || []).filter(
        (contact: any) =>
          String(contact.name || "").trim().toLowerCase() ===
          suggestion.person.trim().toLowerCase()
      );
      if (matches.length !== 1) {
        warnings.push(
          matches.length
            ? `More than one contact matched ${suggestion.person}, so their role was not changed.`
            : `${suggestion.person} is not an exact saved contact yet, so their role was not changed.`
        );
        continue;
      }
      const contact = matches[0];
      const attributes =
        contact.attributes && typeof contact.attributes === "object"
          ? contact.attributes
          : {};
      const { error } = await supabaseAdmin
        .from("contacts")
        .update({
          attributes: {
            ...attributes,
            stakeholderRole: suggestion.buyingRole,
          },
        })
        .eq("id", contact.id);
      if (error) warnings.push(`${suggestion.person}'s role did not save: ${error.message}`);
      else
        applied.push(
          `Set ${suggestion.person} as ${labelRole(suggestion.buyingRole)}`
        );
    }

    let nextCall = (profile as any).next_call;
    if (intelligence.nextCallIntent) {
      nextCall = {
        intent: intelligence.nextCallIntent,
        rationale: intelligence.overview,
        basedOnActivityId: contextId,
        generatedAt: new Date().toISOString(),
      };
      applied.push("Updated the suggested intent for the next call");
      if (upcoming) {
        const prep = upcoming.prep && typeof upcoming.prep === "object" ? upcoming.prep : {};
        if ((prep as any).intentMeta?.source === "manual") {
          warnings.push(
            `The intent on ${upcoming.title || "the next call"} was manually edited, so it was preserved.`
          );
        } else {
          const { error } = await supabaseAdmin
            .from("upcoming_calls")
            .update({
              intent: intelligence.nextCallIntent,
              prep: {
                ...prep,
                intentMeta: {
                  ...(prep as any).intentMeta,
                  source: "activity",
                  basedOnActivityId: contextId,
                  savedAt: new Date().toISOString(),
                },
              },
            })
            .eq("id", upcoming.id);
          if (error) warnings.push(`The upcoming call intent did not save: ${error.message}`);
          else applied.push(`Updated the intent on ${upcoming.title || "the next call"}`);
        }
      }
    }

    const updatedIntelligence: ActivityIntelligence = {
      ...intelligence,
      status: "applied",
      appliedAt: new Date().toISOString(),
      applied,
      warnings,
    };
    const reviewedAt = new Date().toISOString();
    const { error: profileError } = await supabaseAdmin
      .from("companies")
      .update({
        ...(relationshipStage ? { stage: relationshipStage } : {}),
        profile: {
          ...profile,
          ...(relationshipStage
            ? {
                archived: false,
                triage: {
                  ...((profile as any).triage || {}),
                  classification: classificationByStage[relationshipStage],
                  reviewedAt,
                  source: "client_activity",
                },
              }
            : {}),
          next_call: nextCall,
          activity_intelligence: {
            ...activityStore,
            latest: updatedIntelligence,
          },
          updated: reviewedAt,
        },
        updated_at: reviewedAt,
      })
      .eq("id", params.id);
    if (profileError) throw profileError;

    await getCommercialMemory(params.id);

    return NextResponse.json({
      intelligence: updatedIntelligence,
      applied,
      warnings,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "failed to apply activity plan" },
      { status: 500 }
    );
  }
}
