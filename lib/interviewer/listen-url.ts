// Interviewer listen socket. This does not use deepgramListenUrl() because that
// shared URL leaves channel count unset. A stereo mic then gets transcribed
// twice and every word is doubled. One channel, one socket, one recorder.
export function interviewerListenUrl(): string {
  const params = new URLSearchParams({
    model: "nova-3",
    smart_format: "true",
    punctuate: "true",
    interim_results: "true",
    endpointing: "1200",
    utterance_end_ms: "1500",
    language: "en",
    channels: "1",
  });
  return `wss://api.deepgram.com/v1/listen?${params.toString()}`;
}

export const INTERVIEWER_MIC_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
};
