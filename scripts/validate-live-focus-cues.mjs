import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { AsyncLocalStorage } from 'node:async_hooks';
import { JSDOM } from 'jsdom';
import ts from 'typescript';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { oneOffFocusPrompt, validateRequestedFocus } from '../lib/live-focus-cue.ts';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const compile = source => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const load = (source, mocks = {}) => {
  const module = { exports: {} };
  const require = createRequire(import.meta.url);
  new Function('require', 'module', 'exports', compile(source))(
    name => name in mocks ? mocks[name] : require(name), module, module.exports,
  );
  return module.exports;
};
const focuses = Object.freeze(['Understand their needs', 'Agree a pilot', 'Confirm budget']);
const selected = Object.freeze(focuses.slice(0, 2));
assert.equal(validateRequestedFocus(undefined, undefined), null);
assert.equal(validateRequestedFocus(null, undefined), null);
assert.equal(validateRequestedFocus(focuses[2], focuses), focuses[2], 'A covered focus can be revisited once');
for (const [focus, list] of [[42, focuses], ['', focuses], [' ', focuses], ['Another call', focuses], [focuses[0], null], [focuses[0], [42, focuses[0]]], ['x'.repeat(501), ['x'.repeat(501)]], [focuses[0], Array(51).fill(focuses[0])]]) {
  assert.throws(() => validateRequestedFocus(focus, list));
}
assert.equal(oneOffFocusPrompt(null), '');
assert.match(oneOffFocusPrompt(focuses[1]), /THIS response only/);
assert.match(oneOffFocusPrompt(focuses[1]), /not a new call angle/);

// Run the real page handler with its refs and setters, but no network or model cost.
const page = read('app/call/page.tsx');
const ast = ts.createSourceFile('page.tsx', page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler;
const visit = node => {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'requestLiveSuggestion') handler = node.initializer.arguments[0].getText(ast);
  ts.forEachChild(node, visit);
};
visit(ast);
assert.ok(handler);
assert.doesNotMatch(handler, /setSelectedComps|setSuggestedComps|setBrief|setPlan|persistSession|linkSession|savePrep/);
assert.match(page, /onRequest=\{\(focus\) => requestLiveSuggestion\(true, focus\)\}/);
assert.match(page, /cueAbortRef\.current\?\.abort\(\)/);
const ref = current => ({ current });
const makeHost = name => {
  const state = { suggestions: [], focusCue: null, busy: false, requestingFocus: null, requests: [], response: 'What would a useful pilot prove? ||WHY|| clarifies your next step', delay: null, fail: false };
  const context = {
    validateRequestedFocus, inFlightRef: ref(false), endRequestedRef: ref(false),
    suggestedCompsRef: ref(focuses), selectedCompsRef: ref(selected),
    linesRef: ref([{ role: 'candidate', speaker: 'Client', text: 'We need more reliable screening.' }, { role: 'interviewer', text: 'Could we discuss the next step?' }]),
    lineSpeakerLabel: l => l.role === 'interviewer' ? 'You' : l.role === 'teammate' ? `Team member ${l.speaker}` : l.speaker || 'Candidate',
    setFocusCue: v => { state.focusCue = v; }, setCueBusy: v => { state.busy = v; },
    setRequestingFocus: v => { state.requestingFocus = v; },
    setSuggestions: update => { state.suggestions = update(state.suggestions); },
    suggestIdRef: ref(0), cueGapTimerRef: ref(null), cueAbortRef: ref(null),
    aiCallsRef: ref(0), aiUsdRef: ref(0), lastCueAtRef: ref(0),
    knowledgeRef: ref(`Knowledge for ${name}`), candidateRef: ref('Client'), roleRef: ref('Founder'), callTypeRef: ref('sales'),
    recentTextsRef: ref([]), goalsRef: ref([{ text: 'Agree a useful next step' }]), privateNotesRef: ref([`Private ${name}`]),
    playbookRef: ref([{ label: 'Explore', detail: 'Listen first' }]), planBriefRef: ref(`Saved angle for ${name}`),
    lastShownRef: ref(''), timeNow: () => '10.00', usageCostUSD: () => 0,
    setTimeout: callback => { state.timeout = callback; return 1; },
    clearTimeout: () => { state.timeout = null; },
    isDuplicate: text => !text || text === context.lastShownRef.current,
    splitCue: text => { const [ask, why = ''] = text.split(' ||WHY|| '); return { ask, why, followup: '' }; },
    fetch: async (url, opts) => {
      state.requests.push({ url, body: JSON.parse(opts.body) });
      if (state.delay) await state.delay;
      if (opts.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (state.fail) throw new Error('network unavailable');
      return new Response(state.response);
    },
  };
  const run = new Function(...Object.keys(context), `${compile(`const run = ${handler};`)}\nreturn run;`)(...Object.values(context));
  return { state, context, run };
};
const lee = makeHost('Lee');
let release;
lee.state.delay = new Promise(resolve => { release = resolve; });
const first = lee.run(true, focuses[2]);
assert.equal(lee.state.busy, true);
assert.equal(lee.state.requestingFocus, focuses[2]);
assert.equal(lee.state.suggestions[0].pending, true);
await lee.run(true, focuses[1]);
assert.equal(lee.state.requests.length, 1, 'Rapid double taps must not issue two model requests');
release();
await first;
lee.state.delay = null;
assert.equal(lee.state.busy, false);
assert.equal(lee.state.requestingFocus, null);
assert.match(lee.state.focusCue.message, /direction is unchanged/);
assert.equal(lee.state.suggestions[0].requestedFocus, focuses[2]);
assert.equal(lee.state.suggestions[0].pending, false);
const targeted = lee.state.requests[0].body;
assert.equal(targeted.latestSpeaker, 'You');
assert.equal(targeted.latest, 'Could we discuss the next step?');
assert.deepEqual(targeted.competencies, selected, 'Covered focus is not reactivated');
assert.deepEqual(targeted.focusAreas, focuses);
assert.equal(targeted.allowHold, false);
lee.state.response = 'Where is screening slowing you down? ||WHY|| explores your needs';
await lee.run();
const automatic = lee.state.requests[1].body;
assert.equal('requestedFocus' in automatic, false, 'A tap must never leak into later automatic cues');
assert.equal('focusAreas' in automatic, false);
assert.equal(automatic.allowHold, true);
for (const field of ['competencies', 'goals', 'privateNotes', 'playbook', 'planBrief', 'callType']) assert.deepEqual(automatic[field], targeted[field]);
assert.equal(automatic.latestSpeaker, 'Client');
assert.equal(lee.context.suggestedCompsRef.current, focuses);
assert.equal(lee.context.selectedCompsRef.current, selected);

const kamm = makeHost('Kamm');
await kamm.run();
assert.equal('requestedFocus' in kamm.state.requests[0].body, false);
assert.equal(kamm.state.requests[0].body.planBrief, 'Saved angle for Kamm');
assert.deepEqual(kamm.state.requests[0].body.privateNotes, ['Private Kamm']);
assert.equal(kamm.state.focusCue, null, 'Another user has their own cue state');

lee.state.response = 'HOLD';
await lee.run(true, focuses[1]);
assert.equal(lee.state.focusCue.error, true);
assert.match(lee.state.focusCue.message, /try again/);
assert.equal(lee.state.suggestions.length, 2, 'HOLD does not leave an empty card');
lee.state.response = lee.context.lastShownRef.current;
await lee.run(true, focuses[1]);
assert.equal(lee.state.suggestions.length, 2, 'Duplicate output does not leave a card');
lee.state.fail = true;
await lee.run(true, focuses[1]);
assert.match(lee.state.focusCue.message, /Could not create/);
assert.equal(lee.state.suggestions.length, 2);
assert.equal(lee.state.busy, false, 'A failed request unlocks retries');
lee.state.fail = false;
lee.state.response = 'How would you measure a successful pilot? ||WHY|| clarifies success';
lee.context.linesRef.current = [];
await lee.run(true, focuses[1]);
assert.match(lee.state.requests.at(-1).body.latest, /No speech/);
assert.equal(lee.state.suggestions.length, 3, 'An explicit tap works from the plan before the transcript arrives');
const count = lee.state.requests.length;
await lee.run();
assert.equal(lee.state.requests.length, count, 'Automatic cues still wait for a participant answer');
await lee.run(true, 'Not in this call');
assert.equal(lee.state.requests.length, count);
assert.equal(lee.state.focusCue.error, true);
lee.state.delay = new Promise(resolve => { release = resolve; });
const timeout = lee.run(true, focuses[0]);
lee.state.timeout();
release();
await timeout;
assert.match(lee.state.focusCue.message, /took too long/);
assert.equal(lee.state.busy, false, 'A timed out request unlocks the controls');
assert.equal(lee.state.suggestions.length, 3);
lee.state.delay = new Promise(resolve => { release = resolve; });
const cancelled = lee.run(true, focuses[0]);
lee.context.cueAbortRef.current.abort();
release();
await cancelled;
assert.equal(lee.state.suggestions.length, 3, 'Ending or changing a call discards a late result');
assert.equal(lee.state.focusCue, null);
assert.equal(lee.state.busy, false);
lee.context.endRequestedRef.current = true;
await lee.run(true, focuses[0]);
assert.equal(lee.state.requests.length, count + 2, 'No new requests after the call ends');

// Exercise the real HTTP handler with per-request auth/profile stubs and a model double.
const scopes = new AsyncLocalStorage();
const modelCalls = [];
const api = load(read('app/api/interview/suggest/route.ts'), {
  '@/lib/request-scope': { getRequestScope: () => scopes.getStore() },
  '@/lib/live-focus-cue': { validateRequestedFocus, oneOffFocusPrompt },
  '@/lib/workspace': { getTasteBlock: async () => `Taste for ${scopes.getStore().userId}` },
  '@/lib/sales-profile': { getSalesProfileContextBlock: async () => `Profile for ${scopes.getStore().userId}` },
  '@/lib/openai': { isTransientOpenAIError: () => false, OPENAI_MODEL_PRO: 'test-model', openai: { messages: { stream: async args => {
    modelCalls.push(args);
    return { async *[Symbol.asyncIterator]() { yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'What would a pilot need to prove? ||WHY|| clarifies success' } }; }, finalMessage: async () => ({ usage: {} }) };
  } } } },
});
const request = body => new Request('https://livecoach.test/api/interview/suggest', { method: 'POST', body: JSON.stringify(body) });
const call = (scope, body) => scopes.run(scope, () => api.POST(request(body)));
assert.equal((await call(null, targeted)).status, 401);
for (const status of ['suspended', 'removed', 'onboarding']) assert.equal((await call({ userId: 'Lee', status }, targeted)).status, 403);
assert.equal(modelCalls.length, 0, 'Unauthorised requests cannot consume AI');
assert.equal((await call({ userId: 'Lee', status: 'active' }, { ...targeted, requestedFocus: 'Not in call' })).status, 400);
assert.equal(modelCalls.length, 0, 'Invalid focus is rejected before the model');
const [leeResponse, kammResponse] = await Promise.all([
  call({ userId: 'Lee', status: 'active' }, { ...targeted, allowHold: true }),
  call({ userId: 'Kamm', status: 'active' }, kamm.state.requests[0].body),
]);
assert.equal(leeResponse.status, 200);
assert.match(await leeResponse.text(), /What would a pilot/);
assert.equal(kammResponse.status, 200);
await kammResponse.text();
const leeModel = modelCalls.find(c => c.system.some(b => b.text === 'Profile for Lee'));
const kammModel = modelCalls.find(c => c.system.some(b => b.text === 'Profile for Kamm'));
assert.match(leeModel.messages[0].content, /ONE-OFF FOCUS CUE/);
assert.match(leeModel.messages[0].content, /Confirm budget/);
assert.doesNotMatch(JSON.stringify(leeModel.system), /HOLD RULE/);
assert.doesNotMatch(JSON.stringify(leeModel), /Profile for Kamm|Private Kamm/);
assert.doesNotMatch(kammModel.messages[0].content, /ONE-OFF FOCUS CUE|Confirm budget/);
assert.doesNotMatch(JSON.stringify(kammModel), /Profile for Lee|Private Lee/);
assert.match(JSON.stringify(kammModel.system), /HOLD RULE/);

// Real React controls, including covered focus, pending lock and recovery feedback.
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://focus-test.local' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
const Panel = load(read('components/LiveFocusPanel.tsx')).default;
const root = createRoot(document.getElementById('root'));
const taps = [];
const base = { focuses, activeFocuses: selected, currentFocus: focuses[0], coverage: { [focuses[0]]: 40, [focuses[2]]: 100 }, intentCoverage: 40, busy: false, onRequest: f => taps.push(f) };
const render = async props => act(async () => root.render(React.createElement(Panel, { ...base, ...props })));
const buttons = () => [...document.querySelectorAll('button')];
await render();
assert.equal(buttons().length, 3);
assert.ok(buttons().every(b => b.type === 'button' && b.getAttribute('aria-label').startsWith('Get a suggestion for')));
await act(async () => buttons()[2].click());
assert.deepEqual(taps, [focuses[2]]);
assert.match(buttons()[0].textContent, /Current focus/, 'Tapping does not move the main focus indicator');
await render({ busy: true, requestedFocus: focuses[2] });
assert.ok(buttons().every(b => b.disabled));
assert.equal(buttons()[2].getAttribute('aria-busy'), 'true');
await act(async () => buttons()[1].click());
assert.equal(taps.length, 1);
assert.match(document.querySelector('[role="status"]').textContent, /Creating/);
await render({ message: 'Could not create the focus question. Tap it to try again.', error: true });
assert.ok(buttons().every(b => !b.disabled));
assert.match(document.querySelector('[role="status"]').textContent, /try again/);
await render({ busy: true });
assert.match(document.querySelector('[role="status"]').textContent, /Finishing the current cue/);
await render({ focuses: [] });
assert.equal(buttons().length, 0);
assert.match(document.body.textContent, /Build the call focus first/);
await act(async () => root.unmount());
dom.window.close();
console.log('Live focus cue checks passed — real page handler, transient API prompt, auth, separate hosts, retry/deduplication, cancellation and accessible focus controls.');
