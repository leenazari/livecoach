import type { SupabaseClient } from "@supabase/supabase-js";

type Options = {
  table: string;
  columns: string;
  idColumn: string;
  ids: string[];
  workspaceId: string;
  orderBy: string;
  limit: number;
  filter?: (query: any) => any;
};

// The IDs must already be authorised for the caller. Keep their RLS client,
// workspace filter and any extra account filters on EVERY bounded request.
export async function loadScopedIdRows(client: SupabaseClient, options: Options): Promise<any[]> {
  if (!options.workspaceId || !Number.isInteger(options.limit) || options.limit < 1 || options.limit > 5000)
    throw new Error("Invalid scoped row request");
  const ids = [...new Set(options.ids.filter(Boolean))];
  const batches = Array.from({ length: Math.ceil(ids.length / 100) }, (_, i) => ids.slice(i * 100, i * 100 + 100));
  let rows: any[] = [];
  const newestFirst = (a: any, b: any) =>
    String(b[options.orderBy] || "").localeCompare(String(a[options.orderBy] || "")) ||
    String(b.id).localeCompare(String(a.id));
  // Bound concurrency and paginate past PostgREST's default 1000-row ceiling.
  for (let start = 0; start < batches.length; start += 4) {
    const results = await Promise.all(batches.slice(start, start + 4).map(async (batch) => {
      const batchRows: any[] = [];
      for (let offset = 0; offset < options.limit; offset += 1000) {
        let query = client.from(options.table).select(options.columns)
          .eq("workspace_id", options.workspaceId).in(options.idColumn, batch)
          .order(options.orderBy, { ascending: false, nullsFirst: false });
        if (options.orderBy !== "id") query = query.order("id", { ascending: false });
        if (options.filter) query = options.filter(query);
        const pageSize = Math.min(1000, options.limit - offset);
        const { data, error } = await query.range(offset, offset + pageSize - 1);
        if (error) throw error; // Never turn a failed batch into an empty history.
        batchRows.push(...(data || []));
        if ((data || []).length < pageSize) break;
      }
      return batchRows;
    }));
    rows = rows.concat(...results).sort(newestFirst).slice(0, options.limit);
  }
  return rows;
}
