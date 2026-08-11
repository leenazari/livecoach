import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const purpose =
      typeof body.purpose === "string" ? body.purpose.trim() : "";
    const departmentName =
      typeof body.departmentName === "string"
        ? body.departmentName.trim()
        : "";
    if (!name || !departmentName)
      return NextResponse.json(
        { error: "department and workstream name are required" },
        { status: 400 }
      );

    const { data: company, error: companyError } = await supabaseAdmin
      .from("companies")
      .select("id")
      .eq("id", params.id)
      .maybeSingle();
    if (companyError) throw companyError;
    if (!company)
      return NextResponse.json({ error: "company not found" }, { status: 404 });

    const { data: existingDepartments, error: departmentsError } =
      await supabaseAdmin
        .from("departments")
        .select("id, name")
        .eq("company_id", params.id);
    if (departmentsError) throw departmentsError;
    let department = (existingDepartments || []).find(
      (row: any) =>
        String(row.name).trim().toLowerCase() === departmentName.toLowerCase()
    );
    if (!department) {
      const { data: inserted, error: insertDepartmentError } =
        await supabaseAdmin
          .from("departments")
          .insert({ company_id: params.id, name: departmentName })
          .select("id, name")
          .single();
      if (insertDepartmentError) throw insertDepartmentError;
      department = inserted;
    }

    const { data: existingThreads, error: threadsError } = await supabaseAdmin
      .from("workstreams")
      .select("id, name")
      .eq("company_id", params.id);
    if (threadsError) throw threadsError;
    if (
      (existingThreads || []).some(
        (row: any) =>
          String(row.name).trim().toLowerCase() === name.toLowerCase()
      )
    )
      return NextResponse.json(
        { error: "that workstream already exists" },
        { status: 409 }
      );

    const { data: workstream, error: workstreamError } = await supabaseAdmin
      .from("workstreams")
      .insert({
        company_id: params.id,
        department_id: department.id,
        name,
        purpose: purpose || null,
        kind:
          typeof body.kind === "string" &&
          [
            "relationship",
            "opportunity",
            "partnership",
            "project",
            "support",
            "internal",
          ].includes(body.kind)
            ? body.kind
            : "relationship",
      })
      .select()
      .single();
    if (workstreamError) throw workstreamError;
    return NextResponse.json({ department, workstream }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to create workstream" },
      { status: 500 }
    );
  }
}
