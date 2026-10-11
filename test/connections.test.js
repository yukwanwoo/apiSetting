import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Connections, validateSources, youtubeVideoId } from '../src/connections.js';
import { YouTubeConnector } from '../src/youtube.js';
import { InputError } from '../src/engine.js';
function connections(t, fetchImpl) { const dir = mkdtempSync(join(tmpdir(), 'meso-oauth-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return new Connections(dir, {}, { fetchImpl }); }
const clientId = '12345-sample.apps.googleusercontent.com';
test('official source hosts and YouTube watch/live/short URL ID parsing', () => {
  assert.equal(youtubeVideoId('https://youtu.be/abcdefghijk'), 'abcdefghijk'); assert.equal(youtubeVideoId('https://youtube.com/live/abcdefghijk'), 'abcdefghijk');
  assert.throws(() => validateSources({ soop: 'https://play.sooplive.co.kr.evil.com/user' }), InputError);
  assert.throws(() => validateSources({ toonation: 'https://user:password@toon.at/donate/abc' }), InputError);
  assert.throws(() => validateSources({ youtube: 'https://youtube.com/@channel/live' }), InputError);
});
test('OAuth callback requires unexpired one-time state and keeps credentials out of metadata', async t => {
  let calls = 0; const c = connections(t, async () => { calls++; return { ok: true, json: async () => ({ refresh_token: 'private-refresh' }) }; });
  c.setApp({ clientId, clientSecret: 'private-client' });
  assert.equal(c.metadata().appConfigured, true); assert.equal(JSON.stringify(c.metadata()).includes('private-client'), false);
  await assert.rejects(c.callback(new URLSearchParams({ state: 'forged', code: 'anything' })), InputError); assert.equal(calls, 0);
  const url = new URL(c.authorize()); assert.equal(url.hostname, 'accounts.google.com'); assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/youtube.readonly');
  const params = new URLSearchParams({ state: url.searchParams.get('state'), code: 'valid-code' }); await c.callback(params);
  assert.equal(c.metadata().authConfigured, true); assert.equal(c.runtime().YOUTUBE_REFRESH_TOKEN, 'private-refresh');
  assert.equal(JSON.stringify(c.metadata()).includes('private-refresh'), false); await assert.rejects(c.callback(params), InputError); assert.equal(calls, 1);
  c.disconnect(); assert.equal(c.metadata().authConfigured, false);
});
test('YouTube poll uses video URL, handles KRW Super Chat and Sticker, honors page cursor', async () => {
  const events = [], calls = []; let cursor;
  const engine = { receive: (...args) => events.push(args), cursor: () => cursor, setCursor: value => { cursor = value; } };
  const connector = new YouTubeConnector(engine, { env: { YOUTUBE_ACCESS_TOKEN: 'private-access', YOUTUBE_VIDEO_ID: 'abcdefghijk' }, fetchImpl: async (raw, options) => {
    const url = new URL(raw); calls.push(url);
    assert.ok(['/youtube/v3/videos', '/youtube/v3/liveChat/messages'].includes(url.pathname)); assert.equal(options.headers.Authorization, 'Bearer private-access');
    return { ok: true, json: async () => url.pathname.endsWith('/videos') ? { items: [{ liveStreamingDetails: { activeLiveChatId: 'chat-1' } }] } : { pollingIntervalMillis: 7000, nextPageToken: 'page-2', items: [
      { id: 'chat-a', snippet: { superChatDetails: { currency: 'KRW', amountMicros: '1000000000' } }, authorDetails: { displayName: '후원자' } },
      { id: 'sticker-a', snippet: { superStickerDetails: { currency: 'KRW', amountMicros: '2000000000' } }, authorDetails: { displayName: '스티커' } },
      { id: 'foreign', snippet: { superChatDetails: { currency: 'USD', amountMicros: '5000000' } } },
      { id: 'chat-only', snippet: { type: 'textMessageEvent' } }
    ] } };
  } });
  assert.equal(await connector.poll(), 7000); assert.equal(events.length, 2); assert.deepEqual(events[0], ['youtube', { eventId: 'chat-a', nickname: '후원자', unit: 'KRW', amount: 1000 }]);
  assert.equal(connector.status.skippedCurrency, 1); assert.deepEqual(cursor, { chatId: 'chat-1', pageToken: 'page-2' });
  await connector.poll(); assert.equal(calls.at(-1).searchParams.get('pageToken'), 'page-2');
});
test('YouTube refresh uses offline credentials and does not expose provider error bodies', async () => {
  let requests = 0;
  const connector = new YouTubeConnector({}, { env: { YOUTUBE_CLIENT_ID: 'id', YOUTUBE_CLIENT_SECRET: 'secret', YOUTUBE_REFRESH_TOKEN: 'refresh' }, fetchImpl: async (url, options) => {
    requests++; assert.equal(url, 'https://oauth2.googleapis.com/token'); assert.equal(options.body.get('grant_type'), 'refresh_token'); return { ok: true, json: async () => ({ access_token: 'new-access', expires_in: 3600 }) };
  } }); assert.equal(await connector.token(), 'new-access'); assert.equal(await connector.token(), 'new-access'); assert.equal(requests, 1);
});

test('public YouTube mode cancels pending OAuth without deleting previously saved credentials', async t => {
 const c = connections(t, async () => ({ ok: true, json: async () => ({ refresh_token: 'kept-refresh' }) }));
 c.setApp({ clientId, clientSecret: 'private-client' });
 const first = new URL(c.authorize()); await c.callback(new URLSearchParams({ state: first.searchParams.get('state'), code: 'valid' }));
 assert.equal(c.metadata().mode, 'oauth');
 const pending = new URL(c.authorize());
 c.setSources({ youtube: 'https://www.youtube.com/live_chat?is_popout=1&v=9CAhQOG6fxM' }); c.setYouTubePublicEnabled(true);
 assert.equal(c.metadata().mode, 'public'); assert.equal(c.metadata().publicEnabled, true);
 assert.equal(c.runtime().YOUTUBE_REFRESH_TOKEN, 'kept-refresh');
 await assert.rejects(c.callback(new URLSearchParams({ state: pending.searchParams.get('state'), code: 'late' })), InputError);
 const restored = new Connections(c.file.slice(0, -'/connections.json'.length), {});
 assert.equal(restored.metadata().mode, 'public'); assert.equal(restored.metadata().publicEnabled, true);
});
