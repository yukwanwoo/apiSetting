import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version;
const exe = resolve(process.argv[2] || `dist/MesoLiveRoulette-${version}-win-x64.exe`);
const dataDir = mkdtempSync(join(tmpdir(), 'meso-exe-'));
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(CHZZK_|YOUTUBE_|ADMIN_TOKEN$|OVERLAY_TOKEN$|WEBHOOK_SECRET$)/.test(name)));
let child, output = '';
async function start() {
  child = spawn(exe, ['--no-browser'], { cwd: tmpdir(), env: { ...env, DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
  let spawnError; child.on('error', error => { spawnError = error; });
  for (let i = 0; i < 100; i++) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) throw new Error(`EXE failed: ${output}`);
    if (existsSync(join(dataDir, 'keys.json'))) {
      try { if ((await fetch('http://127.0.0.1:3000/api/health')).ok) return; } catch {}
    }
    await delay(100);
  }
  throw new Error(`EXE startup timed out: ${output}`);
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise(r => child.once('exit', r));
  child.kill(); await exited;
}
async function request(path, value) {
  const keys = JSON.parse(readFileSync(join(dataDir, 'keys.json')));
  const response = await fetch(`http://127.0.0.1:3000${path}`, { headers: { Authorization: `Bearer ${keys.admin}`, 'Content-Type': 'application/json' }, method: value === undefined ? 'GET' : 'POST', ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  assert.equal(response.status, 200, path); return response.json();
}
try {
  await start();
  for (const path of ['/', '/dashboard.js', '/styles.css', '/overlay.html', '/overlay.js', '/meso.html']) {
    const response = await fetch(`http://127.0.0.1:3000${path}`); assert.equal(response.status, 200, path); assert.ok((await response.text()).length > 100);
  }
  assert.equal((await fetch('http://127.0.0.1:3000/api/state')).status, 401);
  const state = await request('/api/state'); assert.equal(state.balance, 30_000_000);
  const config = state.config;
  config.roulettes[0].durationMs = 100; config.roulettes[0].resultHoldMs = 0;
  config.roulettes[0].prizes = [{ id: 'exe-fixed', meso: 1_000_000, weight: 1000 }];
  await request('/api/config', config);
  await request('/api/test-donation', { provider: 'soop', nickname: 'EXE smoke', amount: 10, unit: 'STAR' });
  for (let i = 0; i < 50 && (await request('/api/state')).balance !== 31_000_000; i++) await delay(100);
  assert.equal((await request('/api/state')).balance, 31_000_000);
  const keysBefore = readFileSync(join(dataDir, 'keys.json'), 'utf8');
  assert.ok(!output.includes(JSON.parse(keysBefore).admin), 'admin key leaked to console');
  await stop(); await start();
  assert.equal((await request('/api/state')).balance, 31_000_000, 'persistent balance');
  assert.equal(readFileSync(join(dataDir, 'keys.json'), 'utf8'), keysBefore, 'persistent keys');
  console.log('EXE smoke passed: embedded pages, authentication, roulette settlement and restart persistence.');
} finally { await stop(); rmSync(dataDir, { recursive: true, force: true }); }
