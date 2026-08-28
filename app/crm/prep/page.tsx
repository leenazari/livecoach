import { redirect } from "next/navigation";

type SearchValue = string | string[] | undefined;

// Compatibility route for old emails, bookmarks and saved CRM actions.
// Call preparation now lives in the canonical /call workspace, so this route
// only preserves every query parameter and forwards the user there.
export default function LegacyPrepRedirect({
  searchParams,
}: {
  searchParams?: Record<string, SearchValue>;
}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams || {})) {
    if (Array.isArray(value)) {
      value.forEach((item) => query.append(key, item));
    } else if (typeof value === "string") {
      query.set(key, value);
    }
  }
  const suffix = query.toString();
  redirect(`/call${suffix ? `?${suffix}` : ""}`);
}
