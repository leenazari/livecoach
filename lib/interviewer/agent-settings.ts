import { buildInterviewerPrompt, interviewerGreeting, type InterviewerPromptInput } from "./prompt";
import { interviewerVoiceOrFallback, type InterviewerVoiceId } from "./voices";

export const DEEPGRAM_VOICE_AGENT_URL = "wss://agent.deepgram.com/v1/agent/converse";

// Client-side functions. The browser executes them by calling our own API,
// then returns FunctionCallResponse. Booking and disposition wait until the
// person's turn is confirmed so a barge-in cannot book or close by accident.
export const INTERVIEWER_FUNCTIONS = [
  {
    name: "suggest_meeting_times",
    description: "Check the owner's connected calendar and return real free meeting times. Call this only after they have shown clear interest or asked to meet, and only after they agree a meeting would be useful. Do not call it because a proof-of-value number was agreed, or because they asked to hear more.",
    parameters: {
      type: "object",
      properties: {
        duration_minutes: { type: "integer", description: "Meeting length. Use 30 unless they asked for another length." },
        time_of_day: { type: "string", enum: ["any", "morning", "afternoon"] },
        from_date: { type: "string", description: "Optional YYYY-MM-DD lower bound." },
        to_date: { type: "string", description: "Optional YYYY-MM-DD upper bound." },
      },
    },
  },
  {
    name: "book_meeting",
    description: "Reserve one start and end previously returned by suggest_meeting_times on the owner's connected calendar. Call this only after they have chosen one of those times.",
    defer_until_eot: true,
    parameters: {
      type: "object",
      properties: {
        start: { type: "string", description: "ISO start from suggest_meeting_times." },
        end: { type: "string", description: "ISO end from suggest_meeting_times." },
      },
      required: ["start", "end"],
    },
  },
  {
    name: "capture_timing",
    description: "Store the answer to when they are looking to move.",
    parameters: {
      type: "object",
      properties: {
        timing_target_date: { type: "string", description: "YYYY-MM-DD if a date is implied, otherwise omit." },
        timing_precision: { type: "string", enum: ["day", "week", "month", "quarter", "year", "unknown"] },
        timing_raw_quote: { type: "string", description: "Their words, shortened, without adding anything." },
      },
      required: ["timing_precision", "timing_raw_quote"],
    },
  },
  {
    name: "record_disposition",
    description: "Record the final disposition once, just before ending.",
    defer_until_eot: true,
    parameters: {
      type: "object",
      properties: {
        disposition: {
          type: "string",
          enum: ["Hot", "Warm", "Nurture", "Bounced", "Wrong number", "Competitor chosen", "Timing push", "Closed lost"],
        },
        reason_code: { type: "string" },
        timing_target_date: { type: "string" },
        timing_precision: { type: "string", enum: ["day", "week", "month", "quarter", "year", "unknown"] },
        timing_raw_quote: { type: "string" },
      },
      required: ["disposition"],
    },
  },
  {
    name: "show_slide",
    description: "Show the slide that best matches what the person is talking about. Jump to any number. Do not read the slide aloud.",
    parameters: {
      type: "object",
      properties: {
        slide_number: { type: "integer" },
        reason: { type: "string", description: "A short reason, not spoken as a label." },
      },
      required: ["slide_number"],
    },
  },
  {
    name: "end_call",
    description: "End the conversation after the disposition is recorded and you have said goodbye.",
    defer_until_eot: true,
    parameters: { type: "object", properties: {} },
  },
];

export function buildVoiceAgentSettings(input: InterviewerPromptInput & { voiceId: InterviewerVoiceId }) {
  return {
    type: "Settings",
    audio: {
      input: { encoding: "linear16", sample_rate: 16000 },
      output: { encoding: "linear16", sample_rate: 24000, container: "none" },
    },
    agent: {
      language: "en",
      greeting: interviewerGreeting(input),
      listen: {
        provider: {
          type: "deepgram",
          version: "v2",
          model: "flux-general-en",
          eot_threshold: 0.9,
          eot_timeout_ms: 4500,
        },
      },
      think: {
        provider: { type: "open_ai", model: "gpt-4o-mini", temperature: 0.3 },
        prompt: buildInterviewerPrompt(input),
        functions: INTERVIEWER_FUNCTIONS,
      },
      speak: { provider: { type: "deepgram", version: "v1", model: interviewerVoiceOrFallback(input.voiceId) } },
    },
  };
}
