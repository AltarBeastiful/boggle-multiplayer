import { useEffect, useState } from 'react';

import { formatDuration } from '../lib/labels';

interface TimerProps {
  /** Actual start; during the countdown the clock shows the full duration. */
  startsAt: number;
  /** Null for an untimed round: the clock then counts up, and says nothing
   *  about how much is left, because nothing is. */
  endsAt: number | null;
  /** Offset between the server clock and the client one. */
  clockOffset: number;
}

export function Timer({ startsAt, endsAt, clockOffset }: TimerProps) {
  /** Server time, held at the start line during the pre-round countdown. */
  const now = () => Math.max(Date.now() + clockOffset, startsAt);
  const compute = () => (endsAt === null ? now() - startsAt : endsAt - now()) / 1000;
  const [seconds, setSeconds] = useState(compute);

  useEffect(() => {
    const tick = () => setSeconds(compute());
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startsAt, endsAt, clockOffset]);

  const untimed = endsAt === null;
  const clamped = Math.max(0, seconds);
  // The whole round, deduced rather than passed in: it cannot disagree.
  const total = untimed ? 0 : (endsAt - startsAt) / 1000;
  const ratio = total > 0 ? Math.min(1, clamped / total) : 1;
  const urgent = !untimed && clamped <= 10;
  const warning = !untimed && clamped <= 30;

  return (
    <div className="w-full">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs tracking-wide text-fg-muted uppercase">
          {untimed ? 'Sans limite' : 'Temps restant'}
        </span>
        <span
          className={[
            'font-mono text-2xl font-bold tabular-nums',
            urgent ? 'animate-pulse text-bad' : warning ? 'text-accent' : untimed ? 'text-fg-muted' : 'text-fg',
          ].join(' ')}
        >
          {formatDuration(clamped)}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-chip">
        {/* Untimed: a full, still bar. An empty one would read as time up. */}
        <div
          className={[
            'h-full rounded-full transition-[width] duration-200 ease-linear',
            urgent ? 'bg-bad' : warning ? 'bg-accent' : untimed ? 'bg-chip-hover' : 'bg-ok',
          ].join(' ')}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  );
}
