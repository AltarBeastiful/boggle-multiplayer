#!/usr/bin/env node
/**
 * What the game dictionary is missing, measured rather than guessed.
 *
 *   node scripts/audit-dictionary.mjs [--limit N]
 *
 * Two independent references, both already downloaded by
 * `scripts/build-definitions.mjs` into `.work/`:
 *
 *   Lexique 3.83        ~140,000 forms with usage frequencies from film
 *                       subtitles and books. Frequency is what matters here: a
 *                       missing rare word costs nothing, a missing common one
 *                       is felt on every other grid.
 *   Wiktionary (kaikki) the largest French word list there is, used to say how
 *                       many real words are absent in absolute terms.
 *
 * Only words the game could ever accept are counted: three letters or more,
 * purely alphabetic once normalised, since hyphens and apostrophes cannot be
 * traced on a grid anyway.
 */

import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGunzip } from 'node:zlib';

import { buildDictionary, normalizeWord } from '@boggle/shared';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(root, 'server/package.json'));
const work = resolve(root, '.work');
const LEXIQUE = resolve(work, 'Lexique383.tsv');
const WIKTIONARY = resolve(work, 'fr-extract.jsonl.gz');

const dictionary = buildDictionary(require('an-array-of-french-words'));
console.log(`Game dictionary: ${dictionary.size} playable forms\n`);

/** A word the game could accept at all. */
const playable = (word) => {
  const normalized = normalizeWord(word);
  return normalized.length >= 3 && /^[\p{L}]+$/u.test(word) ? normalized : null;
};

// ---------------------------------------------------------------------------
// Lexique 3.83, weighted by how often the word is actually used
// ---------------------------------------------------------------------------

if (!existsSync(LEXIQUE)) {
  console.log(`Lexique missing (${LEXIQUE}); run scripts/build-definitions.mjs first.`);
} else {
  const lines = createInterface({ input: createReadStream(LEXIQUE, 'utf8'), crlfDelay: Infinity });
  let header = true;
  const seen = new Map(); // normalised form -> best frequency seen
  for await (const line of lines) {
    if (header) {
      header = false;
      continue;
    }
    const columns = line.split('\t');
    const word = columns[0];
    if (!word) continue;
    const normalized = playable(word);
    if (!normalized) continue;
    // Occurrences per million in film subtitles, the everyday register.
    const frequency = Number(columns[8]) || 0;
    const previous = seen.get(normalized);
    if (previous === undefined || frequency > previous) seen.set(normalized, frequency);
  }

  const forms = [...seen.entries()];
  const missing = forms.filter(([word]) => !dictionary.has(word));
  const band = (low, high) => {
    const inBand = forms.filter(([, f]) => f >= low && f < high);
    const gone = inBand.filter(([word]) => !dictionary.has(word));
    return { total: inBand.length, gone: gone.length, words: gone };
  };

  console.log('== Lexique 3.83, by how often the word is used ==');
  console.log(`  ${forms.length} playable forms, ${missing.length} missing (${
    ((100 * missing.length) / forms.length).toFixed(1)}%)\n`);

  const bands = [
    ['very common  (>= 100 per million)', 100, Infinity],
    ['common       (10 to 100)', 10, 100],
    ['ordinary     (1 to 10)', 1, 10],
    ['uncommon     (0.1 to 1)', 0.1, 1],
    ['rare         (< 0.1)', 0, 0.1],
  ];
  for (const [label, low, high] of bands) {
    const { total, gone, words } = band(low, high);
    const share = total > 0 ? ((100 * gone) / total).toFixed(1) : '0.0';
    console.log(`  ${label.padEnd(34)} ${String(gone).padStart(6)} / ${String(total).padStart(6)} missing (${share}%)`);
    if (gone > 0 && low >= 1) {
      const sample = words
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([word, f]) => `${word.toLowerCase()} (${f.toFixed(1)})`);
      console.log(`      ${sample.join(', ')}`);
    }
  }
  console.log();
}

// ---------------------------------------------------------------------------
// Wiktionary: the absolute size of the hole
// ---------------------------------------------------------------------------

if (!existsSync(WIKTIONARY)) {
  console.log(`Wiktionary extract missing (${WIKTIONARY}); skipping.`);
} else {
  const lines = createInterface({
    input: createReadStream(WIKTIONARY).pipe(createGunzip()),
    crlfDelay: Infinity,
  });

  const known = new Set();
  const missing = new Set();
  let entries = 0;
  for await (const line of lines) {
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.lang_code !== 'fr' || typeof entry.word !== 'string') continue;
    // Proper nouns are not playable material: the game is not a gazetteer.
    if (entry.pos === 'name') continue;
    if (/^\p{Lu}/u.test(entry.word)) continue;
    const normalized = playable(entry.word);
    if (!normalized) continue;
    entries++;
    if (dictionary.has(normalized)) known.add(normalized);
    else missing.add(normalized);
  }

  console.log('== French Wiktionary (wiktextract) ==');
  console.log(`  ${entries} playable French entries, ${known.size + missing.size} distinct forms`);
  console.log(`  in the game dictionary: ${known.size}`);
  console.log(`  absent from it:         ${missing.size} (${
    ((100 * missing.size) / (known.size + missing.size)).toFixed(1)}%)`);
  const sample = [...missing].sort((a, b) => a.length - b.length || a.localeCompare(b)).slice(0, 25);
  console.log(`  shortest absent forms:  ${sample.map((w) => w.toLowerCase()).join(', ')}`);
}
