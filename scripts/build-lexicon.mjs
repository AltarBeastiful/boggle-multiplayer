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
 * and Firefox (MPL 2.0, "classique" v7.7, published by grammalecte.net).
 * Human-curated and still maintained, which is exactly what the base list is
 * not: it has `blog`, `tofu`, `selfie`, `covoiturage`, `pixel`. Its
 * Hunspell affixes are expanded to every inflected form, minus two families of
 * flag. The SI unit prefixes (`U.`) would multiply every unit symbol by
 * nineteen and produce `zsr`, `dcal`, `ncd`: combinatorially generated, never
 * written by anyone. The elision prefixes produce `d’`, `l’`, `qu’` forms,
 * which cannot be traced on a grid anyway. Two more flags drop the entry
 * itself: the ones Grammalecte's own affix file puts on a unit symbol (`ppm`,
 * `kpc`) and on an elided stem it will never suggest (`quelqu`, `presqu`).
 *
 * And a word has a vowel, whichever source it comes from. Grammalecte holds
 * `tss`, `pff`, `hmm` and `zzz` as interjections beside `zut` and `ouf`, and
 * nothing in the data separates a noise from a word except the letters. See
 * `playable`, which every generated block passes through, and the matching
 * rule that strikes the base list's own.
 *
 * **2. The verbs neither source has**, conjugated by Wiktionary. Taking all of
 * them would add 772,000 words, nearly tripling the dictionary with
 * `encyclopédier` and `concupiscer`: real entries, and nonce coinages all the
 * same. The test is attestation in a corpus, per Lexique 3.83, which is what
 * "does it make sense in French" means once a program has to decide it.
 *
 * **3. The rest of the vocabulary neither source has**: nouns, adjectives,
 * adverbs and interjections, from Wiktionary, under the same corpus test. This
 * is where `ribot` comes from, the pestle of a butter churn, whose whole family
 * the game already knew (`ribote`, `riboter`, `riboteur`) except the word
 * itself. Wiktionary files proper nouns under a part of speech of their own and
 * they are refused there, on top of being refused for their capital letter.
 *
 * This is also where `mique` was refused, and the reason it was is why
 * `corpora.mjs` exists. Lexique 3.83 alone decided attestation, so a word one
 * corpus had never met had no appeal: four decide it now, and `mique`,
 * `panisse`, `déchèterie` and `webmail` come in as a class rather than as a
 * list. The two rules alongside it were wrong in the same shape and are fixed
 * with it: register refused a noun while the file said in so many words that it
 * does not refuse a verb, and `variante de` was read as a cross-reference worth
 * nothing, which is how `clef` would have been refused had the base list not
 * happened to hold it.
 *
 * **4. Words added by hand**, for what no source has. Anything in the file
 * outside the generated blocks is kept, and dropped only once a source covers
 * it, so this block shrinks by itself as the lexicons catch up.
 *
 * **5. The inflections, last**, because it is the one rule that has to see the
 * finished dictionary: every word the game accepts, from any of the four blocks
 * above, gets the forms Wiktionary gives it. Conjugations for the verbs, which
 * is the `gradera` fix, and plurals and feminines for the rest, without which
 * block 3 would hand the game `ribot` and refuse `ribots`. Running it last is
 * what stops a word arriving in an earlier block without its forms.
 *
 * Both Wiktionary passes filter hard, because Wiktionary describes French
 * rather than prescribing it: see UNPLAYABLE_TAGS below, and the separate,
 * stricter rule for inflected forms next to it.
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

import { attestation, CORPUS_ALONE_FROM, GLAFF_VERSION } from './corpora.mjs';
import { baseSpellings, wordAdjustments } from './game-dictionary.mjs';
import { FRENCH_WORD, GRAMMALECTE_VERSION, grammalecteLemmas } from './grammalecte.mjs';

/**
 * Bumped by hand when what goes into the file changes: a different source, a
 * different rule about what is admitted. The generated file carries it, along
 * with a checksum of its own contents, so a copy found anywhere can say what it
 * is and whether it is intact.
 */
const LEXICON_VERSION = '4.0.0';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WIKTIONARY = resolve(root, '.work', 'fr-extract.jsonl.gz');
const LEXIQUE = resolve(root, '.work', 'Lexique383.tsv');
const WORK = resolve(root, '.work');
const EXTRA = resolve(root, 'server', 'data', 'extra-words.txt');
const EXCLUDED = resolve(root, 'server', 'data', 'excluded-words.txt');
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

/**
 * A word has a vowel.
 *
 * A French word is at least one syllable, and a string without a vowel is a
 * noise written down: `tss`, `pff`, `hmm`, `kss`, `zzz`, `grrr`. Every source
 * has some, because every source records what people write, and Grammalecte
 * files them as interjections next to `zut` and `ouf`, which are words; the
 * part of speech does not separate them and the letters do. The same test
 * catches what the sources hold for spell-checking rather than for reading:
 * `http`, `www`, `svp`, `ppm`, `kpc`, and the abbreviations `frs` and `pcs`.
 *
 * On the normalised form, so `œ` and the accented vowels count as what they
 * are. The one real word it costs is `crwth`, the Welsh fiddle.
 */
const VOWEL = /[AEIOUY]/;

/** A word the game could accept at all: three letters, a vowel, French, no capital. */
const playable = (word) => {
  if (typeof word !== 'string' || !FRENCH.test(word)) return null;
  const normalized = normalizeWord(word);
  return normalized.length >= 3 && VOWEL.test(normalized) ? normalized : null;
};

// ---------------------------------------------------------------------------
// The file as it stands

/**
 * The words in a generated file that this script did not put there.
 *
 * The generated blocks are marked, so anything under a block whose title says
 * `by hand` was written by a person. They are read before anything is computed
 * and never used as input to a generator, which is what lets a hand block be
 * pruned: a word leaves it only once the sources have settled the question it
 * was answering.
 */
function handWritten(path) {
  if (!existsSync(path)) return [];
  let generated = false;
  const words = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    // The number is optional: a block heading is a block heading, and one
    // written before the file grew a second block has none.
    const marker = /^# --- (?:([0-9])\. )?(.+?) -/.exec(line);
    if (marker) generated = !/by hand/.test(marker[2]);
    else if (line.startsWith('#')) continue;
    else if (!generated && line.trim().length > 0) words.push(line.trim());
  }
  return words;
}

const hand = handWritten(EXTRA);

/**
 * Words struck by hand, which is the other half of the hand block above and
 * was missing until somebody reported one.
 *
 * A word the sources lack has had a place to go since `orc` was reported. A
 * word they wrongly supply had none: this file is written from a computation,
 * so a line added to it survived until the next `--write` and no longer. The
 * documented way to put a word back, deleting its line, did not survive either,
 * since the computation simply produced it again. Adding and removing are the
 * same question asked twice and they now have the same answer. `orc` itself is
 * what ended up here: the report that brought Grammalecte in, and the English
 * spelling of a word French writes `orque`.
 *
 * What is struck here is not what the base list made up, which is a rule and
 * is computed below. It is the residue that no rule reaches: a word the
 * sources genuinely hold and a player should not be shown.
 */
const handStruck = handWritten(EXCLUDED);
const excluded = wordAdjustments('excluded-words.txt');

/**
 * Base-list words on trial: struck off as each reference is found to know them.
 *
 * The list is a Letterpress word list archived in 2019 and it has decayed, in
 * ways only visible now that there is something to compare it against. What
 * survives both references untouched is not rare vocabulary, it is `conpresser`
 * and `stratigraphiqu` and `nourrirrai`. Marking rather than collecting keeps
 * this to 300,000 strings instead of the Wiktionary's 5.7 million.
 */
const unvouched = new Set();
/** Normalised form back to the spelling the base list wrote, for the report. */
const baseWords = new Map();
for (const word of baseSpellings()) {
  if (!/^[\p{L}]+$/u.test(word)) continue;
  const normalized = normalizeWord(word);
  if (normalized.length < 3) continue;
  unvouched.add(normalized);
  if (!baseWords.has(normalized)) baseWords.set(normalized, word);
}

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
for (const form of grammalecte.lemmas.keys()) unvouched.delete(normalizeWord(form));
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
 *
 * **A headword and an inflected form are not held to the same rule**, which
 * they were until `branque`, `stup`, `perme`, `carbu`, `cuisto` and `nanard`
 * were found missing together. What refuses a word is below; what refuses a
 * form adds register to it, further down, and the difference is the whole
 * point. `sra` is a familiar contraction of `sera` and is not a form of
 * `être` that a player may claim; `branque` is a familiar noun and is a word.
 * The file already said as much about verbs, where `zyeuter` and `chourer` are
 * admitted with the label on, and then said the opposite about every noun.
 */
const UNPLAYABLE_TAGS = new Set(['archaic', 'obsolete', 'dated', 'nonstandard', 'misspelling']);

/** The same, as Wiktionary's own French labels. */
const UNPLAYABLE_LABELS =
  /archaïque|avant 1835|ancienne orthographe|par plaisanterie|régionalisme|diaéthiques|vallée d’aoste|québec|louisiane|acadie|missouri|wallonie|acadien|désuet|vieilli/i;

/**
 * And as the categories the entry is filed under, which say it when nothing
 * else does.
 *
 * `aurevoir` carries no tag and no label. Its one sense is glossed "Variante
 * orthographique de au revoir" and the entry sits in "Termes non standards en
 * français", which is Wiktionary saying exactly what a tag would have said,
 * in the only place this extraction keeps it. Reading the categories as well
 * costs nothing and closes the shape rather than the word.
 *
 * Only the families that mean "not current standard French" are read.
 * Register ("Termes familiers", "Termes argotiques") and the varieties of
 * France ("français du Bourbonnais", "français d’Auvergne") are deliberately
 * not here: `bredin` and `drac` are French, and refusing them would be
 * refusing `mique` for the same reason one sentence later.
 */
const UNPLAYABLE_CATEGORIES =
  /Termes (non standards|désuets|vieillis|archaïques) en français|français moderne d’avant/i;

/**
 * And as the opening of the definition itself: a pointer to an older spelling.
 *
 * `connoissance` is glossed "Ancienne orthographe de connaissance", `avoit`
 * "Ancienne forme d’avait", `fontsaient` "Régularisation de …". The word each
 * points at is the one in use, and these spellings are not.
 *
 * A plain `Variante de …` is deliberately not here, and used to be. It reads
 * like the same thing and is not: Wiktionary glosses `clef` that way, and
 * `carbonade`, `nanard` and `kiff`, all of them current spellings a player can
 * trace and no dictionary refuses. What made the old rule look right is that
 * the variants it caught were mostly old ones, and those are still caught, by
 * the labels above that say so.
 */
const OLD_SPELLING_GLOSS =
  /^(ancienne (orthographe|graphie|forme)|orthographe (ancienne|d’avant)|écriture ancienne|forme ancienne|graphie ancienne)\b|régularisation/i;

/**
 * What refuses an inflected form: everything above, and register besides.
 *
 * A conjugation table is where Wiktionary files `sra`, `ché` and `tsé`, marked
 * familiar and nothing else, and they normalise to three playable letters. It
 * is also where `alt-of` means what the old rule thought it meant everywhere,
 * a form that is only a pointer at another form.
 */
const UNPLAYABLE_FORM_TAGS = new Set([
  ...UNPLAYABLE_TAGS,
  'colloquial',
  'familiar',
  'slang',
  'informal',
  'alt-of',
  'neuter',
]);
const UNPLAYABLE_FORM_LABELS = new RegExp(
  `${UNPLAYABLE_LABELS.source}|populaire|argot|enfantin`,
  'i',
);
const REJECTED_FORM_GLOSS =
  /^(ancienne|variante|orthographe|écriture|contraction|abréviation|autre (graphie|orthographe)|forme ancienne|graphie ancienne)\b|régularisation/i;

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
 * slang and entirely French. What is refused is `vulgar` and `offensive`, in a
 * game meant for a family. Note what that does and does not reach: it is a
 * rule about what Wiktionary hands over, and Grammalecte is taken whole, so the
 * game has `enculer`, `niquer` and `pédé` from block 1 whatever this says. This
 * decides what the passes below add, not what the dictionary already holds.
 *
 * The two conditions take opposite quantifiers, and getting that wrong put
 * `enculer` at the top of the list. **Any** current sense keeps a word alive,
 * one live reading is enough. But **no** sense may be vulgar: a word with one
 * coarse meaning is a coarse word, whatever else it also means.
 */
/**
 * The parts of speech a word game has any use for. Wiktionary's own `name` is
 * deliberately absent: that is where it files proper nouns, and `Ribot` the
 * family name, `Ève`, `Nice`, `Gestapo` and `Élysée` all sit there while
 * `ribot`, `ève`, `nice`, `gestapo` and `élysée` exist separately as ordinary
 * French words. The capital letter already refuses the first list, since
 * FRENCH_WORD is lower-case only; this refuses the sixty-odd trade names that
 * are written without one, `arte`, `durex`, `epub`, `verdana`.
 *
 * Everything else Wiktionary knows is left out for being untraceable on a
 * grid or not a word: prefixes, suffixes, symbols, proverbs, phrases.
 */
const WORD_POS = new Set(['noun', 'adj', 'adv', 'intj', 'onomatopoeia']);

const OBSOLETE_TAGS = new Set(['obsolete', 'archaic', 'dated']);
const UNPRINTABLE_TAGS = new Set(['vulgar', 'offensive']);
const OBSOLETE_LABELS = /archaïque|désuet|vieilli|ancienne orthographe/i;

/**
 * The handful the tags cannot see.
 *
 * `UNPRINTABLE_TAGS` refuses what Wiktionary itself marks vulgar or offensive,
 * and that is most of it. These are the ones it marks as nothing at all, while
 * spelling out in the definition what the tag would have said: `youtre` is
 * glossed "injure antisémite", `niakoué` "terme raciste", `arbi` and `rabouin`
 * and `polak` and `gretchen` are the same thing without the warning, `zézette`
 * is "ou Pénis".
 *
 * The line is drawn at what the word *is*, not how low it speaks. A slur and a
 * genital vulgarity go; register stays, however coarse, because the file
 * already says so about `zyeuter` and `chourer` and because refusing `breneux`
 * and `stropiat` and `tafanard` would be refusing French. A word with one such
 * meaning goes whatever else it also means, which is the rule `UNPRINTABLE_TAGS`
 * already follows: it costs `lope` its aphid and `rabouin` its devil.
 *
 * Written out rather than guessed at by regex, and each one read: there is no
 * signal in the data to do this by rule, which is the whole reason it is here.
 */
const COARSE = new Set([
  'arbi',
  'gretchen',
  'lope',
  'mentule',
  'niakoué',
  'négrophile',
  'pissou',
  'polak',
  'rabouin',
  'youp',
  'youtre',
  'zézette',
]);

/** The senses that say something, which are the only ones worth judging. */
const glossed = (entry) => (entry.senses ?? []).filter((sense) => (sense.glosses ?? []).length > 0);

/** One sense still in use: not marked archaic, obsolete or dated. */
const current = (entry, sense) =>
  ![...(entry.tags ?? []), ...(sense.tags ?? [])].some((tag) => OBSOLETE_TAGS.has(tag)) &&
  ![...(entry.raw_tags ?? []), ...(sense.raw_tags ?? [])].some((label) => OBSOLETE_LABELS.test(label));

/** No sense of it is coarse, which is a property of the word, not of a sense. */
const printable = (entry, senses) =>
  !senses.some((sense) =>
    [...(entry.tags ?? []), ...(sense.tags ?? [])].some((tag) => UNPRINTABLE_TAGS.has(tag)),
  );

function livingVerb(entry) {
  const senses = glossed(entry);
  if (senses.length === 0 || !printable(entry, senses)) return false;
  return senses.some((sense) => current(entry, sense));
}

/**
 * The same question for a word that is not a verb, with one addition.
 *
 * A verb's labels are read off its infinitive and its forms are judged one by
 * one, so `standardForm` gets its say on every conjugation. A noun has no such
 * second pass: the lemma entry is the only entry there is, and if it is not asked
 * whether the sense is standard then a headword whose entire definition is
 * "ancienne orthographe de connaissance" walks in as vocabulary. So the
 * surviving sense has to be both current and standard, and the same one has to
 * be both: a word kept alive by a modern sense and vouched for by an archaic
 * one is neither.
 */
function livingWord(entry) {
  const senses = glossed(entry);
  if (senses.length === 0 || !printable(entry, senses)) return false;
  return senses.some((sense) => current(entry, sense) && standardWord(entry, sense));
}

/** Whether a headword is standard modern French: register is not asked. */
function standardWord(entry, sense) {
  for (const tag of [...(entry.tags ?? []), ...(sense.tags ?? [])]) {
    if (UNPLAYABLE_TAGS.has(tag)) return false;
  }
  for (const label of [...(entry.raw_tags ?? []), ...(sense.raw_tags ?? [])]) {
    if (UNPLAYABLE_LABELS.test(label)) return false;
  }
  for (const category of [...(entry.categories ?? []), ...(sense.categories ?? [])]) {
    if (UNPLAYABLE_CATEGORIES.test(category)) return false;
  }
  return !OLD_SPELLING_GLOSS.test(sense.glosses?.[0] ?? '');
}

/** The same of an inflected form, where register does decide. */
function standardForm(entry, sense) {
  for (const tag of [...(entry.tags ?? []), ...(sense.tags ?? [])]) {
    if (UNPLAYABLE_FORM_TAGS.has(tag)) return false;
  }
  for (const label of [...(entry.raw_tags ?? []), ...(sense.raw_tags ?? [])]) {
    if (UNPLAYABLE_FORM_LABELS.test(label)) return false;
  }
  return !REJECTED_FORM_GLOSS.test(sense.glosses?.[0] ?? '');
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

/** Infinitive -> the conjugations Wiktionary gives it. */
const families = new Map();
/** Lemma -> the plurals and feminines Wiktionary gives it. */
const inflections = new Map();
/** Nouns, adjectives, adverbs and interjections with a living, standard sense. */
const wordLemmas = new Set();
/**
 * Lemmas Wiktionary quotes from a dated, published source, and how many.
 *
 * The second witness a short word needs. A corpus frequency is attached to a
 * lemma by a machine, so for a short string it can belong to another word
 * entirely; a citation is chosen by an editor to illustrate this headword and
 * prints it inside a sentence, which no homograph's count can fake. Dated,
 * because a reference carrying a year is a published work rather than a
 * sentence somebody made up for the entry.
 */
const citedLemmas = new Map();
const CITATION_YEAR = /\b(1[5-9]\d\d|20[0-2]\d)\b/;
/** Forms left out as not being standard modern French. */
const rejected = new Set();
/** Infinitives with no living, printable sense left. */
const labelledLemmas = new Set();
/** Lemmas Wiktionary marks vulgar or offensive, whatever source holds them. */
const unprintableLemmas = new Set(COARSE);
let wiktionaryForms = 0;
let wiktionaryInflections = 0;

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
  /*
   * Every language the French Wiktionary describes counts here, not just
   * French. A word it files under English or Latin is at least a word
   * somebody wrote; what is being looked for is the base list's own
   * inventions, and those appear nowhere at all.
   */
  if (typeof entry.word === 'string' && entry.word.length >= 3) {
    unvouched.delete(normalizeWord(entry.word));
  }

  if (entry.lang_code !== 'fr') continue;
  const verb = entry.pos === 'verb';
  if (!verb && !WORD_POS.has(entry.pos)) continue;
  if (!playable(entry.word)) continue;

  const formSenses = (entry.senses ?? []).filter((sense) => sense.tags?.includes('form-of'));
  /*
   * No form-of sense: this is the lemma's own entry, and the only place its
   * labels live. A word Wiktionary calls archaic or regional is not one to
   * add, however often a corpus happens to have met it.
   */
  if (formSenses.length === 0) {
    /*
     * Noted whoever holds the word. Blocks 2 and 3 refuse a coarse lemma by
     * never admitting it, but block 5 completes whatever the dictionary
     * already accepts, and Grammalecte is an orthographic dictionary: it has
     * `pédé` and `enculer` because they are spelt that way, and block 1 takes
     * it whole. Without this the last block would look up the feminine of a
     * slur and add it, which is how `pédée` arrived.
     */
    const senses = glossed(entry);
    if (senses.length > 0 && !printable(entry, senses)) unprintableLemmas.add(entry.word);

    // Distinct works, not distinct quotations: four sentences from one book
    // are one source, and `mique` is quoted from five different ones.
    const works = new Set();
    for (const sense of senses) {
      for (const example of sense.examples ?? []) {
        const reference = (example.ref ?? '').trim();
        if (reference.length > 0 && CITATION_YEAR.test(reference)) works.add(reference);
      }
    }
    if (works.size > (citedLemmas.get(entry.word) ?? 0)) citedLemmas.set(entry.word, works.size);

    if (verb) {
      if (!livingVerb(entry)) labelledLemmas.add(entry.word);
    } else if (livingWord(entry)) {
      wordLemmas.add(entry.word);
    }
    continue;
  }

  for (const sense of formSenses) {
    if (!standardForm(entry, sense)) {
      rejected.add(entry.word);
      continue;
    }
    for (const target of sense.form_of ?? []) {
      /*
       * A pronominal verb is named with its pronoun and the dictionary holds
       * the bare infinitive; a plural points at its singular as written.
       */
      const lemma = verb ? bareInfinitive(target?.word) : (target?.word ?? '').trim();
      if (lemma.length === 0) continue;
      const paradigm = verb ? families : inflections;
      let family = paradigm.get(lemma);
      if (!family) paradigm.set(lemma, (family = new Set()));
      family.add(entry.word);
      if (verb) wiktionaryForms++;
      else wiktionaryInflections++;
    }
  }
}

// A form kept by one sense and rejected by another stays: it is standard in at
// least one of its readings, which is enough to be worth a point.
console.log(`\nWiktionary: ${wiktionaryForms} verb forms across ${families.size} infinitives`);
console.log(
  `  ${wiktionaryInflections} plurals and feminines across ${inflections.size} lemmas`,
);
console.log(`  ${wordLemmas.size} nouns, adjectives, adverbs and interjections with a living sense`);
console.log(`  ${rejected.size} forms set aside as archaic, regional, slang or joke`);

// ---------------------------------------------------------------------------
// Block 2: the verbs no source has

/*
 * Whether a real French corpus has met the word. This is the whole of what
 * blocks 2 and 3 mean by "makes sense in French": not an opinion about the
 * word, a record of somebody having used it. Four corpora answer, any one of
 * them is enough, and `scripts/corpora.mjs` says why there are four.
 *
 * It is a threshold of existence rather than a measure of currency, and the
 * corpora lower-case proper nouns, so the `ève` that scores well is mostly the
 * first woman rather than the groove in a plank. Nothing enters on that number
 * alone, only words Wiktionary has already vouched for as ordinary French do,
 * so the confusion is harmless.
 */
const attested = await attestation();
console.log('');
for (const line of attested.describe()) console.log(line);

const newVerbs = [];
const newVerbLemmas = [];
let unattested = 0;
let labelledOut = 0;
for (const [lemma, family] of families) {
  const normalized = playable(lemma);
  if (!normalized || known.has(normalized)) continue;
  if (!attested.verb(lemma)) {
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
// Block 3: the rest of the vocabulary no source has

/*
 * The same rule as block 2, on everything that is not a verb. Wiktionary
 * describes 106,710 nouns and adjectives the game does not know, and taking
 * them whole would be a different game: 22,567 of them are one adjective per
 * French commune (`zuydcootois`, `mantallotois`), 920 are SI units built by
 * multiplying a prefix table by a unit table, which block 1 already refuses by
 * name at the other door (`attofarad`, `femtoweber`, `déciban`). Neither is
 * rare vocabulary. Both are a bot filling in a table, and a five-letter grid
 * full of them is worse than one missing `ribot`.
 *
 * The corpus test cuts that down, and it cuts it in the right place: what it
 * keeps is `castagnette`, `affre`, `représaille`, `décarrade`, `larmichette`,
 * `mique`, and what it drops is the tables, which no corpus has ever met. It
 * also quietly covers the regional labels, which turned out to be a near-no-op
 * here: `UNPLAYABLE_LABELS` was written against verb forms, where `québec` and
 * `wallonie` are what one meets, and on nouns the label is `Normandie` or
 * `Savoie` or `Canada` fourteen times more often than anything it lists. The
 * Val d'Aoste sport `rebatta` says so only in the prose of its definition. A
 * corpus does not need the list to be complete to leave those words out.
 */
const newWords = [];
let unvouchedWords = 0;
let coarseWords = 0;
let uncitedShort = 0;
for (const word of wordLemmas) {
  const normalized = playable(word);
  if (!normalized || known.has(normalized)) continue;
  if (!attested.word(word)) {
    unvouchedWords++;
    continue;
  }
  /*
   * The second witness a short word needs, which `corpora.mjs` explains: under
   * five letters a corpus frequency may belong to a homograph, so Wiktionary
   * has to be quoting this headword from a published work as well. It keeps
   * `kiff`, `asso`, `péno`, `shop` and `led`, which are words people play, and
   * drops `tré`, `tion`, `pla`, `ani`, `aure`, `asin`, `anel` and `oule`,
   * which are a tagger's arithmetic.
   */
  if (normalized.length < CORPUS_ALONE_FROM && attested.onCorpusAlone(word) && !citedLemmas.get(word)) {
    uncitedShort++;
    continue;
  }
  if (COARSE.has(word)) {
    coarseWords++;
    continue;
  }
  newWords.push(word);
}
const blockWords = admit(newWords);
console.log(`\nWords: ${unvouchedWords} never met in the corpus, left out`);
console.log(`  ${uncitedShort} under ${CORPUS_ALONE_FROM} letters with no published citation, left out`);
if (coarseWords > 0) console.log(`  ${coarseWords} coarse, left out by name`);
console.log(`  ${blockWords.length} admitted, dictionary now ${known.size}`);

// ---------------------------------------------------------------------------
// Block 4: what was added by hand

const blockHand = admit(hand);
const stale = hand.length - blockHand.length;
console.log(`\nBy hand: ${blockHand.length} words kept, dictionary now ${known.size}`);
if (stale > 0) console.log(`  ${stale} dropped, a source now covers them`);

// ---------------------------------------------------------------------------
// Block 5: the inflections, against the finished dictionary

/*
 * Every paradigm Wiktionary knows, verbs and the rest together, because the
 * rule is the same one: a word the game accepts should have the forms of that
 * word. It held `grader` and refused `gradera`; it holds `abaisseur` and
 * refuses `abaisseuse`, `aboutissant` and refuses `aboutissante`. The verbs
 * were done first because a missing tense is the loudest version of the
 * complaint, but the plural of a noun a player has just traced is the same
 * hole.
 *
 * The sets are copied rather than shared: the verb families were read by
 * block 2 and are read again by the report at the end.
 */
const paradigms = new Map([...families].map(([lemma, forms]) => [lemma, new Set(forms)]));
for (const [lemma, forms] of inflections) {
  const family = paradigms.get(lemma);
  if (family) for (const form of forms) family.add(form);
  else paradigms.set(lemma, new Set(forms));
}

/** The lemmas the blocks above have just put in the dictionary. */
const admittedLemmas = new Set([...newVerbLemmas, ...newWords, ...hand]);

const completions = [];
const holes = [];
let knownLemmas = 0;
let coveredForms = 0;
let coarseParadigms = 0;
/** Forms completing a word the dictionary already had, before today's run. */
let standingForms = 0;
for (const [lemma, family] of paradigms) {
  const normalized = playable(lemma);
  if (!normalized || !known.has(normalized)) continue;
  if (unprintableLemmas.has(lemma)) {
    coarseParadigms++;
    continue;
  }
  knownLemmas++;
  const missing = [];
  for (const form of family) {
    const normalizedForm = playable(form);
    if (!normalizedForm) continue;
    if (known.has(normalizedForm)) coveredForms++;
    else missing.push(form);
  }
  if (missing.length > 0) holes.push({ lemma, missing: missing.length, of: family.size });
  if (!admittedLemmas.has(lemma)) standingForms += missing.length;
  completions.push(...missing);
}
const blockConjugations = admit(completions);
const total = coveredForms + blockConjugations.length;
console.log(`\nInflections: ${knownLemmas} lemmas the dictionary accepts, ${total} forms`);
console.log(
  `  ${coveredForms} already there, ${blockConjugations.length} added, dictionary now ${known.size}`,
);
console.log(`  ${standingForms} of them complete a word the dictionary already had`);
console.log(`  ${coarseParadigms} coarse paradigms left unfinished`);
holes.sort((a, b) => b.missing - a.missing);
console.log(`  worst holes: ${holes.slice(0, 8).map((h) => `${h.lemma} (${h.missing})`).join(', ')}`);

// ---------------------------------------------------------------------------
// What the base list made up

/**
 * Two shapes of invention, and only two.
 *
 * A word no reference vouches for is not automatically wrong: `frigorifiante`
 * is the regular feminine of a participle used as an adjective, correct French
 * that no dictionary bothers to list, and striking it would be `gradera` over
 * again from the other side. So agreement is left alone and only the two
 * shapes that cannot be right are taken:
 *
 *   - a conjugated form of a verb that no dictionary anywhere conjugates.
 *     `blêmaient` is not a form of `blêmir`, which gives `blêmissaient`; it is
 *     a form of `blêmer`, which does not exist. Same for `caséfier`,
 *     `conpresser`, `amotir`, `dessuiter`.
 *   - a plural in `-aus` where French writes `-aux`: `bihoreaus`, `nobliaus`.
 *
 * What is left over is read by hand and left in the file below if it is to go.
 * The order of the tests matters: agreement is checked first, so a participle
 * ending in `-ante` is never mistaken for a conjugation.
 *
 * A third shape is struck whether a reference has it or not: a string with no
 * vowel, which is the rule `playable` holds every other source to. `brrr`,
 * `pfft` and `pst` have Wiktionary entries and are noises all the same.
 */
const VERB_ENDING =
  /(assions|assiez|assent|erions|eriez|erons|eront|aient|èrent|asses|âmes|âtes|erais|erait|eras|erez|asse|ions|iez|ons|ais|ait|erai|era|îmes|îtes|irent|ez|as|ât|at)$/;

const struck = [];
for (const normalized of unvouched) {
  // Not `known.has(normalized)`: on a second run these words are already
  // struck, so the dictionary no longer holds them and the file would empty
  // itself. Membership in the base list is the durable test, and `unvouched`
  // is built from the base list alone.
  const word = baseWords.get(normalized);
  if (!word) continue;
  const lower = word.toLowerCase();

  const present = /^(.*)ant(e|es|s)$/.exec(lower);
  if (present && known.has(normalizeWord(`${present[1]}ant`))) continue;
  const past = /^(.*)(ée|ées|és)$/.exec(lower);
  if (past && known.has(normalizeWord(`${past[1]}é`))) continue;

  if (/aus$/.test(lower) && known.has(normalizeWord(`${lower.slice(0, -3)}au`))) struck.push(word);
  else if (VERB_ENDING.test(lower)) struck.push(word);
}
console.log(`\nStruck off: ${struck.length} of the ${unvouched.size} base-list words no reference has`);
let voiceless = 0;
for (const [normalized, word] of baseWords) {
  if (VOWEL.test(normalized)) continue;
  struck.push(word);
  voiceless++;
}
console.log(`  ${voiceless} more with no vowel, whatever the references say`);
struck.sort((a, b) => a.localeCompare(b, 'fr'));

/*
 * The hand block prunes itself, the same way the one in extra-words.txt does
 * and for the same reason, running the other way: a word stays struck only
 * while a source still supplies it. Once nothing produces it the line is
 * answering a question nobody is asking, and the file would otherwise grow
 * into a list of words that are not in the dictionary anyway.
 *
 * `admitted` is every spelling the blocks above put forward, before exclusion,
 * which is exactly "what the sources supply".
 */
const supplied = new Set();
for (const word of admitted) {
  const normalized = playable(word);
  if (normalized) supplied.add(normalized);
}
// Also dropped once the rule above catches the word on its own, which is the
// same question settled by the other half of the file: two blocks listing one
// word would count it twice and say nothing extra.
const computed = new Set(struck.map((word) => normalizeWord(word)));
const byHand = [...new Set(handStruck)]
  .filter((word) => supplied.has(normalizeWord(word)) && !computed.has(normalizeWord(word)))
  .sort((a, b) => a.localeCompare(b, 'fr'));
const settled = new Set(handStruck).size - byHand.length;
console.log(`  ${byHand.length} more struck by hand, which no rule reaches`);
if (settled > 0) console.log(`  ${settled} dropped from the hand block, no source supplies them now`);

/*
 * A verb whose forms are struck while its infinitive stays is the complaint
 * this whole file exists to answer, wearing the other hat. The infinitives sit
 * in the leftovers rather than in either shape above, so they are reported and
 * not acted on.
 */
const stranded = [];
for (const word of struck) {
  const stem = word.toLowerCase().replace(VERB_ENDING, '');
  for (const ending of ['er', 'ir', 're']) {
    const infinitive = `${stem}${ending}`;
    if (unvouched.has(normalizeWord(infinitive)) && known.has(normalizeWord(infinitive))) {
      stranded.push(infinitive);
    }
  }
}
const strandedList = [...new Set(stranded)].sort((a, b) => a.localeCompare(b, 'fr'));
if (strandedList.length > 0) {
  console.log(`  ${strandedList.length} infinitives left behind, still accepted: ${strandedList.join(' ')}`);
}

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
    'stopped being in 2019: this is where `blog`, `tofu`, `selfie` and',
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
      'French corpus has met the verb (Lexique 3.83, alone here: an infinitive',
      'brings fifty forms with it, and the other corpora tag their verbs by',
      `machine) and Wiktionary does not call it archaic or coarse. The other ${unattested}`,
      'it conjugates would have added some 772,000 words, most of them coinages.',
    ],
    blockVerbs,
  ),
  ...block(
    '2. the rest of the vocabulary no source had',
    [
      `${blockWords.length} nouns, adjectives, adverbs and interjections, from Wiktionary,`,
      'kept when any of four French corpora has met the word: Lexique 3.83, and',
      `Frantext 20e, Le Monde and FrWaC through GLÀFF ${GLAFF_VERSION}. This is where`,
      '`ribot` comes from, and `castagnette`, `affre`, `larmichette`, `mique`.',
      `The ${unvouchedWords} Wiktionary describes that no corpus has met are one adjective`,
      'per French commune and every SI unit multiplied by every prefix. Proper',
      'nouns are refused twice over, for their capital and for their part of speech.',
    ],
    blockWords,
  ),
  ...block(
    '3. added by hand',
    [
      `${blockHand.length} words no source has yet. Add another here: the script keeps`,
      'whatever it finds outside the generated blocks, and drops a word only',
      'once a source covers it, so this block shrinks as the lexicons catch up.',
    ],
    blockHand,
  ),
  ...block(
    '4. inflections completing every word above',
    [
      `${blockConjugations.length} forms, from Wiktionary. Computed last, so it sees the finished`,
      'dictionary: it held `grader` but not `gradera`, `abaisseur` but not',
      '`abaisseuse`, and it would have held `ribot` without `ribots`. No new',
      'vocabulary, every one is a form of a word already accepted.',
    ],
    blockConjugations,
  ),
];

const extraCount =
  blockVerbs.length + blockWords.length + blockHand.length + blockConjugations.length;
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
    `# Source: Dictionnaire orthographique français « classique » v${GRAMMALECTE_VERSION},`,
    '#   by Olivier R., https://grammalecte.net/ , read from the published',
    '#   Hunspell archive rather than from a package that repeats it.',
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
    '# Sources, all CC BY-SA, see LICENCE-DEFINITIONS.md:',
    '#   French Wiktionary, via the wiktextract extraction at kaikki.org',
    '#   Lexique 3.83, and GLÀFF 1.2.2 for Frantext 20e, Le Monde and FrWaC,',
    '#   which together decide whether a French corpus has met a word',
    '#',
    '# Grammalecte lives in grammalecte-words.txt, under its own licence.',
  ]);

  const struckSum = writeLexicon(
    EXCLUDED,
    [
      ...block(
        '1. struck by rule',
        [
          `${struck.length} words, struck off. ${struck.length - voiceless} of them the base list made up: neither`,
          'Grammalecte nor the Wiktionary, in any of the languages it describes, has',
          'an entry for them, and they take one of the two shapes that cannot be',
          'anything but an error: a conjugation of a verb nothing conjugates',
          '(`blêmer` for `blêmir`, `caséfier`, `conpresser`), or a plural in -aus',
          `where French writes -aux. The other ${voiceless} have no vowel, and a string`,
          'with no vowel is a noise written down, not a word: the rule every other',
          'source is held to at the door, applied to the one source taken whole.',
          '',
          'Agreement is deliberately left alone: `frigorifiante` is the regular',
          'feminine of a participle used as an adjective, correct French that no',
          'dictionary lists, and refusing it would be the bug this file exists to fix.',
          '',
          'Computed, so deleting a line here brings the word back only until the',
          'next build. To keep one, move it to the block below.',
        ],
        struck,
      ),
      ...block(
        '2. struck by hand',
        [
          `${byHand.length} ${byHand.length === 1 ? 'word' : 'words'} the sources do hold and a player should not be`,
          'shown. Strike another by writing it here: the script keeps whatever it',
          'finds outside the generated block, and drops a word only once no source',
          'supplies it any more. The plural usually needs no line of its own, the',
          'block that completes paradigms completing only what the dictionary still',
          'accepts; write one when a source supplies the plural itself, as',
          'Grammalecte does for `orcs`. This is the hand block of extra-words.txt',
          'run backwards, and a word reported as wrongly accepted belongs in it.',
        ],
        byHand,
      ),
    ],
    (checksum) => [
      '# Boggle multijoueur : mots retirés du dictionnaire',
      '#',
      `# version   ${LEXICON_VERSION}`,
      `# generated ${new Date().toISOString().slice(0, 10)} by scripts/build-lexicon.mjs`,
      `# words     ${struck.length + byHand.length}`,
      `# sha256    ${checksum}`,
      '#',
      '# The base word list (an-array-of-french-words, from the Letterpress lists,',
      '# archived in 2019) carries spellings no dictionary has ever had. Block 1',
      '# is the ones no judgement is needed to see; block 2 is the ones that',
      '# needed it, written by hand and kept across rebuilds.',
    ],
  );

  console.log(`\nWrote ${struck.length + byHand.length} words to ${EXCLUDED} (sha256 ${struckSum})`);
  console.log(`Wrote ${blockGrammalecte.length} words to ${CURATED} (sha256 ${curatedSum})`);
  console.log(`Wrote ${extraCount} words to ${EXTRA} (sha256 ${extraSum})`);
  console.log(`  version ${LEXICON_VERSION}`);
}
