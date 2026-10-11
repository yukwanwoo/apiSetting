import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { preparePortableData } from '../src/portable.js';

test('portable storage ignores legacy data and preserves existing portable settings', t => {
  const root = mkdtempSync(join(tmpdir(), 'meso-portable-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const exe = join(root, '방송 folder', 'Meso.exe'), appdata = join(root, 'AppData');
  const legacy = join(appdata, 'MesoLiveRoulette', 'data'); mkdirSync(legacy, { recursive: true });
  for (const [name, value] of Object.entries({ 'keys.json': { admin: 'legacy-test-key' }, 'state.json': { balance: -100 }, 'connections.json': { fixture: true } })) writeFileSync(join(legacy, name), JSON.stringify(value));
  const first = preparePortableData(exe, { LOCALAPPDATA: appdata });
  assert.equal(first.dataDir, join(root, '방송 folder', 'data'));
  for (const file of ['state.json', 'keys.json', 'connections.json']) assert.equal(existsSync(join(first.dataDir, file)), false);
  writeFileSync(join(first.dataDir, 'state.json'), JSON.stringify({ balance: 200 }));
  assert.equal(preparePortableData(exe, { LOCALAPPDATA: appdata }).dataDir, first.dataDir);
  assert.equal(JSON.parse(readFileSync(join(first.dataDir, 'state.json'))).balance, 200);
  assert.equal(JSON.parse(readFileSync(join(legacy, 'state.json'))).balance, -100);
});
test('portable installations ignore DATA_DIR and never write to AppData', t => {
  const root = mkdtempSync(join(tmpdir(), 'meso-portable-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const appdata = join(root, 'AppData'), exe = join(root, 'Meso.exe');
  assert.equal(preparePortableData(exe, { LOCALAPPDATA: appdata }).dataDir, join(root, 'data'));
  assert.equal(existsSync(appdata), false);
  assert.equal(preparePortableData(exe, { LOCALAPPDATA: appdata, DATA_DIR: join(root, 'custom') }).dataDir, join(root, 'data'));
  assert.equal(existsSync(join(root, 'custom')), false);
});
