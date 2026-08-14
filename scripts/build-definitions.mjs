#!/usr/bin/env node
/**
 * Builds the bundled definitions file (option C).
 *
 *   node scripts/build-definitions.mjs
 *
 * Deux sources, toutes deux libres :
 *
 * - **kaikki.org**, the wiktextract extraction of the French Wiktionary,
 *   already parsed. Its `form_of` field names the lemma outright, where the
 *   live lookup had to guess it from a sentence's last word.
 * - **Lexique 3.83**, measured usage frequencies in occurrences per million,
 *   from film subtitles and books. They rank homographs: for COTE, "côté" must
 *   come before "coté", which no rule about word shape could ever work out.
 *
 * Neither file is decompressed to disk; both are read as streams.
 *
 * Output: server/data/definitions.tsv.gz, **one line per sense**
 *   NORMALISED_FORM \t part of speech \t spelling \t lemma \t definition
 *
 * Content under CC BY-SA 4.0, see server/data/LICENCE-DEFINITIONS.md
 */

import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';

import { buildDictionary, normalizeWord } from '@boggle/shared';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const require = createRequire(resolve(root, 'server/package.json'));

const WIKT_URL = 'https://kaikki.org/dictionary/downloads/fr/fr-extract.jsonl.gz';
const LEXIQUE_URL = 'http://www.lexique.org/databases/Lexique383/Lexique383.tsv';
const USER_AGENT = 'boggle-multiplayer/1.0 (https://github.com/AltarBeastiful/boggle-multiplayer)';

const WORK_DIR = process.env.BOGGLE_WORK_DIR ?? resolve(root, '.work');
const WIKT_FILE = resolve(WORK_DIR, 'fr-extract.jsonl.gz');
const LEXIQUE_FILE = resolve(WORK_DIR, 'Lexique383.tsv');
const OUT_FILE = resolve(root, 'server/data/definitions.tsv.gz');

/** Anything longer belongs to an encyclopaedia, not to a word game. */
const MAX_DEFINITION = 400;
/** Senses kept per spelling. Beyond this it clutters more than it informs. */
const MAX_SENSES = 3;
/** Spellings kept per normalised form. */
const MAX_SPELLINGS = 4;

const log = (message) => console.log(`[definitions] ${message}`);

// ---------------------------------------------------------------------------

async function download(url, target, minSize) {
  mkdirSync(WORK_DIR, { recursive: true });
  if (existsSync(target) && statSync(target).size > minSize) {
    log(`already present: ${target.split('/').pop()} (${(statSync(target).size / 1e6).toFixed(0)} MB)`);
    return;
  }

  log(`downloading ${url}`);
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok || !response.body) throw new Error(`download failed: ${response.status}`);

  const total = Number(response.headers.get('content-length') ?? 0);
  let received = 0;
  let lastLogged = 0;
  const progress = new TransformStream({
    transform(chunk, controller) {
      received += chunk.length;
      if (received - lastLogged > 100_000_000) {
        lastLogged = received;
        log(
          `  ${(received / 1e6).toFixed(0)} Mo${total ? ` (${((received / total) * 100).toFixed(0)} %)` : ''}`,
        );
      }
      controller.enqueue(chunk);
    },
  });

  await pipeline(response.body.pipeThrough(progress), createWriteStream(target));
  log(`downloaded: ${(statSync(target).size / 1e6).toFixed(0)} MB`);
}

/**
 * Usage frequency per spelling, in occurrences per million.
 * One spelling appears several times, once per lemma and category, so keep the
 * highest: the most common use.
 */
async function loadFrequencies() {
  const frequencies = new Map();
  const lines = createInterface({ input: createReadStream(LEXIQUE_FILE), crlfDelay: Infinity });
  let first = true;
  for await (const line of lines) {
    if (first) {
      first = false;
      continue;
    }
    const columns = line.split('\t');
    const ortho = columns[0];
    if (!ortho) continue;
    const films = Number.parseFloat(columns[8] ?? '0') || 0;
    const books = Number.parseFloat(columns[9] ?? '0') || 0;
    const score = films + books;
    const known = frequencies.get(ortho);
    if (known === undefined || score > known) frequencies.set(ortho, score);
  }
  return frequencies;
}

async function forEachFrenchEntry(onEntry) {
  const lines = createInterface({
    input: createReadStream(WIKT_FILE).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  let seen = 0;
  for await (const line of lines) {
    if (line.length < 2 || line[0] !== '{') continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    seen++;
    // The file covers every language the French Wiktionary describes.
    if (entry.lang_code === 'fr') onEntry(entry);
  }
  return seen;
}

function cleanDefinition(text) {
  const cleaned = String(text).replace(/\s+/g, ' ').trim();
  if (cleaned.length <= MAX_DEFINITION) return cleaned;
  const cut = cleaned.slice(0, MAX_DEFINITION);
  const stop = cut.lastIndexOf('. ');
  return (stop > MAX_DEFINITION / 2 ? cut.slice(0, stop + 1) : cut).trim() + '…';
}

/** An entry's own senses, pointers excluded, main one first. */
function ownSenses(entry) {
  const senses = [];
  for (const sense of entry.senses ?? []) {
    if (sense.form_of || sense.alt_of) continue;
    const gloss = sense.glosses?.[0];
    if (!gloss) continue;
    const definition = cleanDefinition(gloss);
    if (!senses.includes(definition)) senses.push(definition);
    if (senses.length >= MAX_SENSES) break;
  }
  return senses;
}

/** First sense pointing at a lemma. */
function formSense(entry) {
  for (const sense of entry.senses ?? []) {
    const target = sense.form_of?.[0]?.word ?? sense.alt_of?.[0]?.word;
    if (target) return { lemma: String(target), gloss: sense.glosses?.[0] ?? null };
  }
  return null;
}

// ---------------------------------------------------------------------------

async function main() {
  await download(WIKT_URL, WIKT_FILE, 600_000_000);
  await download(LEXIQUE_URL, LEXIQUE_FILE, 20_000_000);

  log('loading usage frequencies (Lexique 3.83)');
  const frequencies = await loadFrequencies();
  log(`${frequencies.size} spellings with a known frequency`);

  log('loading the game dictionary');
  const dictionary = buildDictionary(require('an-array-of-french-words'));
  log(`${dictionary.size} playable words`);

  // -- passe 1 : les sens des lemmes ----------------------------------------
  log('pass 1/2: lemma senses');
  const lemmaDefs = new Map();
  const totalRead = await forEachFrenchEntry((entry) => {
    const senses = ownSenses(entry);
    if (senses.length === 0) return;
    const word = String(entry.word ?? '');
    if (!word || lemmaDefs.has(word)) return;
    lemmaDefs.set(word, { partOfSpeech: entry.pos_title ?? entry.pos ?? '', definitions: senses });
  });
  log(`${totalRead} entries read, ${lemmaDefs.size} lemmas defined`);

  // -- passe 2 : ne garder que les mots jouables ----------------------------
  log('pass 2/2: attaching inflected forms');
  const rows = new Map();
  let direct = 0;
  let viaLemma = 0;
  let unresolved = 0;

  await forEachFrenchEntry((entry) => {
    const spelling = String(entry.word ?? '');
    if (!spelling) return;
    // Wiktionary also describes affixes and hyphenated phrases. Without this
    // filter "-eté" overrides "été", "-ane" overrides "âne" and "de-ci"
    // overrides "déci", since they normalise onto the same key. It is the rule
    // the game dictionary already applies.
    if (!/^[\p{L}]+$/u.test(spelling)) return;
    const normalized = normalizeWord(spelling);
    if (normalized.length < 3 || !dictionary.has(normalized)) return;

    const key = `${normalized}\t${spelling}`;
    const existing = rows.get(key);
    if (existing && existing.lemma === '') return; // already has a definition of its own

    const own = ownSenses(entry);
    if (own.length > 0) {
      rows.set(key, {
        normalized,
        spelling,
        partOfSpeech: entry.pos_title ?? entry.pos ?? '',
        lemma: '',
        definitions: own,
      });
      if (!existing) direct++;
      return;
    }

    if (existing) return;

    const form = formSense(entry);
    if (!form) return;

    const target = lemmaDefs.get(form.lemma);
    if (target) {
      rows.set(key, {
        normalized,
        spelling,
        partOfSpeech: target.partOfSpeech,
        lemma: form.lemma,
        definitions: target.definitions,
      });
      viaLemma++;
    } else if (form.gloss) {
      rows.set(key, {
        normalized,
        spelling,
        partOfSpeech: entry.pos_title ?? entry.pos ?? '',
        lemma: '',
        definitions: [cleanDefinition(form.gloss)],
      });
      unresolved++;
    }
  });

  log(
    `${rows.size} spellings: ${direct} defined outright, ${viaLemma} via lemma, ${unresolved} pointers only`,
  );

  // -- ranking the spellings ------------------------------------------------
  //
  // Wiktionary also describes acronyms and proper nouns, so without ranking
  // ETE returns an accounting term before "été". Those entries are pushed back
  // first, then the rest is ordered by measured usage frequency, which is what
  // puts "côté" ahead of "coté".
  const penalty = (row) => {
    let score = 0;
    if (row.spelling !== row.spelling.toLowerCase()) score += 4; // Ane, ANE, Añe
    if (/propre/i.test(row.partOfSpeech)) score += 4;
    if (/^(Abréviation|Sigle|Initiales|Variante|Symbole)\b/i.test(row.definitions[0] ?? '')) score += 3;
    return score;
  };
  const frequency = (row) =>
    frequencies.get(row.spelling) ?? frequencies.get(row.spelling.toLowerCase()) ?? 0;

  const byWord = new Map();
  for (const row of rows.values()) {
    const list = byWord.get(row.normalized);
    if (list) list.push(row);
    else byWord.set(row.normalized, [row]);
  }

  const ordered = [];
  let ranked = 0;
  for (const [, list] of [...byWord.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (list.length > 1) ranked++;
    list.sort(
      (a, b) =>
        penalty(a) - penalty(b) ||
        frequency(b) - frequency(a) ||
        (a.lemma ? 1 : 0) - (b.lemma ? 1 : 0) ||
        a.spelling.localeCompare(b.spelling),
    );
    ordered.push(...list.slice(0, MAX_SPELLINGS));
  }
  log(`${ranked} forms with several spellings, ranked by usage frequency`);

  // -- writing ---------------------------------------------------------------
  mkdirSync(dirname(OUT_FILE), { recursive: true });
  const gzip = createGzip({ level: 9 });
  const written = gzip.pipe(createWriteStream(OUT_FILE));
  let raw = 0;
  let senses = 0;
  for (const row of ordered) {
    for (const definition of row.definitions) {
      const line = `${row.normalized}\t${row.partOfSpeech}\t${row.spelling}\t${row.lemma}\t${definition}\n`;
      raw += Buffer.byteLength(line);
      senses++;
      gzip.write(line);
    }
  }
  gzip.end();
  await new Promise((done) => written.on('finish', done));

  const words = new Set(ordered.map((row) => row.normalized));
  const size = statSync(OUT_FILE).size;
  log(`written: ${OUT_FILE}`);
  log(`  ${words.size} words of ${dictionary.size} (${((words.size / dictionary.size) * 100).toFixed(1)}%)`);
  log(
    `  ${ordered.length} spellings, ${senses} senses (${(senses / ordered.length).toFixed(2)} per spelling)`,
  );
  log(`  ${(raw / 1e6).toFixed(1)} MB raw, ${(size / 1e6).toFixed(1)} MB compressed`);

  if (words.size < dictionary.size * 0.5) {
    throw new Error(`coverage suspiciously low (${words.size}), extraction looks wrong`);
  }
}

main().catch((error) => {
  console.error('[definitions] failed:', error.message);
  process.exitCode = 1;
});
