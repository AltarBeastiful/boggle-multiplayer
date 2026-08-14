/**
 * The grid, and path validation.
 *
 * "You may move from one letter to the next directly to the left, to the
 *  right, above, below, or on any of the four diagonal tiles. A letter cannot
 *  be used more than once in the same word."
 * Source: https://www.boggle.fr/regles.php
 */

export interface Board {
  size: number;
  /** Letters, row by row, as unaccented capitals. */
  cells: string[];
}

const neighbourCache = new Map<number, number[][]>();

/** The eight neighbours of every tile, cached per grid size. */
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
  /** "QU instead of Q" variant: a Q tile may count as Q or QU. */
  qEqualsQu?: boolean;
}

/**
 * Looks for a path spelling `word` across the grid without reusing a tile.
 * Returns the tile indices, or `null` when the word cannot be traced.
 * `word` must already be normalised: capitals, no accents.
 */
export function findPath(board: Board, word: string, options: PathOptions = {}): number[] | null {
  const { qEqualsQu = false } = options;
  if (word.length === 0) return null;

  const adjacency = getNeighbours(board.size);
  const used = new Array<boolean>(board.cells.length).fill(false);
  const path: number[] = [];

  /** How many characters this tile can consume at position `at`. */
  const consumable = (cellIndex: number, at: number): number[] => {
    const letter = board.cells[cellIndex];
    if (letter === undefined) return [];
    const lengths: number[] = [];
    // The Q=QU variant is tried first since it gives the shorter path, but a
    // plain Q stays possible: QUI can also be traced as Q, then U, then I.
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

/** Can the word be traced on the grid? */
export function isOnBoard(board: Board, word: string, options: PathOptions = {}): boolean {
  return findPath(board, word, options) !== null;
}
