import type { Board } from './board.js';
import type { Dictionary } from './dictionary.js';
import { countVowels } from './normalize.js';
import { mulberry32, randomSeed, type Rng } from './rng.js';
import { solveBoard } from './solver.js';
import type { BoardSize } from './types.js';

/**
 * Le sachet de 96 faces (16 dés x 6 faces).
 *
 * Hasbro ne publie pas les faces des dés de l'édition française, et aucune source
 * fiable ne les donne. Plutôt que d'inventer un jeu de dés « officiel », la
 * répartition ci-dessous suit la fréquence des lettres en français, arrondie sur
 * 96 faces. Une grille est ensuite tirée *sans remise* dans ce sachet : impossible
 * d'obtenir trois Z, et les voyelles restent proportionnées comme sur de vrais dés.
 */
export const FRENCH_FACE_BAG: Readonly<Record<string, number>> = Object.freeze({
  E: 14, A: 7, I: 7, S: 7, N: 7, T: 7, R: 6, U: 6, O: 5, L: 5,
  D: 4, C: 3, M: 3, P: 3, V: 2,
  G: 1, B: 1, H: 1, F: 1, Q: 1, X: 1, Y: 1, J: 1, K: 1, Z: 1,
});

/** Les 96 faces, développées. */
export function expandBag(bag: Readonly<Record<string, number>> = FRENCH_FACE_BAG): string[] {
  const faces: string[] = [];
  for (const [letter, count] of Object.entries(bag)) {
    for (let i = 0; i < count; i++) faces.push(letter);
  }
  return faces;
}

export const TOTAL_FACES = expandBag().length; // 96

/** Tirage sans remise de `count` faces (Fisher-Yates partiel). */
function draw(count: number, rng: Rng): string[] {
  const faces = expandBag();
  const drawn: string[] = [];
  for (let i = 0; i < count; i++) {
    // Le sachet est réapprovisionné si la grille dépasse 96 cases (impossible ici).
    const pick = i + Math.floor(rng() * (faces.length - i));
    const chosen = faces[pick] as string;
    faces[pick] = faces[i] as string;
    faces[i] = chosen;
    drawn.push(chosen);
  }
  return drawn;
}

export interface GenerateBoardOptions {
  size: BoardSize;
  /** Dictionnaire utilisé pour vérifier qu'une grille est jouable. */
  dictionary?: Dictionary;
  minWordLength?: number;
  qEqualsQu?: boolean;
  /** Nombre minimal de mots exigé (0 pour désactiver le contrôle qualité). */
  minWords?: number;
  seed?: number;
  maxAttempts?: number;
}

export interface GeneratedBoard {
  board: Board;
  seed: number;
  /** Nombre de mots trouvés par le solveur, si le contrôle qualité a tourné. */
  wordCount: number | null;
  attempts: number;
}

/** Nombre de mots attendu d'une grille correcte, par taille. */
function defaultMinWords(size: BoardSize): number {
  return size === 4 ? 40 : 120;
}

/**
 * Tire une grille jouable : proportion de voyelles raisonnable, et assez de mots
 * pour que la manche soit intéressante. Les grilles pauvres sont retirées.
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
      // On garde la meilleure grille au cas où aucune n'atteindrait le seuil.
      if (!best || wordCount > (best.wordCount ?? -1)) best = candidate;
    }

    // Graine suivante, déterministe : une grille rejouable le reste.
    seed = (seed + 0x9e3779b9) >>> 0;
  }

  if (best) return best;
  const rng = mulberry32(seed);
  return { board: { size, cells: draw(cellCount, rng) }, seed, wordCount: null, attempts: maxAttempts };
}
