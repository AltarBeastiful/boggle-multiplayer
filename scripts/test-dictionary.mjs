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
 * `orc`. `server/data/extra-words.txt` repairs both, and this is what notices
 * if the file is ever lost or rebuilt wrongly.
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
    ['orc', 'orcs'],
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
  // its tenses: that is what stops `orc` from repeating `gradera`.
  for (const form of ['hacker', 'hackers', 'hacke', 'hackait', 'hackerait']) {
    expect(form, true, 'hacker is in the dictionary, so its conjugation must follow');
  }
  console.log('  hacker conjugates');

  // The words no source has, which is what the hand block is for. It empties
  // itself as the sources catch up: `freelance` and `burnout` were here until
  // Wiktionary's nouns were let in, and they are still accepted, one block
  // further down. Which is why this asks the dictionary and not the file.
  for (const form of ['visio', 'ramen', 'wrap', 'freelance', 'covid']) {
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
  ];
  const missing = ordinary.filter((word) => !accepts(word));
  console.log(`  ${ordinary.length - missing.length}/${ordinary.length} accepted`);
  for (const word of missing) problems.push(`${word}: refused, though it is ordinary French`);

  // A floor, so a truncated or empty word list is caught rather than passing
  // every assertion above by accident.
  console.log(`  dictionary size: ${dictionary.size}`);
  if (dictionary.size < 430_000) problems.push(`the dictionary holds only ${dictionary.size} words`);
}

console.log('');
if (problems.length === 0) console.log('OK: the dictionary accepts its conjugations and refuses the rest');
else for (const problem of problems) console.log(`✗ ${problem}`);
process.exitCode = problems.length === 0 ? 0 : 1;
