import { NextResponse } from "next/server";

import { crmBlockerPayload } from "@/lib/crm-blocker";
import type { FieldErrors } from "@/lib/interviewer/form-fields";

const noStore = { "Cache-Control": "private, no-store" };

export function interviewerFieldError(code: string, title: string, fields: FieldErrors) {
  const reason = Object.values(fields)[0] || "Check the highlighted field.";
  return NextResponse.json(
    {
      ...crmBlockerPayload({
        code,
        title,
        reason,
        nextAction: "Correct the field named above and try again. Nothing was saved.",
        responsible: "owner",
        outcome: "No record was confirmed saved.",
      }),
      fields,
    },
    { status: 400, headers: noStore }
  );
}
