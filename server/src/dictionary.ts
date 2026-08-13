import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDictionary, type SortedDictionary } from '@boggle/shared';

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

export function getDictionary(): SortedDictionary {
  if (cached) return cached;

  const started = Date.now();
  const base = require('an-array-of-french-words') as string[];
  const extra = readWordFile('extra-words.txt');
  const excluded = readWordFile('excluded-words.txt');

  cached = buildDictionary(extra.length > 0 ? [...base, ...extra] : base, {
    exclude: excluded.length > 0 ? excluded : undefined,
  });

  const details = [`${cached.size} mots`, `${Date.now() - started} ms`];
  if (extra.length > 0) details.push(`+${extra.length} ajoutés`);
  if (excluded.length > 0) details.push(`-${excluded.length} exclus`);
  console.log(`[dictionnaire] ${details.join(', ')}`);

  return cached;
}
