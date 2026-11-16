import { interviewerOwnerError, requireInterviewerOwner } from "@/lib/interviewer/access";
import { interviewerFieldError } from "@/lib/interviewer/field-error";
import { extractTextFromPDF } from "@/lib/pdf-extract";
import { parseCsvPriceSheet, parseXlsxPriceSheet, plansFromSheetText, plansFromVision, type SheetParse } from "@/lib/interviewer/price-sheet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 8_000_000;

export async function POST(req: Request) {
  try {
    await requireInterviewerOwner();
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return interviewerFieldError("interviewer_price_sheet_blocked", "Price sheet was not read", { file: "Choose a CSV, Excel, PDF, or image file." });
    }
    if (file.size > MAX_BYTES) {
      return interviewerFieldError("interviewer_price_sheet_blocked", "Price sheet was not read", { file: "That file is over 8 MB. Export a smaller sheet and try again." });
    }
    const name = file.name.toLowerCase();
    const type = file.type.toLowerCase();
    const bytes = new Uint8Array(await file.arrayBuffer());
    let parsed: SheetParse;
    if (name.endsWith(".csv") || type.includes("csv") || type === "text/plain") {
      parsed = parseCsvPriceSheet(new TextDecoder().decode(bytes));
    } else if (name.endsWith(".xlsx")) {
      parsed = await parseXlsxPriceSheet(bytes);
    } else if (name.endsWith(".pdf") || type.includes("pdf")) {
      const text = await extractTextFromPDF(bytes);
      parsed = plansFromSheetText(text);
      if (!parsed.plans.length && text.trim().length < 40) {
        return interviewerFieldError("interviewer_price_sheet_blocked", "Price sheet was not read", {
          file: "That PDF has no selectable text. Upload a photo of the page, or a CSV.",
        });
      }
    } else if (type.startsWith("image/") || /\.(png|jpe?g|webp)$/.test(name)) {
      parsed = await plansFromImage(bytes, type || "image/png");
    } else {
      return interviewerFieldError("interviewer_price_sheet_blocked", "Price sheet was not read", { file: "Use a CSV, Excel, PDF, PNG, JPG, or WebP file." });
    }
    return Response.json({ ...parsed, saved: false }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "not_configured") {
      return interviewerFieldError("interviewer_price_sheet_blocked", "Price sheet was not read", {
        file: "This image needs the writing service, which is not configured. Upload a CSV, an Excel file, or a PDF with selectable text.",
      });
    }
    return interviewerOwnerError(error);
  }
}

async function plansFromImage(bytes: Uint8Array, mime: string): Promise<SheetParse> {
  const key = (process.env.OPENAI_API_KEY || "").trim();
  if (!key) throw new Error("not_configured");
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "price_sheet",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              rows: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    name: { type: "string" },
                    price: { type: "string" },
                    period: { type: "string" },
                    includes: { type: "string" },
                    overage: { type: "string" },
                    details: { type: "string" },
                  },
                  required: ["name", "price", "period", "includes", "overage", "details"],
                },
              },
              trial: { type: "string" },
              discount: { type: "string" },
            },
            required: ["rows", "trial", "discount"],
          },
        },
      },
      messages: [{
        role: "user",
        content: [
          {
            type: "text",
            text: "Read every price row in this sheet. Keep monthly and yearly prices as separate rows. Keep the currency symbol. Put extra columns in details as key: value. Do not include internal cost, margin, or a supplier name. If a price is missing, leave it blank. Return only the schema.",
          },
          { type: "image_url", image_url: { url: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}` } },
        ],
      }],
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw new Error("draft_failed");
  const payload = await response.json();
  const parsed = JSON.parse(payload?.choices?.[0]?.message?.content || "{}") as { rows?: Array<Record<string, string>>; trial?: string; discount?: string };
  return plansFromVision(parsed);
}
