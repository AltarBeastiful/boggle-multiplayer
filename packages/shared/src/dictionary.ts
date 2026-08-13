import { normalizeWord } from './normalize.js';

export interface Dictionary {
  /** Le mot (normalisé) existe-t-il ? */
  has(word: string): boolean;
  /** Existe-t-il au moins un mot commençant par ce préfixe ? (élagage du solveur) */
  hasPrefix(prefix: string): boolean;
  readonly size: number;
}

/**
 * Dictionnaire compact : un Set pour les recherches exactes et un tableau trié
 * pour les préfixes (recherche dichotomique). Pas de trie en mémoire : à 336 000
 * mots, un trie d'objets coûterait plusieurs centaines de Mo pour un gain minime.
 */
export class SortedDictionary implements Dictionary {
  private readonly exact: Set<string>;
  private readonly sorted: string[];

  constructor(words: string[]) {
    this.sorted = words;
    this.exact = new Set(words);
  }

  get size(): number {
    return this.sorted.length;
  }

  has(word: string): boolean {
    return this.exact.has(word);
  }

  hasPrefix(prefix: string): boolean {
    let low = 0;
    let high = this.sorted.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if ((this.sorted[mid] as string) < prefix) low = mid + 1;
      else high = mid;
    }
    const candidate = this.sorted[low];
    return candidate !== undefined && candidate.startsWith(prefix);
  }
}

export interface BuildDictionaryOptions {
  /** Longueur minimale conservée (3 : la plus permissive des règles). */
  minLength?: number;
  /** Longueur maximale utile (une grille 5x5 ne peut pas tracer plus de 25 lettres). */
  maxLength?: number;
  /** Mots à retirer (liste d'exclusion locale). */
  exclude?: Iterable<string>;
}

/**
 * Normalise, filtre et trie une liste brute.
 * Les entrées contenant autre chose que des lettres (« a-t-il », « aujourd'hui »)
 * sont écartées : elles ne sont de toute façon pas traçables sur une grille.
 */
export function buildDictionary(
  rawWords: Iterable<string>,
  options: BuildDictionaryOptions = {},
): SortedDictionary {
  const { minLength = 3, maxLength = 25, exclude } = options;
  const seen = new Set<string>();

  for (const raw of rawWords) {
    if (!raw) continue;
    // Rejette avant normalisation les entrées à trait d'union / apostrophe :
    // normalizeWord les collerait en un mot qui n'existe pas (« a-t-il » -> « ATIL »).
    if (!/^[\p{L}]+$/u.test(raw)) continue;
    const word = normalizeWord(raw);
    if (word.length < minLength || word.length > maxLength) continue;
    seen.add(word);
  }

  if (exclude) {
    for (const raw of exclude) seen.delete(normalizeWord(raw));
  }

  return new SortedDictionary([...seen].sort());
}
