import { useEffect, useState } from 'react';

import { formatDuration } from '../lib/labels';

interface TimerProps {
  endsAt: number;
  /** Décalage horloge serveur - client. */
  clockOffset: number;
  totalSeconds: number;
}

export function Timer({ endsAt, clockOffset, totalSeconds }: TimerProps) {
  const [remaining, setRemaining] = useState(() => (endsAt - (Date.now() + clockOffset)) / 1000);

  useEffect(() => {
    const tick = () => setRemaining((endsAt - (Date.now() + clockOffset)) / 1000);
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [endsAt, clockOffset]);

  const clamped = Math.max(0, remaining);
  const ratio = totalSeconds > 0 ? Math.min(1, clamped / totalSeconds) : 0;
  const urgent = clamped <= 10;
  const warning = clamped <= 30;

  return (
    <div className="w-full">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs tracking-wide text-slate-400 uppercase">Temps restant</span>
        <span
          className={[
            'font-mono text-2xl font-bold tabular-nums',
            urgent ? 'animate-pulse text-red-400' : warning ? 'text-amber-300' : 'text-slate-100',
          ].join(' ')}
        >
          {formatDuration(clamped)}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
        <div
          className={[
            'h-full rounded-full transition-[width] duration-200 ease-linear',
            urgent ? 'bg-red-500' : warning ? 'bg-amber-400' : 'bg-emerald-400',
          ].join(' ')}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  );
}
