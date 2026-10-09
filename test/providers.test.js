import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket, { WebSocketServer } from 'ws';
import { Engine, choosePrize, InputError } from '../src/engine.js';
import { Connections } from '../src/connections.js';
import { ChzzkConnector, parseChzzkDonation, chzzkSocketUrl } from '../src/chzzk.js';
import { SoopConnector, soopStreamerId, parseSoopDonation } from '../src/soop.js';
import { ToonationConnector, parseToonationDonation, validateToonationWidget, toonationPayload } from '../src/toonation.js';
import { createApp } from '../src/server.js';
import { ChzzkPublicConnector, parsePublicChzzkFrame } from '../src/chzzk-public.js';
import { SoopChatCore } from '../node_modules/soop-chat/dist/client.js';

const channelId = 'a'.repeat(32);
function fixture(t, fetchImpl) {
  const dir = mkdtempSync(join(tmpdir(), 'meso-providers-'));
  const engine = new Engine(join(dir, 'state.json'), { pick: prizes => choosePrize(prizes, 999) });
  const connections = new Connections(dir, {}, { fetchImpl });
  const config = engine.snapshot().config; for (const r of config.roulettes) { r.durationMs = 100; r.resultHoldMs = 0; } engine.updateConfig(config);
  t.after(() => { engine.close(); rmSync(dir, { recursive: true, force: true }); });
  return { dir, engine, connections };
}
async function until(predicate) { for (let i = 0; i < 100; i++) { if (predicate()) return; await delay(10); } throw new Error('Receiver readiness timeout'); }
async function socketServer(t) {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' }); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { for (const socket of server.clients) socket.terminate(); server.close(); });
  return { server, url: `ws://127.0.0.1:${server.address().port}` };
}
const response = data => ({ ok: true, json: async () => data });
test('CHZZK official donation parser accepts chat/video, rejects wrong channel and malformed amount', () => {
  for (const donationType of ['CHAT', 'VIDEO']) assert.deepEqual(parseChzzkDonation({ donationType, channelId, donatorNickname: '후원자', payAmount: '1000' }, 'event', channelId), { eventId: 'event', nickname: '후원자', amount: 1000, unit: 'KRW' });
  assert.equal(parseChzzkDonation({ donationType: 'SUBSCRIPTION' }, 'event'), null);
  assert.throws(() => parseChzzkDonation({ donationType: 'CHAT', channelId: 'other', payAmount: '1000' }, 'e', channelId), InputError);
  assert.throws(() => parseChzzkDonation({ donationType: 'CHAT', channelId, payAmount: '1.1' }, 'e', channelId), InputError);
  const url = new URL(chzzkSocketUrl('https://ssio08.nchat.naver.com:443?auth=fixture-token'));
  assert.equal(url.protocol, 'wss:'); assert.equal(url.pathname, '/socket.io/'); assert.equal(url.searchParams.get('EIO'), '3');
  assert.throws(() => chzzkSocketUrl('https://127.0.0.1?auth=secret'));
});
test('CHZZK OAuth uses documented body, rotates tokens persistently and separates provider state', async t => {
  let body;
  const { connections, dir } = fixture(t, async (url, options) => { assert.equal(url, 'https://openapi.chzzk.naver.com/auth/v1/token'); body = JSON.parse(options.body); return response({ accessToken: 'access-one', refreshToken: 'refresh-one', expiresIn: '86400' }); });
  connections.setChzzkApp({ clientId: 'fixture-client-id', clientSecret: 'fixture-client-secret' });
  const auth = new URL(connections.authorizeChzzk());
  assert.equal(auth.hostname, 'chzzk.naver.com'); assert.equal(auth.searchParams.get('redirectUri'), 'http://127.0.0.1:3000/oauth/chzzk/callback');
  const state = auth.searchParams.get('state'); await connections.callbackChzzk(new URLSearchParams({ state, code: 'fixture-code' }));
  assert.deepEqual(body, { grantType: 'authorization_code', clientId: 'fixture-client-id', clientSecret: 'fixture-client-secret', code: 'fixture-code', state });
  assert.equal(connections.chzzkMetadata().authConfigured, true); assert.equal(JSON.stringify(connections.chzzkMetadata()).includes('access-one'), false);
  assert.equal(new Connections(dir, {}).chzzkCredentials().refreshToken, 'refresh-one');
  await assert.rejects(connections.callbackChzzk(new URLSearchParams({ state, code: 'fixture-code' })), InputError);
  const crossState = new URL(connections.authorizeChzzk()).searchParams.get('state'); await assert.rejects(connections.callback(new URLSearchParams({ state: crossState, code: 'fixture-code' })), InputError);
});
test('CHZZK real Engine.IO frames subscribe then deliver two identical payments separately', async t => {
  const { server, url } = await socketServer(t); const { engine, connections } = fixture(t);
  connections.setChzzkApp({ clientId: 'fixture-client-id', clientSecret: 'fixture-secret' }); connections.setChzzkTokens({ accessToken: 'access', refreshToken: 'refresh', expiresIn: 86400 });
  let peer, subscribed = false; const calls = [];
  server.on('connection', socket => { peer = socket; socket.send('0' + JSON.stringify({ sid: 'fixture-sid', pingInterval: 1000, pingTimeout: 1000 })); socket.on('message', raw => { if (raw.toString() === '40') { socket.send('40'); socket.send('42' + JSON.stringify(['SYSTEM', JSON.stringify({ type: 'connected', data: { sessionKey: 'fixture-session' } })])); } if (raw.toString() === '2') socket.send('3'); }); });
  const connector = new ChzzkConnector(engine, connections, { socketFactory: actual => { assert.match(actual, /EIO=3/); return new WebSocket(url); }, fetchImpl: async (raw, options) => {
    calls.push(raw); assert.equal(options.headers.Authorization, 'Bearer access');
    if (raw.endsWith('/users/me')) return response({ content: { channelId } });
    if (raw.endsWith('/sessions/auth')) return response({ content: { url: 'https://ssio08.nchat.naver.com?auth=fixture' } });
    assert.equal(raw, 'https://openapi.chzzk.naver.com/open/v1/sessions/events/subscribe/donation?sessionKey=fixture-session'); assert.equal(options.method, 'POST'); subscribed = true; return response({ code: 200 });
  } }); t.after(() => connector.stop()); connector.start();
  await until(() => subscribed && connector.status.state === 'listening'); assert.equal(engine.data.donations.length, 0);
  for (let i = 0; i < 2; i++) peer.send('42' + JSON.stringify(['DONATION', { channelId, donationType: 'CHAT', payAmount: '1000', donatorNickname: '같은 후원자' }]));
  await until(() => engine.data.donations.length === 2); assert.equal(connector.status.state, 'connected'); assert.equal(engine.data.queue.length, 1); assert.notEqual(engine.data.donations[0].eventId, engine.data.donations[1].eventId);
  await until(() => engine.data.history.length === 2); assert.equal(engine.data.balance, 50_000_000);
  peer.send('42' + JSON.stringify(['SYSTEM', { type: 'revoked', data: {} }])); await until(() => connector.status.state === 'auth_required'); assert.equal(connector.socket, null);
});
test('CHZZK refresh saves the one-time replacement refresh token', async t => {
  const { connections, engine, dir } = fixture(t); connections.setChzzkApp({ clientId: 'fixture-client', clientSecret: 'fixture-secret' }); connections.setChzzkTokens({ accessToken: 'old-access', refreshToken: 'old-refresh', expiresIn: 1 });
  const connector = new ChzzkConnector(engine, connections, { fetchImpl: async (url, options) => { const body = JSON.parse(options.body); assert.equal(body.grantType, 'refresh_token'); assert.equal(body.refreshToken, 'old-refresh'); return response({ accessToken: 'new-access', refreshToken: 'new-refresh', expiresIn: 86400 }); } }); connector.running = true; t.after(() => connector.stop());
  assert.equal(await connector.token(), 'new-access'); assert.equal(new Connections(dir, {}).chzzkCredentials().refreshToken, 'new-refresh');
});
test('SOOP uses real event schema, does not use fanOrder for dedup, skips VOD and chat', async t => {
  const { engine, connections } = fixture(t); connections.setSources({ soop: 'https://play.sooplive.com/streamer1/1234' }); connections.setSoopEnabled(true);
  let chat; class FakeChat extends EventEmitter { async connect() { this.emit('stateChange', { current: 'connected' }); } async disconnect() {} }
  const connector = new SoopConnector(engine, connections, { chatFactory: options => { assert.equal(options.streamerId, 'streamer1'); chat = new FakeChat(); return chat; } }); t.after(() => connector.stop()); connector.start(); await until(() => connector.status.state === 'listening');
  for (let i = 0; i < 2; i++) chat.emit('event', { type: 'sendBalloon', data: { streamerId: 'streamer1', senderNickname: '별풍선 후원자', count: 10, fanOrder: 1 } });
  assert.equal(engine.data.donations.length, 2); assert.equal(engine.data.active.donation.amountKrw, 1000);
  chat.emit('event', { type: 'videoBalloon', data: { streamerId: 'streamer1', senderNickname: '영상 후원자', balloonCount: 20 } }); assert.equal(engine.data.queue.at(-1).roulette.kind, 'defense');
  chat.emit('event', { type: 'vodBalloon', data: { count: 1000 } }); assert.equal(engine.data.donations.length, 3);
  const oldChat = chat; connector.stop(); oldChat.emit('event', { type: 'sendBalloon', data: { streamerId: 'streamer1', senderNickname: 'late', count: 10 } }); assert.equal(engine.data.donations.length, 3);
});
test('SOOP IDs accept legacy/current hosts; restricted broadcasts are explicit', async t => {
  assert.equal(soopStreamerId('https://play.sooplive.co.kr/streamer1/123'), 'streamer1'); assert.equal(soopStreamerId('https://play.sooplive.com/streamer1'), 'streamer1'); assert.throws(() => soopStreamerId('https://evil.com/streamer1'), InputError);
  const { engine, connections } = fixture(t); connections.setSources({ soop: 'https://play.sooplive.com/streamer1' }); connections.setSoopEnabled(true);
  class RestrictedChat extends EventEmitter { async connect() { this.emit('ended', { reason: 'restricted' }); throw new Error('restricted'); } async disconnect() {} }
  const connector = new SoopConnector(engine, connections, { chatFactory: () => new RestrictedChat() }); t.after(() => connector.stop()); connector.start(); await until(() => connector.status.state === 'auth_required'); assert.equal(connector.retryTimer, null);
});
test('Toonation requires private alertbox URL, parses payload safely and only monetary code 101', () => {
  assert.equal(validateToonationWidget('https://toon.at/widget/alertbox/' + 'a'.repeat(32)).includes('/alertbox/'), true);
  for (const url of ['https://toon.at/donate/abc', 'https://127.0.0.1/widget/alertbox/' + 'a'.repeat(32), 'https://toon.at/widget/alertbox/' + 'a'.repeat(32) + '?redirect=http://localhost']) assert.throws(() => validateToonationWidget(url), InputError);
  assert.equal(toonationPayload('<script>const config = {"payload":"fixturePayloadToken"}</script>'), 'fixturePayloadToken'); assert.throws(() => toonationPayload('<script>process.exit()</script>'));
  const parsed = parseToonationDonation({ code: 101, content: { uid: 'donor-id', name: '투네 후원자', amount: '1000' } }, 'delivery-1'); assert.equal(parsed.donation.eventId, 'delivery-1'); assert.equal(parsed.donation.amount, 1000);
  assert.equal(parseToonationDonation({ code: 107, content: { name: '후원자', amount: 1000 } }, 'event'), null);
  assert.throws(() => parseToonationDonation({ code: 101, content: { name: '후원자', amount: 'USD 10' } }, 'event'), InputError);
});
test('Toonation real WebSocket receives donations, ignores test alerts and clears secrets on disconnect', async t => {
  const { server, url } = await socketServer(t), { engine, connections, dir } = fixture(t); const widgetUrl = 'https://toon.at/widget/alertbox/' + 'a'.repeat(32); connections.setToonationWidget(widgetUrl);
  let peer; server.on('connection', socket => { peer = socket; });
  const connector = new ToonationConnector(engine, connections, { fetchImpl: async (actual, options) => { assert.equal(actual, widgetUrl); assert.equal(options.redirect, 'error'); return { ok: true, text: async () => '{"payload":"fixturePayloadToken"}' }; }, socketFactory: actual => { assert.equal(actual, 'wss://ws.toon.at/fixturePayloadToken'); return new WebSocket(url); } }); t.after(() => connector.stop()); connector.start(); await until(() => peer && connector.status.state === 'listening');
  peer.send(JSON.stringify({ code: 101, content: { name: '테스트', amount: 1000, is_test: true } })); await until(() => connector.status.ignored === 1); assert.equal(engine.data.donations.length, 0);
  for (let i = 0; i < 2; i++) peer.send(JSON.stringify({ code: 101, content: { name: '동일 후원자', amount: 1000, uid: 'same-user' } }));
  await until(() => engine.data.donations.length === 2); assert.equal(engine.data.active.donation.provider, 'toonation'); assert.equal(connector.status.state, 'connected');
  await until(() => engine.data.history.length === 2); assert.equal(engine.data.balance, 50_000_000);
  connector.stop(); assert.equal(connector.socket, null); connections.setToonationWidget(''); assert.equal(new Connections(dir, {}).data.toonation.widgetUrl, '');
});
test('new provider API requires admin; secrets never appear in connection metadata', async t => {
  const { dir } = fixture(t); const keys = { admin: 'fixture-admin', overlay: 'fixture-overlay', webhook: 'fixture-webhook' };
  const app = createApp({ dataDir: dir, keys, env: {} }); await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => { app.close(); app.server.closeAllConnections(); }); const base = `http://127.0.0.1:${app.server.address().port}`;
  const post = (path, data, authorized = true) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authorized ? { Authorization: `Bearer ${keys.admin}` } : {}) }, body: JSON.stringify(data) });
  for (const path of ['/api/chzzk/connection', '/api/chzzk/app', '/api/chzzk/authorize', '/api/soop/connection', '/api/toonation/widget']) assert.equal((await post(path, {}, false)).status, 401);
  assert.equal((await post('/api/chzzk/app', { clientId: 'fixture-client-id', clientSecret: 'private-secret' })).status, 200);
  const meta = await (await fetch(base + '/api/connection', { headers: { Authorization: `Bearer ${keys.admin}` } })).json(); assert.equal(meta.chzzk.appConfigured, true); assert.equal(JSON.stringify(meta).includes('private-secret'), false); assert.equal(meta.toonation.widgetUrl, undefined);
  assert.equal((await post('/api/soop/connection', { enabled: true })).status, 400); assert.equal((await post('/api/toonation/widget', { widgetUrl: 'https://toon.at/donate/abc' })).status, 400);
});

test('SOOP binary handshake and raw balloon frame travel through the pinned SDK into meso settlement', async t => {
  const { server, url } = await socketServer(t), { engine, connections } = fixture(t);
  connections.setSources({ soop: 'https://play.sooplive.com/streamer1/1234' }); connections.setSoopEnabled(true);
  const packet = (opcode, fields) => { const payload = Buffer.from('\f' + fields.join('\f') + '\f'); return Buffer.concat([Buffer.from(`\x1b\t${opcode}${String(payload.length).padStart(6, '0')}00`), payload]); };
  let peer;
  server.on('connection', socket => { peer = socket; socket.on('message', raw => { const opcode = raw.toString().slice(2, 6); if (opcode === '0001') socket.send(packet('0001', ['guest', '16'])); if (opcode === '0002') socket.send(packet('0002', ['456', 'streamer1', '', '5', '0', '', '16'])); }); });
  const connector = new SoopConnector(engine, connections, { chatFactory: options => new SoopChatCore({ ...options, resolveChannel: async () => ({ broadcastNo: '1234', chatNo: '456', chatDomain: 'chat.sooplive.com', chatPort: 8000 }), createWebSocket: () => new WebSocket(url), heartbeatIntervalMs: 1000 }) }); t.after(() => connector.stop()); connector.start();
  await until(() => connector.status.state === 'listening');
  peer.send(packet('0018', ['streamer1', 'donor1', '별풍선 후원자', '10', '1', '', '1', '0', '', 'ko', '0']));
  await until(() => engine.data.history.length === 1); assert.equal(engine.data.balance, 40_000_000); assert.equal(engine.data.donations[0].nickname, '별풍선 후원자'); assert.equal(engine.data.donations[0].amountKrw, 1000);
});

test('CHZZK URL mode uses read-only anonymous handshake and pays live frames, not recent history', async t => {
  const { server, url } = await socketServer(t), { engine, connections } = fixture(t);
  connections.setSources({ chzzk: `https://chzzk.naver.com/live/${channelId}` }); connections.setChzzkPublicEnabled(true);
  let peer, handshake;
  server.on('connection', socket => { peer = socket; socket.on('message', raw => { const message = JSON.parse(raw.toString()); if (message.cmd === 100) { handshake = message; socket.send(JSON.stringify({ cmd: 10100, bdy: { sid: 'public-fixture-session' } })); } if (message.cmd === 0) socket.send(JSON.stringify({ cmd: 10000 })); }); });
  const connector = new ChzzkPublicConnector(engine, connections, { fetchImpl: async raw => raw.includes('live-status') ? response({ code: 200, content: { chatChannelId: 'fixture-chat', status: 'OPEN', adult: false } }) : response({ code: 200, content: { accessToken: 'public-read-token' } }), socketFactory: actual => { assert.match(actual, /^wss:\/\/kr-ss[1-9]\.chat\.naver\.com\/chat$/); return new WebSocket(url); } }); t.after(() => connector.stop()); connector.start();
  await until(() => connector.status.state === 'listening'); assert.equal(handshake.bdy.auth, 'READ'); assert.equal(handshake.bdy.uid, null);
  const message = { msgTypeCode: 10, profile: JSON.stringify({ nickname: '치지직 공개 후원자' }), extras: JSON.stringify({ donationType: 'CHAT', payAmount: 1000, isAnonymous: false }) };
  peer.send(JSON.stringify({ cmd: 15101, bdy: { messageList: [message] } })); await delay(20); assert.equal(engine.data.donations.length, 0);
  peer.send(JSON.stringify({ cmd: 93102, bdy: [message, message] })); await until(() => engine.data.history.length === 2); assert.equal(engine.data.balance, 50_000_000); assert.equal(engine.data.donations[0].nickname, '치지직 공개 후원자');
});
test('CHZZK URL mode blocks restricted broadcasts and ignores unpaid mission state changes', async t => {
  const { connections, engine } = fixture(t); connections.setSources({ chzzk: `https://chzzk.naver.com/live/${channelId}` }); connections.setChzzkPublicEnabled(true);
  const connector = new ChzzkPublicConnector(engine, connections, { fetchImpl: async () => response({ code: 200, content: { adult: true } }), socketFactory: () => { throw new Error('must not connect'); } }); t.after(() => connector.stop()); connector.start(); await until(() => connector.status.state === 'auth_required'); assert.equal(connector.socket, null);
  assert.equal(parsePublicChzzkFrame({ cmd: 93102, bdy: [{ msgTypeCode: 10, extras: { donationType: 'MISSION', payAmount: 1000, status: 'FAILED' } }] }, () => 'id').length, 0);
});
