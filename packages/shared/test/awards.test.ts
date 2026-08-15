import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MAX_AWARDS_PER_PLAYER,
  computeAwards,
  emptyMetrics,
  restoreMetrics,
  type AwardEntry,
  type PlayerMetrics,
} from '../dist/index.js';

function player(playerId: string, patch: Partial<PlayerMetrics>): AwardEntry {
  return { playerId, nickname: playerId, metrics: { ...emptyMetrics(), ...patch } };
}

/** The award ids a player walked away with. */
function idsFor(result: ReturnType<typeof computeAwards>, playerId: string): string[] {
  return result.find((entry) => entry.playerId === playerId)?.awards.map((award) => award.id) ?? [];
}

test('the longest word of the game is worth a Gros Cerveau', () => {
  const awards = computeAwards([
    player('long', { accepted: 4, points: 8, longestWord: 'PLANCHER' }),
    player('short', { accepted: 4, points: 8, longestWord: 'PLAN' }),
  ]);
  assert.ok(idsFor(awards, 'long').includes('big-brain'));
  assert.ok(!idsFor(awards, 'short').includes('big-brain'));
});

test('a longest word of five letters is nobody‘s Gros Cerveau', () => {
  const awards = computeAwards([
    player('a', { accepted: 3, points: 5, longestWord: 'PLANS' }),
    player('b', { accepted: 3, points: 5, longestWord: 'PLAN' }),
  ]);
  assert.ok(!idsFor(awards, 'a').includes('big-brain'));
});

test('an award can be shared: two players tie on the longest word', () => {
  const awards = computeAwards([
    player('a', { accepted: 4, points: 8, longestWord: 'PLANCHE' }),
    player('b', { accepted: 4, points: 8, longestWord: 'TRACTEU' }),
  ]);
  assert.ok(idsFor(awards, 'a').includes('big-brain'));
  assert.ok(idsFor(awards, 'b').includes('big-brain'));
});

test('points made mostly of long words earn Longue Portée', () => {
  const awards = computeAwards([
    player('a', { accepted: 6, points: 20, longWords: 4, longPoints: 15, longestWord: 'PLANCHE' }),
  ]);
  assert.ok(idsFor(awards, 'a').includes('long-shot'));
});

test('a heap of three-letter words earns Grignoteur, not Longue Portée', () => {
  const awards = computeAwards([
    player('a', { accepted: 20, points: 20, shortWords: 18, longWords: 1, longPoints: 3, longestWord: 'PLANCHE' }),
  ]);
  const ids = idsFor(awards, 'a');
  assert.ok(ids.includes('nibbler'));
  assert.ok(!ids.includes('long-shot'));
});

test('words that come quickly earn a Lièvre, slow ones a Tortue', () => {
  const awards = computeAwards([
    player('quick', { accepted: 8, points: 10, waits: 8, waitMs: 8 * 6_000 }),
    player('slow', { accepted: 4, points: 6, waits: 4, waitMs: 4 * 55_000 }),
  ]);
  assert.ok(idsFor(awards, 'quick').includes('hare'));
  assert.ok(idsFor(awards, 'slow').includes('tortoise'));
});

test('inventing words is told apart from misreading the grid', () => {
  const awards = computeAwards([
    player('inventor', { attempts: 30, accepted: 10, invented: 18, points: 10 }),
    player('dreamer', { attempts: 30, accepted: 12, offBoard: 15, points: 12 }),
  ]);
  assert.ok(idsFor(awards, 'inventor').includes('brute-force'));
  assert.ok(idsFor(awards, 'dreamer').includes('mirage'));
  assert.ok(!idsFor(awards, 'inventor').includes('mirage'));
});

test('a comparative award goes unhanded in a room of one', () => {
  // Every word is "found by nobody else" when there is nobody else.
  const alone = computeAwards([player('solo', { accepted: 12, points: 20, soloWords: 12 })]);
  assert.ok(!idsFor(alone, 'solo').includes('ghost'));
  assert.ok(!idsFor(alone, 'solo').includes('harvester'));

  const crowd = computeAwards([
    player('solo', { accepted: 12, points: 20, soloWords: 12 }),
    player('other', { accepted: 4, points: 6, sharedWords: 4 }),
  ]);
  assert.ok(idsFor(crowd, 'solo').includes('ghost'));
});

test('nobody carries more than three', () => {
  const awards = computeAwards([
    player('everything', {
      attempts: 40,
      accepted: 38,
      points: 60,
      longWords: 10,
      longPoints: 40,
      longestWord: 'PLANCHER',
      soloWords: 20,
      openings: 3,
      waits: 38,
      waitMs: 38 * 5_000,
      rounds: 3,
    }),
    player('quiet', { attempts: 4, accepted: 2, points: 2, sharedWords: 2, rounds: 3 }),
  ]);
  assert.equal(idsFor(awards, 'everything').length, MAX_AWARDS_PER_PLAYER);
  // Ordered by what says most about the player, so the rarest comes first.
  assert.equal(idsFor(awards, 'everything')[0], 'big-brain');
});

test('everybody leaves with something', () => {
  const awards = computeAwards([
    // Nothing to say about this one: a few words, half of them shared, no
    // extreme anywhere. Exactly the player the fallback exists for.
    player('middling', { attempts: 7, accepted: 4, points: 6, shortWords: 1, sharedWords: 2, soloWords: 2 }),
    player('watcher', { attempts: 2, accepted: 0 }),
  ]);
  for (const entry of awards) assert.ok(entry.awards.length >= 1, `${entry.playerId} left empty-handed`);
  assert.deepEqual(idsFor(awards, 'watcher'), ['bystander']);
  assert.deepEqual(idsFor(awards, 'middling'), ['all-rounder']);
});

test('an award always carries the figure that earned it', () => {
  const awards = computeAwards([player('a', { accepted: 4, points: 8, longestWord: 'PLANCHER' })]);
  const award = awards[0]?.awards[0];
  assert.equal(award?.id, 'big-brain');
  assert.match(award?.detail ?? '', /PLANCHER, 8 lettres/);
});

test('a room where nobody played still returns a card each', () => {
  const awards = computeAwards([player('a', {}), player('b', {})]);
  assert.equal(awards.length, 2);
  for (const entry of awards) assert.deepEqual(entry.awards.map((a) => a.id), ['bystander']);
});

// ---------------------------------------------------------------------------
// Metrics read back from disk
// ---------------------------------------------------------------------------

test('metrics saved by an older version come back whole', () => {
  const restored = restoreMetrics({ accepted: 7, longestWord: 'PLANCHE' });
  assert.equal(restored.accepted, 7);
  assert.equal(restored.longestWord, 'PLANCHE');
  assert.equal(restored.openings, 0, 'a field the file never had falls back to zero');
});

test('a corrupt metrics record does not poison an award', () => {
  const restored = restoreMetrics({ accepted: -5, points: 'beaucoup', longestWord: 42, waits: Infinity });
  assert.equal(restored.accepted, 0);
  assert.equal(restored.points, 0);
  assert.equal(restored.longestWord, '');
  assert.equal(restored.waits, 0);
});

test('anything that is not a record reads as a blank slate', () => {
  assert.deepEqual(restoreMetrics(null), emptyMetrics());
  assert.deepEqual(restoreMetrics('rien'), emptyMetrics());
});
