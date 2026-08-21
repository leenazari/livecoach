import "server-only";

import {
  getAccessToken,
  googleConnected,
  listAllEventsSnapshot,
} from "@/lib/google";
import {
  listAllMicrosoftEventsSnapshot,
  microsoftConnected,
} from "@/lib/microsoft";

export type CalendarProvider = "google" | "microsoft";

export type CalendarSnapshot = {
  provider: CalendarProvider;
  source: CalendarProvider;
  email: string | null;
  events: any[];
  complete: boolean;
  failedCalendars: string[];
};

export async function connectedCalendarProvider(ownerId?: string): Promise<{
  provider: CalendarProvider | null;
  email: string | null;
}> {
  const [google, microsoft] = await Promise.all([
    googleConnected(ownerId),
    microsoftConnected(ownerId),
  ]);
  if (google.connected) return { provider: "google", email: google.email };
  if (microsoft.connected) return { provider: "microsoft", email: microsoft.email };
  return { provider: null, email: null };
}

export async function listConnectedCalendarSnapshot(
  timeMinIso: string,
  timeMaxIso: string,
  ownerId?: string
): Promise<CalendarSnapshot | null> {
  const connection = await connectedCalendarProvider(ownerId);
  if (connection.provider === "google") {
    const access = await getAccessToken(false, ownerId);
    if (!access) return null;
    const snapshot = await listAllEventsSnapshot(access, timeMinIso, timeMaxIso);
    return {
      provider: "google",
      source: "google",
      email: connection.email,
      ...snapshot,
      failedCalendars: [],
    };
  }
  if (connection.provider === "microsoft") {
    const snapshot = await listAllMicrosoftEventsSnapshot(
      timeMinIso,
      timeMaxIso,
      ownerId
    );
    return {
      provider: "microsoft",
      source: "microsoft",
      email: connection.email,
      ...snapshot,
    };
  }
  return null;
}
