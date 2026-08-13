import type { ScoringMode } from './types.js';

/**
 * Décompte des points, d'après https://www.boggle.fr/regles.php
 *
 *   3 ou 4 lettres : 1 point
 *   5 lettres      : 2 points
 *   6 lettres      : 3 points
 *   7 lettres      : 5 points
 *   8 lettres ou + : 11 points
 *
 * Variante « décompte simplifié », d'après https://www.boggle.fr/variantes.php
 * 1 point par lettre supplémentaire au-delà de la troisième :
 *
 *   3 ou 4 lettres : 1 point
 *   5 lettres      : 2 points
 *   6 lettres      : 3 points
 *   7 lettres      : 4 points
 *   8 lettres      : 5 points (8 - 3), et ainsi de suite.
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

/** Petit tableau lisible pour l'interface (le dernier libellé est « 8+ »). */
export function scoringTable(mode: ScoringMode): Array<{ label: string; points: number }> {
  return [
    { label: '3-4', points: wordScore(4, mode) },
    { label: '5', points: wordScore(5, mode) },
    { label: '6', points: wordScore(6, mode) },
    { label: '7', points: wordScore(7, mode) },
    { label: '8+', points: wordScore(8, mode) },
  ];
}
