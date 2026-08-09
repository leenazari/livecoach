import "server-only";

import { supabaseAdmin } from "@/lib/supabase";
import {
  companyAliases,
  isDistinctivePartialCompanyMatch,
  normaliseCompanyDomain,
  normaliseCompanyName,
} from "@/lib/company-identity";

type CompanyIdentity = {
  id: string;
  name: string;
  domain?: string | null;
  website?: string | null;
  profile?: Record<string, unknown> | null;
  [key: string]: any;
};

export async function resolveExistingCompany(
  input: { name?: string | null; domain?: string | null },
  options: { select?: string; allowDistinctivePartial?: boolean } = {}
): Promise<CompanyIdentity | null> {
  const name = normaliseCompanyName(input.name);
  const domain = normaliseCompanyDomain(input.domain);
  if (!name && !domain) return null;

  const select = options.select || "id,name,domain,website,profile";
  const { data, error } = await supabaseAdmin
    .from("companies")
    .select(select)
    .limit(1000);
  if (error) throw error;
  // The generated Supabase type cannot infer a row shape from a caller-
  // supplied select string, but every allowed caller includes id and name.
  const rows = (data || []) as unknown as CompanyIdentity[];

  const unique = (matches: CompanyIdentity[]) => {
    const byId = new Map(matches.map((company) => [company.id, company]));
    return byId.size === 1 ? [...byId.values()][0] : null;
  };

  if (domain) {
    const exactDomain = rows.filter((company) =>
      [company.domain, company.website]
        .map(normaliseCompanyDomain)
        .filter(Boolean)
        .includes(domain)
    );
    const match = unique(exactDomain);
    if (match) return match;
  }

  if (name) {
    const exactName = unique(
      rows.filter((company) => normaliseCompanyName(company.name) === name)
    );
    if (exactName) return exactName;

    const exactAlias = unique(
      rows.filter((company) =>
        companyAliases(company.profile).some(
          (alias) => normaliseCompanyName(alias) === name
        )
      )
    );
    if (exactAlias) return exactAlias;

    if (options.allowDistinctivePartial) {
      const partial = unique(
        rows.filter(
          (company) =>
            isDistinctivePartialCompanyMatch(name, company.name) ||
            companyAliases(company.profile).some((alias) =>
              isDistinctivePartialCompanyMatch(name, alias)
            )
        )
      );
      if (partial) return partial;
    }
  }

  return null;
}
