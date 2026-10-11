import { dirname, resolve, join } from 'node:path';
import { mkdirSync } from 'node:fs';

export function preparePortableData(exePath) {
  const dataDir = join(dirname(resolve(exePath)), 'data');
  mkdirSync(dataDir, { recursive: true });
  return { dataDir };
}
