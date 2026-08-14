import { normalizeWord } from './normalize.js';

export interface Dictionary {
  /** Does the normalised word exist? */
  has(word: string): boolean;
  /** Is there any word starting with this prefix? Used to prune the solver. */
  hasPrefix(prefix: string): boolean;
  readonly size: number;
}

/**
 * Compact dictionary: a Set for exact lookups and a sorted array for prefixes,
 * searched by bisection. No in-memory trie: at 336,000 words a trie of objects
 * would cost several hundred megabytes for a negligible gain.
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
  /** Shortest word kept; 3 is the most permissive of the rules. */
  minLength?: number;
  /** Longest useful word: a 5x5 grid cannot trace more than 25 letters. */
  maxLength?: number;
  /** Words to drop, from the local exclusion list. */
  exclude?: Iterable<string>;
}

/**
 * Normalises, filters and sorts a raw list.
 * Entries holding anything but letters, such as "a-t-il" or "aujourd'hui", are
 * dropped: they cannot be traced on a grid anyway.
 */
export function buildDictionary(
  rawWords: Iterable<string>,
  options: BuildDictionaryOptions = {},
): SortedDictionary {
  const { minLength = 3, maxLength = 25, exclude } = options;
  const seen = new Set<string>();

  for (const raw of rawWords) {
    if (!raw) continue;
    // Reject hyphenated and apostrophised entries before normalising, since
    // normalizeWord would glue them into a word that does not exist
    // ("a-t-il" would become "ATIL").
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
