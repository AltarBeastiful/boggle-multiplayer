import { getNeighbours, type Board } from './board.js';
import type { Dictionary } from './dictionary.js';
import { wordScore } from './scoring.js';
import type { ScoringMode } from './types.js';

export interface SolveOptions {
  minWordLength: number;
  qEqualsQu: boolean;
}

export interface Solution {
  /** Tous les mots de la grille, associés à un chemin possible. */
  words: Map<string, number[]>;
  /** Somme des points de tous les mots (barème donné). */
  totalPoints: number;
}

/**
 * Énumère tous les mots traçables sur la grille (DFS avec élagage par préfixe).
 * Sert à afficher les mots manqués en fin de manche et à jauger la qualité d'une grille.
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

    // Une case Q peut produire deux préfixes différents avec la variante Q=QU.
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
