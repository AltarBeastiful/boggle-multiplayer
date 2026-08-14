import { useTheme, type ThemePreference } from '../hooks/useTheme';

const ORDER: ThemePreference[] = ['auto', 'light', 'dark'];

const LABELS: Record<ThemePreference, string> = {
  auto: 'Thème : automatique',
  light: 'Thème : clair',
  dark: 'Thème : sombre',
};

function Icon({ preference }: { preference: ThemePreference }) {
  if (preference === 'light') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="h-4 w-4">
        <circle cx="12" cy="12" r="4.5" />
        <path strokeLinecap="round" d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
      </svg>
    );
  }
  if (preference === 'dark') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="h-4 w-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5z" />
      </svg>
    );
  }
  // Automatic: a disc half light, half dark.
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="h-4 w-4">
      <circle cx="12" cy="12" r="8.5" />
      <path fill="currentColor" stroke="none" d="M12 3.5a8.5 8.5 0 0 1 0 17z" />
    </svg>
  );
}

/** Compact button cycling automatic, then light, then dark. */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const { preference, setPreference } = useTheme();
  const next = ORDER[(ORDER.indexOf(preference) + 1) % ORDER.length] as ThemePreference;

  return (
    <button
      type="button"
      onClick={() => setPreference(next)}
      title={`${LABELS[preference]}. Cliquer pour passer en ${LABELS[next].replace('Thème : ', '')}`}
      aria-label={`${LABELS[preference]}. Activer le thème ${LABELS[next].replace('Thème : ', '')}`}
      className={[
        'inline-flex h-11 w-11 items-center justify-center rounded-xl border border-border',
        'bg-panel text-fg-muted transition hover:border-accent hover:text-accent',
        className,
      ].join(' ')}
    >
      <Icon preference={preference} />
    </button>
  );
}
