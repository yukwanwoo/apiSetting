import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { browserLaunch } from '../src/browser.js';

test('Windows opens the default URL handler without Explorer or shell interpolation', () => {
  const url = 'http://127.0.0.1:3000/#admin=fixture-key&text="$(ignored)';
  const env = { SystemRoot: 'C:\\Windows', EXISTING: 'kept' };
  const launch = browserLaunch(url, 'win32', env);
  assert.equal(launch.command, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.equal(launch.options.windowsHide, true);
  assert.equal(launch.options.env.MESO_BROWSER_URL, url);
  assert.equal(launch.options.env.EXISTING, 'kept');
  assert.equal(env.MESO_BROWSER_URL, undefined);
  assert.ok(!launch.args.some(arg => arg.includes('fixture-key')));
  assert.match(launch.args.at(-1), /^Start-Process -FilePath \$env:MESO_BROWSER_URL -ErrorAction Stop$/);
});

test('Windows PowerShell passes the complete login URL to Start-Process', { skip: process.platform !== 'win32' }, () => {
  const url = 'http://127.0.0.1:3000/#admin=fixture-key';
  const launch = browserLaunch(url);
  // Stub only the OS handler, so CI does not open an interactive browser.
  const args = [...launch.args];
  args[args.length - 1] = 'function Start-Process { param($FilePath, $ErrorAction) Write-Output $FilePath }; ' + args.at(-1);
  const result = spawnSync(launch.command, args, { ...launch.options, stdio: 'pipe', detached: false, encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), url);
});
