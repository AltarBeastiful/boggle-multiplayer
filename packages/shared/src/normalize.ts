/**
 * "Accents do not matter. E can be used as É, È, Ê and so on."
 * Source: https://www.boggle.fr/regles.php
 *
 * Everything is therefore folded to unaccented capitals, ligatures expanded.
 */

const DIACRITICS = /[̀-ͯ]/g;

/** Uppercase, ligatures expanded, accents stripped. */
export function normalizeLetters(input: string): string {
  return input
    .toUpperCase()
    .replace(/Œ/g, 'OE')
    .replace(/Æ/g, 'AE')
    .normalize('NFD')
    .replace(DIACRITICS, '');
}

/** Like `normalizeLetters`, but keeps only A-Z, dropping hyphens, apostrophes and spaces. */
export function normalizeWord(input: string): string {
  return normalizeLetters(input).replace(/[^A-Z]/g, '');
}

/** Is the word made only of A-Z letters once normalised? */
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
