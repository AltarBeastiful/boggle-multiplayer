import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  FRENCH_FACE_BAG,
  buildDictionary,
  countVowels,
  dailyKey,
  dailySeed,
  disambiguateNicknames,
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
// Scoring, from https://www.boggle.fr/regles.php
// ---------------------------------------------------------------------------

test('classic scoring: 3-4=1, 5=2, 6=3, 7=5, 8+=11', () => {
  assert.equal(wordScore(3, 'classic'), 1);
  assert.equal(wordScore(4, 'classic'), 1);
  assert.equal(wordScore(5, 'classic'), 2);
  assert.equal(wordScore(6, 'classic'), 3);
  assert.equal(wordScore(7, 'classic'), 5);
  assert.equal(wordScore(8, 'classic'), 11);
  assert.equal(wordScore(12, 'classic'), 11);
});

// "Simplified scoring" variant, from https://www.boggle.fr/variantes.php
test('simplified scoring: one point per letter beyond the third', () => {
  assert.equal(wordScore(3, 'simplified'), 1);
  assert.equal(wordScore(4, 'simplified'), 1);
  assert.equal(wordScore(5, 'simplified'), 2);
  assert.equal(wordScore(6, 'simplified'), 3);
  assert.equal(wordScore(7, 'simplified'), 4);
  assert.equal(wordScore(8, 'simplified'), 5, 'the page gives 8 - 3 = 5');
  assert.equal(wordScore(10, 'simplified'), 7);
});

test('a word under 3 letters is worth nothing', () => {
  assert.equal(wordScore(2, 'classic'), 0);
  assert.equal(wordScore(2, 'simplified'), 0);
});

test('the points table reflects the chosen scoring', () => {
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
// Normalisation: "accents do not matter"
// ---------------------------------------------------------------------------

test('accents, ligatures and case are all folded away', () => {
  assert.equal(normalizeWord('été'), 'ETE');
  assert.equal(normalizeWord('Élève'), 'ELEVE');
  assert.equal(normalizeWord('cœur'), 'COEUR');
  assert.equal(normalizeWord('ex æquo'), 'EXAEQUO');
  assert.equal(normalizeWord('  Ça  '), 'CA');
});

// ---------------------------------------------------------------------------
// Paths across the grid
// ---------------------------------------------------------------------------

const board: Board = { size: 4, cells: 'ABCDEFGHIJKLMNOP'.split('') };
//  A B C D
//  E F G H
//  I J K L
//  M N O P

test('a word traces horizontally, vertically and diagonally', () => {
  assert.deepEqual(findPath(board, 'ABC'), [0, 1, 2]);
  assert.deepEqual(findPath(board, 'AEI'), [0, 4, 8]);
  assert.deepEqual(findPath(board, 'AFK'), [0, 5, 10], 'diagonal');
});

test('two non-adjacent tiles do not form a word', () => {
  assert.equal(findPath(board, 'AC'), null);
  assert.equal(findPath(board, 'AP'), null);
});

test('a tile cannot serve twice in the same word', () => {
  const repeated: Board = { size: 2, cells: ['T', 'O', 'X', 'Y'] };
  assert.deepEqual(findPath(repeated, 'TO'), [0, 1]);
  assert.equal(findPath(repeated, 'TOT'), null, 'the T would have to be reused');
});

test('a letter appearing twice on the grid can be used twice', () => {
  const twice: Board = { size: 2, cells: ['T', 'O', 'T', 'X'] };
  assert.deepEqual(findPath(twice, 'TOT'), [0, 1, 2]);
});

// "QU instead of Q" variant
test('Q=QU variant: a Q tile counts as Q or QU', () => {
  const withQ: Board = { size: 2, cells: ['Q', 'I', 'X', 'Y'] };
  assert.equal(findPath(withQ, 'QUI'), null, 'without the variant, a U must be on the grid');
  assert.deepEqual(findPath(withQ, 'QUI', { qEqualsQu: true }), [0, 1]);
});

test('Q=QU variant: the word stays traceable when the U is on the grid', () => {
  const withU: Board = { size: 2, cells: ['Q', 'U', 'I', 'X'] };
  assert.deepEqual(findPath(withU, 'QUI'), [0, 1, 2], 'without the variant: Q then U then I');
  // With the variant the Q tile absorbs the QU: a shorter path, just as valid.
  assert.deepEqual(findPath(withU, 'QUI', { qEqualsQu: true }), [0, 2]);
});

test('Q=QU variant: the grid U is used when the Q cannot absorb it', () => {
  // QUE: the Q absorbs QU and then needs an E, otherwise Q + U + E.
  const grid: Board = { size: 2, cells: ['Q', 'U', 'E', 'X'] };
  assert.deepEqual(findPath(grid, 'QUE'), [0, 1, 2]);
  assert.notEqual(findPath(grid, 'QUE', { qEqualsQu: true }), null);
});

// ---------------------------------------------------------------------------
// Dictionary
// ---------------------------------------------------------------------------

test('the dictionary normalises and drops non-alphabetic entries', () => {
  const dictionary = buildDictionary(['déci', 'zut', "aujourd'hui", 'a-t-il', 'ok', 'ÉTÉ']);
  assert.ok(dictionary.has('DECI'));
  assert.ok(dictionary.has('ZUT'));
  assert.ok(dictionary.has('ETE'));
  assert.ok(!dictionary.has('AUJOURDHUI'), 'apostrophe: entry dropped');
  assert.ok(!dictionary.has('ATIL'), 'hyphen: entry dropped');
  assert.ok(!dictionary.has('OK'), 'under 3 letters');
});

test('prefix search feeds the solver pruning', () => {
  const dictionary = buildDictionary(['chat', 'chien', 'chienne']);
  assert.ok(dictionary.hasPrefix('CH'));
  assert.ok(dictionary.hasPrefix('CHIEN'));
  assert.ok(!dictionary.hasPrefix('CHZ'));
  assert.ok(!dictionary.hasPrefix('Z'));
});

test('an exclusion list removes words', () => {
  const dictionary = buildDictionary(['chat', 'chien'], { exclude: ['chien'] });
  assert.ok(dictionary.has('CHAT'));
  assert.ok(!dictionary.has('CHIEN'));
});

// ---------------------------------------------------------------------------
// Solver
// ---------------------------------------------------------------------------

test('the solver finds traceable words and ignores the rest', () => {
  const dictionary = buildDictionary(['rat', 'art', 'tar', 'chien']);
  const small: Board = { size: 2, cells: ['R', 'A', 'T', 'X'] };
  const solution = solveBoard(small, dictionary, { minWordLength: 3, qEqualsQu: false });
  assert.deepEqual([...solution.words.keys()].sort(), ['ART', 'RAT', 'TAR']);
  assert.equal(solution.totalPoints, 3, '3 words of 3 letters');
});

test('the solver honours the variant minimum length', () => {
  const dictionary = buildDictionary(['rat', 'rats']);
  const small: Board = { size: 2, cells: ['R', 'A', 'T', 'S'] };
  const three = solveBoard(small, dictionary, { minWordLength: 3, qEqualsQu: false });
  const four = solveBoard(small, dictionary, { minWordLength: 4, qEqualsQu: false });
  assert.deepEqual([...three.words.keys()].sort(), ['RAT', 'RATS']);
  assert.deepEqual([...four.words.keys()], ['RATS']);
});

// ---------------------------------------------------------------------------
// Drawing grids
// ---------------------------------------------------------------------------

test('the bag holds 96 faces, being 16 dice of 6', () => {
  assert.equal(expandBag().length, 96);
  assert.equal(Object.values(FRENCH_FACE_BAG).reduce((sum, count) => sum + count, 0), 96);
});

test('a drawn grid has the right size and enough vowels', () => {
  for (const size of [4, 5] as const) {
    const { board: grid } = generateBoard({ size, minWords: 0, seed: 12345 });
    assert.equal(grid.cells.length, size * size);
    assert.ok(grid.cells.every((cell) => /^[A-Z]$/.test(cell)));
    const vowels = countVowels(grid.cells);
    assert.ok(vowels >= Math.round(size * size * 0.28), `not enough vowels: ${vowels}`);
  }
});

test('the same seed gives back the same grid', () => {
  const first = generateBoard({ size: 4, minWords: 0, seed: 42 });
  const second = generateBoard({ size: 4, minWords: 0, seed: 42 });
  assert.deepEqual(first.board.cells, second.board.cells);
});

test('drawing is without replacement, never more faces than exist', () => {
  // The bag holds a single Z, so a grid cannot contain two.
  for (let seed = 0; seed < 60; seed++) {
    const { board: grid } = generateBoard({ size: 4, minWords: 0, seed });
    const zeds = grid.cells.filter((cell) => cell === 'Z').length;
    assert.ok(zeds <= 1, `grid holding ${zeds} Z`);
  }
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

test('settings sent by the client are clamped', () => {
  const settings = sanitizeSettings({
    boardSize: 9 as never,
    roundSeconds: 99999,
    minWordLength: 7 as never,
    scoringMode: 'triche' as never,
    endCondition: { type: 'rounds', rounds: 9999 },
  });
  assert.equal(settings.boardSize, 4, 'invalid value: the base value is kept');
  assert.equal(settings.roundSeconds, 900);
  assert.equal(settings.minWordLength, 3);
  assert.equal(settings.scoringMode, 'classic');
  assert.deepEqual(settings.endCondition, { type: 'rounds', rounds: 50 });
});

test('an untimed round is null, and survives sanitising', () => {
  assert.equal(sanitizeSettings({ roundSeconds: null }).roundSeconds, null);
  assert.equal(
    sanitizeSettings({ roundSeconds: 60 }, sanitizeSettings({ roundSeconds: null })).roundSeconds,
    60,
    'a duration takes back over from an untimed round',
  );
  assert.equal(
    sanitizeSettings({}, sanitizeSettings({ roundSeconds: null })).roundSeconds,
    null,
    'an untouched setting keeps the untimed round',
  );
  assert.equal(
    sanitizeSettings({ roundSeconds: 'jamais' as never }).roundSeconds,
    180,
    'unusable value: the base duration is kept, not an endless round',
  );
});

test('the word-count hint is hidden by default', () => {
  assert.equal(sanitizeSettings({}).showSolutionCount, false);
  assert.equal(sanitizeSettings({ showSolutionCount: true }).showSolutionCount, true);
  assert.equal(
    sanitizeSettings({ showSolutionCount: 'oui' as never }).showSolutionCount,
    false,
    'invalid value: the hint stays hidden',
  );
});

test('valid settings are kept', () => {
  const settings = sanitizeSettings({ boardSize: 5, roundSeconds: 120, qEqualsQu: true, minWordLength: 4 });
  assert.equal(settings.boardSize, 5);
  assert.equal(settings.roundSeconds, 120);
  assert.equal(settings.qEqualsQu, true);
  assert.equal(settings.minWordLength, 4);
});

// ---------------------------------------------------------------------------
// Grille du jour
// ---------------------------------------------------------------------------

test('the day turns over at midnight in Paris, not in UTC', () => {
  // 21:30 UTC on 14 August is 23:30 in Paris, still the 14th.
  assert.equal(dailyKey(new Date('2026-08-14T21:30:00Z')), '2026-08-14');
  // 22:30 UTC is half past midnight in Paris: the grid has changed.
  assert.equal(dailyKey(new Date('2026-08-14T22:30:00Z')), '2026-08-15');
  // In winter Paris is one hour ahead, so the turn happens at 23:00 UTC.
  assert.equal(dailyKey(new Date('2026-01-14T22:30:00Z')), '2026-01-14');
  assert.equal(dailyKey(new Date('2026-01-14T23:30:00Z')), '2026-01-15');
});

test('a day always yields the same grid, and two days do not', () => {
  assert.equal(dailySeed('2026-08-14'), dailySeed('2026-08-14'));
  assert.notEqual(dailySeed('2026-08-14'), dailySeed('2026-08-15'));

  const grid = (day: string) =>
    generateBoard({ size: 4, seed: dailySeed(day), minWords: 0 }).board.cells.join('');
  assert.equal(grid('2026-08-14'), grid('2026-08-14'), 'the grid is rebuilt, never stored');
  assert.notEqual(grid('2026-08-14'), grid('2026-08-15'));
});

test('players sharing a nickname are numbered, in join order', () => {
  const names = disambiguateNicknames([
    { id: 'a', nickname: 'Batman' },
    { id: 'b', nickname: 'Robin' },
    { id: 'c', nickname: 'batman' },
    { id: 'd', nickname: 'BÂTMAN' },
  ]);
  assert.equal(names.get('a'), 'Batman', 'the first keeps the plain name');
  assert.equal(names.get('b'), 'Robin', 'a name held once is left alone');
  assert.equal(names.get('c'), 'batman (2)', 'case is not a distinction on a scoreboard');
  assert.equal(names.get('d'), 'BÂTMAN (3)', 'nor are accents');
});

test('nicknames are cleaned up', () => {
  assert.equal(sanitizeNickname('  Rémi  '), 'Rémi');
  assert.equal(sanitizeNickname(''), 'Joueur');
  assert.equal(sanitizeNickname(null), 'Joueur');
  assert.equal(sanitizeNickname('x'.repeat(50)).length, 20);
});

test('room codes exclude ambiguous characters', () => {
  assert.ok(isValidRoomCode('ABCD'));
  assert.ok(!isValidRoomCode('ABC'));
  assert.ok(!isValidRoomCode('ABC0'), '0 is excluded, too close to O');
  assert.ok(!isValidRoomCode('ABCI'), 'I is excluded, too close to 1');
});
