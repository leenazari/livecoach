import assert from 'node:assert/strict';
import { marketingMetrics, marketingReportIsLimited, marketingSpend, marketingDate, marketingText, MARKETING_LESSONS, OWN_APPROACH } from '../lib/marketing.ts';
const campaigns = [{ id: 'recruitment', spend_gbp: 600 }, { id: 'education', spend_gbp: 420 }];
const leads = [
  { id: 'one', campaign_id: 'recruitment', assigned_to_user_id: 'cam' },
  { id: 'two', campaign_id: 'recruitment', assigned_to_user_id: 'cam' },
  { id: 'three', campaign_id: 'education', assigned_to_user_id: 'sharon' },
  { id: 'four', campaign_id: 'education', assigned_to_user_id: 'sharon' },
  { id: 'five', campaign_id: 'education', assigned_to_user_id: null },
];
const feedback = [{ lead_id: 'one', stage: 'paid' }, { lead_id: 'two', stage: 'demo' }, { lead_id: 'three', stage: 'rejected' }];
const result = marketingMetrics(campaigns, leads, feedback);
assert.deepEqual(result, { leads: 5, accepted: 2, rejected: 1, demos: 2, paid: 1, spend: 1020, costPerAccepted: 510, unassigned: 1, awaiting: 1 });
const recruitment = marketingMetrics([campaigns[0]], leads.filter(l => l.campaign_id === 'recruitment'), feedback);
assert.equal(recruitment.spend, 600);
assert.equal(recruitment.leads, 2);
assert.equal(recruitment.costPerAccepted, 300);
assert.equal(marketingMetrics([], [], []).costPerAccepted, null, 'No acceptance evidence must not become a zero cost claim');
assert.throws(() => marketingSpend(''));
assert.throws(() => marketingSpend(-1));
assert.throws(() => marketingSpend('Infinity'));
assert.equal(marketingSpend('0'), 0);
assert.equal(marketingSpend('35.75'), 35.75);
assert.throws(() => marketingDate('2026-02-30'));
assert.equal(marketingDate('2026-10-07'), '2026-10-07');
assert.throws(() => marketingText('', 100, true));
assert.throws(() => marketingText('too long', 3));
assert.equal(marketingText('  hello  ', 20), 'hello');
for (const lesson of Object.values(MARKETING_LESSONS)) {
  assert.equal(lesson.approaches.length, 2);
  for (const approach of [...lesson.approaches, OWN_APPROACH]) {
    assert.equal(approach.steps.length, 3);
    assert.ok(approach.steps.every(s => s.title && s.detail && s.simple && s.output));
  }
}
assert.equal(marketingReportIsLimited([{ count: 1100, data: Array(1000) }]), true, 'Database row caps must not hide incomplete reports');
assert.equal(marketingReportIsLimited([{ count: null, data: [] }]), true, 'Unknown totals are not a complete report');
assert.equal(marketingReportIsLimited([{ count: 1000, data: Array(1000) }]), false);
assert.equal(marketingReportIsLimited([{ count: 0, data: [] }]), false);
console.log('Marketing attribution, commercial metrics, input validation and repeatable coaching passed.');
