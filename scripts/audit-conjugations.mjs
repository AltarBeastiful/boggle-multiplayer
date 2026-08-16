#!/usr/bin/env node
/**
 * Are the conjugations there? Measured, and repaired.
 *
 *   node scripts/audit-conjugations.mjs [--verbs] [--write]
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
 * By default **only verbs the game already accepts are completed**, which makes
 * the repair safe to apply unattended: it adds no vocabulary, takes no view on
 * what belongs in a family game, and cannot let in a word whose infinitive was
 * deliberately left out. It only finishes sentences the dictionary had already
 * started.
 *
 * `--verbs` also adds the verbs missing outright, and there the question is
 * which ones "make sense in French". Wiktionary conjugates 24,281 verbs the
 * game does not have, and taking them all would add 772,000 words, nearly
 * tripling the dictionary with `encyclopédier`, `plager`, `idéer`,
 * `concupiscer`: real entries, and nonce coinages all the same. Every grid
 * would fill with words nobody could be expected to know, which is a worse
 * failure than the one being fixed.
 *
 * The test used instead is **attestation in a corpus**: does the verb actually
 * occur in French films and books, per Lexique 3.83? That is what "makes sense
 * in French" means operationally, and it cuts 24,281 candidates to 804:
 * `zapper`, `réécrire`, `rembobiner`, `menotter`, `grésiller`, `crasher`.
 *
 * With --write the missing forms are merged into server/data/extra-words.txt.
 */

import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGunzip } from 'node:zlib';

import { normalizeWord } from '@boggle/shared';

import { gameDictionary, gameSpellings } from './game-dictionary.mjs';

/**
 * Bumped by hand when what goes into the file changes: a different source, a
 * different rule about what is admitted. The generated file carries it, along
 * with a checksum of its own contents, so a copy found anywhere can say what it
 * is and whether it is intact.
 */
const LEXICON_VERSION = '1.0.0';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WIKTIONARY = resolve(root, '.work', 'fr-extract.jsonl.gz');
const LEXIQUE = resolve(root, '.work', 'Lexique383.tsv');
const EXTRA = resolve(root, 'server', 'data', 'extra-words.txt');
const write = process.argv.includes('--write');
const withVerbs = process.argv.includes('--verbs');

if (!existsSync(WIKTIONARY)) {
  console.log(`Wiktionary extract missing (${WIKTIONARY}); run scripts/build-definitions.mjs first.`);
  process.exit(1);
}
if (withVerbs && !existsSync(LEXIQUE)) {
  console.log(`Lexique missing (${LEXIQUE}); run scripts/build-definitions.mjs first.`);
  process.exit(1);
}

/**
 * Verb infinitives that occur in a real French corpus, with how often, per
 * Lexique 3.83 (film subtitles and books). This is the whole of what `--verbs`
 * means by "makes sense in French": not an opinion about the word, a record of
 * somebody having used it.
 */
function attestedVerbs() {
  const verbs = new Map();
  if (!withVerbs) return verbs;
  const lines = readFileSync(LEXIQUE, 'utf8').split('\n');
  const columns = lines[0].split('\t');
  const [lemma, category, films, books] = ['lemme', 'cgram', 'freqfilms2', 'freqlivres'].map((name) =>
    columns.indexOf(name),
  );
  for (let index = 1; index < lines.length; index++) {
    const fields = lines[index].split('\t');
    if (fields.length < 11 || fields[category] !== 'VER') continue;
    const frequency = (Number.parseFloat(fields[films]) || 0) + (Number.parseFloat(fields[books]) || 0);
    if (frequency > (verbs.get(fields[lemma]) ?? -1)) verbs.set(fields[lemma], frequency);
  }
  return verbs;
}

const dictionary = gameDictionary();
/** Spellings as written, which is what the extra-words file holds. */
const spellings = new Set(gameSpellings());
console.log(`Game dictionary: ${dictionary.size} playable forms\n`);

/**
 * The modern French alphabet, and nothing else.
 *
 * `\p{L}` is too generous here. Wiktionary carries older orthography under the
 * same French heading (`aboutißẽt`), and the eszett uppercases to SS, so
 * normalising that form yields ABOUTISSET: a word that looks entirely real,
 * is entirely traceable on a grid, and does not exist. One is enough to make
 * the dictionary worse than the hole it was filling.
 */
const FRENCH = /^[a-zàâäçéèêëîïôöùûüÿœ]+$/;

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
      ![...(entry.raw_tags ?? []), ...(sense.raw_tags ?? [])].some((label) => OBSOLETE_LABELS.test(label)),
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

/** A word the game could accept at all: three letters, French, no capital. */
const playable = (word) => {
  if (typeof word !== 'string' || !FRENCH.test(word)) return null;
  const normalized = normalizeWord(word);
  return normalized.length >= 3 ? normalized : null;
};

/**
 * A pronominal verb is named with its pronoun (`s’enfuir`, `se souvenir`)
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
/** Infinitives with no living, printable sense left. */
const labelledLemmas = new Set();
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
      forms++;
    }
  }
}

// A form kept by one sense and rejected by another stays: it is standard in at
// least one of its readings, which is enough to be worth a point.
console.log(`Wiktionary: ${forms} verb forms across ${families.size} infinitives`);
console.log(`  ${rejected.size} forms set aside as archaic, regional, slang or joke\n`);

const attested = attestedVerbs();
if (withVerbs) console.log(`Lexique: ${attested.size} verb infinitives attested in a corpus\n`);

let knownVerbs = 0;
let coveredForms = 0;
/** Conjugations of verbs the game already had. */
const completions = new Set();
/** Verbs it did not have at all, and their conjugations. */
const newVerbs = new Set();
const holes = [];
const admitted = [];
let unattested = 0;
let labelledOut = 0;

for (const [lemma, family] of families) {
  const normalizedLemma = playable(lemma);
  if (!normalizedLemma) continue;

  const isKnown = dictionary.has(normalizedLemma);
  let target = null;

  if (isKnown) {
    // Completing what the dictionary already knows: no judgement required.
    knownVerbs++;
    target = completions;
  } else if (withVerbs) {
    /*
     * Adding a verb outright does require judgement, and these two lines are
     * all of it: somebody has used the word in print, and Wiktionary does not
     * call it archaic, regional or slang. Everything else Wiktionary conjugates
     * (twenty thousand verbs, three quarters of a million forms) stays out.
     */
    const frequency = attested.get(lemma);
    if (frequency === undefined) {
      unattested++;
      continue;
    }
    if (labelledLemmas.has(lemma)) {
      labelledOut++;
      continue;
    }
    target = newVerbs;
    newVerbs.add(lemma);
    admitted.push({ lemma, frequency, forms: family.size });
  } else {
    continue;
  }

  const missing = [];
  for (const form of family) {
    const normalized = playable(form);
    if (!normalized) continue;
    if (dictionary.has(normalized)) {
      if (isKnown) coveredForms++;
    } else {
      missing.push(form);
      target.add(form);
    }
  }
  if (isKnown && missing.length > 0) holes.push({ lemma, missing: missing.length, of: family.size });
}

const total = coveredForms + completions.size;
console.log('== Verbs the game already accepts ==');
console.log(`  infinitives            ${knownVerbs}`);
console.log(`  their forms            ${total}`);
console.log(`  accepted               ${coveredForms} (${((100 * coveredForms) / total).toFixed(1)} %)`);
console.log(`  refused                ${completions.size} (${((100 * completions.size) / total).toFixed(1)} %)`);
console.log(`  verbs with a hole      ${holes.length} of ${knownVerbs}`);

holes.sort((a, b) => b.missing - a.missing);
console.log('\n-- the worst holes --');
for (const hole of holes.slice(0, 12)) {
  console.log(`  ${hole.lemma.padEnd(20)} ${hole.missing} of ${hole.of} forms refused`);
}

if (withVerbs) {
  console.log('\n== Verbs the game did not have at all ==');
  console.log(`  conjugated by Wiktionary   ${unattested + labelledOut + admitted.length}`);
  console.log(`  never used in the corpus   ${unattested} (left out)`);
  console.log(`  obsolete or vulgar         ${labelledOut} (left out)`);
  console.log(`  admitted                   ${admitted.length} verbs, ${newVerbs.size} words with their forms`);

  admitted.sort((a, b) => b.frequency - a.frequency);
  console.log('\n-- the most used of them --');
  console.log(`  ${admitted.slice(0, 30).map((v) => v.lemma).join(' ')}`);
}

const additions = new Set([...completions, ...newVerbs]);
console.log(`\n-- a sample of what is refused --\n  ${[...completions].sort().slice(0, 16).join(' ')}`);

if (!write) {
  console.log(
    `\nRun again with --write${withVerbs ? ' --verbs' : ''} to add these to server/data/extra-words.txt.`,
  );
} else {
  const fresh = (words) =>
    [...words].filter((word) => !spellings.has(word)).sort((a, b) => a.localeCompare(b, 'fr'));
  const conjugations = fresh(completions);
  const verbs = fresh(newVerbs);

  // Anything hand-written in the file is kept: only the generated blocks are
  // replaced, and a word already present is never written twice.
  const previous = existsSync(EXTRA) ? readFileSync(EXTRA, 'utf8') : '';
  const handWritten = previous
    .split('\n')
    .filter((line) => line.trim().length > 0 && !line.startsWith('#'))
    .filter((word) => !additions.has(word.trim()));

  const blocks = [];
  if (conjugations.length > 0) {
    blocks.push(
      '# --- 1. conjugations of verbs the dictionary already had ------------------',
      `#     ${conjugations.length} forms. It held \`grader\` but not \`gradera\`, \`nourrir\` but none`,
      '#     of its future. No new vocabulary: every one is a form of a known verb.',
      '',
      ...conjugations,
      '',
    );
  }
  if (verbs.length > 0) {
    blocks.push(
      '# --- 2. verbs it lacked outright, with their conjugations -----------------',
      `#     ${admitted.length} infinitives and their forms. Admitted only if a French corpus`,
      '#     has actually met the verb (Lexique 3.83) and Wiktionary does not call it',
      '#     archaic, regional or slang. The other 20,870 verbs Wiktionary conjugates',
      '#     would have added some 772,000 words, most of them nonce coinages.',
      '',
      ...verbs,
      '',
    );
  }
  if (handWritten.length > 0) {
    blocks.push('# --- added by hand --------------------------------------------------------', '', ...handWritten, '');
  }

  const body = blocks.join('\n');
  const checksum = createHash('sha256').update(body).digest('hex').slice(0, 16);
  const header = [
    '# Boggle multijoueur : complément du dictionnaire français',
    '#',
    `# version   ${LEXICON_VERSION}`,
    `# generated ${new Date().toISOString().slice(0, 10)} by scripts/audit-conjugations.mjs`,
    `# words     ${conjugations.length + verbs.length + handWritten.length}`,
    `# sha256    ${checksum}`,
    '#',
    '# Sources, both CC BY-SA 4.0, see LICENCE-DEFINITIONS.md:',
    '#   French Wiktionary, via the wiktextract extraction at kaikki.org',
    '#   Lexique 3.83, for which verbs a French corpus has actually met',
    '#',
    '# One word per line. Blank lines and lines starting with # are ignored;',
    '# accents and case do not matter. Read when the server starts.',
    '#',
    '# Regenerate from scratch:',
    `#   rm server/data/extra-words.txt && npm run audit:conj -- --write${withVerbs ? ' --verbs' : ''}`,
    '#   node scripts/build-definitions.mjs   # or the new words have no definition',
    '',
  ].join('\n');

  writeFileSync(EXTRA, header + body, 'utf8');
  console.log(`\nWrote ${conjugations.length + verbs.length} words to ${EXTRA}`);
  console.log(`  version ${LEXICON_VERSION}, sha256 ${checksum}`);
  if (handWritten.length > 0) console.log(`  (${handWritten.length} hand-written entries kept)`);
}
