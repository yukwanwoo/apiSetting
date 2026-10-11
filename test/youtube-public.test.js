import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../src/engine.js';
import { Connections, youtubeVideoId, validateSources } from '../src/connections.js';
import { YouTubePublicConnector, extractChatPage, krwAmount } from '../src/youtube-public.js';
const video = '9CAhQOG6fxM', now = 1791700000000;
const config = { INNERTUBE_API_KEY: 'public-page-key-not-user-secret', INNERTUBE_CONTEXT_CLIENT_NAME: 1, INNERTUBE_CONTEXT: { client: { clientName: 'WEB', clientVersion: '2.20261011.01.00', visitorData: 'ephemeral-visitor' } } };
const paid = (id, amount = '₩1,000', stamp = now + 100, sticker = false) => ({ addChatItemAction: { item: { [sticker ? 'liveChatPaidStickerRenderer' : 'liveChatPaidMessageRenderer']: { id, authorName: { simpleText: '실제 스키마 후원자' }, purchaseAmountText: { simpleText: amount }, timestampUsec: String(stamp * 1000) } } } });
const chat = (token, actions = []) => ({ continuationContents: { liveChatContinuation: { actions, continuations: token ? [{ timedContinuationData: { continuation: token, timeoutMs: 1500 } }] : [] } } });
const page = initial => `<script>ytcfg.set(${JSON.stringify(config)}); var ytInitialData = ${JSON.stringify(initial)};</script>`;
function fixture(t, fetchImpl) {
 const dir = mkdtempSync(join(tmpdir(), 'meso-youtube-public-'));
 let clock = now;
 const engine = new Engine(join(dir, 'state.json'), { now: () => clock, pick: prizes => ({ ...prizes[1], index: 1 }) });
 const connections = new Connections(dir, {}); connections.setSources({ youtube: `https://www.youtube.com/live_chat?is_popout=1&v=${video}` }); connections.setYouTubePublicEnabled(true);
 const connector = new YouTubePublicConnector(engine, connections, { fetchImpl, now: () => now });
 t.after(() => { connector.stop(); engine.close(); rmSync(dir, { recursive: true, force: true }); });
 return { connector, engine, connections, dir, advance: ms => { clock += ms; engine.pump(); } };
}
test('popup URLs and strict KRW amounts accept won formats and reject replay/unrelated URLs and foreign amounts', () => {
 assert.equal(youtubeVideoId(`https://www.youtube.com/live_chat?is_popout=1&v=${video}`), video);
 for (const url of [`https://evil.example/live_chat?v=${video}`, `https://www.youtube.com/live_chat_replay?v=${video}`, `https://www.youtube.com/account?v=${video}`]) assert.equal(youtubeVideoId(url), '');
 assert.throws(() => validateSources({ youtube: `https://www.youtube.com/live_chat_replay?v=${video}` }));
 for (const amount of ['₩1,000', '￦ 1,000', 'KRW 1000', '1,000원', '1,000 KRW']) assert.equal(krwAmount(amount), 1000);
 for (const amount of ['$1,000', '¥1,000', '₩1.50', '₩1,00', '₩0', '₩100,000,001', '1천원', '<script>₩1000']) assert.equal(krwAmount(amount), null);
});
test('page extraction parses JSON with escaped braces without evaluating scripts', () => {
 const html = page({ sample: 'quote " and } brace', continuationContents: { liveChatContinuation: {} } }) + '<script>globalThis.remoteScriptRan = true;</script>';
 assert.equal(extractChatPage(html).initial.sample, 'quote " and } brace'); assert.equal(globalThis.remoteScriptRan, undefined);
 assert.equal(extractChatPage(html).config.INNERTUBE_CONTEXT.client.visitorData, 'ephemeral-visitor');
});
test('public polling settles paid messages and stickers, skips initial/history/ticker/replay/foreign, and persists dedup without public tokens', async t => {
 let posts = 0;
 const { connector, engine, connections, dir, advance } = fixture(t, async (raw, options) => {
  const url = new URL(raw); assert.equal(url.origin, 'https://www.youtube.com'); assert.equal(options.redirect, 'manual'); assert.equal(options.headers.Authorization, undefined); assert.equal(options.headers.Cookie, undefined);
  if (!options.method) { assert.equal(url.pathname, '/live_chat'); assert.equal(url.searchParams.get('v'), video); return new Response(page(chat('initial-token', [paid('initial', '₩1,000', now - 5000)]))); }
  posts++; assert.equal(url.pathname, '/youtubei/v1/live_chat/get_live_chat'); assert.equal(url.searchParams.get('key'), config.INNERTUBE_API_KEY);
  const body = JSON.parse(options.body); assert.equal(body.context.client.visitorData, 'ephemeral-visitor'); assert.equal(body.continuation, posts === 1 ? 'initial-token' : 'next-token');
  const events = [paid('old', '₩1,000', now - 10000), paid('new-chat'), paid('new-sticker', '₩1,100', now + 100, true), paid('foreign', '$10'), paid('bad', '₩1,00'), { replayChatItemAction: { actions: [paid('replay')] } }, { addLiveChatTickerItemAction: { item: { liveChatTickerPaidMessageItemRenderer: paid('ticker').addChatItemAction.item.liveChatPaidMessageRenderer } } }, { addChatItemAction: { item: { liveChatTextMessageRenderer: { message: { runs: [{ text: '₩1000 가짜 채팅' }] } } } } }];
  return new Response(JSON.stringify(chat('next-token', events)));
 });
 assert.equal(connector.configured(), true); await connector.poll(); assert.equal(engine.data.donations.length, 0);
 assert.equal(await connector.poll(), 1500); assert.equal(engine.data.donations.length, 2); assert.equal(connector.status.received, 2); assert.equal(connector.status.state, 'connected');
 assert.equal(engine.data.active.donation.amountKrw, 1000); assert.equal(engine.data.queue[0].donation.amountKrw, 1100);
 await connector.poll(); assert.equal(engine.data.donations.length, 2); assert.equal(connector.status.received, 2); assert.ok(connector.status.diagnostics.duplicates >= 2);
 assert.equal(connector.status.skippedCurrency, 1);
 assert.equal(JSON.stringify(connections.metadata()).includes('ephemeral'), false); assert.equal(readFileSync(join(dir, 'state.json'), 'utf8').includes('initial-token'), false);
 assert.equal(readFileSync(join(dir, 'connections.json'), 'utf8').includes('public-page-key'), false);
 advance(1000); assert.equal(engine.data.balance, 31_000_000);
 advance(2000); advance(1000); assert.equal(engine.data.balance, 30_000_000); engine.close();
 const restored = new Engine(join(dir, 'state.json')); t.after(() => restored.close());
 assert.equal(restored.receive('youtube', { eventId: 'public-new-chat', nickname: '중복', amount: 1000, unit: 'KRW' }).duplicate, true);
});
test('renderer bootstrap switches to unfiltered live chat and refreshes continuation page', async t => {
 const calls = [];
 const { connector } = fixture(t, async raw => {
  const url = new URL(raw); calls.push(url);
  if (url.searchParams.has('continuation')) { assert.equal(url.searchParams.get('continuation'), 'all-chat-token'); return new Response(page(chat('live-token'))); }
  return new Response(page({ contents: { liveChatRenderer: { continuations: [{ reloadContinuationData: { continuation: 'top-chat-token' } }], header: { viewSelector: { sortFilterSubMenuRenderer: { subMenuItems: [{}, { continuation: { reloadContinuationData: { continuation: 'all-chat-token' } } }] } } } } } }));
 });
 await connector.poll(); assert.equal(calls.length, 2); assert.equal(connector.session.continuation, 'live-token');
});
test('ended/restricted chats and malformed response never become donation-confirmed and errors hide remote data', async t => {
 const { connector } = fixture(t, async () => new Response('private page response', { status: 403 }));
 await assert.rejects(connector.poll(), error => error.state === 'auth_required' && !error.message.includes('private page'));
 connector.fetch = async () => new Response(page({ contents: { liveChatRenderer: { isReplay: true, continuations: [{ liveChatReplayContinuationData: { continuation: 'old' } }] } } }));
 await assert.rejects(connector.poll(), error => error.state === 'offline');
 connector.fetch = async () => new Response('<html>no chat</html>'); await assert.rejects(connector.poll(), /접속 정보를 찾지/);
 assert.equal(connector.status.received, 0);
});
test('stopping a pending connection cannot process late paid responses', async t => {
 let release;
 const { connector, engine } = fixture(t, async () => new Promise(resolve => { release = resolve; }));
 const pending = connector.poll(); connector.stop(); release(new Response(page(chat('late', [paid('late')]))));
 await assert.rejects(pending); assert.equal(engine.data.donations.length, 0); assert.equal(connector.session, null);
});

test('HTTP connection is admin-only, persists popup settings, and processes a mocked public donation through the actual connector', async t => {
 const { createApp } = await import('../src/server.js');
 const { connector, engine, connections, dir } = fixture(t, async () => new Response(page(chat('seed'))));
 connections.setYouTubePublicEnabled(false);
 const keys = { admin: 'youtube-admin', overlay: 'youtube-overlay', webhook: 'test-webhook' };
 const app = createApp({ dataDir: dir, keys, env: {}, engine, connectorOptions: { youtubePublic: { now: () => now, fetchImpl: async (url, options) => new Response(options.method ? JSON.stringify(chat('next', [paid('http-donation')])) : page(chat('seed'))) } } });
 await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
 t.after(() => { app.close(); app.server.closeAllConnections(); });
 const base = `http://127.0.0.1:${app.server.address().port}`;
 const post = auth => fetch(base + '/api/youtube/connection', { method: 'POST', headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }) });
 assert.equal((await post(keys.overlay)).status, 401); assert.equal((await post(keys.admin)).status, 200);
 for (let i = 0; i < 100 && !app.connectors.youtube.session; i++) await new Promise(resolve => setTimeout(resolve, 5));
 assert.ok(app.connectors.youtube instanceof YouTubePublicConnector);
 await app.connectors.youtube.poll();
 assert.equal(engine.data.donations.length, 1); assert.equal(engine.data.active.donation.amountKrw, 1000);
 const metadata = await (await fetch(base + '/api/connection', { headers: { Authorization: `Bearer ${keys.admin}` } })).json();
 assert.equal(metadata.youtube.mode, 'public'); assert.equal(metadata.youtube.publicEnabled, true);
 assert.equal(metadata.providers.find(p => p.provider === 'youtube').state, 'connected');
 for (const token of ['ephemeral-visitor', 'public-page-key-not-user-secret', 'seed', 'next-token']) assert.equal(JSON.stringify(metadata).includes(token), false);
 assert.equal(JSON.parse(readFileSync(join(dir, 'connections.json'))).youtube.enabled, true);
 connector.stop();
});
