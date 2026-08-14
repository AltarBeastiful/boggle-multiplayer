import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDictionary, normalizeWord, type SortedDictionary } from '@boggle/shared';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

/**
 * Le dictionnaire vient de `an-array-of-french-words` (MIT), dérivé du lexique
 * Dicollecte/Grammalecte : ~336 000 formes fléchies, conjugaisons et pluriels
 * compris. Volontairement permissif : il accepte « déci », « zut », « eus »…
 *
 * Deux fichiers optionnels permettent de l'ajuster sans le reconstruire :
 *   data/extra-words.txt    mots ajoutés (un par ligne)
 *   data/excluded-words.txt mots retirés (un par ligne)
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
 * Index inverse : forme normalisée -> graphies réelles.
 *
 * Le jeu ignore les accents (`ETE`) alors que le Wiktionnaire les indexe
 * (`été`) : sans cet index, aucune définition ne serait trouvable. Seules les
 * entrées dont la graphie diffère de la forme normalisée sont conservées :
 * pour les autres, le mot en minuscules suffit. Environ 16 Mo.
 *
 * Une clé peut porter plusieurs graphies : `COTE` -> coté, côte, côté.
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

  const details = [`${cached.size} mots`, `${spellingIndex.size} graphies accentuées`, `${Date.now() - started} ms`];
  if (extra.length > 0) details.push(`+${extra.length} ajoutés`);
  if (excluded.length > 0) details.push(`-${excluded.length} exclus`);
  console.log(`[dictionnaire] ${details.join(', ')}`);

  return cached;
}
