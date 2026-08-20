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
 * the same spelling are grouped, here at lookup time.
 *
 * Spellings are ranked by measured usage frequency, senses in Wiktionary's own
 * order, main one first.
 *
 * **The file is searched where it lies, never parsed into objects.** Turning
 * its 81 MB into a Map of 433,018 words held 383 MB of JavaScript heap, which
 * does not fit on a 682 MB server: V8 caps its heap at a fraction of the
 * machine and the process died on the first lookup. Kept as bytes the same
 * data costs 81 MB, and outside the heap, since a Buffer is not counted
 * against it. The lines are sorted by normalised form and the forms are ASCII,
 * so a binary search over raw bytes finds a word in about twenty probes,
 * faster than the Map it replaces and without the load-time cost of building
 * one. Only the handful of lines that match are ever turned into strings.
 */

const here = dirname(fileURLToPath(import.meta.url));
const FILE_NAMES = ['definitions.tsv.gz', 'definitions.tsv'];
const NEWLINE = 0x0a;
const TAB = 0x09;

let data: Buffer | null = null;
let words = 0;
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

/** End of the line starting at `start`, on its newline or at the end of file. */
function lineEnd(buffer: Buffer, start: number): number {
  const newline = buffer.indexOf(NEWLINE, start);
  return newline === -1 ? buffer.length : newline;
}

/** End of the first field, on its tab. Bounded by the line: a line without a
 *  tab is its own key, and reading past the newline would take the next one. */
function keyEnd(buffer: Buffer, start: number, end: number): number {
  const tab = buffer.indexOf(TAB, start);
  return tab === -1 || tab > end ? end : tab;
}

/** Start of the line `position` falls in, never before `floor`. */
function lineStart(buffer: Buffer, position: number, floor: number): number {
  let start = position;
  while (start > floor && buffer[start - 1] !== NEWLINE) start--;
  return start;
}

/**
 * Offset of the first line whose word is `target` or sorts after it.
 *
 * `Buffer.compare(target, targetStart, targetEnd, sourceStart, sourceEnd)`
 * compares the source range, here the word in the file, against the target: a
 * negative result means the file is still before the word being looked up.
 */
function seek(buffer: Buffer, target: Buffer): number {
  let low = 0;
  let high = buffer.length;
  while (low < high) {
    const start = lineStart(buffer, (low + high) >>> 1, low);
    const end = lineEnd(buffer, start);
    if (buffer.compare(target, 0, target.length, start, keyEnd(buffer, start, end)) < 0) {
      // Past the whole line, so the search cannot stall on the line it lands in.
      low = Math.min(end + 1, high);
    } else {
      high = start;
    }
  }
  return low;
}

/** Distinct words, for the health endpoint. One pass, no strings built. */
function countWords(buffer: Buffer): number {
  let count = 0;
  let start = 0;
  let previousStart = -1;
  let previousEnd = -1;

  while (start < buffer.length) {
    const end = lineEnd(buffer, start);
    if (end > start) {
      const key = keyEnd(buffer, start, end);
      if (previousStart < 0 || buffer.compare(buffer, previousStart, previousEnd, start, key) !== 0) {
        count++;
      }
      previousStart = start;
      previousEnd = key;
    }
    start = end + 1;
  }
  return count;
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
  data = path.endsWith('.gz') ? gunzipSync(raw) : raw;
  words = countWords(data);
  console.log(
    `[definitions] ${words} words in ${Math.round(data.length / 1e6)} MB of ${path.split('/').pop()}, searched in place, ready in ${Date.now() - started} ms`,
  );
}

/** Bundled definitions for a normalised word, or `null` when no file is present. */
export function lookupLocal(word: string): DefinitionEntry[] | null {
  if (!loaded) load();
  const buffer = data;
  if (!buffer) return null;

  const target = Buffer.from(word, 'utf8');
  const entries: DefinitionEntry[] = [];

  for (let start = seek(buffer, target); start < buffer.length; ) {
    const end = lineEnd(buffer, start);
    if (buffer.compare(target, 0, target.length, start, keyEnd(buffer, start, end)) !== 0) break;

    const [, partOfSpeech, spelling, lemma, definition] = buffer.toString('utf8', start, end).split('\t');
    start = end + 1;
    if (!definition) continue;

    const last = entries[entries.length - 1];
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
    entries.push(entry);
  }

  return entries.length > 0 ? entries : null;
}

export function localDefinitionCount(): number {
  if (!loaded) load();
  return words;
}

export function hasLocalDefinitions(): boolean {
  if (!loaded) load();
  return data !== null;
}
