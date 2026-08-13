import { useEffect, useState } from 'react';

import { formatDuration } from '../lib/labels';

interface TimerProps {
  /** Début effectif : pendant le décompte, le chrono affiche la durée pleine. */
  startsAt: number;
  endsAt: number;
  /** Décalage horloge serveur - client. */
  clockOffset: number;
  totalSeconds: number;
}

export function Timer({ startsAt, endsAt, clockOffset, totalSeconds }: TimerProps) {
  const compute = () => (endsAt - Math.max(Date.now() + clockOffset, startsAt)) / 1000;
  const [remaining, setRemaining] = useState(compute);

  useEffect(() => {
    const tick = () => setRemaining(compute());
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startsAt, endsAt, clockOffset]);

  const clamped = Math.max(0, remaining);
  const ratio = totalSeconds > 0 ? Math.min(1, clamped / totalSeconds) : 0;
  const urgent = clamped <= 10;
  const warning = clamped <= 30;

  return (
    <div className="w-full">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs tracking-wide text-fg-muted uppercase">Temps restant</span>
        <span
          className={[
            'font-mono text-2xl font-bold tabular-nums',
            urgent ? 'animate-pulse text-bad' : warning ? 'text-accent' : 'text-fg',
          ].join(' ')}
        >
          {formatDuration(clamped)}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-chip">
        <div
          className={[
            'h-full rounded-full transition-[width] duration-200 ease-linear',
            urgent ? 'bg-bad' : warning ? 'bg-accent' : 'bg-ok',
          ].join(' ')}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  );
}
