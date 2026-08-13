import { useCallback, useEffect, useState } from 'react';

export type ThemePreference = 'auto' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'boggle.theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

function readPreference(): ThemePreference {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'auto';
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

function apply(theme: ResolvedTheme): void {
  document.documentElement.dataset.theme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#020617' : '#eef2f7');
}

/**
 * Thème clair / sombre. « auto » suit le réglage du système et continue de le
 * suivre s'il change en cours de partie ; un choix explicite est mémorisé.
 * Le thème initial est déjà posé par le script de index.html (pas de flash).
 */
export function useTheme() {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference);
  const [resolved, setResolved] = useState<ResolvedTheme>(() =>
    preference === 'auto' ? systemTheme() : preference,
  );

  useEffect(() => {
    const next = preference === 'auto' ? systemTheme() : preference;
    setResolved(next);
    apply(next);

    if (preference !== 'auto') return;
    const media = window.matchMedia(DARK_QUERY);
    const onChange = (event: MediaQueryListEvent) => {
      const system = event.matches ? 'dark' : 'light';
      setResolved(system);
      apply(system);
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    if (next === 'auto') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, next);
    setPreferenceState(next);
  }, []);

  return { preference, resolved, setPreference };
}
