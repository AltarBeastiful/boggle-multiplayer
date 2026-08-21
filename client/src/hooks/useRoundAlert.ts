import { useEffect, useRef } from 'react';

import type { RoomState } from '@boggle/shared';

import { callAttention } from '../lib/attention';

/** What the tab says while it waits to be looked at. */
const CALL = 'À vous de jouer !';

/**
 * A round starts for everyone at once, wherever each player happens to be
 * looking. Two beats of countdown warn the one in front of the grid and warn
 * the one in another tab of nothing at all: they come back to a clock that has
 * been running without them. So whenever a round is running and nobody is
 * watching, the game says so: the icon in the dock if it is installed there,
 * the tab otherwise.
 *
 * **Whenever, not only at the start.** Leaving in the middle of a round is the
 * same predicament as missing its beginning, and the first version only ever
 * fired on the round's first beat, so a player who looked in and left again
 * took an unmarked tab with them for the rest of the clock. The mark now
 * follows the tab: up while they are away, down the moment they are back.
 *
 * **Told once, marked as often as it takes.** A notification is an
 * interruption and belongs to the news that a round has begun; the second time
 * they wander off, they already know. So the tab is marked again and nothing
 * is sent. A player who watched the round start is counted as told, which is
 * what the countdown over the grid was for.
 *
 * The mark is never up on a tab being looked at. That is the whole reason it
 * can stay meaningful: it says something is happening without you, and coming
 * back is what answers it.
 */
export function useRoundAlert(room: RoomState | null): void {
  const started = room?.phase === 'playing' && room.round ? room.round.number : null;
  const round = started === null ? null : `${room?.code}#${started}`;
  /** The notification has room for a second line; the tab strip has not. */
  const body = started === null ? '' : `Manche ${started} dans la salle ${room?.code}.`;
  /** The last round this player has laid eyes on, so it is announced once. */
  const seen = useRef<string | null>(null);

  useEffect(() => {
    if (!round) return;
    let stop: (() => void) | undefined;

    const follow = () => {
      if (document.visibilityState === 'visible') {
        stop?.();
        stop = undefined;
        seen.current = round;
        return;
      }
      if (stop) return;
      const notify = seen.current !== round;
      seen.current = round;
      stop = callAttention({ title: CALL, body, notify });
    };

    follow();
    document.addEventListener('visibilitychange', follow);
    // Also on the way out: a round that ends while nobody came back takes the
    // call with it, rather than leaving a tab asking for something that is over.
    return () => {
      document.removeEventListener('visibilitychange', follow);
      stop?.();
    };
  }, [round, body]);
}
