import "server-only";

import { createHash } from "crypto";
import { McpServer, type ServerContext } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  createStaffMcpClient,
  type StaffMcpPrincipal,
} from "@/lib/staff-mcp-auth";

const PAGE_SIZE = 25;
const DEFAULT_RATE_LIMIT = 120;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEAD_FIELDS = [
  "id",
  "email",
  "first_name",
  "last_name",
  "job_title",
  "company_name",
  "company_domain",
  "website",
  "phone",
  "person_linkedin_url",
  "priority",
  "status",
  "next_action_at",
  "source_metadata",
  "assigned_to_user_id",
  "owner_id",
  "created_at",
  "updated_at",
].join(",");

type JsonObject = Record<string, unknown>;
type McpToolName =
  | "find_my_lead"
  | "list_my_leads"
  | "add_lead"
  | "add_lead_context"
  | "create_my_follow_up"
  | "list_my_tasks";

type Receipt = {
  id: string;
  outcome: string;
  target_table?: string | null;
  target_id?: string | null;
  result_summary?: JsonObject | null;
  error_code?: string | null;
};

class SafeMcpError extends Error {
  code: string;
  nextStep: string;

  constructor(code: string, message: string, nextStep: string) {
    super(message);
    this.name = "SafeMcpError";
    this.code = code;
    this.nextStep = nextStep;
  }
}

function compact(value: unknown, max: number): string {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function contextText(value: unknown): string {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 4000);
}

function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

function exactIlikePattern(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function normaliseDomain(value: string | undefined): string | null {
  const raw = compact(value, 255).toLowerCase();
  if (!raw) return null;
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return url.hostname.replace(/^www\./, "").slice(0, 255) || null;
  } catch {
    throw new SafeMcpError(
      "invalid_company_domain",
      "The company domain is not valid.",
      "Use a domain such as example.com, or leave it out."
    );
  }
}

function cleanUrl(value: string | undefined, kind: "website" | "linkedin"): string | null {
  const raw = compact(value, 1000);
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SafeMcpError(
      `invalid_${kind}_url`,
      `The ${kind === "linkedin" ? "LinkedIn" : "website"} URL is not valid.`,
      "Use a complete https URL, or leave it out."
    );
  }
  if (url.protocol !== "https:") {
    throw new SafeMcpError(
      `invalid_${kind}_url`,
      "Only secure https URLs can be saved.",
      "Use a complete https URL, or leave it out."
    );
  }
  if (url.username || url.password) {
    throw new SafeMcpError(
      `invalid_${kind}_url`,
      "A URL containing a username or password cannot be saved.",
      "Use the public https URL without credentials, or leave it out."
    );
  }
  if (
    kind === "linkedin" &&
    url.hostname.toLowerCase() !== "linkedin.com" &&
    !url.hostname.toLowerCase().endsWith(".linkedin.com")
  ) {
    throw new SafeMcpError(
      "invalid_linkedin_url",
      "The LinkedIn profile URL is not on linkedin.com.",
      "Use the person's full LinkedIn profile URL, or leave it out."
    );
  }
  url.hash = "";
  return url.toString().slice(0, 1000);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as JsonObject)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function requestFingerprint(
  principal: StaffMcpPrincipal,
  toolName: McpToolName,
  args: unknown,
  ctx: ServerContext
): string {
  return sha256(
    [
      principal.clientId,
      principal.userId,
      toolName,
      String(ctx.mcpReq.id),
      canonicalJson(args),
    ].join("::")
  );
}

function leadAccessFilter(userId: string): string {
  return `assigned_to_user_id.eq.${userId},and(owner_id.eq.${userId},assigned_to_user_id.is.null)`;
}

function latestContextNotes(row: JsonObject): Array<{ text: string; addedAt: string }> {
  const metadata = row.source_metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  const mcp = (metadata as JsonObject).chatgpt_mcp;
  if (!mcp || typeof mcp !== "object" || Array.isArray(mcp)) return [];
  const notes = (mcp as JsonObject).context_notes;
  if (!Array.isArray(notes)) return [];
  return notes
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      text: contextText((item as JsonObject).text),
      addedAt: compact((item as JsonObject).added_at, 80),
    }))
    .filter((item) => item.text)
    .slice(-5);
}

function publicLead(row: JsonObject): JsonObject {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name || null,
    lastName: row.last_name || null,
    jobTitle: row.job_title || null,
    companyName: row.company_name,
    companyDomain: row.company_domain || null,
    website: row.website || null,
    phone: row.phone || null,
    linkedInUrl: row.person_linkedin_url || null,
    priority: row.priority,
    status: row.status,
    nextActionAt: row.next_action_at || null,
    contextNotes: latestContextNotes(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function success(text: string, structuredContent: JsonObject) {
  return {
    content: [{ type: "text" as const, text }],
    structuredContent,
  };
}

function safeFailure(error: unknown) {
  const known = error instanceof SafeMcpError;
  const databaseCode = compact((error as { code?: string } | null)?.code, 80);
  let code = known ? error.code : "livecoach_action_failed";
  let message = known
    ? error.message
    : "LiveCoach could not safely complete that action.";
  let nextStep = known
    ? error.nextStep
    : "Try once more. If it repeats, ask the LiveCoach workspace owner to check the connector receipt.";

  if (databaseCode === "42501") {
    code = "permission_denied";
    message = "Your LiveCoach account is not allowed to change that record.";
    nextStep = "Open the record in LiveCoach and check that it is assigned to you.";
  } else if (databaseCode === "23505") {
    code = "duplicate_protected";
    message = "That record already exists in LiveCoach, so no duplicate was created.";
    nextStep = "Ask the workspace owner to assign or share the existing record if you need access.";
  } else if (databaseCode === "42P01") {
    code = "connector_setup_incomplete";
    message = "The LiveCoach staff connector has not finished being enabled.";
    nextStep = "Ask the workspace owner to finish the connector setup, then try again.";
  }

  return {
    content: [
      {
        type: "text" as const,
        text: `${message} What to do next. ${nextStep}`,
      },
    ],
    structuredContent: {
      ok: false,
      errorCode: code,
      message,
      nextStep,
    },
    isError: true,
  };
}

function rateLimit(): number {
  const parsed = Number(process.env.LIVECOACH_MCP_ACTIONS_PER_HOUR || "");
  return Number.isInteger(parsed) && parsed >= 20 && parsed <= 1000
    ? parsed
    : DEFAULT_RATE_LIMIT;
}

async function enforceRateLimit(
  principal: StaffMcpPrincipal,
  client: ReturnType<typeof createStaffMcpClient>
) {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error } = await client
    .from("mcp_action_receipts")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", principal.workspaceId)
    .eq("actor_user_id", principal.userId)
    .gte("created_at", since);
  if (error) throw error;
  if ((count || 0) >= rateLimit()) {
    throw new SafeMcpError(
      "rate_limit_reached",
      "The hourly LiveCoach connector limit has been reached.",
      "Wait until the next hour before asking ChatGPT to make more CRM changes."
    );
  }
}

async function beginReceipt(args: {
  principal: StaffMcpPrincipal;
  toolName: McpToolName;
  requestFingerprint: string;
  requestSummary: JsonObject;
  client: ReturnType<typeof createStaffMcpClient>;
}): Promise<{ receipt: Receipt; inserted: boolean }> {
  await enforceRateLimit(args.principal, args.client);
  const row = {
    workspace_id: args.principal.workspaceId,
    actor_user_id: args.principal.userId,
    oauth_client_id: args.principal.clientId,
    tool_name: args.toolName,
    outcome: "started",
    request_fingerprint: args.requestFingerprint,
    request_summary: args.requestSummary,
  };
  const { data, error } = await args.client
    .from("mcp_action_receipts")
    .insert(row)
    .select("id,outcome,target_table,target_id,result_summary,error_code")
    .single();
  if (!error && data) {
    return { receipt: data as Receipt, inserted: true };
  }
  if (error?.code !== "23505") throw error;

  const { data: existing, error: existingError } = await args.client
    .from("mcp_action_receipts")
    .select("id,outcome,target_table,target_id,result_summary,error_code")
    .eq("workspace_id", args.principal.workspaceId)
    .eq("actor_user_id", args.principal.userId)
    .eq("oauth_client_id", args.principal.clientId)
    .eq("request_fingerprint", args.requestFingerprint)
    .maybeSingle();
  if (existingError || !existing) throw existingError || error;
  return { receipt: existing as Receipt, inserted: false };
}

async function finishReceipt(args: {
  receipt: Receipt;
  principal: StaffMcpPrincipal;
  client: ReturnType<typeof createStaffMcpClient>;
  outcome: "created" | "updated" | "existing" | "read" | "failed";
  targetTable?: "outreach_prospects" | "tasks";
  targetId?: string;
  resultSummary?: JsonObject;
  errorCode?: string;
}) {
  const { data, error } = await args.client
    .from("mcp_action_receipts")
    .update({
      outcome: args.outcome,
      target_table: args.targetTable || null,
      target_id: args.targetId || null,
      result_summary: args.resultSummary || {},
      error_code: args.errorCode || null,
      completed_at: new Date().toISOString(),
    })
    .eq("workspace_id", args.principal.workspaceId)
    .eq("actor_user_id", args.principal.userId)
    .eq("oauth_client_id", args.principal.clientId)
    .eq("id", args.receipt.id)
    .select("id")
    .single();
  if (error || !data) throw error || new Error("MCP receipt was not finalized");
}

async function auditedTool(
  principal: StaffMcpPrincipal,
  toolName: McpToolName,
  args: JsonObject,
  ctx: ServerContext,
  run: (helpers: {
    client: ReturnType<typeof createStaffMcpClient>;
    receipt: Receipt;
  }) => Promise<{
    text: string;
    data: JsonObject;
    outcome: "created" | "updated" | "existing" | "read";
    targetTable?: "outreach_prospects" | "tasks";
    targetId?: string;
  }>
) {
  const client = createStaffMcpClient(principal.accessToken);
  let receipt: Receipt | null = null;
  try {
    const receiptStart = await beginReceipt({
      principal,
      toolName,
      requestFingerprint: requestFingerprint(principal, toolName, args, ctx),
      requestSummary: {
        emailHash: typeof args.email === "string" ? sha256(normaliseEmail(args.email)) : null,
        fields: Object.keys(args).sort(),
      },
      client,
    });
    receipt = receiptStart.receipt;
    if (!receiptStart.inserted) {
      if (receipt.outcome === "started") {
        return safeFailure(
          new SafeMcpError(
            "request_in_progress",
            "This exact LiveCoach request is already being processed.",
            "Wait for the current request to finish before trying it again."
          )
        );
      }
      if (receipt.outcome === "failed") {
        return safeFailure(
          new SafeMcpError(
            receipt.error_code || "previous_request_failed",
            "This exact request was already processed and did not complete.",
            "Change the request after resolving the original blocker, then try again."
          )
        );
      }
      return success("This exact request was already completed. LiveCoach did not run it twice.", {
        ok: true,
        replayed: true,
        receiptId: receipt.id,
        outcome: receipt.outcome,
        targetId: receipt.target_id || null,
        ...(receipt.result_summary || {}),
      });
    }
    const result = await run({ client, receipt });
    await finishReceipt({
      receipt,
      principal,
      client,
      outcome: result.outcome,
      targetTable: result.targetTable,
      targetId: result.targetId,
      resultSummary: {
        ok: true,
        outcome: result.outcome,
        targetId: result.targetId || null,
      },
    });
    return success(result.text, {
      ok: true,
      receiptId: receipt.id,
      ...result.data,
    });
  } catch (error) {
    if (receipt) {
      const mapped = safeFailure(error);
      try {
        await finishReceipt({
          receipt,
          principal,
          client,
          outcome: "failed",
          errorCode: String(mapped.structuredContent.errorCode),
          resultSummary: {
            ok: false,
            errorCode: mapped.structuredContent.errorCode,
          },
        });
      } catch {
        // The original safe error remains more useful than a second receipt error.
      }
    }
    return safeFailure(error);
  }
}

function encodeCursor(createdAt: unknown, id: unknown): string | null {
  const date = compact(createdAt, 80);
  const rowId = compact(id, 80);
  if (!date || !rowId) return null;
  return Buffer.from(JSON.stringify({ createdAt: date, id: rowId }), "utf8").toString(
    "base64url"
  );
}

function decodeCursor(value: string | undefined): { createdAt: string; id: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    const createdAt = compact(parsed.createdAt, 80);
    const id = compact(parsed.id, 80);
    if (!createdAt || !UUID.test(id) || !Number.isFinite(Date.parse(createdAt))) {
      throw new Error();
    }
    return { createdAt: new Date(createdAt).toISOString(), id };
  } catch {
    throw new SafeMcpError(
      "invalid_cursor",
      "That results cursor is not valid.",
      "Start the list again without a cursor."
    );
  }
}

function appendContextMetadata(
  sourceMetadata: unknown,
  note: string,
  principal: StaffMcpPrincipal
): { metadata: JsonObject; changed: boolean } {
  const metadata =
    sourceMetadata && typeof sourceMetadata === "object" && !Array.isArray(sourceMetadata)
      ? { ...(sourceMetadata as JsonObject) }
      : {};
  const existingMcp =
    metadata.chatgpt_mcp &&
    typeof metadata.chatgpt_mcp === "object" &&
    !Array.isArray(metadata.chatgpt_mcp)
      ? { ...(metadata.chatgpt_mcp as JsonObject) }
      : {};
  const existingNotes = Array.isArray(existingMcp.context_notes)
    ? existingMcp.context_notes.filter(
        (item) => item && typeof item === "object" && !Array.isArray(item)
      )
    : [];
  const normalised = contextText(note).toLowerCase();
  const duplicate = existingNotes.some(
    (item) => contextText((item as JsonObject).text).toLowerCase() === normalised
  );
  if (duplicate) return { metadata, changed: false };
  const addedAt = new Date().toISOString();
  metadata.chatgpt_mcp = {
    ...existingMcp,
    context_notes: [
      ...existingNotes.slice(-19),
      {
        text: contextText(note),
        added_at: addedAt,
        added_by: principal.userId,
        oauth_client_id: principal.clientId,
      },
    ],
    last_updated_at: addedAt,
  };
  return { metadata, changed: true };
}

async function findAccessibleLead(
  client: ReturnType<typeof createStaffMcpClient>,
  principal: StaffMcpPrincipal,
  email: string
): Promise<JsonObject | null> {
  const { data, error } = await client
    .from("outreach_prospects")
    .select(LEAD_FIELDS)
    .eq("workspace_id", principal.workspaceId)
    .ilike("email", exactIlikePattern(normaliseEmail(email)))
    .or(leadAccessFilter(principal.userId))
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as JsonObject | null) || null;
}

const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .email("Use a valid email address")
  .max(320)
  .describe("The lead's exact email address. LiveCoach uses this to prevent duplicates.");
const cursorField = z
  .string()
  .trim()
  .max(500)
  .optional()
  .describe("Opaque nextCursor returned by the previous list call.");

export function buildStaffMcpServer(principal: StaffMcpPrincipal): McpServer {
  const server = new McpServer(
    { name: "LiveCoach Staff CRM", version: "1.0.0" },
    {
      instructions:
        "Use these tools only for the signed-in staff member's own CRM work. Never claim that an action succeeded unless the tool returns ok true and a receiptId. Do not invent lead details. Ask for an exact email and company before adding a lead. This connector cannot send outreach, start campaigns, assign work to colleagues, change permissions, or change code.",
    }
  );

  server.registerTool(
    "find_my_lead",
    {
      title: "Find my LiveCoach lead",
      description:
        "Find one lead assigned to the signed-in staff member using an exact email address. It never searches another salesperson's private records.",
      inputSchema: z.object({ email: emailField }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ email }, ctx) =>
      auditedTool(principal, "find_my_lead", { email }, ctx, async ({ client }) => {
        const lead = await findAccessibleLead(client, principal, email);
        return {
          text: lead
            ? `Found ${compact(lead.first_name, 120) || normaliseEmail(email)} at ${compact(lead.company_name, 200)} in your LiveCoach leads.`
            : "No lead with that exact email is assigned to you in LiveCoach.",
          data: { found: Boolean(lead), lead: lead ? publicLead(lead) : null },
          outcome: "read",
          targetTable: lead ? "outreach_prospects" : undefined,
          targetId: lead ? String(lead.id) : undefined,
        };
      })
  );

  server.registerTool(
    "list_my_leads",
    {
      title: "List my LiveCoach leads",
      description:
        "List leads assigned to the signed-in staff member. Results are paginated and never include another salesperson's private records.",
      inputSchema: z
        .object({
          status: z
            .enum([
              "imported",
              "queued",
              "researching",
              "ready",
              "contacted",
              "replied",
              "qualified",
              "not_interested",
              "suppressed",
            ])
            .optional()
            .describe("Optional exact outreach status filter."),
          cursor: cursorField,
        })
        .strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ status, cursor }, ctx) =>
      auditedTool(
        principal,
        "list_my_leads",
        { status: status || null, cursor: cursor || null },
        ctx,
        async ({ client }) => {
          const page = decodeCursor(cursor);
          let query = client
            .from("outreach_prospects")
            .select(LEAD_FIELDS)
            .eq("workspace_id", principal.workspaceId)
            .or(leadAccessFilter(principal.userId))
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .limit(PAGE_SIZE + 1);
          if (status) query = query.eq("status", status);
          if (page) {
            query = query.or(
              `created_at.lt.${page.createdAt},and(created_at.eq.${page.createdAt},id.lt.${page.id})`
            );
          }
          const { data, error } = await query;
          if (error) throw error;
          const rows = (data || []) as unknown as JsonObject[];
          const hasMore = rows.length > PAGE_SIZE;
          const visible = rows.slice(0, PAGE_SIZE);
          const last = visible[visible.length - 1];
          const nextCursor = hasMore
            ? encodeCursor(last?.created_at, last?.id)
            : null;
          return {
            text: visible.length
              ? `Found ${visible.length} lead${visible.length === 1 ? "" : "s"} assigned to you${hasMore ? ". More results are available" : ""}.`
              : "No leads matched in your LiveCoach account.",
            data: {
              leads: visible.map(publicLead),
              nextCursor,
              hasMore,
            },
            outcome: "read",
          };
        }
      )
  );

  server.registerTool(
    "add_lead",
    {
      title: "Add a lead to my LiveCoach CRM",
      description:
        "Add one lead as a private record assigned to the signed-in staff member. Exact email deduplication prevents duplicate CRM people. Existing values are never overwritten by this tool.",
      inputSchema: z
        .object({
          email: emailField,
          firstName: z.string().trim().min(1).max(120).optional(),
          lastName: z.string().trim().min(1).max(120).optional(),
          jobTitle: z.string().trim().min(1).max(200).optional(),
          companyName: z
            .string()
            .trim()
            .min(1)
            .max(200)
            .describe("The verified company name. Do not invent one."),
          companyDomain: z.string().trim().min(1).max(500).optional(),
          website: z.string().trim().min(1).max(1000).optional(),
          phone: z.string().trim().min(3).max(80).optional(),
          linkedInUrl: z.string().trim().min(1).max(1000).optional(),
          priority: z.enum(["high", "medium", "low"]).default("low"),
          context: z
            .string()
            .trim()
            .min(1)
            .max(4000)
            .optional()
            .describe("Verified context about the lead. Do not add guesses."),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input, ctx) =>
      auditedTool(principal, "add_lead", input, ctx, async ({ client }) => {
        const email = normaliseEmail(input.email);
        const companyDomain = normaliseDomain(input.companyDomain);
        const website = cleanUrl(input.website, "website");
        const linkedInUrl = cleanUrl(input.linkedInUrl, "linkedin");
        const existing = await findAccessibleLead(client, principal, email);

        if (existing) {
          const updates: JsonObject = {};
          const missingOnly: Array<[string, unknown]> = [
            ["first_name", compact(input.firstName, 120) || null],
            ["last_name", compact(input.lastName, 120) || null],
            ["job_title", compact(input.jobTitle, 200) || null],
            ["company_domain", companyDomain],
            ["website", website],
            ["phone", compact(input.phone, 80) || null],
            ["person_linkedin_url", linkedInUrl],
          ];
          for (const [column, value] of missingOnly) {
            if (!existing[column] && value) updates[column] = value;
          }
          if (input.context) {
            const appended = appendContextMetadata(
              existing.source_metadata,
              input.context,
              principal
            );
            if (appended.changed) updates.source_metadata = appended.metadata;
          }
          if (Object.keys(updates).length) {
            updates.updated_at = new Date().toISOString();
            const { data, error } = await client
              .from("outreach_prospects")
              .update(updates)
              .eq("workspace_id", principal.workspaceId)
              .eq("id", String(existing.id))
              .or(leadAccessFilter(principal.userId))
              .select(LEAD_FIELDS)
              .single();
            if (error) throw error;
            return {
              text: "This lead already existed. LiveCoach kept the existing record, filled only missing verified details, and did not create a duplicate.",
              data: { created: false, updated: true, duplicatePrevented: true, lead: publicLead(data as unknown as JsonObject) },
              outcome: "updated",
              targetTable: "outreach_prospects",
              targetId: String(existing.id),
            };
          }
          return {
            text: "This lead already existed in your LiveCoach account. No duplicate was created and no existing data was overwritten.",
            data: { created: false, updated: false, duplicatePrevented: true, lead: publicLead(existing) },
            outcome: "existing",
            targetTable: "outreach_prospects",
            targetId: String(existing.id),
          };
        }

        let metadata: JsonObject = {
          chatgpt_mcp: {
            created_at: new Date().toISOString(),
            created_by: principal.userId,
            oauth_client_id: principal.clientId,
            context_notes: [],
          },
        };
        if (input.context) {
          metadata = appendContextMetadata(metadata, input.context, principal).metadata;
        }
        const { data, error } = await client
          .from("outreach_prospects")
          .insert({
            owner_id: principal.userId,
            workspace_id: principal.workspaceId,
            visibility: "private",
            assigned_to_user_id: principal.userId,
            email,
            first_name: compact(input.firstName, 120) || null,
            last_name: compact(input.lastName, 120) || null,
            job_title: compact(input.jobTitle, 200) || null,
            company_name: compact(input.companyName, 200),
            company_domain: companyDomain,
            website,
            phone: compact(input.phone, 80) || null,
            person_linkedin_url: linkedInUrl,
            priority: input.priority,
            status: "imported",
            source_file: "ChatGPT MCP",
            source_sheet: "staff connector",
            source_metadata: metadata,
          })
          .select(LEAD_FIELDS)
          .single();
        if (error) {
          if (error.code === "23505") {
            throw new SafeMcpError(
              "duplicate_protected",
              "That email already exists in LiveCoach, so no duplicate was created.",
              "Ask the workspace owner to assign or share the existing lead if you need access."
            );
          }
          throw error;
        }
        const inserted = data as unknown as JsonObject;
        return {
          text: `${compact(input.firstName, 120) || email} was added to your LiveCoach leads and assigned only to you. No outreach was sent.`,
          data: { created: true, updated: false, duplicatePrevented: false, lead: publicLead(inserted) },
          outcome: "created",
          targetTable: "outreach_prospects",
          targetId: String(inserted.id),
        };
      })
  );

  server.registerTool(
    "add_lead_context",
    {
      title: "Add context to my LiveCoach lead",
      description:
        "Append verified context to a lead assigned to the signed-in staff member. It does not overwrite existing context or alter outreach status.",
      inputSchema: z
        .object({
          email: emailField,
          context: z.string().trim().min(1).max(4000),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ email, context }, ctx) =>
      auditedTool(
        principal,
        "add_lead_context",
        { email, context },
        ctx,
        async ({ client }) => {
          const existing = await findAccessibleLead(client, principal, email);
          if (!existing) {
            throw new SafeMcpError(
              "lead_not_assigned",
              "No lead with that exact email is assigned to you.",
              "Add the lead first, or ask the workspace owner to assign the existing lead to you."
            );
          }
          const appended = appendContextMetadata(
            existing.source_metadata,
            context,
            principal
          );
          if (!appended.changed) {
            return {
              text: "That exact context is already saved on this lead. LiveCoach did not add it twice.",
              data: { updated: false, duplicatePrevented: true, lead: publicLead(existing) },
              outcome: "existing",
              targetTable: "outreach_prospects",
              targetId: String(existing.id),
            };
          }
          const { data, error } = await client
            .from("outreach_prospects")
            .update({
              source_metadata: appended.metadata,
              updated_at: new Date().toISOString(),
            })
            .eq("workspace_id", principal.workspaceId)
            .eq("id", String(existing.id))
            .or(leadAccessFilter(principal.userId))
            .select(LEAD_FIELDS)
            .single();
          if (error) throw error;
          return {
            text: "The context was added to your LiveCoach lead. Existing notes and outreach status were left unchanged.",
            data: { updated: true, duplicatePrevented: false, lead: publicLead(data as unknown as JsonObject) },
            outcome: "updated",
            targetTable: "outreach_prospects",
            targetId: String(existing.id),
          };
        }
      )
  );

  server.registerTool(
    "create_my_follow_up",
    {
      title: "Create my LiveCoach follow-up",
      description:
        "Create or reschedule an open follow-up task for a lead assigned to the signed-in staff member. It never sends a message or books a meeting.",
      inputSchema: z
        .object({
          email: emailField,
          dueAt: z
            .string()
            .trim()
            .max(80)
            .refine(
              (value) =>
                Number.isFinite(Date.parse(value)) &&
                /(Z|[+-]\d{2}:?\d{2})$/i.test(value),
              "Use an ISO 8601 date and time with a timezone"
            )
            .describe("Future ISO 8601 date and time with timezone."),
          action: z.enum(["call", "email", "task"]).default("call"),
          task: z.string().trim().min(1).max(500).optional(),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input, ctx) =>
      auditedTool(
        principal,
        "create_my_follow_up",
        input,
        ctx,
        async ({ client }) => {
          const dueAt = new Date(input.dueAt);
          if (dueAt.getTime() <= Date.now()) {
            throw new SafeMcpError(
              "follow_up_time_in_past",
              "The follow-up time has already passed.",
              "Choose a future date and time, including its timezone."
            );
          }
          const lead = await findAccessibleLead(client, principal, input.email);
          if (!lead) {
            throw new SafeMcpError(
              "lead_not_assigned",
              "No lead with that exact email is assigned to you.",
              "Add the lead first, or ask the workspace owner to assign the existing lead to you."
            );
          }
          const name = compact(
            [lead.first_name, lead.last_name].filter(Boolean).join(" "),
            240
          );
          const company = compact(lead.company_name, 200);
          const taskText = compact(
            input.task || `Follow up with ${name || normaliseEmail(input.email)}${company ? ` at ${company}` : ""}`,
            500
          );
          const payload = {
            pinned: true,
            scheduledTime: true,
            outreachProspectId: lead.id,
            prospectName: name || null,
            companyName: company || null,
            createdThrough: "chatgpt_mcp",
            oauthClientId: principal.clientId,
          };
          const { data: openTasks, error: openError } = await client
            .from("tasks")
            .select("id,text,status,due_at,payload,created_at")
            .eq("workspace_id", principal.workspaceId)
            .eq("owner_id", principal.userId)
            .eq("status", "open")
            .eq("source", "chatgpt_mcp_follow_up")
            .contains("payload", { outreachProspectId: lead.id })
            .order("created_at", { ascending: false })
            .limit(1);
          if (openError) throw openError;

          let task: JsonObject;
          let created = false;
          if (openTasks?.[0]) {
            const { data, error } = await client
              .from("tasks")
              .update({
                text: taskText,
                kind: "manual",
                link_kind: input.action === "task" ? "client" : input.action,
                due_at: dueAt.toISOString(),
                payload: { ...((openTasks[0].payload as JsonObject) || {}), ...payload },
              })
              .eq("workspace_id", principal.workspaceId)
              .eq("owner_id", principal.userId)
              .eq("status", "open")
              .eq("id", openTasks[0].id)
              .select("id,text,status,due_at,payload,created_at")
              .single();
            if (error) throw error;
            task = data as JsonObject;
          } else {
            const fingerprint = sha256(
              [
                "chatgpt_mcp_follow_up",
                String(lead.id),
                dueAt.toISOString(),
                taskText.toLowerCase(),
              ].join("::")
            );
            const { data, error } = await client
              .from("tasks")
              .upsert(
                {
                  owner_id: principal.userId,
                  workspace_id: principal.workspaceId,
                  visibility: "private",
                  company_id: null,
                  workstream_id: null,
                  text: taskText,
                  kind: "manual",
                  link_kind: input.action === "task" ? "client" : input.action,
                  source: "chatgpt_mcp_follow_up",
                  source_ref: `chatgpt_mcp:${lead.id}:${fingerprint.slice(0, 16)}`,
                  payload,
                  due_at: dueAt.toISOString(),
                  fingerprint,
                  status: "open",
                },
                { onConflict: "owner_id,fingerprint", ignoreDuplicates: true }
              )
              .select("id,text,status,due_at,payload,created_at")
              .maybeSingle();
            if (error) throw error;
            if (data) {
              task = data as JsonObject;
              created = true;
            } else {
              const { data: duplicate, error: duplicateError } = await client
                .from("tasks")
                .select("id,text,status,due_at,payload,created_at")
                .eq("workspace_id", principal.workspaceId)
                .eq("owner_id", principal.userId)
                .eq("fingerprint", fingerprint)
                .single();
              if (duplicateError) throw duplicateError;
              task = duplicate as JsonObject;
            }
          }

          const { error: nextActionError } = await client
            .from("outreach_prospects")
            .update({ next_action_at: dueAt.toISOString(), updated_at: new Date().toISOString() })
            .eq("workspace_id", principal.workspaceId)
            .eq("id", String(lead.id))
            .or(leadAccessFilter(principal.userId));

          const rescheduled = !created;
          return {
            text: `${rescheduled ? "The open follow-up was rescheduled" : "The follow-up was added"} for ${dueAt.toISOString()}. It is assigned only to you. No message was sent${nextActionError ? ". The task is saved, but the lead's next-action field could not be refreshed" : ""}.`,
            data: {
              created,
              rescheduled,
              task: {
                id: task.id,
                text: task.text,
                status: task.status,
                dueAt: task.due_at,
              },
              leadId: lead.id,
              prospectNextActionUpdated: !nextActionError,
            },
            outcome: created ? "created" : "updated",
            targetTable: "tasks",
            targetId: String(task.id),
          };
        }
      )
  );

  server.registerTool(
    "list_my_tasks",
    {
      title: "List my LiveCoach tasks",
      description:
        "List the signed-in staff member's own LiveCoach tasks. Results are paginated and never include another user's tasks.",
      inputSchema: z
        .object({
          status: z.enum(["open", "done", "dismissed"]).default("open"),
          cursor: cursorField,
        })
        .strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ status, cursor }, ctx) =>
      auditedTool(
        principal,
        "list_my_tasks",
        { status, cursor: cursor || null },
        ctx,
        async ({ client }) => {
          const page = decodeCursor(cursor);
          let query = client
            .from("tasks")
            .select("id,text,kind,link_kind,status,due_at,source,payload,created_at")
            .eq("workspace_id", principal.workspaceId)
            .eq("owner_id", principal.userId)
            .eq("status", status)
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .limit(PAGE_SIZE + 1);
          if (page) {
            query = query.or(
              `created_at.lt.${page.createdAt},and(created_at.eq.${page.createdAt},id.lt.${page.id})`
            );
          }
          const { data, error } = await query;
          if (error) throw error;
          const rows = (data || []) as JsonObject[];
          const hasMore = rows.length > PAGE_SIZE;
          const visible = rows.slice(0, PAGE_SIZE);
          const last = visible[visible.length - 1];
          return {
            text: visible.length
              ? `Found ${visible.length} ${status} task${visible.length === 1 ? "" : "s"} in your LiveCoach account${hasMore ? ". More results are available" : ""}.`
              : `You have no ${status} LiveCoach tasks.`,
            data: {
              tasks: visible.map((task) => ({
                id: task.id,
                text: task.text,
                kind: task.kind,
                linkKind: task.link_kind,
                status: task.status,
                dueAt: task.due_at || null,
                source: task.source || null,
                createdAt: task.created_at,
              })),
              nextCursor: hasMore
                ? encodeCursor(last?.created_at, last?.id)
                : null,
              hasMore,
            },
            outcome: "read",
          };
        }
      )
  );

  return server;
}
