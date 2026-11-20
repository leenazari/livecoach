import { adamSheetRange } from "./adam-outbound.ts";

export type AdamSheetReadResult =
  | { ok: true; values: string[][] }
  | { ok: false; code: "sheets_access" | "sheets_missing" | "sheets_failed" };

function sheetsUrl(spreadsheetId: string, path: string) {
  return `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}${path}`;
}

export async function readAdamSheet(input: {
  accessToken: string;
  spreadsheetId: string;
  tab: string;
  fetchImpl?: typeof fetch;
}): Promise<AdamSheetReadResult> {
  const fetchImpl = input.fetchImpl || fetch;
  const range = encodeURIComponent(adamSheetRange(input.tab, "A:W"));
  let response: Response;
  try {
    response = await fetchImpl(sheetsUrl(input.spreadsheetId, `/values/${range}`), {
      headers: { Authorization: `Bearer ${input.accessToken}` },
      cache: "no-store",
    });
  } catch {
    return { ok: false, code: "sheets_failed" };
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, code: "sheets_access" };
  }
  if (response.status === 404) return { ok: false, code: "sheets_missing" };
  if (!response.ok) return { ok: false, code: "sheets_failed" };
  const payload = await response.json().catch(() => null);
  const values = Array.isArray(payload?.values) ? payload.values : [];
  return {
    ok: true,
    values: values.map((row: unknown) =>
      Array.isArray(row) ? row.map((cell) => String(cell ?? "")) : []
    ),
  };
}

export async function writeAdamSheetCells(input: {
  accessToken: string;
  spreadsheetId: string;
  tab: string;
  rowNumber: number;
  status: string;
  note: string;
  fetchImpl?: typeof fetch;
}): Promise<AdamSheetReadResult> {
  const fetchImpl = input.fetchImpl || fetch;
  if (!Number.isInteger(input.rowNumber) || input.rowNumber < 1) {
    return { ok: false, code: "sheets_failed" };
  }
  let response: Response;
  try {
    response = await fetchImpl(
      sheetsUrl(input.spreadsheetId, "/values:batchUpdate"),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          valueInputOption: "RAW",
          data: [
            {
              range: adamSheetRange(input.tab, `K${input.rowNumber}`),
              values: [[input.status]],
            },
            {
              range: adamSheetRange(input.tab, `M${input.rowNumber}`),
              values: [[input.note]],
            },
          ],
        }),
      }
    );
  } catch {
    return { ok: false, code: "sheets_failed" };
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, code: "sheets_access" };
  }
  if (response.status === 404) return { ok: false, code: "sheets_missing" };
  if (!response.ok) return { ok: false, code: "sheets_failed" };
  return { ok: true, values: [] };
}
