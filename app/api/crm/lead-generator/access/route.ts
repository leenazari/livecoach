import { NextResponse } from "next/server";

import { LeadGeneratorError } from "@/lib/lead-generator-contract";
import { leadCleanseEnabled } from "@/lib/lead-cleanse-rules";
import {
  leadGeneratorJson,
  leadGeneratorNoStore,
} from "@/lib/lead-generator-http";
import { canManageLeadGenerator } from "@/lib/lead-generator-rules";
import { requireRequestScope } from "@/lib/request-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const scope = requireRequestScope();
    const allowed = canManageLeadGenerator(scope.role, scope.status);
    return NextResponse.json(
      {
        allowed,
        role: scope.role,
        cleanseEnabled: allowed ? leadCleanseEnabled() : false,
      },
      { headers: leadGeneratorNoStore }
    );
  } catch (error) {
    return leadGeneratorJson(
      error instanceof LeadGeneratorError
        ? error
        : new LeadGeneratorError({
            status: 401,
            code: "lead_generator_sign_in",
            title: "Sign-in required",
            reason: "LiveCoach could not verify your current CRM session.",
            nextAction: "Sign in again, then open Lead generator.",
            outcome: "Nothing was changed.",
            responsible: "user",
          })
    );
  }
}
