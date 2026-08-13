/**
 * Grille et validation des chemins.
 *
 * « Vous pouvez passer d'une lettre à la suivante située directement à gauche,
 *   à droite, en haut, en bas, ou sur l'une des quatre cases diagonales.
 *   Une lettre ne peut pas être utilisée plus d'une fois pour un même mot. »
 * Source : https://www.boggle.fr/regles.php
 */

export interface Board {
  size: number;
  /** Lettres, ligne par ligne, en majuscules non accentuées. */
  cells: string[];
}

const neighbourCache = new Map<number, number[][]>();

/** Voisins (8 directions) de chaque case, mis en cache par taille de grille. */
export function getNeighbours(size: number): number[][] {
  const cached = neighbourCache.get(size);
  if (cached) return cached;

  const table: number[][] = [];
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const list: number[] = [];
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const r = row + dr;
          const c = col + dc;
          if (r < 0 || r >= size || c < 0 || c >= size) continue;
          list.push(r * size + c);
        }
      }
      table.push(list);
    }
  }
  neighbourCache.set(size, table);
  return table;
}

export interface PathOptions {
  /** Variante « QU à la place de Q » : une case Q peut valoir Q ou QU. */
  qEqualsQu?: boolean;
}

/**
 * Cherche un chemin traçant `word` sur la grille, sans réutiliser une case.
 * Retourne les indices des cases, ou `null` si le mot n'est pas traçable.
 * `word` doit déjà être normalisé (majuscules, sans accents).
 */
export function findPath(board: Board, word: string, options: PathOptions = {}): number[] | null {
  const { qEqualsQu = false } = options;
  if (word.length === 0) return null;

  const adjacency = getNeighbours(board.size);
  const used = new Array<boolean>(board.cells.length).fill(false);
  const path: number[] = [];

  /** Longueurs de mot que cette case peut consommer à la position `at`. */
  const consumable = (cellIndex: number, at: number): number[] => {
    const letter = board.cells[cellIndex];
    if (letter === undefined) return [];
    const lengths: number[] = [];
    // La variante Q=QU est essayée en premier (chemin le plus court),
    // mais le Q « simple » reste possible : QUI peut se tracer Q+U+I.
    if (qEqualsQu && letter === 'Q' && word.startsWith('QU', at)) lengths.push(2);
    if (word.startsWith(letter, at)) lengths.push(letter.length);
    return lengths;
  };

  const walk = (cellIndex: number, at: number): boolean => {
    const lengths = consumable(cellIndex, at);
    if (lengths.length === 0) return false;

    used[cellIndex] = true;
    path.push(cellIndex);

    for (const taken of lengths) {
      const next = at + taken;
      if (next === word.length) return true;
      for (const neighbour of adjacency[cellIndex] ?? []) {
        if (!used[neighbour] && walk(neighbour, next)) return true;
      }
    }

    used[cellIndex] = false;
    path.pop();
    return false;
  };

  for (let start = 0; start < board.cells.length; start++) {
    if (walk(start, 0)) return [...path];
  }
  return null;
}

/** Le mot est-il traçable sur la grille ? */
export function isOnBoard(board: Board, word: string, options: PathOptions = {}): boolean {
  return findPath(board, word, options) !== null;
}
