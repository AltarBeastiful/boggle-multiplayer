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

  // Deux temps valent mieux qu'un décompte chiffré : on lit un mot d'un coup
  // d'œil, là où un chiffre demande d'attendre le suivant.
  const label = Math.ceil(left) > 1 ? 'Prêt ?' : 'Partez !';

  return (
    <div
      role="status"
      aria-live="assertive"
      className="absolute inset-0 flex items-center justify-center rounded-2xl bg-bg/45 backdrop-blur-[2px]"
    >
      <span
        key={label}
        className="animate-countdown text-5xl leading-none font-black text-accent drop-shadow-lg sm:text-6xl"
      >
        {label}
      </span>
    </div>
  );
}
