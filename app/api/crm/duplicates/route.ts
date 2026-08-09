import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { findDuplicateCompanies } from "@/lib/crm-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Conservative duplicate detector: exact normalised names/domains or the same
// contact email attached to different clients. It only suggests review and
// never mutates CRM records.
export async function GET() {
  try {
    const [{ data: companies, error: companyError }, { data: contacts, error: contactError }] =
      await Promise.all([
        supabaseAdmin
          .from("companies")
          .select("id, name, domain, website, profile, updated_at")
          .limit(1000),
        supabaseAdmin
          .from("contacts")
          .select("company_id, email")
          .not("company_id", "is", null)
          .not("email", "is", null)
          .limit(3000),
      ]);
    if (companyError) throw companyError;
    if (contactError) throw contactError;

    const duplicates = findDuplicateCompanies(companies || [], contacts || []);

    return NextResponse.json({ duplicates });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to check duplicate clients" },
      { status: 500 }
    );
  }
}
