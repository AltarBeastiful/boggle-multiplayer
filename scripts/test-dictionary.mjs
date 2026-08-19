#!/usr/bin/env node
/**
 * What the dictionary must and must not accept.
 *
 *   node scripts/test-dictionary.mjs
 *
 * Fast, offline, no browser: it builds the dictionary exactly as the server
 * does and asks it questions. The point is the conjugations. The word list is
 * derived from a game word list rather than a lexicon, and it used to accept
 * `grader` while refusing `gradera`, so a player who knew their conjugation
 * was punished for it, which is the least forgivable way for a dictionary to be
 * wrong. `server/data/extra-words.txt` repairs that, and this is what
 * notices if the file is ever lost or rebuilt wrongly.
 *
 * Its third block is different in kind: modern words the base list predates,
 * `orc` and `blog` and `tofu`, which no rule found and somebody chose. The
 * checks below hold both halves, and hold out the technical vocabulary that
 * every automatic rule wanted to let in instead.
 *
 * Regenerate the file with: node scripts/audit-conjugations.mjs --write
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
  // list from before any of these, and Lexique cannot vouch for them either,
  // its corpus having closed in 2001. Each is in block 3 of extra-words.txt,
  // with its plural, chosen by hand.
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

  // Adding `hacker` as a noun makes it a verb the dictionary knows, so the
  // conjugation pass now completes it. That cascade is the intended behaviour
  // and this is what says so.
  for (const form of ['hacker', 'hackers', 'hacke', 'hackait', 'hackerait']) {
    expect(form, true, 'hacker was added, so its conjugation must follow');
  }
  console.log('  hacker conjugates');
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
    // Every automatic rule tried for the modern words admits these first:
    // counting Wiktionary translations, examples or corpus frequency ranks
    // bot-written mineralogy and metrology above `orc` by thousands of words.
    // They stay out, and that is why block 3 is picked by hand.
    ['yttrotantalite', 'a mineral nobody plays'],
    ['attoweber', 'an SI unit nobody plays'],
    ['décicandela', 'the same'],
  ];
  for (const [word, why] of rubbish) {
    const got = expect(word, false, `${why}: it should not be in the dictionary`);
    console.log(`  ${word.padEnd(12)} ${got ? 'ACCEPTED' : 'refused'}  (${why})`);
  }
}

// ---------------------------------------------------------------------------
console.log('\n── Ordinary French is still there ──');
{
  const ordinary = ['maison', 'chat', 'ordinateur', 'pain', 'lumière', 'écrire', 'cœur', 'été'];
  const missing = ordinary.filter((word) => !accepts(word));
  console.log(`  ${ordinary.length - missing.length}/${ordinary.length} accepted`);
  for (const word of missing) problems.push(`${word}: refused, though it is ordinary French`);

  // A floor, so a truncated or empty word list is caught rather than passing
  // every assertion above by accident.
  console.log(`  dictionary size: ${dictionary.size}`);
  if (dictionary.size < 300_000) problems.push(`the dictionary holds only ${dictionary.size} words`);
}

console.log('');
if (problems.length === 0) console.log('OK: the dictionary accepts its conjugations and refuses the rest');
else for (const problem of problems) console.log(`✗ ${problem}`);
process.exitCode = problems.length === 0 ? 0 : 1;
