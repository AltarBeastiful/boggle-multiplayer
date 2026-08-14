import type { ScoringMode } from './types.js';

/**
 * Scoring, from https://www.boggle.fr/regles.php
 *
 *   3 or 4 letters : 1 point
 *   5 letters      : 2 points
 *   6 letters      : 3 points
 *   7 letters      : 5 points
 *   8 letters or + : 11 points
 *
 * "Simplified scoring" variant, from https://www.boggle.fr/variantes.php
 * one point per letter beyond the third:
 *
 *   3 or 4 letters : 1 point
 *   5 letters      : 2 points
 *   6 letters      : 3 points
 *   7 letters      : 4 points
 *   8 letters      : 5 points (8 - 3), and so on.
 */
export function wordScore(length: number, mode: ScoringMode): number {
  if (length < 3) return 0;
  if (mode === 'simplified') return Math.max(1, length - 3);
  if (length <= 4) return 1;
  if (length === 5) return 2;
  if (length === 6) return 3;
  if (length === 7) return 5;
  return 11;
}

/** Small readable table for the interface; the last label reads "8+". */
export function scoringTable(mode: ScoringMode): Array<{ label: string; points: number }> {
  return [
    { label: '3-4', points: wordScore(4, mode) },
    { label: '5', points: wordScore(5, mode) },
    { label: '6', points: wordScore(6, mode) },
    { label: '7', points: wordScore(7, mode) },
    { label: '8+', points: wordScore(8, mode) },
  ];
}
