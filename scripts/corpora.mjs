/**
 * Has anyone actually written this word?
 *
 * Two of the lexicon's five blocks take vocabulary from the Wiktionary, which
 * describes French rather than prescribing it: it conjugates 20,870 verbs
 * nobody has printed and files one adjective for each of 34,000 communes. The
 * test that separates a word from a table entry is attestation, a record of
 * somebody having used it, and this module is where that record is kept.
 *
 * **It used to be one corpus and that was the bug.** Lexique 3.83 is film
 * subtitles and books, 50,000 lemmas, and a word it never met was refused: no
 * appeal, no second opinion. `mique`, the Périgord dumpling that the Wiktionary
 * quotes from Mauriac, from two cookery books and from an ethnography of the
 * Pyrenees, is not in Lexique, so the game refused it to the player who traced
 * it. So did `déchèterie`, `panisse`, `webmail` and `phishing`. One corpus
 * missing a word says something about the corpus, not about the word.
 *
 * So attestation is now a panel of four, and any one of them vouching is
 * enough:
 *
 *   - **Lexique 3.83**, film subtitles and books, presence of the lemma. Kept
 *     as it was, because its nomenclature is checked by hand and presence in it
 *     means more than a raw count would.
 *   - **Frantext 20e**, 28.8 million words of twentieth-century literature.
 *   - **Le Monde**, ten years of it, 219.8 million words.
 *   - **FrWaC**, 1.25 billion words crawled from the French web, which is the
 *     only one of the four young enough to have met `télétravail`.
 *
 * The last three come from GLÀFF, which is where those corpora are counted per
 * word. They disagree about size by a factor of forty, so the test is a rate
 * rather than a count: {@link MIN_RATE} per million words, which is one
 * occurrence in the smallest of them. A newspaper needs seven and a web crawl
 * thirty-eight to say the same thing, which is the point. A crawl that size has
 * met every typo in French once, and `huluberlu` and `rappatriement` are what a
 * count would have let through.
 *
 * Sources are cached in `.work/` beside the Wiktionary extract, downloaded once.
 */

import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORK = resolve(root, '.work');

/** The edition this build was checked against, named in the generated files. */
export const GLAFF_VERSION = '1.2.2';
const GLAFF_URL = `http://redac.univ-tlse2.fr/lexiques/glaff/GLAFF-${GLAFF_VERSION}.tar.bz2`;
const GLAFF_ARCHIVE = resolve(WORK, `GLAFF-${GLAFF_VERSION}.tar.bz2`);
const GLAFF_MEMBER = `GLAFF-${GLAFF_VERSION}/glaff-${GLAFF_VERSION}.txt`;
/** The archive is 13.8 MB; anything much smaller is a truncated download. */
const GLAFF_MIN_SIZE = 10_000_000;

const LEXIQUE = resolve(WORK, 'Lexique383.tsv');

/**
 * Occurrences per million words, below which a corpus has not met the word.
 *
 * Frantext 20e is the smallest of the three at 28.8 million words, so one
 * occurrence in it is 0.035 per million and this is the threshold that lets
 * that one occurrence count. Le Monde then needs seven and FrWaC thirty-eight
 * to clear the same bar, in proportion to how much more text they are.
 *
 * Checked against what it has to separate. `mique` scores 0.061 and `panisse`
 * 0.046; `huluberlu` scores 0.023 and `aplaventrisme` 0.002, and the commune
 * adjectives and the SI unit table score nothing at all in any of the three.
 */
const MIN_RATE = 0.03;

/**
 * Under five letters a corpus frequency is not evidence on its own.
 *
 * Not because short words matter less. They matter most: the dictionary holds
 * 649 three-letter and 2,562 four-letter words and a grid is mostly made of
 * them, which is exactly why a wrong one is read by every player on the
 * missed-words page while a wrong nine-letter one is read by nobody.
 *
 * The problem is that for a short string the frequency may not be the word's.
 * These counts come from corpora lemmatised by machine, and a tagger handed a
 * short French form guesses: `tré` scores 6.6 per million on tokenisation
 * debris, `tion` 0.61 on the suffix, and `pla`, `ani`, `poa`, `aure`, `asin`,
 * `anel`, `oule`, `assa` and `oura` the same way, every one of them a real
 * Wiktionary entry wearing another word's number. A length cut was tried first
 * and it is the wrong shape: it throws `kiff`, `asso`, `péno`, `shop` and `led`
 * out with them, and those are words people play.
 *
 * So a short word needs a **second witness** instead, and `build-lexicon.mjs`
 * asks Wiktionary for it: a citation from a dated, published source. A
 * frequency is attached to a lemma by a machine and can belong to a homograph;
 * a citation is chosen by an editor to illustrate this headword and prints it
 * inside a sentence, which no other word's count can fake. Of the 127 short
 * words the corpora alone would have admitted it keeps 75 and drops 52, and
 * the 52 are the list above. What it keeps reads `led`, `asso`, `péno`, `run`,
 * `shop`, `ping`, `zine`, `kiff`, `drac`, `bin`, `cant`, `lose`, and then the
 * rare but real: `nit` the unit of luminance, `mée` the bread chest, `enne` the
 * letter N, `suet` the south-east wind, `atte` the leafcutter ant. Measured on
 * 400 4x4 grids, 147.1 words each against 142.8 before any of this, where a
 * length cut would have reached 145.1 by refusing all 127.
 *
 * A word Lexique already knows never reaches this test: its nomenclature is
 * checked by hand, which is the same second opinion by another route.
 */
export const CORPUS_ALONE_FROM = 5;

/**
 * A verb is asked of Lexique alone, and that is a deliberate exception.
 *
 * Two things make the verb block the one place this panel does not belong.
 *
 * The first is price. Admitting a noun puts two words on the grid, the
 * singular and the plural. Admitting an infinitive puts about fifty there,
 * because the block that runs last conjugates everything the dictionary
 * accepts, so the evidence has to be fifty times as good and a rate is not.
 *
 * The second is that GLÀFF's verb lemmas are not the same quality as its
 * nouns, and in exactly the wrong place. Its counts come from a corpus tagged
 * by machine, and a tagger asked for the lemma of a short French form guesses
 * a verb: `idéer` scores 0.158 on occurrences of `idée`, `vener` 0.417 on
 * `venir`, `anser` 0.486 on `anse`, and `esser`, `facer`, `funer` and `galer`
 * the same way. Every one of those is four or five letters, so every one of
 * them lays fifty short words across the grid: widening this block takes the
 * block from 338 infinitives to 549, adds 7,365 words, and moves 147.1 words
 * per 4x4 grid to 148.1, the difference reading
 * `ANSER ANSEZ ANSAI ANSAT IDEER IDEEZ IDEAI FUNEZ VENEZ`. `idéer` is named in the architecture decision as a
 * coinage to keep out, and here it was, admitted by a frequency belonging to
 * `idée`. Lexique's nomenclature is checked by hand and has none of it.
 *
 * What this gives up is real and small: `switcher`, `booter`, `uploader` and
 * `labéliser` are attested and stay out, because the same signal that vouches
 * for them vouches for `idéer`. None of them is a verb the game was reported
 * missing, and none is a conjugation: the last block completes every verb the
 * dictionary already holds, whichever source it came from, which is the fix
 * that `gradera` actually needed. GLÀFF's verb rows are still read, because a
 * verb lemma must not be allowed to vouch for the noun it is spelt like.
 */

/** The published archive, fetched once and kept. */
async function glaffArchive() {
  mkdirSync(WORK, { recursive: true });
  if (!existsSync(GLAFF_ARCHIVE) || statSync(GLAFF_ARCHIVE).size < GLAFF_MIN_SIZE) {
    console.log(`[corpora] downloading ${GLAFF_URL}`);
    const response = await fetch(GLAFF_URL);
    if (!response.ok || !response.body) throw new Error(`download failed: ${response.status}`);
    await pipeline(response.body, createWriteStream(GLAFF_ARCHIVE));
  }
  return GLAFF_ARCHIVE;
}

/**
 * The one member of the archive, streamed rather than unpacked.
 *
 * It is 157 MB of text and nothing here needs it twice, so it goes through a
 * pipe instead of onto the disk: what stays in `.work/` is the 14 MB archive,
 * which is what the release caches. Node ships gzip and deflate but not bzip2,
 * hence `tar`, which reads this format everywhere this build runs.
 */
function glaffLines(archive) {
  const tar = spawn('tar', ['-xjOf', archive, GLAFF_MEMBER], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  tar.on('error', (error) => tar.stdout.destroy(error));
  tar.stderr.on('data', (chunk) => (stderr += chunk));
  // Destroying the stream rather than throwing: the loop reading it is what
  // has to fail, and a throw from an event handler takes the process down
  // without saying which of the two sources was the problem.
  tar.on('close', (code) => {
    if (code !== 0) tar.stdout.destroy(new Error(`tar failed (${code}): ${stderr.trim()}`));
  });
  return createInterface({ input: tar.stdout, crlfDelay: Infinity });
}

/**
 * Lemma to its best rate across the three corpora, verbs kept apart.
 *
 * Apart because the question is asked of a lemma with a part of speech already
 * in hand: `porte` the noun and `porte` the verb form are different words that
 * happen to be spelt alike, and a corpus meeting one is no evidence for the
 * other. GLÀFF tags each row in GRACE format, where a verb starts with `V`.
 *
 * The rate read is the lemma's, not the form's, so a noun a corpus only ever
 * met in the plural still vouches for its singular.
 */
async function glaffRates() {
  const verbs = new Map();
  const words = new Map();
  let rows = 0;
  for await (const line of glaffLines(await glaffArchive())) {
    if (!line) continue;
    rows++;
    const fields = line.split('|');
    if (fields.length < 17) continue;
    // 9, 13 and 17 in the published numbering: the lemma's frequency per
    // million words in Frantext 20e, in Le Monde 10 and in FrWaC.
    const rate = Math.max(
      Number.parseFloat(fields[8]) || 0,
      Number.parseFloat(fields[12]) || 0,
      Number.parseFloat(fields[16]) || 0,
    );
    if (rate <= 0) continue;
    const kind = fields[1].startsWith('V') ? verbs : words;
    if (rate > (kind.get(fields[2]) ?? -1)) kind.set(fields[2], rate);
  }
  return { verbs, words, rows };
}

/**
 * Lemmas Lexique 3.83 knows, verbs apart from the rest.
 *
 * Presence rather than frequency, which is how this has always read it: the
 * list is a nomenclature checked by hand as well as a frequency table, and
 * `ribot` is in it with a count of zero.
 */
function lexiqueLemmas() {
  const verbs = new Set();
  const words = new Set();
  const rows = readFileSync(LEXIQUE, 'utf8').split('\n');
  const columns = rows[0].split('\t');
  const [lemma, category] = ['lemme', 'cgram'].map((name) => columns.indexOf(name));
  for (let index = 1; index < rows.length; index++) {
    const fields = rows[index].split('\t');
    if (fields.length < 11 || fields[category].length === 0) continue;
    (fields[category] === 'VER' ? verbs : words).add(fields[lemma]);
  }
  return { verbs, words };
}

/**
 * The panel, as two questions: has a corpus met this verb, this other word.
 *
 * `describe()` says what the answers rest on, so the build log records which
 * editions decided a lexicon rather than only how many words it holds.
 */
export async function attestation() {
  if (!existsSync(LEXIQUE)) {
    throw new Error(`Lexique missing (${LEXIQUE}); run scripts/build-definitions.mjs first.`);
  }
  const lexique = lexiqueLemmas();
  const glaff = await glaffRates();

  return {
    verb: (lemma) => lexique.verbs.has(lemma),
    word: (lemma) => lexique.words.has(lemma) || (glaff.words.get(lemma) ?? 0) >= MIN_RATE,
    /**
     * True when the corpora are the only thing vouching for the word, so the
     * caller knows a second witness is wanted below {@link CORPUS_ALONE_FROM}
     * letters.
     */
    onCorpusAlone: (lemma) =>
      !lexique.words.has(lemma) && (glaff.words.get(lemma) ?? 0) >= MIN_RATE,
    describe() {
      return [
        `Lexique 3.83: ${lexique.words.size} lemmas, ${lexique.verbs.size} verb infinitives`,
        `GLÀFF ${GLAFF_VERSION}: ${glaff.rows} forms read, ` +
          `${glaff.words.size} lemmas a corpus has met, at ${MIN_RATE} per million or better`,
        `  alone from ${CORPUS_ALONE_FROM} letters up, and never for a verb: see corpora.mjs`,
      ];
    },
  };
}
