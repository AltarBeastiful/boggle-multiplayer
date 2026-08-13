/**
 * « Les accents ne sont pas importants. E peut être utilisé comme É, È, Ê, etc. »
 * Source : https://www.boggle.fr/regles.php
 *
 * Tout est donc ramené en majuscules non accentuées, ligatures développées.
 */

const DIACRITICS = /[̀-ͯ]/g;

/** Majuscules, ligatures développées, accents supprimés. */
export function normalizeLetters(input: string): string {
  return input
    .toUpperCase()
    .replace(/Œ/g, 'OE')
    .replace(/Æ/g, 'AE')
    .normalize('NFD')
    .replace(DIACRITICS, '');
}

/** Comme `normalizeLetters`, mais ne garde que A-Z (supprime traits d'union, apostrophes, espaces). */
export function normalizeWord(input: string): string {
  return normalizeLetters(input).replace(/[^A-Z]/g, '');
}

/** Un mot est-il formé uniquement de lettres A-Z après normalisation ? */
export function isPlainWord(input: string): boolean {
  const normalized = normalizeLetters(input);
  return /^[A-Z]+$/.test(normalized);
}

export const VOWELS = new Set(['A', 'E', 'I', 'O', 'U', 'Y']);

export function countVowels(letters: readonly string[]): number {
  let count = 0;
  for (const letter of letters) if (VOWELS.has(letter)) count++;
  return count;
}
