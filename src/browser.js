import { spawn } from 'node:child_process';
import { win32 } from 'node:path';

// Keep the login fragment out of shell source and error messages.
export function browserLaunch(url, platform = process.platform, env = process.env) {
  if (platform === 'win32') {
    return {
      command: win32.join(env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'Start-Process -FilePath $env:MESO_BROWSER_URL -ErrorAction Stop'],
      options: { stdio: 'ignore', detached: true, windowsHide: true, env: { ...env, MESO_BROWSER_URL: url } }
    };
  }
  return { command: 'xdg-open', args: [url], options: { stdio: 'ignore', detached: true } };
}

export function openBrowser(url, onFailure) {
  const { command, args, options } = browserLaunch(url);
  let reported = false;
  const fail = () => { if (!reported) { reported = true; onFailure(); } };
  try {
    const child = spawn(command, args, options);
    child.once('error', fail);
    child.once('exit', code => { if (code !== 0) fail(); });
    child.unref();
  } catch { fail(); }
}
