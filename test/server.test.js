import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { createApp } from '../src/server.js';
const keys = { admin: 'admin-test', overlay: 'overlay-test', webhook: 'webhook-test' };
async function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'meso-http-'));
  const app = createApp({ dataDir: dir, keys, env: {} });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => { app.close(); app.server.closeAllConnections(); await new Promise(resolve => { if (!app.server.listening) resolve(); else app.server.once('close', resolve); }); rmSync(dir, { recursive: true, force: true }); });
  const request = (path, value, auth = true) => fetch(base + path, { headers: { ...(auth ? { Authorization: `Bearer ${keys.admin}` } : {}), 'Content-Type': 'application/json' }, method: value === undefined ? 'GET' : 'POST', ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  return { app, base, request };
}
test('HTTP auth separation: overlay token cannot edit admin settings or read connection keys', async t => {
  const { request } = await setup(t); assert.equal((await request('/api/state', undefined, false)).status, 401);
  assert.equal((await request(`/api/connection?token=${keys.overlay}`, undefined, false)).status, 401);
  const state = await (await request('/api/state')).json(); assert.equal(state.balance, 30000000);
  assert.equal((await request('/api/config', state.config, false)).status, 401);
  const providers = (await (await request('/api/connection')).json()).providers; assert.equal(providers[0].state, 'not_configured'); assert.equal(providers[2].state, 'not_configured');
});
test('signed webhook accepts normalized real donation, rejects forgery/replay timestamp, deduplicates', async t => {
  const { base, app } = await setup(t); const raw = JSON.stringify({ eventId: 'real-1', nickname: '별 시청자', unit: 'STAR', amount: 10 });
  const timestamp = String(Date.now()); const signature = createHmac('sha256', keys.webhook).update(timestamp + '.').update(raw).digest('hex');
  const post = (sig, ts = timestamp) => fetch(`${base}/webhooks/soop`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Webhook-Timestamp': ts, 'X-Webhook-Signature': sig }, body: raw });
  assert.equal((await post('fake')).status, 401); assert.equal((await post(signature, '1')).status, 401);
  const first = await (await post(signature)).json(); assert.equal(first.matched, true); assert.equal(first.duplicate, false);
  const second = await (await post(signature)).json(); assert.equal(second.duplicate, true);
  assert.equal(app.engine.data.active.donation.amountKrw, 1000); assert.equal(app.engine.data.active.donation.test, false);
});
test('SSE overlay receives actual spin and balance with no admin history', async t => {
  const { base, request } = await setup(t); const abort = new AbortController();
  const response = await fetch(`${base}/api/events?token=${keys.overlay}`, { signal: abort.signal }); assert.equal(response.status, 200);
  const reader = response.body.getReader(); let buffer = '';
  async function next() { while (!buffer.includes('\n\n')) { const chunk = await reader.read(); buffer += new TextDecoder().decode(chunk.value); } const edge = buffer.indexOf('\n\n'), block = buffer.slice(0, edge); buffer = buffer.slice(edge + 2); return JSON.parse(block.split('\n').find(line => line.startsWith('data: ')).slice(6)); }
  const initial = await next(); assert.equal(initial.balance, 30000000); assert.equal(initial.history, undefined);
  const result = await (await request('/api/test-donation', { provider: 'chzzk', nickname: '시청자', amount: 1000, unit: 'KRW' })).json(); assert.equal(result.matched, true);
  let spin = await next(); if (!spin.active) spin = await next(); assert.equal(spin.active.donation.nickname, '시청자'); assert.equal(spin.active.donation.test, true); assert.equal(spin.history, undefined); abort.abort();
});
test('static pages work, CSP allows same-origin preview, and filesystem traversal is blocked', async t => {
  const { request } = await setup(t); for (const path of ['/', '/overlay.html', '/meso.html', '/styles.css', '/dashboard.js', '/overlay.js']) { const response = await request(path, undefined, false); assert.equal(response.status, 200); assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'self'/); }
  assert.equal((await request('/data/keys.json', undefined, false)).status, 404); assert.equal((await request('/src/server.js', undefined, false)).status, 404);
});
test('API settings and custom exact amounts persist, malformed JSON/invalid rules fail', async t => {
  const { request, app } = await setup(t); const state = await (await request('/api/state')).json(); state.config.roulettes[0].triggerKrw = 3300;
  assert.equal((await request('/api/config', state.config)).status, 200);
  assert.equal((await (await request('/api/test-donation', { provider: 'chzzk', nickname: '손님', amount: 1000, unit: 'KRW' })).json()).matched, false);
  assert.equal((await (await request('/api/test-donation', { provider: 'soop', nickname: '손님', amount: 33, unit: 'STAR' })).json()).matched, true);
  assert.equal(app.engine.data.active.roulette.triggerKrw, 3300);
  state.config.roulettes[0].prizes[0].weight--; assert.equal((await request('/api/config', state.config)).status, 400);
});
test('source URLs are saved without claiming a live receiver is authenticated', async t => {
  const { request } = await setup(t); const sources = { chzzk: 'https://chzzk.naver.com/live/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', youtube: 'https://www.youtube.com/watch?v=abcdefghijk' };
  assert.equal((await request('/api/sources', sources)).status, 200); const info = await (await request('/api/connection')).json(); assert.equal(info.sources.youtube, sources.youtube); assert.equal(info.providers[0].configured, false);
  assert.equal((await request('/api/sources', { youtube: 'https://example.com/watch?v=abcdefghijk' })).status, 400);
});
