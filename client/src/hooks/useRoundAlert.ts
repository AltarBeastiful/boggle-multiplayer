import { useEffect, useRef } from 'react';

import type { RoomState } from '@boggle/shared';

import { flashTab } from '../lib/attention';

/** What the tab says while it waits to be looked at. */
const CALL = 'À vous de jouer !';

/**
 * A round starts for everyone at once, wherever each player happens to be
 * looking. Two beats of countdown warn the one in front of the grid and warn
 * the one in another tab of nothing at all: they come back to a clock that has
 * been running without them. So when the letters arrive and nobody is
 * watching, the tab calls out on its own.
 *
 * Only then. A player already on the page is being told by the countdown over
 * the grid, which says it better, and a tab that flashes at someone reading it
 * is just noise.
 */
export function useRoundAlert(room: RoomState | null): void {
  const round = room?.phase === 'playing' && room.round ? `${room.code}#${room.round.number}` : null;
  /** Rounds already called, so a redraw does not call the same one twice. */
  const called = useRef<string | null>(null);

  useEffect(() => {
    if (!round || called.current === round) return;
    called.current = round;
    if (document.visibilityState === 'visible') return;
    // Stops by itself on their return; this stops it if the round ends first,
    // since a tab still calling for a round that is over is calling for
    // nothing.
    return flashTab(CALL);
  }, [round]);
}
