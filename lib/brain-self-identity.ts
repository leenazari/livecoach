import "server-only";

import { requireRequestScope } from "@/lib/request-scope";
import { supabaseAdmin, supabaseService } from "@/lib/supabase";
import type { BrainKnownIdentity } from "@/lib/brain-self-name";

const identityCache = new Map<
  string,
  { expiresAt: number; identities: BrainKnownIdentity[] }
>();
const IDENTITY_CACHE_MS = 60_000;

function nameFromEmail(email: unknown): string {
  const local = String(email || "").split("@")[0] || "";
  return local
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\s+/g, " ")
    .trim();
}

function identityFromProfile(
  profile: any,
  relationship: BrainKnownIdentity["relationship"]
): BrainKnownIdentity {
  const canonicalName =
    String(profile?.display_name || "").replace(/\s+/g, " ").trim() ||
    nameFromEmail(profile?.email);
  const aliases = Array.isArray(profile?.transcriber_aliases)
    ? profile.transcriber_aliases.map((value: unknown) => String(value || ""))
    : [];
  return { canonicalName, aliases, relationship };
}

export async function loadBrainIdentityDirectory(): Promise<
  BrainKnownIdentity[]
> {
  const scope = requireRequestScope();
  const cacheKey = `${scope.workspaceId}:${scope.userId}`;
  const cached = identityCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.identities;
  const { data: currentProfile, error } = await supabaseAdmin
    .from("profiles")
    .select("display_name,email,transcriber_aliases")
    .eq("user_id", scope.userId)
    .maybeSingle();
  if (error) throw error;
  const current = identityFromProfile(currentProfile, "signed_in_user");
  if (scope.role === "owner") {
    const identities = [current];
    identityCache.set(cacheKey, {
      expiresAt: Date.now() + IDENTITY_CACHE_MS,
      identities,
    });
    return identities;
  }

  // The workspace owner is a safe shared identity, not a shared record. This
  // exact, verified workspace lookup reveals only their display name and voice
  // aliases. It does not expose their email, calendar, calls or CRM rows.
  const { data: ownerMembership, error: ownerError } = await supabaseService
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", scope.workspaceId)
    .eq("role", "owner")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (ownerError) throw ownerError;
  if (!ownerMembership?.user_id || ownerMembership.user_id === scope.userId) {
    return [current];
  }
  const { data: ownerProfile, error: ownerProfileError } = await supabaseService
    .from("profiles")
    .select("display_name,transcriber_aliases")
    .eq("user_id", ownerMembership.user_id)
    .maybeSingle();
  if (ownerProfileError) throw ownerProfileError;
  const owner = identityFromProfile(ownerProfile, "workspace_owner");
  const identities = owner.canonicalName ? [current, owner] : [current];
  identityCache.set(cacheKey, {
    expiresAt: Date.now() + IDENTITY_CACHE_MS,
    identities,
  });
  return identities;
}

export async function exactVisibleContactNamesIn(
  message: string
): Promise<string[]> {
  const scope = requireRequestScope();
  const normalMessage = ` ${String(message || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
  let query = supabaseAdmin
    .from("contacts")
    .select("name")
    .eq("workspace_id", scope.workspaceId)
    .limit(500);
  if (scope.role !== "owner") query = query.eq("owner_id", scope.userId);
  const { data, error } = await query;
  if (error) throw error;
  return (data || [])
    .map((row: any) => String(row?.name || "").replace(/\s+/g, " ").trim())
    .filter((name) => {
      const normalName = name
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return normalName.length >= 3 && normalMessage.includes(` ${normalName} `);
    });
}
