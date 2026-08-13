import { useEffect, useState } from 'react';

interface RoundCountdownProps {
  /** Instant de départ donné par le serveur (epoch ms). */
  startsAt: number;
  clockOffset: number;
}

/**
 * Décompte affiché par-dessus la grille floutée. Il se cale sur l'horloge du
 * serveur : tout le monde voit les lettres au même instant, quel que soit le
 * moment où sa grille est arrivée.
 */
export function RoundCountdown({ startsAt, clockOffset }: RoundCountdownProps) {
  const remaining = () => (startsAt - (Date.now() + clockOffset)) / 1000;
  const [left, setLeft] = useState(remaining);

  useEffect(() => {
    const id = setInterval(() => setLeft(remaining()), 80);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startsAt, clockOffset]);

  const shown = Math.max(1, Math.ceil(left));

  return (
    <div
      role="status"
      aria-live="assertive"
      aria-label={`La manche commence dans ${shown}`}
      className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-2xl bg-bg/45 backdrop-blur-[2px]"
    >
      <span
        key={shown}
        className="animate-countdown font-black text-accent tabular-nums drop-shadow-lg text-8xl leading-none"
      >
        {shown}
      </span>
      <span className="text-xs font-semibold tracking-[0.35em] text-fg-muted uppercase">
        Préparez-vous
      </span>
    </div>
  );
}
