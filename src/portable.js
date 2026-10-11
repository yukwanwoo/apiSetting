import { dirname, resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, existsSync, cpSync } from 'node:fs';

export function preparePortableData(exePath, env = process.env) {
  if (env.DATA_DIR) return { dataDir: resolve(env.DATA_DIR), migrated: false };
  const dataDir = join(dirname(resolve(exePath)), 'data');
  mkdirSync(dataDir, { recursive: true });
  const files = ['state.json', 'keys.json', 'connections.json'];
  const legacy = join(env.LOCALAPPDATA || join(homedir(), '.local', 'share'), 'MesoLiveRoulette', 'data');
  const shouldCopy = !files.some(file => existsSync(join(dataDir, file))) && files.some(file => existsSync(join(legacy, file))) && resolve(legacy) !== resolve(dataDir);
  if (shouldCopy) cpSync(legacy, dataDir, { recursive: true, force: false, errorOnExist: false });
  return { dataDir, migrated: shouldCopy };
}
