#!/usr/bin/env node
/**
 * Are the conjugations there? Measured, and repaired.
 *
 *   node scripts/audit-conjugations.mjs [--write]
 *
 * The word list is derived from a game word list rather than a lexicon, and it
 * shows most in the verbs: it accepts `grader` and refuses `gradera`, accepts
 * `nourrir` and refuses every form of its future. A player who knows their
 * conjugation is then punished for it, which is the least forgivable way for a
 * dictionary to be wrong.
 *
 * The reference is the French Wiktionary extract already in `.work/`, which is
 * the only one of the two that carries conjugation: Lexique knows `grader`
 * solely as a noun, so it cannot even see this gap. A form is an entry tagged
 * `form-of` under `pos: verb`, pointing at its infinitive.
 *
 * **Only verbs the game already accepts are completed.** That is the whole
 * rule, and it is what makes the repair safe to apply unattended: it adds no
 * vocabulary, takes no view on what belongs in a family game, and cannot let
 * in a word whose infinitive was deliberately left out. It only finishes
 * sentences the dictionary had already started.
 *
 * With --write the missing forms are merged into server/data/extra-words.txt.
 */

import { createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGunzip } from 'node:zlib';

import { normalizeWord } from '@boggle/shared';

import { gameDictionary, gameSpellings } from './game-dictionary.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WIKTIONARY = resolve(root, '.work', 'fr-extract.jsonl.gz');
const EXTRA = resolve(root, 'server', 'data', 'extra-words.txt');
const write = process.argv.includes('--write');

if (!existsSync(WIKTIONARY)) {
  console.log(`Wiktionary extract missing (${WIKTIONARY}); run scripts/build-definitions.mjs first.`);
  process.exit(1);
}

const dictionary = gameDictionary();
/** Spellings as written, which is what the extra-words file holds. */
const spellings = new Set(gameSpellings());
console.log(`Game dictionary: ${dictionary.size} playable forms\n`);

/**
 * The modern French alphabet, and nothing else.
 *
 * `\p{L}` is too generous here. Wiktionary carries older orthography under the
 * same French heading — `aboutißẽt` — and the eszett uppercases to SS, so
 * normalising that form yields ABOUTISSET: a word that looks entirely real,
 * is entirely traceable on a grid, and does not exist. One is enough to make
 * the dictionary worse than the hole it was filling.
 */
const FRENCH = /^[a-zàâäçéèêëîïôöùûüÿœ]+$/;

/**
 * Wiktionary describes French rather than prescribing it, so a conjugation
 * table is not a list of words a player may use. It also records:
 *
 *   - pre-1835 spelling — `avoit`, `seroit`, `vouloit`
 *   - regional forms — `mangeont`, `sontaient`, `disez`
 *   - contractions and slang — `ché`, `sra`, `tsé`
 *   - forms coined as jokes — `boivez`, `faisez`, `mourirai`
 *   - children's regularisations, entered as such: `fontsaient` is glossed
 *     "régularisation de faisaient à partir du présent font"
 *
 * All real entries, none of them a word to be refused a point for not knowing.
 * `rare` is deliberately not here — `gésir` is rare and entirely correct — nor
 * are the 1990 reform spellings, which are official.
 */
const REJECTED_TAGS = new Set([
  'archaic',
  'obsolete',
  'dated',
  'colloquial',
  'familiar',
  'slang',
  'informal',
  'nonstandard',
  'misspelling',
  'alt-of',
  'neuter',
]);

/** The same, as Wiktionary's own French labels. */
const REJECTED_LABELS =
  /archaïque|avant 1835|ancienne orthographe|par plaisanterie|régionalisme|diaéthiques|vallée d’aoste|québec|louisiane|acadie|missouri|wallonie|acadien|désuet|vieilli|populaire|argot|enfantin/i;

/** And as the opening of the definition itself. */
const REJECTED_GLOSS = /^(ancienne|variante|orthographe|écriture|contraction)\b|régularisation/i;

function standardForm(entry, sense) {
  for (const tag of [...(entry.tags ?? []), ...(sense.tags ?? [])]) {
    if (REJECTED_TAGS.has(tag)) return false;
  }
  for (const label of [...(entry.raw_tags ?? []), ...(sense.raw_tags ?? [])]) {
    if (REJECTED_LABELS.test(label)) return false;
  }
  return !REJECTED_GLOSS.test(sense.glosses?.[0] ?? '');
}

/** A word the game could accept at all: three letters, French, no capital. */
const playable = (word) => {
  if (typeof word !== 'string' || !FRENCH.test(word)) return null;
  const normalized = normalizeWord(word);
  return normalized.length >= 3 ? normalized : null;
};

/**
 * A pronominal verb is named with its pronoun — `s’enfuir`, `se souvenir` —
 * and the dictionary holds the bare infinitive. Without stripping it the
 * lookup fails on the apostrophe and every pronominal verb in French is
 * skipped in silence, which is how `enfuira` stayed missing after a first pass
 * that thought it had finished the job.
 */
const bareInfinitive = (lemma) =>
  typeof lemma === 'string' ? lemma.replace(/^s['’]|^se\s+/i, '').trim() : '';

const lines = createInterface({
  input: createReadStream(WIKTIONARY).pipe(createGunzip()),
  crlfDelay: Infinity,
});

/** lemma -> the forms Wiktionary gives it. */
const families = new Map();
/** Forms left out as not being standard modern French. */
const rejected = new Set();
let forms = 0;

for await (const line of lines) {
  if (!line) continue;
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    continue;
  }
  if (entry.lang_code !== 'fr' || entry.pos !== 'verb') continue;
  if (!playable(entry.word)) continue;

  for (const sense of entry.senses ?? []) {
    if (!sense.tags?.includes('form-of')) continue;
    if (!standardForm(entry, sense)) {
      rejected.add(entry.word);
      continue;
    }
    for (const target of sense.form_of ?? []) {
      const lemma = bareInfinitive(target?.word);
      if (lemma.length === 0) continue;
      let family = families.get(lemma);
      if (!family) families.set(lemma, (family = new Set()));
      family.add(entry.word);
      forms++;
    }
  }
}

// A form kept by one sense and rejected by another stays: it is standard in at
// least one of its readings, which is enough to be worth a point.
console.log(`Wiktionary: ${forms} verb forms across ${families.size} infinitives`);
console.log(`  ${rejected.size} forms set aside as archaic, regional, slang or joke\n`);

let knownVerbs = 0;
let coveredForms = 0;
const additions = new Set();
const holes = [];

for (const [lemma, family] of families) {
  const normalizedLemma = playable(lemma);
  // The rule: complete what the dictionary already knows, and nothing else.
  if (!normalizedLemma || !dictionary.has(normalizedLemma)) continue;
  knownVerbs++;

  const missing = [];
  for (const form of family) {
    const normalized = playable(form);
    if (!normalized) continue;
    if (dictionary.has(normalized)) coveredForms++;
    else {
      missing.push(form);
      additions.add(form);
    }
  }
  if (missing.length > 0) holes.push({ lemma, missing: missing.length, of: family.size });
}

const total = coveredForms + additions.size;
console.log('== Verbs the game already accepts ==');
console.log(`  infinitives            ${knownVerbs}`);
console.log(`  their forms            ${total}`);
console.log(`  accepted               ${coveredForms} (${((100 * coveredForms) / total).toFixed(1)} %)`);
console.log(`  refused                ${additions.size} (${((100 * additions.size) / total).toFixed(1)} %)`);
console.log(`  verbs with a hole      ${holes.length} of ${knownVerbs}`);

holes.sort((a, b) => b.missing - a.missing);
console.log('\n-- the worst holes --');
for (const hole of holes.slice(0, 20)) {
  console.log(`  ${hole.lemma.padEnd(20)} ${hole.missing} of ${hole.of} forms refused`);
}

const sample = [...additions].sort();
console.log(`\n-- a sample of what is refused --\n  ${sample.slice(0, 20).join(' ')}`);

if (!write) {
  console.log('\nRun again with --write to add these to server/data/extra-words.txt.');
} else {
  const header = [
    '# Words added to the dictionary, one per line.',
    '#',
    '# Conjugations of verbs the dictionary already accepts, taken from the',
    '# French Wiktionary by scripts/audit-conjugations.mjs. The source list is a',
    '# game word list rather than a lexicon: it holds `grader` but not `gradera`,',
    '# `nourrir` but none of its future. Nothing here is new vocabulary — every',
    '# one of these is a form of a verb the game already knew.',
    '#',
    '# Regenerate with: node scripts/audit-conjugations.mjs --write',
  ].join('\n');

  // Anything hand-written in the file is kept: only the generated block is
  // replaced, and a word already present is never written twice.
  const previous = existsSync(EXTRA) ? readFileSync(EXTRA, 'utf8') : '';
  const handWritten = previous
    .split('\n')
    .filter((line) => line.trim().length > 0 && !line.startsWith('#'))
    .filter((word) => !additions.has(word.trim()));

  const body = [...additions].filter((word) => !spellings.has(word)).sort((a, b) => a.localeCompare(b, 'fr'));
  const out = [header, '', ...handWritten, ...body, ''].join('\n');
  writeFileSync(EXTRA, out, 'utf8');
  console.log(`\nWrote ${body.length} forms to ${EXTRA}`);
  if (handWritten.length > 0) console.log(`  (${handWritten.length} hand-written entries kept)`);
}
