// Common spoken words plus the run-together phrases from real calls.
// A jammed token is split only when every piece is in this set.
export const SPEECH_WORDS = new Set(`
a adam i
about able accurately additional after again agent all along also always among an analysis and another answer any appointments approach are as ask at available away
base be before big book booking brand brochure business busy but by
call calls campaigns can capture centralised centralized challenging come consider consumers could create customers currently
dashboard demo direct directly do does doing driving
each effectively engage engages enough enquiry enquiries especially even every extra
fantastic features few first follow for four from frustrating
gaining get getting glad go good got great
have having help her here him his how
happens hello identify if immediate immediately important in information inquiries inquiry inside instantly integrated into is it its
just
keeping know knows knowledge
lead leads leave leaves let like live little
many matches may me means might month more most my
need no nobody not now someone
of offer offerings often on one or other our out own
people potential prioritise prioritize products providing
queries question questions quickly
quite
really receive recent relevant relying respond responses right
sales salesperson say see sentiment seven show so solid someone sounds specific still success sustainable
take task team ten thanks than that the their them then there these they this those three through to today too track tracked traction traffic train trained trends twenty two typically
understand up uploading
via very visit visitors visits
want website what whatsapp when where which who why will win with without would
you your
conscientious consumers ensuring happens
`.split(/\s+/).filter((word) => word.length > 0));
