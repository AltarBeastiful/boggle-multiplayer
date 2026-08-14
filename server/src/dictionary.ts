import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDictionary, normalizeWord, type SortedDictionary } from '@boggle/shared';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

/**
 * The dictionary comes from `an-array-of-french-words` (MIT), derived from the
 * Dicollecte/Grammalecte lexicon: around 336,000 inflected forms, conjugations
 * and plurals included. Deliberately permissive: it accepts "déci", "zut",
 * "eus" and the like.
 *
 * Two optional files adjust it without rebuilding anything:
 *   data/extra-words.txt    words to add, one per line
 *   data/excluded-words.txt words to drop, one per line
 */
function readWordFile(name: string): string[] {
  for (const base of [resolve(here, '..', 'data'), resolve(here, '..', '..', 'data')]) {
    const path = resolve(base, name);
    if (!existsSync(path)) continue;
    return readFileSync(path, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
  }
  return [];
}

let cached: SortedDictionary | null = null;
let spellingIndex: Map<string, string[]> | null = null;

/**
 * Reverse index: normalised form -> real spellings.
 *
 * The game ignores accents (`ETE`) where Wiktionary indexes them (`été`), so
 * without this index no definition could be found. Only entries whose spelling
 * differs from the normalised form are kept; for the rest the lowercase word is
 * enough. Around 16 MB.
 *
 * One key can carry several spellings: `COTE` -> coté, côte, côté.
 */
function buildSpellingIndex(words: Iterable<string>): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const raw of words) {
    if (!/^[\p{L}]+$/u.test(raw)) continue;
    const normalized = normalizeWord(raw);
    if (normalized.length < 3 || normalized === raw.toUpperCase()) continue;
    const spellings = index.get(normalized);
    if (spellings) {
      if (!spellings.includes(raw)) spellings.push(raw);
    } else {
      index.set(normalized, [raw]);
    }
  }
  return index;
}

export function getSpellingIndex(): Map<string, string[]> {
  if (!spellingIndex) getDictionary();
  return spellingIndex ?? new Map();
}

export function getDictionary(): SortedDictionary {
  if (cached) return cached;

  const started = Date.now();
  const base = require('an-array-of-french-words') as string[];
  const extra = readWordFile('extra-words.txt');
  const excluded = readWordFile('excluded-words.txt');

  cached = buildDictionary(extra.length > 0 ? [...base, ...extra] : base, {
    exclude: excluded.length > 0 ? excluded : undefined,
  });

  spellingIndex = buildSpellingIndex([...base, ...extra]);

  const details = [`${cached.size} words`, `${spellingIndex.size} accented spellings`, `${Date.now() - started} ms`];
  if (extra.length > 0) details.push(`+${extra.length} added`);
  if (excluded.length > 0) details.push(`-${excluded.length} excluded`);
  console.log(`[dictionary] ${details.join(', ')}`);

  return cached;
}
