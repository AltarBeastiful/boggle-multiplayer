#!/usr/bin/env node
/**
 * Builds `server/data/extra-words.txt`, everything the base word list lacks.
 *
 *   node scripts/build-lexicon.mjs [--write]
 *
 * The base list is `an-array-of-french-words`, derived from the Letterpress
 * word lists and archived in 2019. It is a word list for a game, not a lexicon,
 * and players keep finding the seams: `grader` accepted and `gradera` refused,
 * `orque` accepted and `orc` refused. This script fills them from sources that
 * are lexicons, in four blocks, each computed against everything before it.
 *
 * **1. Grammalecte**, the French orthographic dictionary behind LibreOffice
 * and Firefox (MPL 2.0, "classique" v7.5, shipped in the `dictionary-fr`
 * package). Human-curated and still maintained, which is exactly what the base
 * list is not: it has `orc`, `blog`, `tofu`, `selfie`, `covoiturage`. Its
 * Hunspell affixes are expanded to every inflected form, minus two families of
 * flag. The SI unit prefixes (`U.`) would multiply every unit symbol by
 * nineteen and produce `zsr`, `dcal`, `ncd`: combinatorially generated, never
 * written by anyone. The elision prefixes produce `d’`, `l’`, `qu’` forms,
 * which cannot be traced on a grid anyway.
 *
 * **2. The verbs neither source has**, conjugated by Wiktionary. Taking all of
 * them would add 772,000 words, nearly tripling the dictionary with
 * `encyclopédier` and `concupiscer`: real entries, and nonce coinages all the
 * same. The test is attestation in a corpus, per Lexique 3.83, which is what
 * "does it make sense in French" means once a program has to decide it.
 *
 * **3. Words added by hand**, for what no source has. Anything in the file
 * outside the generated blocks is kept, and dropped only once a source covers
 * it, so this block shrinks by itself as the lexicons catch up.
 *
 * **4. The conjugations, last**, because it is the one rule that has to see
 * the finished dictionary: every verb the game accepts, from any of the three
 * blocks above, gets the forms Wiktionary gives it. That is the `gradera` fix,
 * and running it last is what stops a verb arriving in block 1 or 3 without
 * its tenses.
 *
 * Both Wiktionary passes filter hard, because Wiktionary describes French
 * rather than prescribing it: see REJECTED_TAGS below.
 *
 * With --write the result is merged into server/data/extra-words.txt. Running
 * it twice produces the same file, byte for byte.
 */

import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGunzip } from 'node:zlib';

import { buildDictionary, normalizeWord } from '@boggle/shared';

import { baseSpellings, wordAdjustments } from './game-dictionary.mjs';
import { FRENCH_WORD, grammalecteLemmas } from './grammalecte.mjs';

/**
 * Bumped by hand when what goes into the file changes: a different source, a
 * different rule about what is admitted. The generated file carries it, along
 * with a checksum of its own contents, so a copy found anywhere can say what it
 * is and whether it is intact.
 */
const LEXICON_VERSION = '2.0.0';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WIKTIONARY = resolve(root, '.work', 'fr-extract.jsonl.gz');
const LEXIQUE = resolve(root, '.work', 'Lexique383.tsv');
const WORK = resolve(root, '.work');
const EXTRA = resolve(root, 'server', 'data', 'extra-words.txt');
const CURATED = resolve(root, 'server', 'data', 'grammalecte-words.txt');
const write = process.argv.includes('--write');

if (!existsSync(WIKTIONARY) || !existsSync(LEXIQUE)) {
  console.log(`Sources missing in ${WORK}; run scripts/build-definitions.mjs first.`);
  process.exit(1);
}

/**
 * The modern French alphabet, and nothing else.
 *
 * `\p{L}` is too generous here. Wiktionary carries older orthography under the
 * same French heading (`aboutißẽt`), and the eszett uppercases to SS, so
 * normalising that form yields ABOUTISSET: a word that looks entirely real,
 * is entirely traceable on a grid, and does not exist. One is enough to make
 * the dictionary worse than the hole it was filling.
 *
 * It is also what keeps Grammalecte's proper nouns, abbreviations with dots
 * and elided forms out: none of them is all lower-case letters. Shared with
 * `grammalecte.mjs`, which applies it to the other source.
 */
const FRENCH = FRENCH_WORD;

/** A word the game could accept at all: three letters, French, no capital. */
const playable = (word) => {
  if (typeof word !== 'string' || !FRENCH.test(word)) return null;
  const normalized = normalizeWord(word);
  return normalized.length >= 3 ? normalized : null;
};

// ---------------------------------------------------------------------------
// The file as it stands

/**
 * The words in the file that this script did not put there.
 *
 * The generated blocks are marked, so anything outside them was written by
 * hand. They are read before anything is computed and never used as input to
 * a generator, which is what lets the hand block be pruned: a word is dropped
 * from it only once a source has been shown to cover it.
 */
function handPicked() {
  if (!existsSync(EXTRA)) return [];
  let generated = false;
  const words = [];
  for (const line of readFileSync(EXTRA, 'utf8').split('\n')) {
    const marker = /^# --- ([0-9])\. (.+?) -/.exec(line);
    if (marker) generated = !/by hand/.test(marker[2]);
    else if (line.startsWith('#')) continue;
    else if (!generated && line.trim().length > 0) words.push(line.trim());
  }
  return words;
}

const hand = handPicked();
const excluded = wordAdjustments('excluded-words.txt');

/** Everything admitted so far, as spellings, in block order. */
const admitted = [...baseSpellings()];
/** The same, normalised, which is what "does the game know this word" means. */
let known = buildDictionary(admitted, { exclude: excluded.length > 0 ? excluded : undefined });

/** Adds a block's words to the running dictionary, and returns them sorted. */
function admit(words) {
  const fresh = [...new Set(words)].filter((word) => {
    const normalized = playable(word);
    return normalized !== null && !known.has(normalized);
  });
  admitted.push(...fresh);
  known = buildDictionary(admitted, { exclude: excluded.length > 0 ? excluded : undefined });
  return fresh.sort((a, b) => a.localeCompare(b, 'fr'));
}

console.log(`Base list: ${known.size} playable forms`);

// ---------------------------------------------------------------------------
// Block 1: Grammalecte

const grammalecte = await grammalecteLemmas();
console.log(`\nGrammalecte: ${grammalecte.entries} entries, ${grammalecte.expanded} forms expanded`);
console.log(`  ${grammalecte.lemmas.size} of them lower-case French`);
const blockGrammalecte = admit([...grammalecte.lemmas.keys()]);
console.log(`  ${blockGrammalecte.length} new to the game, dictionary now ${known.size}`);

// ---------------------------------------------------------------------------
// The Wiktionary pass, which both remaining blocks read

/**
 * Wiktionary describes French rather than prescribing it, so a conjugation
 * table is not a list of words a player may use. It also records:
 *
 *   - pre-1835 spelling: `avoit`, `seroit`, `vouloit`
 *   - regional forms: `mangeont`, `sontaient`, `disez`
 *   - contractions and slang: `ché`, `sra`, `tsé`
 *   - forms coined as jokes: `boivez`, `faisez`, `mourirai`
 *   - children's regularisations, entered as such: `fontsaient` is glossed
 *     "régularisation de faisaient à partir du présent font"
 *
 * All real entries, none of them a word to be refused a point for not knowing.
 * `rare` is deliberately not here, since `gésir` is rare and entirely correct,
 * and neither are the 1990 reform spellings, which are official.
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

/**
 * Whether an infinitive is one to add, which is a different question from
 * whether a form is standard, and needs a different rule.
 *
 * Tags sit on senses, not on words. `cibler` carries `dated` on its military
 * sense and nothing on its current one; `piger` is `obsolete` in one reading
 * and everyday in another. Aggregating a word's tags therefore lets a single
 * old sense condemn a word in daily use, which is how `zapper`, `cibler` and
 * `zoomer` were thrown out of a first attempt. A verb is admitted if **one** of
 * its senses is current: that is what it means for the word to still be alive.
 *
 * Register is not a reason to refuse. `zyeuter` and `chourer` are familiar and
 * slang and entirely French. What is refused is `vulgar` and `offensive`, and
 * that is a decision about the source list rather than about the language: it
 * has no `encule`, no `niquer`, no `pede`, so somebody already made this call
 * and re-adding them would quietly overrule it in a game meant for a family.
 *
 * The two conditions take opposite quantifiers, and getting that wrong put
 * `enculer` at the top of the list. **Any** current sense keeps a word alive,
 * one live reading is enough. But **no** sense may be vulgar: a word with one
 * coarse meaning is a coarse word, whatever else it also means.
 */
const OBSOLETE_TAGS = new Set(['obsolete', 'archaic', 'dated']);
const UNPRINTABLE_TAGS = new Set(['vulgar', 'offensive']);
const OBSOLETE_LABELS = /archaïque|désuet|vieilli|ancienne orthographe/i;

function livingVerb(entry) {
  const senses = (entry.senses ?? []).filter((sense) => (sense.glosses ?? []).length > 0);
  if (senses.length === 0) return false;

  const tagsOf = (sense) => [...(entry.tags ?? []), ...(sense.tags ?? [])];
  if (senses.some((sense) => tagsOf(sense).some((tag) => UNPRINTABLE_TAGS.has(tag)))) return false;

  return senses.some(
    (sense) =>
      !tagsOf(sense).some((tag) => OBSOLETE_TAGS.has(tag)) &&
      ![...(entry.raw_tags ?? []), ...(sense.raw_tags ?? [])].some((label) =>
        OBSOLETE_LABELS.test(label),
      ),
  );
}

function standardForm(entry, sense) {
  for (const tag of [...(entry.tags ?? []), ...(sense.tags ?? [])]) {
    if (REJECTED_TAGS.has(tag)) return false;
  }
  for (const label of [...(entry.raw_tags ?? []), ...(sense.raw_tags ?? [])]) {
    if (REJECTED_LABELS.test(label)) return false;
  }
  return !REJECTED_GLOSS.test(sense.glosses?.[0] ?? '');
}

/**
 * A pronominal verb is named with its pronoun (`s’enfuir`, `se souvenir`)
 * and the dictionary holds the bare infinitive. Without stripping it the
 * lookup fails on the apostrophe and every pronominal verb in French is
 * skipped in silence, which is how `enfuira` stayed missing after a first pass
 * that thought it had finished the job.
 */
const bareInfinitive = (lemma) =>
  typeof lemma === 'string' ? lemma.replace(/^s['’]|^se\s+/i, '').trim() : '';

/** lemma -> the forms Wiktionary gives it. */
const families = new Map();
/** Forms left out as not being standard modern French. */
const rejected = new Set();
/** Infinitives with no living, printable sense left. */
const labelledLemmas = new Set();
let wiktionaryForms = 0;

const lines = createInterface({
  input: createReadStream(WIKTIONARY).pipe(createGunzip()),
  crlfDelay: Infinity,
});

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

  const formSenses = (entry.senses ?? []).filter((sense) => sense.tags?.includes('form-of'));
  /*
   * No form-of sense: this is the infinitive's own entry, and the only place
   * its labels live. A verb Wiktionary calls archaic or regional is not one to
   * add, however often a corpus happens to have met it.
   */
  if (formSenses.length === 0) {
    if (!livingVerb(entry)) labelledLemmas.add(entry.word);
    continue;
  }

  for (const sense of formSenses) {
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
      wiktionaryForms++;
    }
  }
}

// A form kept by one sense and rejected by another stays: it is standard in at
// least one of its readings, which is enough to be worth a point.
console.log(`\nWiktionary: ${wiktionaryForms} verb forms across ${families.size} infinitives`);
console.log(`  ${rejected.size} forms set aside as archaic, regional, slang or joke`);

// ---------------------------------------------------------------------------
// Block 2: the verbs no source has

/**
 * Verb infinitives that occur in a real French corpus, with how often, per
 * Lexique 3.83 (film subtitles and books). This is the whole of what block 2
 * means by "makes sense in French": not an opinion about the word, a record of
 * somebody having used it.
 */
function attestedVerbs() {
  const verbs = new Map();
  const rows = readFileSync(LEXIQUE, 'utf8').split('\n');
  const columns = rows[0].split('\t');
  const [lemma, category, films, books] = ['lemme', 'cgram', 'freqfilms2', 'freqlivres'].map(
    (name) => columns.indexOf(name),
  );
  for (let index = 1; index < rows.length; index++) {
    const fields = rows[index].split('\t');
    if (fields.length < 11 || fields[category] !== 'VER') continue;
    const frequency =
      (Number.parseFloat(fields[films]) || 0) + (Number.parseFloat(fields[books]) || 0);
    if (frequency > (verbs.get(fields[lemma]) ?? -1)) verbs.set(fields[lemma], frequency);
  }
  return verbs;
}

const attested = attestedVerbs();
console.log(`\nLexique: ${attested.size} verb infinitives attested in a corpus`);

const newVerbs = [];
const newVerbLemmas = [];
let unattested = 0;
let labelledOut = 0;
for (const [lemma, family] of families) {
  const normalized = playable(lemma);
  if (!normalized || known.has(normalized)) continue;
  if (!attested.has(lemma)) {
    unattested++;
    continue;
  }
  if (labelledLemmas.has(lemma)) {
    labelledOut++;
    continue;
  }
  newVerbLemmas.push(lemma);
  newVerbs.push(lemma, ...family);
}
const blockVerbs = admit(newVerbs);
console.log(`  ${unattested} verbs never met in the corpus, left out`);
console.log(`  ${labelledOut} obsolete or coarse, left out`);
console.log(
  `  ${newVerbLemmas.length} admitted, ${blockVerbs.length} new words, dictionary now ${known.size}`,
);

// ---------------------------------------------------------------------------
// Block 3: what was added by hand

const blockHand = admit(hand);
const stale = hand.length - blockHand.length;
console.log(`\nBy hand: ${blockHand.length} words kept, dictionary now ${known.size}`);
if (stale > 0) console.log(`  ${stale} dropped, a source now covers them`);

// ---------------------------------------------------------------------------
// Block 4: the conjugations, against the finished dictionary

const completions = [];
const holes = [];
let knownVerbs = 0;
let coveredForms = 0;
for (const [lemma, family] of families) {
  const normalized = playable(lemma);
  if (!normalized || !known.has(normalized)) continue;
  knownVerbs++;
  const missing = [];
  for (const form of family) {
    const normalizedForm = playable(form);
    if (!normalizedForm) continue;
    if (known.has(normalizedForm)) coveredForms++;
    else missing.push(form);
  }
  if (missing.length > 0) holes.push({ lemma, missing: missing.length, of: family.size });
  completions.push(...missing);
}
const blockConjugations = admit(completions);
const total = coveredForms + blockConjugations.length;
console.log(`\nConjugations: ${knownVerbs} verbs the dictionary accepts, ${total} forms`);
console.log(
  `  ${coveredForms} already there, ${blockConjugations.length} added, dictionary now ${known.size}`,
);
holes.sort((a, b) => b.missing - a.missing);
console.log(`  worst holes: ${holes.slice(0, 8).map((h) => `${h.lemma} (${h.missing})`).join(', ')}`);

// ---------------------------------------------------------------------------
// The files
//
// Two of them, because the sources are under two licences that do not mix.
// Grammalecte is MPL 2.0, which is copyleft per file; Wiktionary and Lexique
// are CC BY-SA 4.0, which is copyleft per work. Keeping each source in its own
// file lets each keep its own licence, and says which word came from where.

/** Renders one block of the file: a marked heading, the reason, the words. */
function block(title, why, words) {
  return [
    `# --- ${title} ${'-'.repeat(Math.max(3, 74 - title.length))}`,
    ...why.map((line) => `#     ${line}`),
    '',
    ...words,
    '',
  ];
}

/** Header, body, checksum of the body, written to disk. */
function writeLexicon(path, lines, describe) {
  const body = lines.join('\n');
  const checksum = createHash('sha256').update(body).digest('hex').slice(0, 16);
  const header = [
    ...describe(checksum),
    '#',
    '# One word per line. Blank lines and lines starting with # are ignored;',
    '# accents and case do not matter. Read when the server starts.',
    '#',
    '# Regenerate:',
    '#   npm run lexicon -- --write',
    '#   node scripts/build-definitions.mjs   # or the new words have no definition',
    '',
  ].join('\n');
  writeFileSync(path, header + body, 'utf8');
  return checksum;
}

const curatedBlock = block(
  '1. Grammalecte, expanded from its Hunspell affixes',
  [
    `${blockGrammalecte.length} words. The orthographic dictionary behind LibreOffice and`,
    'Firefox, human-curated and still maintained, which the base word list',
    'stopped being in 2019: this is where `orc`, `blog`, `tofu`, `selfie` and',
    '`covoiturage` come from. The SI unit prefixes are the one thing dropped,',
    'since they multiply every unit symbol by nineteen and nobody writes `zsr`.',
  ],
  blockGrammalecte,
);

const extraBlocks = [
  ...block(
    '1. verbs no source had, with their conjugations',
    [
      `${newVerbLemmas.length} infinitives and their forms, from Wiktionary. Admitted only if a`,
      'French corpus has met the verb (Lexique 3.83) and Wiktionary does not call',
      `it archaic, regional or slang. The other ${unattested} verbs it conjugates would`,
      'have added some 772,000 words, most of them nonce coinages.',
    ],
    blockVerbs,
  ),
  ...block(
    '2. added by hand',
    [
      `${blockHand.length} words no source has yet. Add another here: the script keeps`,
      'whatever it finds outside the generated blocks, and drops a word only',
      'once a source covers it, so this block shrinks as the lexicons catch up.',
    ],
    blockHand,
  ),
  ...block(
    '3. conjugations completing every verb above',
    [
      `${blockConjugations.length} forms, from Wiktionary. Computed last, so it sees the finished`,
      'dictionary: it held `grader` but not `gradera`, `nourrir` but none of its',
      'future. No new vocabulary, every one is a form of a verb already accepted.',
    ],
    blockConjugations,
  ),
];

const extraCount = blockVerbs.length + blockHand.length + blockConjugations.length;
const count = blockGrammalecte.length + extraCount;
console.log(`\nTotal: ${count} words added to a ${known.size}-word dictionary`);

if (!write) {
  console.log('\nRun again with --write to put them in server/data/.');
} else {
  const curatedSum = writeLexicon(CURATED, curatedBlock, (checksum) => [
    '# Boggle multijoueur : le dictionnaire Grammalecte, mis à plat',
    '#',
    `# version   ${LEXICON_VERSION}`,
    `# generated ${new Date().toISOString().slice(0, 10)} by scripts/build-lexicon.mjs`,
    `# words     ${blockGrammalecte.length}`,
    `# sha256    ${checksum}`,
    '#',
    '# Source: Dictionnaire orthographique français « classique », by Olivier R.',
    '#   https://grammalecte.net/ , shipped in the npm package dictionary-fr.',
    '#   Licence MPL 2.0, which this file keeps: see LICENCE-DEFINITIONS.md.',
    '#   Only the words the base list lacked are here, with the SI unit',
    '#   prefixes dropped. Nothing else is changed and nothing is rewritten.',
  ]);
  const extraSum = writeLexicon(EXTRA, extraBlocks, (checksum) => [
    '# Boggle multijoueur : complément du dictionnaire français',
    '#',
    `# version   ${LEXICON_VERSION}`,
    `# generated ${new Date().toISOString().slice(0, 10)} by scripts/build-lexicon.mjs`,
    `# words     ${extraCount}`,
    `# sha256    ${checksum}`,
    '#',
    '# Sources, both CC BY-SA 4.0, see LICENCE-DEFINITIONS.md:',
    '#   French Wiktionary, via the wiktextract extraction at kaikki.org',
    '#   Lexique 3.83, for which verbs a French corpus has actually met',
    '#',
    '# Grammalecte lives in grammalecte-words.txt, under its own licence.',
  ]);

  console.log(`\nWrote ${blockGrammalecte.length} words to ${CURATED} (sha256 ${curatedSum})`);
  console.log(`Wrote ${extraCount} words to ${EXTRA} (sha256 ${extraSum})`);
  console.log(`  version ${LEXICON_VERSION}`);
}
