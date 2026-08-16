/**
 * The dictionary the server actually plays with.
 *
 * The npm package is only the starting point: `server/data/extra-words.txt`
 * and `excluded-words.txt` adjust it, and a script that skips them measures,
 * or builds definitions for, a dictionary nobody is playing. That is how the
 * added conjugations came to be the only words in the game with no bundled
 * definition — the very words added because they were missing.
 *
 * Mirrors `server/src/dictionary.ts`, which does the same thing at runtime.
 */

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDictionary } from '@boggle/shared';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(root, 'server/package.json'));

/** One of the adjustment files, as a list of words. */
export function wordAdjustments(name) {
  const path = resolve(root, 'server', 'data', name);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

/** Every spelling the game knows, before normalising. */
export function gameSpellings() {
  return [...require('an-array-of-french-words'), ...wordAdjustments('extra-words.txt')];
}

/** The dictionary, adjustments included. */
export function gameDictionary() {
  const excluded = wordAdjustments('excluded-words.txt');
  return buildDictionary(gameSpellings(), { exclude: excluded.length > 0 ? excluded : undefined });
}
