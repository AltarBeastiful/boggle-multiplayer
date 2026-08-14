import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import type { DefinitionEntry } from '@boggle/shared';

/**
 * Bundled definitions, served from a file shipped with the image.
 *
 * The file is **optional**: without it `lookup` returns nothing and the caller
 * falls back to the live Wiktionary search. The game therefore behaves exactly
 * the same without it, which is what allows building it, comparing it, and
 * rolling back without breaking anything.
 *
 * Format: a sorted TSV, one line per sense.
 *
 *   NORMALISED_FORM \t part of speech \t spelling \t lemma \t definition
 *
 * The lemma is empty when the word carries its own definition. One spelling
 * takes as many lines as it has senses, and one normalised form as many
 * spellings as it has (COTE -> côté, côte, cote, coté). Consecutive lines of
 * the same spelling are grouped at load time.
 *
 * Spellings are ranked by measured usage frequency, senses in Wiktionary's own
 * order, main one first.
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
    console.log('[definitions] no bundled file, falling back to live Wiktionary lookups');
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
    // Next line of the same spelling: one more sense, not a new entry.
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
    `[definitions] ${map.size} words, ${entries} spellings, ${lines} senses loaded from ${path.split('/').pop()} in ${Date.now() - started} ms`,
  );
}

/** Bundled definitions for a normalised word, or `null` when no file is present. */
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
