import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import ts from 'typescript';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://chat-test.local' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
let contentHeight = 1600;
const viewportHeight = 360;
const positions = new WeakMap();
Object.defineProperties(dom.window.HTMLElement.prototype, {
  scrollHeight: { get() { return contentHeight; } },
  clientHeight: { get() { return viewportHeight; } },
  scrollTop: {
    get() { return positions.get(this) || 0; },
    set(value) { positions.set(this, Math.max(0, Math.min(value, contentHeight - viewportHeight))); },
  },
});
const observers = [];
globalThis.ResizeObserver = class {
  constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
  observe() {}
  disconnect() { this.disconnected = true; }
};
const source = readFileSync(new URL('../components/crm/ChatMessageViewport.tsx', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const module = { exports: {} };
new Function('require', 'module', 'exports', output)(createRequire(import.meta.url), module, module.exports);
const Viewport = module.exports.default;
const root = createRoot(document.getElementById('root'));
const render = async (id, { ready = true, mine = false, conversation = 'one' } = {}) => act(async () => root.render(React.createElement(Viewport, {
  key: conversation, ready, latestMessageId: id, latestMessageIsMine: mine,
}, React.createElement('p', null, ready ? `Message ${id}` : 'Loading messages'))));
const log = () => document.querySelector('[role="log"]');
const bottom = () => contentHeight - viewportHeight;
const scrollBack = async (top) => act(async () => { log().scrollTop = top; log().dispatchEvent(new dom.window.Event('scroll')); });

await render('', { ready: false });
assert.equal(log().scrollTop, 0);
await render('first');
assert.equal(log().scrollTop, bottom(), 'Opening a loaded conversation starts at its latest message');
await scrollBack(100);
await render('first');
assert.equal(log().scrollTop, 100, 'A poll with unchanged messages preserves reading position');
contentHeight = 2000;
await render('second');
assert.equal(log().scrollTop, 100, 'Incoming messages must not drag someone out of history');
assert.match(document.querySelector('button').textContent, /New messages.*Jump to latest/);
await act(async () => observers.at(-1).callback());
assert.equal(log().scrollTop, 100, 'Resizing older messages must preserve reading position');
await act(async () => document.querySelector('button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
assert.equal(log().scrollTop, bottom());
assert.equal(document.querySelector('button'), null);
contentHeight = 2300;
await render('third');
assert.equal(log().scrollTop, bottom(), 'Someone already at the latest message follows incoming messages');
contentHeight = 2500;
await act(async () => observers.at(-1).callback());
assert.equal(log().scrollTop, bottom(), 'Attachments and viewport resizes keep the latest message in view');
await scrollBack(150);
await render('own-message', { mine: true });
assert.equal(log().scrollTop, bottom(), 'Sending a message returns to the conversation end');
await render('', { ready: false, conversation: 'two' });
assert.equal(log().scrollTop, 0);
await render('different-chat', { conversation: 'two' });
assert.equal(log().scrollTop, bottom(), 'Switching conversations opens the new conversation at its end');
assert.equal(window.scrollY, 0, 'Message navigation must not move the document');
await act(async () => root.unmount());
assert.ok(observers.every((observer) => observer.disconnected));
dom.window.close();
console.log('Chat opening, polling, reader position, new-message jump, outgoing messages and resize behavior passed.');
