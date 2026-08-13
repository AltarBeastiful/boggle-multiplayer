import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  FRENCH_FACE_BAG,
  buildDictionary,
  countVowels,
  expandBag,
  findPath,
  generateBoard,
  isValidRoomCode,
  normalizeWord,
  sanitizeNickname,
  sanitizeSettings,
  scoringTable,
  solveBoard,
  wordScore,
  type Board,
} from '../dist/index.js';

// ---------------------------------------------------------------------------
// Décompte des points, d'après https://www.boggle.fr/regles.php
// ---------------------------------------------------------------------------

test('barème classique : 3-4=1, 5=2, 6=3, 7=5, 8+=11', () => {
  assert.equal(wordScore(3, 'classic'), 1);
  assert.equal(wordScore(4, 'classic'), 1);
  assert.equal(wordScore(5, 'classic'), 2);
  assert.equal(wordScore(6, 'classic'), 3);
  assert.equal(wordScore(7, 'classic'), 5);
  assert.equal(wordScore(8, 'classic'), 11);
  assert.equal(wordScore(12, 'classic'), 11);
});

// Variante « décompte simplifié », d'après https://www.boggle.fr/variantes.php
test('barème simplifié : 1 point par lettre au-delà de la troisième', () => {
  assert.equal(wordScore(3, 'simplified'), 1);
  assert.equal(wordScore(4, 'simplified'), 1);
  assert.equal(wordScore(5, 'simplified'), 2);
  assert.equal(wordScore(6, 'simplified'), 3);
  assert.equal(wordScore(7, 'simplified'), 4);
  assert.equal(wordScore(8, 'simplified'), 5, 'la page donne 8 - 3 = 5');
  assert.equal(wordScore(10, 'simplified'), 7);
});

test('un mot de moins de 3 lettres ne vaut rien', () => {
  assert.equal(wordScore(2, 'classic'), 0);
  assert.equal(wordScore(2, 'simplified'), 0);
});

test('le tableau des points reflète le barème choisi', () => {
  assert.deepEqual(
    scoringTable('classic').map((row) => row.points),
    [1, 2, 3, 5, 11],
  );
  assert.deepEqual(
    scoringTable('simplified').map((row) => row.points),
    [1, 2, 3, 4, 5],
  );
});

// ---------------------------------------------------------------------------
// Normalisation : « les accents ne sont pas importants »
// ---------------------------------------------------------------------------

test('accents, ligatures et casse sont neutralisés', () => {
  assert.equal(normalizeWord('été'), 'ETE');
  assert.equal(normalizeWord('Élève'), 'ELEVE');
  assert.equal(normalizeWord('cœur'), 'COEUR');
  assert.equal(normalizeWord('ex æquo'), 'EXAEQUO');
  assert.equal(normalizeWord('  Ça  '), 'CA');
});

// ---------------------------------------------------------------------------
// Chemins sur la grille
// ---------------------------------------------------------------------------

const board: Board = { size: 4, cells: 'ABCDEFGHIJKLMNOP'.split('') };
//  A B C D
//  E F G H
//  I J K L
//  M N O P

test('un mot se trace horizontalement, verticalement et en diagonale', () => {
  assert.deepEqual(findPath(board, 'ABC'), [0, 1, 2]);
  assert.deepEqual(findPath(board, 'AEI'), [0, 4, 8]);
  assert.deepEqual(findPath(board, 'AFK'), [0, 5, 10], 'diagonale');
});

test('deux cases non adjacentes ne forment pas un mot', () => {
  assert.equal(findPath(board, 'AC'), null);
  assert.equal(findPath(board, 'AP'), null);
});

test('une case ne peut pas servir deux fois dans le même mot', () => {
  const repeated: Board = { size: 2, cells: ['T', 'O', 'X', 'Y'] };
  assert.deepEqual(findPath(repeated, 'TO'), [0, 1]);
  assert.equal(findPath(repeated, 'TOT'), null, 'le T devrait être réutilisé');
});

test('une lettre présente deux fois sur la grille reste utilisable deux fois', () => {
  const twice: Board = { size: 2, cells: ['T', 'O', 'T', 'X'] };
  assert.deepEqual(findPath(twice, 'TOT'), [0, 1, 2]);
});

// Variante « QU à la place de Q »
test('variante Q=QU : la case Q vaut Q ou QU', () => {
  const withQ: Board = { size: 2, cells: ['Q', 'I', 'X', 'Y'] };
  assert.equal(findPath(withQ, 'QUI'), null, 'sans la variante, il faut un U sur la grille');
  assert.deepEqual(findPath(withQ, 'QUI', { qEqualsQu: true }), [0, 1]);
});

test('variante Q=QU : le mot reste traçable quand le U est sur la grille', () => {
  const withU: Board = { size: 2, cells: ['Q', 'U', 'I', 'X'] };
  assert.deepEqual(findPath(withU, 'QUI'), [0, 1, 2], 'sans la variante : Q puis U puis I');
  // Avec la variante, la case Q absorbe le QU : chemin plus court, tout aussi valide.
  assert.deepEqual(findPath(withU, 'QUI', { qEqualsQu: true }), [0, 2]);
});

test('variante Q=QU : le U de la grille sert quand le Q ne peut pas absorber', () => {
  // QUE : le Q absorbe QU puis il faut un E ; sinon Q + U + E.
  const grid: Board = { size: 2, cells: ['Q', 'U', 'E', 'X'] };
  assert.deepEqual(findPath(grid, 'QUE'), [0, 1, 2]);
  assert.notEqual(findPath(grid, 'QUE', { qEqualsQu: true }), null);
});

// ---------------------------------------------------------------------------
// Dictionnaire
// ---------------------------------------------------------------------------

test('le dictionnaire normalise et écarte les entrées non alphabétiques', () => {
  const dictionary = buildDictionary(['déci', 'zut', "aujourd'hui", 'a-t-il', 'ok', 'ÉTÉ']);
  assert.ok(dictionary.has('DECI'));
  assert.ok(dictionary.has('ZUT'));
  assert.ok(dictionary.has('ETE'));
  assert.ok(!dictionary.has('AUJOURDHUI'), 'apostrophe : entrée écartée');
  assert.ok(!dictionary.has('ATIL'), 'trait d’union : entrée écartée');
  assert.ok(!dictionary.has('OK'), 'moins de 3 lettres');
});

test('la recherche par préfixe alimente l’élagage du solveur', () => {
  const dictionary = buildDictionary(['chat', 'chien', 'chienne']);
  assert.ok(dictionary.hasPrefix('CH'));
  assert.ok(dictionary.hasPrefix('CHIEN'));
  assert.ok(!dictionary.hasPrefix('CHZ'));
  assert.ok(!dictionary.hasPrefix('Z'));
});

test('une liste d’exclusion retire des mots', () => {
  const dictionary = buildDictionary(['chat', 'chien'], { exclude: ['chien'] });
  assert.ok(dictionary.has('CHAT'));
  assert.ok(!dictionary.has('CHIEN'));
});

// ---------------------------------------------------------------------------
// Solveur
// ---------------------------------------------------------------------------

test('le solveur trouve les mots traçables et ignore les autres', () => {
  const dictionary = buildDictionary(['rat', 'art', 'tar', 'chien']);
  const small: Board = { size: 2, cells: ['R', 'A', 'T', 'X'] };
  const solution = solveBoard(small, dictionary, { minWordLength: 3, qEqualsQu: false });
  assert.deepEqual([...solution.words.keys()].sort(), ['ART', 'RAT', 'TAR']);
  assert.equal(solution.totalPoints, 3, '3 mots de 3 lettres');
});

test('le solveur respecte la longueur minimale de la variante', () => {
  const dictionary = buildDictionary(['rat', 'rats']);
  const small: Board = { size: 2, cells: ['R', 'A', 'T', 'S'] };
  const three = solveBoard(small, dictionary, { minWordLength: 3, qEqualsQu: false });
  const four = solveBoard(small, dictionary, { minWordLength: 4, qEqualsQu: false });
  assert.deepEqual([...three.words.keys()].sort(), ['RAT', 'RATS']);
  assert.deepEqual([...four.words.keys()], ['RATS']);
});

// ---------------------------------------------------------------------------
// Tirage des grilles
// ---------------------------------------------------------------------------

test('le sachet contient 96 faces (16 dés x 6)', () => {
  assert.equal(expandBag().length, 96);
  assert.equal(Object.values(FRENCH_FACE_BAG).reduce((sum, count) => sum + count, 0), 96);
});

test('une grille tirée a la bonne taille et assez de voyelles', () => {
  for (const size of [4, 5] as const) {
    const { board: grid } = generateBoard({ size, minWords: 0, seed: 12345 });
    assert.equal(grid.cells.length, size * size);
    assert.ok(grid.cells.every((cell) => /^[A-Z]$/.test(cell)));
    const vowels = countVowels(grid.cells);
    assert.ok(vowels >= Math.round(size * size * 0.28), `voyelles insuffisantes : ${vowels}`);
  }
});

test('une même graine redonne la même grille', () => {
  const first = generateBoard({ size: 4, minWords: 0, seed: 42 });
  const second = generateBoard({ size: 4, minWords: 0, seed: 42 });
  assert.deepEqual(first.board.cells, second.board.cells);
});

test('le tirage est sans remise : jamais plus de faces qu’il n’en existe', () => {
  // Le sachet ne contient qu'un Z ; une grille ne peut donc pas en contenir deux.
  for (let seed = 0; seed < 60; seed++) {
    const { board: grid } = generateBoard({ size: 4, minWords: 0, seed });
    const zeds = grid.cells.filter((cell) => cell === 'Z').length;
    assert.ok(zeds <= 1, `grille avec ${zeds} Z`);
  }
});

// ---------------------------------------------------------------------------
// Réglages
// ---------------------------------------------------------------------------

test('les réglages envoyés par le client sont bornés', () => {
  const settings = sanitizeSettings({
    boardSize: 9 as never,
    roundSeconds: 99999,
    minWordLength: 7 as never,
    scoringMode: 'triche' as never,
    endCondition: { type: 'rounds', rounds: 9999 },
  });
  assert.equal(settings.boardSize, 4, 'valeur invalide : on garde la valeur de base');
  assert.equal(settings.roundSeconds, 900);
  assert.equal(settings.minWordLength, 3);
  assert.equal(settings.scoringMode, 'classic');
  assert.deepEqual(settings.endCondition, { type: 'rounds', rounds: 50 });
});

test('les réglages valides sont conservés', () => {
  const settings = sanitizeSettings({ boardSize: 5, roundSeconds: 120, qEqualsQu: true, minWordLength: 4 });
  assert.equal(settings.boardSize, 5);
  assert.equal(settings.roundSeconds, 120);
  assert.equal(settings.qEqualsQu, true);
  assert.equal(settings.minWordLength, 4);
});

test('les pseudos sont nettoyés', () => {
  assert.equal(sanitizeNickname('  Rémi  '), 'Rémi');
  assert.equal(sanitizeNickname(''), 'Joueur');
  assert.equal(sanitizeNickname(null), 'Joueur');
  assert.equal(sanitizeNickname('x'.repeat(50)).length, 20);
});

test('les codes de salle excluent les caractères ambigus', () => {
  assert.ok(isValidRoomCode('ABCD'));
  assert.ok(!isValidRoomCode('ABC'));
  assert.ok(!isValidRoomCode('ABC0'), '0 est exclu (confusion avec O)');
  assert.ok(!isValidRoomCode('ABCI'), 'I est exclu (confusion avec 1)');
});
