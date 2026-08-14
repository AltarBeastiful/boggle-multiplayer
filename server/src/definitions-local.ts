import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import type { DefinitionEntry } from '@boggle/shared';

/**
 * Définitions embarquées, servies depuis un fichier livré avec l'image.
 *
 * Le fichier est **facultatif** : s'il est absent, `lookup` ne renvoie rien et
 * l'appelant retombe sur la recherche en direct au Wiktionnaire. Le jeu
 * fonctionne donc à l'identique sans lui, ce qui permet de le construire, de le
 * comparer, et de revenir en arrière sans rien casser.
 *
 * Format : un TSV trié, une ligne par sens.
 *
 *   FORME_NORMALISEE \t nature \t graphie \t lemme \t définition
 *
 * Le lemme est vide quand le mot porte sa propre définition. Une même graphie
 * occupe autant de lignes qu'elle a de sens, et une même forme normalisée
 * autant de graphies qu'elle en a (COTE -> côté, côte, cote, coté). Les lignes
 * consécutives d'une même graphie sont regroupées au chargement.
 *
 * Les graphies sont classées par fréquence d'usage réelle, les sens dans
 * l'ordre du Wiktionnaire (le principal en premier).
 */

const here = dirname(fileURLToPath(import.meta.url));
const FILE_NAMES = ['definitions.tsv.gz', 'definitions.tsv'];

let index: Map<string, DefinitionEntry[]> | null = null;
let loaded = false;

function findFile(): string | null {
  for (const base of [resolve(here, '..', 'data'), resolve(here, '..', '..', 'data')]) {
    for (const name of FILE_NAMES) {
      const path = resolve(base, name);
      if (existsSync(path)) return path;
    }
  }
  return null;
}

function load(): void {
  loaded = true;
  const path = findFile();
  if (!path) {
    console.log('[définitions] aucun fichier embarqué, recherche en direct au Wiktionnaire');
    return;
  }

  const started = Date.now();
  const raw = readFileSync(path);
  const text = (path.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8');

  const map = new Map<string, DefinitionEntry[]>();
  let lines = 0;

  for (const line of text.split('\n')) {
    if (line.length === 0) continue;
    const [word, partOfSpeech, spelling, lemma, definition] = line.split('\t');
    if (!word || !definition) continue;
    lines++;

    const existing = map.get(word);
    const last = existing?.[existing.length - 1];
    // Ligne suivante de la même graphie : c'est un sens de plus, pas une entrée.
    if (last && last.spelling === spelling && last.partOfSpeech === partOfSpeech) {
      last.definitions.push(definition);
      continue;
    }

    const entry: DefinitionEntry = {
      spelling: spelling || word.toLowerCase(),
      partOfSpeech: partOfSpeech || '',
      definitions: [definition],
    };
    if (lemma) entry.lemma = lemma;
    if (existing) existing.push(entry);
    else map.set(word, [entry]);
  }

  index = map;
  let entries = 0;
  for (const list of map.values()) entries += list.length;
  console.log(
    `[définitions] ${map.size} mots, ${entries} graphies, ${lines} sens chargés depuis ${path.split('/').pop()} en ${Date.now() - started} ms`,
  );
}

/** Définitions embarquées d'un mot normalisé, ou `null` si aucun fichier. */
export function lookupLocal(word: string): DefinitionEntry[] | null {
  if (!loaded) load();
  if (!index) return null;
  return index.get(word) ?? null;
}

export function localDefinitionCount(): number {
  if (!loaded) load();
  return index?.size ?? 0;
}

export function hasLocalDefinitions(): boolean {
  if (!loaded) load();
  return index !== null;
}
