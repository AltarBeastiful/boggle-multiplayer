import { useNotifications } from '../hooks/useNotifications';

function Bell({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="h-4 w-4">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 9a6 6 0 0 1 12 0c0 6 2.5 8 2.5 8h-17S6 15 6 9z" />
      <path strokeLinecap="round" d="M10.2 21a2 2 0 0 0 3.6 0" />
      {muted && <path strokeLinecap="round" d="M3 3l18 18" />}
    </svg>
  );
}

/**
 * Asks the browser for the right to interrupt, and never before it is pressed.
 *
 * It sits beside the theme button rather than in the settings panel because
 * those settings belong to the room and this one belongs to the player: the
 * host chooses the grid, each player chooses whether their machine is allowed
 * to say something.
 */
export function AlertToggle({ className = '' }: { className?: string }) {
  const { supported, blocked, on, toggle } = useNotifications();
  if (!supported) return null;

  const label = blocked
    ? 'Notifications bloquées pour ce site dans les réglages du navigateur'
    : on
      ? 'Prévenir au début de la manche : activé'
      : 'Prévenir au début de la manche : désactivé';

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={blocked}
      aria-pressed={on}
      title={label}
      aria-label={label}
      className={[
        'inline-flex h-11 w-11 items-center justify-center rounded-xl border border-border',
        'bg-panel transition',
        blocked
          ? 'cursor-not-allowed text-fg-faint opacity-60'
          : on
            ? 'text-accent hover:border-accent'
            : 'text-fg-muted hover:border-accent hover:text-accent',
        className,
      ].join(' ')}
    >
      <Bell muted={!on} />
    </button>
  );
}
