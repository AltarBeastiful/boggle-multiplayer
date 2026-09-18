#!/usr/bin/env node
/**
 * What the dictionary must and must not accept.
 *
 *   node scripts/test-dictionary.mjs
 *
 * Fast, offline, no browser: it builds the dictionary exactly as the server
 * does and asks it questions. The base list is a word list for a game rather
 * than a lexicon, and both ways it shows up were reported by players: it
 * accepted `grader` and refused `gradera`, it accepted `orque` and refused
 * `orc`. `server/data/extra-words.txt` repairs the first, and the second turned
 * out to be the base list being right: `orc` is the English spelling and is
 * struck by hand now. This is what notices if either file is lost or rebuilt
 * wrongly.
 *
 * The checks below hold each of its four blocks to what it is for, and hold
 * out the generated technical vocabulary that comes with the territory.
 *
 * Regenerate the file with: npm run lexicon -- --write
 */

import { normalizeWord } from '@boggle/shared';

import { gameDictionary } from './game-dictionary.mjs';

const problems = [];
const dictionary = gameDictionary();
console.log(`Dictionary: ${dictionary.size} playable forms\n`);

function accepts(word) {
  return dictionary.has(normalizeWord(word));
}

function expect(word, wanted, why) {
  const got = accepts(word);
  if (got !== wanted) problems.push(`${word}: ${got ? 'accepted' : 'refused'}, ${why}`);
  return got;
}

// ---------------------------------------------------------------------------
console.log('── Conjugations of verbs the game accepts ──');
{
  /** Infinitive, then forms that must come with it. */
  const verbs = [
    ['grader', ['gradera', 'graderai', 'gradant', 'gradez', 'graderons', 'gradions']],
    ['nourrir', ['nourrira', 'nourriront', 'nourrirait', 'nourrissons', 'nourrissait']],
    // Pronominal: Wiktionary files these under "s’enfuir", which cost a first
    // pass every reflexive verb in French before the pronoun was stripped.
    ['enfuir', ['enfuira', 'enfuyait', 'enfuirent', 'enfuyaient']],
    ['évanouir', ['évanouira', 'évanouissait', 'évanouirent']],
    ['absenter', ['absentera', 'absentait', 'absentassent']],
    ['manger', ['mangera', 'mangeaient', 'mangerions', 'mangeasse']],
    ['être', ['serait', 'furent', 'étions', 'seront']],
  ];

  for (const [infinitive, forms] of verbs) {
    expect(infinitive, true, 'the infinitive itself is missing');
    const missing = forms.filter((form) => !accepts(form));
    console.log(
      `  ${infinitive.padEnd(10)} ${forms.length - missing.length}/${forms.length}` +
        (missing.length > 0 ? `  missing: ${missing.join(' ')}` : ''),
    );
    for (const form of missing) problems.push(`${form}: refused, though ${infinitive} is accepted`);
  }
}

// ---------------------------------------------------------------------------
console.log('\n── Verbs the base list never had ──');
{
  // Admitted because a French corpus has actually met them, and Wiktionary
  // calls them neither obsolete nor coarse.
  const verbs = [
    ['télécharger', ['téléchargea', 'téléchargeront']],
    ['zapper', ['zappait', 'zapperais']],
    ['cibler', ['ciblera', 'ciblaient']],
    ['réécrire', ['réécrira', 'réécrivait']],
    ['menotter', ['menotta', 'menotteront']],
    ['rembobiner', ['rembobina', 'rembobinerait']],
  ];
  for (const [infinitive, forms] of verbs) {
    expect(infinitive, true, 'an attested modern verb is missing');
    const missing = forms.filter((form) => !accepts(form));
    console.log(`  ${infinitive.padEnd(13)} ${forms.length - missing.length + 1}/${forms.length + 1}`);
    for (const form of missing) problems.push(`${form}: refused, though ${infinitive} was added`);
  }
}

// ---------------------------------------------------------------------------
console.log('\n── Modern words the base list predates ──');
{
  // Reported as `orc`, and one of a class: the base list is a Letterpress word
  // list archived in 2019, and Lexique cannot vouch for these either, its
  // corpus having closed in 2001. They come from Grammalecte, which is a
  // maintained French dictionary, with the handful it lacks added by hand.
  const modern = [
    ['blog', 'blogs'],
    ['selfie', 'selfies'],
    ['manga', 'mangas'],
    ['tofu', 'tofus'],
    ['pixel', 'pixels'],
    ['covoiturage', 'covoiturages'],
    ['écolo', 'écolos'],
    ['sudoku', 'sudokus'],
    ['kebab', 'kebabs'],
  ];
  let held = 0;
  for (const forms of modern) {
    const missing = forms.filter((form) => !accepts(form));
    held += forms.length - missing.length;
    for (const form of missing) problems.push(`${form}: refused, though it was added by hand`);
  }
  console.log(`  ${held}/${modern.length * 2} accepted, singular and plural`);

  // Grammalecte has `hacker` as a noun only. The conjugation block runs last,
  // against the finished dictionary, so a verb arriving from any source gets
  // its tenses: that is what stops `covoiturage` from repeating `gradera`.
  for (const form of ['hacker', 'hackers', 'hacke', 'hackait', 'hackerait']) {
    expect(form, true, 'hacker is in the dictionary, so its conjugation must follow');
  }
  console.log('  hacker conjugates');

  // The words no source has, which is what the hand block is for. It empties
  // itself as the sources catch up: `freelance` and `burnout` were here until
  // Wiktionary's nouns were let in, and they are still accepted, one block
  // further down. Which is why this asks the dictionary and not the file.
  // `rad`, `kat` and `tep` are unit names Grammalecte holds only as symbols,
  // and `ros` the weaver's reed: all four in ODS 9, none with the published
  // citation a short word needs from Wiktionary, so they are held by hand.
  for (const form of ['visio', 'ramen', 'wrap', 'freelance', 'covid', 'rad', 'kat', 'tep', 'ros']) {
    expect(form, true, 'a hand-added word is missing');
  }
  console.log('  hand-added words held');
}

// ---------------------------------------------------------------------------
console.log('\n── Words that are not verbs ──');
{
  /*
   * `lait ribot` is Breton buttermilk, and the game knew `ribote`, `riboter`
   * and `riboteur` while refusing the word they are all built on: Wiktionary
   * was read for its verbs alone. It is read for the rest now, under the same
   * corpus test, and the pairs below are what that is worth. The plural
   * matters as much as the word: half a fix is `gradera` over again.
   */
  const words = [
    ['ribot', 'ribots'],
    ['castagnette', 'castagnettes'],
    ['affre', 'affres'],
    ['larmichette', 'larmichettes'],
    ['décarrade', 'décarrades'],
  ];
  let held = 0;
  for (const forms of words) {
    for (const form of forms) held += expect(form, true, 'a noun the corpus attests is missing') ? 0 : 1;
  }
  console.log(`  ${words.length * 2 - held}/${words.length * 2} accepted, singular and plural`);

  // The inflection block runs against the finished dictionary, so it completes
  // what the game already had as well as what it just gained. These are nouns
  // and participles the base list held in one gender or one number only.
  for (const form of ['abaisseuse', 'aboutissante', 'accélérantes', 'spadassine']) {
    expect(form, true, 'a form of a word the dictionary already accepts is missing');
  }
  console.log('  feminines and plurals completed');
}

// ---------------------------------------------------------------------------
console.log('\n── Words that are hard to build in ──');
{
  /*
   * The words that were missing for a reason, kept here by the reason.
   *
   * `mique` is why this section exists. It is the Périgord dumpling, the
   * Wiktionary quotes it from Mauriac and from three other published books,
   * and the game refused it to the player who traced it, because the one
   * frequency list the build consulted had never met it. Fixing that word
   * would have fixed nothing: what was wrong was that a single corpus had a
   * veto, and asking what else it was refusing turned up two more rules wrong
   * in the same shape, which is why there are seven groups below and not one.
   *
   * Each group below is a class rather than a word, and names the rule that
   * lets it in. A failure here says which rule went, not which word.
   */
  const classes = [
    [
      'the corpora disagree, and one of them is enough',
      // `mique` is in Le Monde thirteen times and in Lexique not at all.
      // Attestation is a panel now: see scripts/corpora.mjs.
      ['mique', 'miques', 'panisse', 'panisses'],
    ],
    [
      'register is not a reason to refuse a word',
      // Familiar and slang, tagged as such by Wiktionary, and French. The
      // build said so about verbs and refused every noun on the same ground.
      // All six are in ODS 9, which is the check the clipped forms got.
      ['branque', 'stup', 'perme', 'restau', 'impec', 'calcif'],
    ],
    [
      'a spelling variant is a word to trace',
      // Wiktionary glosses all four "variante de ...", `clef` included, which
      // the old rule read as a cross-reference worth nothing.
      ['clef', 'clefs', 'carbonade', 'kiff', 'nanards'],
    ],
    [
      'short words, which a corpus frequency alone cannot vouch for',
      // Three and four letters are most of a grid, so a wrong one is read by
      // every player on the missed-words page. These are not refused for being
      // short: they are kept because Wiktionary quotes each of them from a
      // published work, which a homograph's frequency cannot fake. `tré` and
      // `tion` have no such quotation and are in the section below, refused,
      // and so are `nap` and `mili`, which have one and which ODS 9 does not
      // list: a citation answers "is this a word", not "is it this word game's".
      ['asso', 'péno', 'led', 'zine', 'kiff', 'suet', 'enne'],
    ],
    [
      'vocabulary younger than the corpora that vouch for it',
      // Frantext and Le Monde stop around 2000; the web crawl is what has met
      // these, which is why it counts as a witness at a rate of its own.
      ['déchèterie', 'téléréalité', 'phishing', 'weekend', 'postdoc', 'cardio'],
    ],
    [
      'no source has them yet, so they are held by hand',
      // The residue, and the whole of it: block 3 of extra-words.txt. It
      // prunes itself, so a word leaving it is not a failure, a word leaving
      // the dictionary is.
      ['socca', 'seum', 'enchaud', 'pounti', 'wastringue'],
    ],
    [
      'and their inflections, because half a fix is gradera over again',
      ['miques', 'restaus', 'branques', 'clefs', 'déchèteries', 'soccas'],
    ],
  ];
  for (const [why, words] of classes) {
    const missing = words.filter((word) => !accepts(word));
    console.log(`  ${String(words.length - missing.length).padStart(2)}/${words.length}  ${why}`);
    for (const word of missing) problems.push(`${word}: refused, though ${why}`);
  }
}

// ---------------------------------------------------------------------------
console.log('\n── What must stay out ──');
{
  const rubbish = [
    // The eszett uppercases to SS, so this archaic form would normalise to
    // ABOUTISSET: traceable on a grid, and not a word.
    ['aboutissset', 'invented'],
    ['fontsaient', 'a child’s regularisation of faisaient, documented as such'],
    ['ontvaient', 'the same, for avaient'],
    ['avoit', 'pre-1835 spelling of avait'],
    ['seroit', 'pre-1835 spelling of serait'],
    ['boivez', 'coined as a joke'],
    ['mangeont', 'regional'],
    ['zzzzz', 'not a word in any language'],
    // A word has a vowel. These are noises written down, and every source
    // carries some: Grammalecte files them as interjections next to `zut`,
    // which is a word and stays. The letters separate them where the part of
    // speech does not, so the build refuses the shape at every door and
    // strikes the base list's own.
    ['tss', 'a noise, from Grammalecte'],
    ['pff', 'the same'],
    ['hmm', 'the same'],
    ['kss', 'the same'],
    ['brrr', 'the same, from the base list, struck by the same rule'],
    ['pst', 'the same'],
    // The same shape catches what the sources hold for spell-checking rather
    // than reading: symbols, acronyms, letter abbreviations.
    ['http', 'a protocol, not a word'],
    ['www', 'the same'],
    ['svp', 'an abbreviation, from Wiktionary'],
    ['frs', 'an abbreviation of francs, which Wiktionary files as a form of franc'],
    // Grammalecte marks its unit symbols KEEPCASE and its elided stems
    // NOSUGGEST in its own affix file, and those lines are dropped whole.
    ['ppm', 'a unit symbol, flagged as one by Grammalecte'],
    ['kpc', 'the same, for kiloparsec'],
    ['mbar', 'the same, for millibar'],
    ['quelqu', 'the stem of quelqu’un, which Grammalecte holds and never suggests'],
    ['presqu', 'the same'],
    // Wiktionary conjugates 20,870 more verbs nobody has ever printed. Taking
    // them would have added 772,000 words to a family word game.
    ['encyclopédier', 'a Wiktionary coinage, in no corpus'],
    ['concupiscer', 'the same'],
    ['insecter', 'the same'],
    // Taking Wiktionary whole was measured and refused: it doubles the words
    // on a grid and the additions are `kdo`, `tjs`, `orser`, `neocorat`.
    // Struck off by the exclusion pass: the base list carries them and no
    // dictionary anywhere does. `blêmaient` is a form of `blêmer`, which does
    // not exist; the verb is `blêmir`, and `blêmissaient` is right below.
    ['blêmaient', 'a conjugation of a verb that does not exist'],
    ['caséfiera', 'the same'],
    ['conpressait', 'the same, and a misspelling of compresser besides'],
    ['bihoreaus', 'the plural is bihoreaux'],
    ['nobliaus', 'the plural is nobliaux'],
    ['yttrotantalite', 'a mineral, from a Wiktionary nobody filtered'],
    // Hunspell would multiply every unit symbol by the nineteen SI prefixes.
    // Dropping that one flag family was the only cleaning Grammalecte needed.
    ['attoweber', 'generated by rule, written by nobody'],
    ['décicandela', 'the same'],
    ['zsr', 'the same, from steradian'],
    // The same table, from the other door: Wiktionary describes 920 prefixed
    // units and one adjective for each of 34,000 French communes. No corpus
    // has met any of them, which is what keeps them out.
    ['femtoweber', 'the SI table again, this time from Wiktionary'],
    ['zuydcootois', 'one adjective per commune, written by a bot'],
    ['mantallotois', 'the same'],
    // Wiktionary tags most coarse words and leaves these untagged, saying it
    // in the definition instead: "injure antisémite", "terme raciste".
    ['youtre', 'a slur Wiktionary does not tag as one'],
    ['niakoué', 'the same'],
    // Grammalecte is an orthographic dictionary and has `pédé` because it is
    // spelt that way, so the last block would have looked up its feminine.
    ['pédée', 'the inflection block must not finish a coarse paradigm'],
    // The other side of the section above. Opening the door to `clef` and
    // `carbonade` is opening it to everything Wiktionary glosses the same way,
    // and these are the ones that must not walk through: a spelling is a word
    // only while it is current, and each of these says somewhere that it is
    // not. `aurevoir` says it in its categories alone, which is why they are
    // read too.
    ['connoissance', 'the spelling of before 1835'],
    ['aurevoir', 'filed under "Termes non standards", and tagged nothing at all'],
    ['partisant', 'a variant of partisan, and Wiktionary calls it dated'],
    ['huluberlu', 'hurluberlu, met once by a web crawl of 1.25 billion words'],
    ['rappatriement', 'the same, for rapatriement'],
    // And the other side of the short-word group above, which is the whole
    // reason it needs a citation and not just a frequency. Each of these is a
    // real Wiktionary headword carrying a number that belongs to another
    // word, and each is three or four letters, so each would land on a large
    // share of grids: `tré` turned up on 77 of 400 before it was stopped.
    ['tré', 'a tokenisation artefact scoring 6.6 per million'],
    ['tion', 'the suffix, counted as though it were a word'],
    ['pla', 'the same shape, and no published source quotes it'],
    ['asin', 'the same'],
    ['oule', 'the same'],
    // And the other side of "register is not a reason to refuse a word",
    // which holds of a word and not of a form: `sra` is familiar for `sera`
    // and is not a conjugation of `être` anybody may claim a point for.
    // Struck by hand, in block 2 of excluded-words.txt, and the first word to
    // earn a place there. It was the report that brought Grammalecte in and it
    // came in with it, `orc/S.` being in the Hunspell file; the Officiel du
    // Scrabble refuses it, French writes `orque`, and Tolkien asked his
    // translators to translate the word, which Ledoux did. Both forms need a
    // line, the plural coming from Grammalecte's own flag rather than from the
    // block that completes paradigms.
    ['orc', 'the English spelling; French writes orque, which the game accepts'],
    ['orcs', 'and its plural, which Grammalecte supplies directly'],
    // The rest of the hand block: clipped forms the corpora vouch for and the
    // Officiel du Scrabble does not list, struck together once it was checked
    // rather than argued. Their plurals went on their own, the paradigm block
    // completing only what the dictionary still accepts. `gogues` stayed: ODS
    // has it, French using that one in the plural only.
    ['carbu', 'a clipped form ODS 9 does not list, where it lists aprèm and certif'],
    ['soluce', 'the same'],
    ['aéro', 'the same'],
    ['pédago', 'the same'],
    ['zique', 'the same, where ODS takes zizique'],
    ['aprème', 'the same, where ODS takes aprèm'],
    ['sra', 'a contraction of sera, marked familiar and nothing else'],
    ['tsé', 'the same, for tu sais'],
  ];
  for (const [word, why] of rubbish) {
    const got = expect(word, false, `${why}: it should not be in the dictionary`);
    console.log(`  ${word.padEnd(12)} ${got ? 'ACCEPTED' : 'refused'}  (${why})`);
  }
}

// ---------------------------------------------------------------------------
console.log('\n── Ordinary French is still there ──');
{
  // `frigorifiante` and `hennie` sit next to the struck words in every respect
  // except one: they are correct French that no dictionary lists. Agreement of
  // a participle is regular, so the exclusion pass must not reach them.
  const ordinary = [
    'maison',
    'chat',
    'ordinateur',
    'pain',
    'lumière',
    'écrire',
    'cœur',
    'été',
    'blêmissaient',
    'frigorifiante',
    'hennie',
    // Interjections with a vowel are words, and ODS 9 lists all four. The rule
    // that refuses `tss` is about letters, not about the part of speech.
    'zut',
    'ouf',
    'bof',
    'miam',
    // A symbol that is also a word keeps its word line in Grammalecte.
    'bar',
    'bit',
    'gal',
  ];
  const missing = ordinary.filter((word) => !accepts(word));
  console.log(`  ${ordinary.length - missing.length}/${ordinary.length} accepted`);
  for (const word of missing) problems.push(`${word}: refused, though it is ordinary French`);

  // A floor, so a truncated or empty word list is caught rather than passing
  // every assertion above by accident.
  console.log(`  dictionary size: ${dictionary.size}`);
  if (dictionary.size < 450_000) problems.push(`the dictionary holds only ${dictionary.size} words`);
}

console.log('');
if (problems.length === 0) console.log('OK: the dictionary accepts its conjugations and refuses the rest');
else for (const problem of problems) console.log(`✗ ${problem}`);
process.exitCode = problems.length === 0 ? 0 : 1;
