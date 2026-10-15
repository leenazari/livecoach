import { z } from 'zod';

export const INBOUND_SOURCES = ['facebook', 'google'] as const;
export const INBOUND_STATES = ['new', 'in_review', 'ready', 'rejected', 'assigned'] as const;
export const INBOUND_SCOPES = ['leads:create', 'leads:read', 'leads:update', 'events:write'] as const;
export const INBOUND_EVENTS = ['whatsapp.sent', 'whatsapp.delivered', 'whatsapp.replied', 'call.completed', 'call.no_answer', 'demo.booked', 'trial.registered', 'trial.tokens_granted', 'tutorial.completed', 'trial.activated', 'contact.opted_out', 'human.takeover'] as const;
const text = (max: number) => z.string().trim().max(max);
const timestamp = z.iso.datetime({ offset: true });
const permission = z.object({ granted: z.boolean(), capturedAt: timestamp, wording: text(1000).min(1), version: text(100).min(1) }).strict();
export const inboundCreate = z.object({
  source: z.enum(INBOUND_SOURCES), sourceLeadId: text(200).min(1),
  companyName: text(160).min(1), contactName: text(160).min(1),
  contactEmail: z.email().max(254).transform(v => v.toLowerCase()),
  contactPhone: z.string().regex(/^\+[1-9]\d{6,14}$/, 'Use an international phone number, for example +447700900123'),
  businessType: text(160).default(''), companySize: text(120).default(''), need: text(2000).default(''),
  sourceDetails: z.object({ formId: text(200).optional(), campaignId: text(200).optional(), adId: text(200).optional(), submittedAt: timestamp.optional() }).strict().default({}),
  consent: z.object({ whatsapp: permission.optional(), aiCall: permission.optional() }).strict().default({}),
}).strict();
export const qualificationSchema = z.object({
  businessProcess: text(2000).nullable().optional(), need: text(2000).nullable().optional(),
  monthlyVolume: text(300).nullable().optional(), currentSystems: text(1000).nullable().optional(),
  budget: text(300).nullable().optional(), timeline: text(300).nullable().optional(),
  buyingRole: text(300).nullable().optional(), recommendedProduct: text(300).nullable().optional(),
  recommendationReason: text(1000).nullable().optional(), callSummary: text(4000).nullable().optional(),
  preferredRoute: z.enum(['demo', 'self_service', 'human_review']).nullable().optional(),
}).strict();
export const inboundUpdate = z.object({ requestId: text(200).min(1), expectedVersion: z.number().int().positive(), qualification: qualificationSchema }).strict();
export const inboundEvent = z.object({ eventId: text(200).min(1), leadId: z.uuid(), type: z.enum(INBOUND_EVENTS), occurredAt: timestamp,
  details: z.object({ providerReference: text(300).optional(), summary: text(2000).optional(), bookingAt: timestamp.optional(), product: text(300).optional(), tokens: z.number().int().nonnegative().max(1000000).optional(), channel: z.enum(['whatsapp', 'aiCall', 'all']).optional() }).strict().default({}),
}).strict();
export const reviewerCommand = z.object({ action: z.enum(['review', 'assign']), expectedVersion: z.number().int().positive(),
  status: z.enum(['new', 'in_review', 'ready', 'rejected']).optional(), reviewNote: text(1600).optional(), assignedTo: z.uuid().optional(),
}).strict().superRefine((v, ctx) => {
  if (v.action === 'assign' && (!v.assignedTo || !v.reviewNote?.trim())) ctx.addIssue({ code: 'custom', message: 'Choose a salesperson and add a handover note' });
  if (v.action === 'review' && !v.status) ctx.addIssue({ code: 'custom', message: 'Choose a review status' });
});
export const inboundConfiguration = z.object({ enabled: z.boolean(), reviewerId: z.uuid().nullable(), salesIds: z.array(z.uuid()).max(20) }).strict().superRefine((v, ctx) => {
  if (v.enabled && !v.reviewerId) ctx.addIssue({ code: 'custom', message: 'Choose the reviewer before enabling intake' });
});
export const inboundKeyInput = z.object({ label: text(120).min(1), scopes: z.array(z.enum(INBOUND_SCOPES)).min(1).max(4), sources: z.array(z.enum(INBOUND_SOURCES)).min(1).max(2),
  eventTypes: z.array(z.enum(INBOUND_EVENTS)).max(INBOUND_EVENTS.length).default([]), expiresAt: timestamp,
}).strict();
export type InboundCreate = z.infer<typeof inboundCreate>;
export type InboundLead = {
  id: string; company_name: string; contact_name: string; contact_email: string; contact_phone: string;
  business_type: string; company_size: string; need: string; source: string; source_lead_id: string;
  source_details: Record<string, string>; consent: Record<string, { granted: boolean; capturedAt: string; wording: string; version: string }>;
  qualification: z.infer<typeof qualificationSchema>; status: typeof INBOUND_STATES[number]; version: number;
  review_note: string; duplicate_of: string | null; assigned_to_user_id: string | null; marketing_lead_id: string | null;
  created_at: string; updated_at: string; human_takeover: boolean; contact_stopped: boolean; journey_completed?: boolean;
};
export type InboundAccess = { canReview: boolean; canConfigure: boolean; enabled: boolean; schemaReady: boolean };
export type InboundMember = { userId: string; name: string };
export type InboundList = { leads: InboundLead[]; total: number; page: number; pageSize: number; counts: Record<string, number>; sales: InboundMember[] };
export function contactPermissions(lead: Pick<InboundLead, 'consent' | 'human_takeover' | 'contact_stopped' | 'status' | 'journey_completed' | 'duplicate_of'>) {
  const stopped = lead.contact_stopped || lead.human_takeover || lead.journey_completed || lead.duplicate_of || lead.status === 'assigned' || lead.status === 'rejected';
  return { whatsapp: !stopped && lead.consent.whatsapp?.granted === true, aiCall: !stopped && lead.consent.aiCall?.granted === true };
}
