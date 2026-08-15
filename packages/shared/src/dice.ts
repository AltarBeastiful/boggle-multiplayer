import type { Board } from './board.js';
import type { Dictionary } from './dictionary.js';
import { countVowels } from './normalize.js';
import { fnv1a, mulberry32, randomSeed, type Rng } from './rng.js';
import { solveBoard } from './solver.js';
import type { BoardSize } from './types.js';

/**
 * The bag of 96 faces, being 16 dice of 6 faces.
 *
 * Hasbro does not publish the faces of the French edition, and no reliable
 * source gives them. Rather than invent an "official" set, the distribution
 * below follows French letter frequencies rounded over 96 faces. A grid is then
 * drawn from that bag *without replacement*: three Z tiles become impossible,
 * and vowels stay in proportion as they would on real dice.
 */
export const FRENCH_FACE_BAG: Readonly<Record<string, number>> = Object.freeze({
  E: 14, A: 7, I: 7, S: 7, N: 7, T: 7, R: 6, U: 6, O: 5, L: 5,
  D: 4, C: 3, M: 3, P: 3, V: 2,
  G: 1, B: 1, H: 1, F: 1, Q: 1, X: 1, Y: 1, J: 1, K: 1, Z: 1,
});

/** The 96 faces, expanded. */
export function expandBag(bag: Readonly<Record<string, number>> = FRENCH_FACE_BAG): string[] {
  const faces: string[] = [];
  for (const [letter, count] of Object.entries(bag)) {
    for (let i = 0; i < count; i++) faces.push(letter);
  }
  return faces;
}

export const TOTAL_FACES = expandBag().length; // 96

/** Draws `count` faces without replacement, by partial Fisher-Yates. */
function draw(count: number, rng: Rng): string[] {
  const faces = expandBag();
  const drawn: string[] = [];
  for (let i = 0; i < count; i++) {
    // The bag would need refilling beyond 96 tiles, which cannot happen here.
    const pick = i + Math.floor(rng() * (faces.length - i));
    const chosen = faces[pick] as string;
    faces[pick] = faces[i] as string;
    faces[i] = chosen;
    drawn.push(chosen);
  }
  return drawn;
}

/**
 * How each die came to rest, in quarter-turns clockwise (0 to 3).
 *
 * Shaken dice do not all land the right way up, and a cubic die in a square
 * cell can only settle four ways, so four is the whole story. Nothing about
 * the round depends on it: a tile spells the same letter whichever way it
 * faces, and the solver never sees this.
 *
 * Derived from the letters rather than sent by the server, which keeps it out
 * of the protocol, out of the saved room and out of the daily record: the same
 * grid gives the same throw on every screen, and a player who reconnects finds
 * the dice exactly as they left them. `salt` separates two rounds that happened
 * to draw the same letters.
 */
export function dieOrientations(cells: string[], salt: string | number = ''): number[] {
  const rng = mulberry32(fnv1a(`${cells.join('')}#${salt}`));
  return cells.map(() => Math.floor(rng() * 4));
}

/**
 * Letters that become another letter once the die is turned: M and W are each
 * other upside down, N and Z at a quarter-turn. Shown underlined when the dice
 * are thrown, since the underline gives the letter a floor and takes the guess
 * away. It is the reading that would otherwise be ambiguous, not the scoring:
 * the grid holds an M whatever the player reads.
 */
export const REVERSIBLE_LETTERS: ReadonlySet<string> = new Set(['M', 'W', 'N', 'Z']);

export interface GenerateBoardOptions {
  size: BoardSize;
  /** Dictionary used to check that a grid is worth playing. */
  dictionary?: Dictionary;
  minWordLength?: number;
  qEqualsQu?: boolean;
  /** Minimum number of words required; 0 disables the quality check. */
  minWords?: number;
  seed?: number;
  maxAttempts?: number;
}

export interface GeneratedBoard {
  board: Board;
  seed: number;
  /** Words found by the solver, when the quality check ran. */
  wordCount: number | null;
  attempts: number;
}

/** How many words a decent grid should hold, per size. */
function defaultMinWords(size: BoardSize): number {
  return size === 4 ? 40 : 120;
}

/**
 * Draws a playable grid: a sensible proportion of vowels, and enough words to
 * make the round interesting. Poor grids are drawn again.
 */
export function generateBoard(options: GenerateBoardOptions): GeneratedBoard {
  const {
    size,
    dictionary,
    minWordLength = 3,
    qEqualsQu = false,
    minWords = defaultMinWords(size),
    maxAttempts = 40,
  } = options;

  const cellCount = size * size;
  const minVowels = Math.max(2, Math.round(cellCount * 0.28));
  const maxVowels = Math.max(minVowels + 1, Math.round(cellCount * 0.6));

  let seed = options.seed ?? randomSeed();
  let best: GeneratedBoard | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const rng = mulberry32(seed);
    const cells = draw(cellCount, rng);
    const board: Board = { size, cells };
    const vowels = countVowels(cells);

    if (vowels >= minVowels && vowels <= maxVowels) {
      if (!dictionary || minWords <= 0) {
        return { board, seed, wordCount: null, attempts: attempt };
      }
      const solution = solveBoard(board, dictionary, { minWordLength, qEqualsQu });
      const wordCount = solution.words.size;
      const candidate: GeneratedBoard = { board, seed, wordCount, attempts: attempt };
      if (wordCount >= minWords) return candidate;
      // Keep the best grid so far, in case none reaches the threshold.
      if (!best || wordCount > (best.wordCount ?? -1)) best = candidate;
    }

    // Next seed, deterministic, so a replayable grid stays replayable.
    seed = (seed + 0x9e3779b9) >>> 0;
  }

  if (best) return best;
  const rng = mulberry32(seed);
  return { board: { size, cells: draw(cellCount, rng) }, seed, wordCount: null, attempts: maxAttempts };
}
