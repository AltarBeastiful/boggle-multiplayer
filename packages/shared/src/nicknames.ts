import { normalizeLetters } from './normalize.js';

/**
 * Two players called "Batman" are two players to the server, which keys on the
 * identifier, and one name to everyone else: the scores, the word counts and
 * the finders of a solution all become unreadable.
 *
 * Rather than refuse a name somebody has every right to, the later arrivals are
 * numbered. The order given is the join order, so the first Batman keeps the
 * plain name and does not see it change when a second one turns up.
 *
 * Accents and case are folded for the comparison: "Rémi" and "remi" are a
 * distinction nobody can make out on a scoreboard.
 */
export function disambiguateNicknames(
  players: ReadonlyArray<{ id: string; nickname: string }>,
): Map<string, string> {
  const taken = new Map<string, number>();
  const names = new Map<string, string>();
  for (const player of players) {
    const key = normalizeLetters(player.nickname).trim();
    const rank = (taken.get(key) ?? 0) + 1;
    taken.set(key, rank);
    names.set(player.id, rank === 1 ? player.nickname : `${player.nickname} (${rank})`);
  }
  return names;
}
