import { useEffect, useState } from 'react';

interface RoundCountdownProps {
  /** Start instant given by the server, epoch ms. */
  startsAt: number;
  clockOffset: number;
}

/**
 * Countdown shown over the blurred grid. It follows the server clock, so
 * everyone sees the letters at the same instant whenever their grid arrived.
 */
export function RoundCountdown({ startsAt, clockOffset }: RoundCountdownProps) {
  const remaining = () => (startsAt - (Date.now() + clockOffset)) / 1000;
  const [left, setLeft] = useState(remaining);

  useEffect(() => {
    const id = setInterval(() => setLeft(remaining()), 80);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startsAt, clockOffset]);

  // Two beats beat a numeric countdown: a word reads at a glance, where a
  // digit makes you wait for the next one.
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
