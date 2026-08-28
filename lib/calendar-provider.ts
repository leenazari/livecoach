import "server-only";

import {
  createGoogleCalendarEvent,
  getAccessToken,
  googleConnected,
  listAllEventsSnapshot,
  meetingUrlOf,
} from "@/lib/google";
import {
  createMicrosoftCalendarEvent,
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
  calendarListAccessible?: boolean | null;
};

export type CreateCalendarEventInput = {
  requestId: string;
  title: string;
  startIso: string;
  endIso: string;
  attendeeEmails: string[];
  meetingUrl: string | null;
};

export type CreatedCalendarEvent = {
  provider: CalendarProvider;
  externalId: string;
  providerEventId: string;
  scheduledAt: string;
  meetingUrl: string | null;
  attendees: Array<{
    email: string;
    displayName: string;
    self: boolean;
    responseStatus: string;
  }>;
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

export async function createConnectedCalendarEvent(
  input: CreateCalendarEventInput,
  ownerId?: string
): Promise<CreatedCalendarEvent> {
  const connection = await connectedCalendarProvider(ownerId);
  const attendeeFallback = input.attendeeEmails.map((email) => ({
    email,
    displayName: email,
    self: false,
    responseStatus: "needsAction",
  }));

  if (connection.provider === "google") {
    let accessToken = await getAccessToken(false, ownerId);
    if (!accessToken) throw new Error("Reconnect Google Calendar in Settings");
    let event: any;
    try {
      event = await createGoogleCalendarEvent(accessToken, input);
    } catch (error: any) {
      if (error?.status !== 401) throw error;
      accessToken = await getAccessToken(true, ownerId);
      if (!accessToken) throw new Error("Reconnect Google Calendar in Settings");
      event = await createGoogleCalendarEvent(accessToken, input);
    }
    if (!event?.id) throw new Error("Google did not confirm the calendar event");
    const attendees = Array.isArray(event.attendees)
      ? event.attendees.map((attendee: any) => ({
          email: String(attendee?.email || "").toLowerCase(),
          displayName: String(attendee?.displayName || attendee?.email || ""),
          self: !!attendee?.self,
          responseStatus: String(attendee?.responseStatus || "needsAction"),
        }))
      : attendeeFallback;
    return {
      provider: "google",
      externalId: String(event.id),
      providerEventId: String(event.id),
      scheduledAt: String(event?.start?.dateTime || input.startIso),
      meetingUrl: input.meetingUrl || meetingUrlOf(event),
      attendees,
    };
  }

  if (connection.provider === "microsoft") {
    const event = await createMicrosoftCalendarEvent(input, ownerId);
    if (!event?.id) throw new Error("Microsoft did not confirm the calendar event");
    const attendees = Array.isArray(event.attendees)
      ? event.attendees.map((attendee: any) => {
          const email = String(attendee?.emailAddress?.address || "").toLowerCase();
          return {
            email,
            displayName: String(attendee?.emailAddress?.name || email),
            self: false,
            responseStatus: String(attendee?.status?.response || "needsAction"),
          };
        })
      : attendeeFallback;
    return {
      provider: "microsoft",
      externalId: `microsoft:${String(event.id)}`,
      providerEventId: String(event.id),
      scheduledAt: input.startIso,
      meetingUrl: input.meetingUrl,
      attendees,
    };
  }

  throw new Error("Connect Google or Microsoft Calendar in Settings first");
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
