import { getNeighbours, type Board } from './board.js';
import type { Dictionary } from './dictionary.js';
import { wordScore } from './scoring.js';
import type { ScoringMode } from './types.js';

export interface SolveOptions {
  minWordLength: number;
  qEqualsQu: boolean;
}

export interface Solution {
  /** Every word in the grid, each with one possible path. */
  words: Map<string, number[]>;
  /** Sum of every word's points under the given scoring table. */
  totalPoints: number;
}

/**
 * Lists every word traceable on the grid, depth-first with prefix pruning.
 * Used to show the words missed at the end of a round, and to judge whether a
 * grid is worth playing.
 */
export function solveBoard(
  board: Board,
  dictionary: Dictionary,
  options: SolveOptions,
  scoringMode: ScoringMode = 'classic',
): Solution {
  const { minWordLength, qEqualsQu } = options;
  const adjacency = getNeighbours(board.size);
  const used = new Array<boolean>(board.cells.length).fill(false);
  const path: number[] = [];
  const words = new Map<string, number[]>();

  const visit = (cellIndex: number, prefix: string): void => {
    const letter = board.cells[cellIndex];
    if (letter === undefined) return;

    used[cellIndex] = true;
    path.push(cellIndex);

    // Under the Q=QU variant a Q tile yields two different prefixes.
    const variants = qEqualsQu && letter === 'Q' ? ['Q', 'QU'] : [letter];
    for (const variant of variants) {
      const current = prefix + variant;
      if (!dictionary.hasPrefix(current)) continue;
      if (current.length >= minWordLength && !words.has(current) && dictionary.has(current)) {
        words.set(current, [...path]);
      }
      for (const neighbour of adjacency[cellIndex] ?? []) {
        if (!used[neighbour]) visit(neighbour, current);
      }
    }

    used[cellIndex] = false;
    path.pop();
  };

  for (let start = 0; start < board.cells.length; start++) visit(start, '');

  let totalPoints = 0;
  for (const word of words.keys()) totalPoints += wordScore(word.length, scoringMode);

  return { words, totalPoints };
}
