import { existsSync, realpathSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const inside = path => { const value = relative(root, path); return value !== '' && !value.startsWith('..') && !isAbsolute(value); };
if (process.argv.slice(2).some(argument => argument !== '--dry-run')) throw new Error('Only --dry-run is supported.');
const targets = ['dist', 'web/dist', 'target', 'wasm/pkg', 'web/src/wasm/generated'].map(name => {
  const path = resolve(root, name);
  if (!inside(path) || existsSync(path) && !inside(realpathSync(path))) throw new Error(`Unsafe generated-output path: ${name}`);
  return path;
});
if (process.argv.includes('--dry-run')) console.log(JSON.stringify(targets, null, 2));
else for (const path of targets) rmSync(path, { recursive: true, force: true });
