import { useEffect, useState, type FormEvent } from 'react';

import { normalizeRoomCode, type DailyTeaser } from '@boggle/shared';

import { dailyApi } from '../lib/daily';
import { getNickname, setNickname } from '../lib/storage';
import { ThemeToggle } from './ThemeToggle';

interface HomeProps {
  connected: boolean;
  initialCode: string;
  onCreate(nickname: string): Promise<unknown>;
  onJoin(code: string, nickname: string): Promise<unknown>;
  onDaily(): void;
}

export function Home({ connected, initialCode, onCreate, onJoin, onDaily }: HomeProps) {
  const [nickname, setNicknameValue] = useState(getNickname);
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [daily, setDaily] = useState<DailyTeaser | null>(null);

  // The daily grid is worth mentioning only if the server can serve it.
  useEffect(() => {
    let cancelled = false;
    void dailyApi.teaser().then((teaser) => {
      if (!cancelled) setDaily(teaser);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const run = async (kind: 'create' | 'join', action: () => Promise<unknown>) => {
    setError(null);
    setBusy(kind);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur inconnue');
    } finally {
      setBusy(null);
    }
  };

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    void run('create', () => onCreate(nickname.trim() || 'Joueur'));
  };

  const handleJoin = (event: FormEvent) => {
    event.preventDefault();
    const cleaned = normalizeRoomCode(code);
    if (cleaned.length < 4) {
      setError('Entrez le code à 4 caractères de la salle');
      return;
    }
    void run('join', () => onJoin(cleaned, nickname.trim() || 'Joueur'));
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-8 px-5 py-10">
      <header className="relative text-center">
        <div className="absolute -top-2 right-0">
          <ThemeToggle />
        </div>
        <h1 className="text-5xl font-black tracking-tight text-accent">BOGGLE</h1>
        <p className="mt-2 text-fg-muted">
          Trouvez un maximum de mots en 3 minutes. À plusieurs, en temps réel.
        </p>
      </header>

      <div>
        <label htmlFor="nickname" className="mb-1.5 block text-sm font-medium text-fg-muted">
          Votre pseudo
        </label>
        <input
          id="nickname"
          value={nickname}
          onChange={(event) => setNicknameValue(event.target.value)}
          maxLength={20}
          placeholder="Ex. Batman"
          autoComplete="nickname"
          className="w-full rounded-xl border border-border-strong bg-panel-soft px-4 py-3 text-lg text-fg outline-none placeholder:text-fg-faint focus:border-accent"
        />
      </div>

      <form onSubmit={handleCreate}>
        <button
          type="submit"
          disabled={!connected || busy !== null}
          className="w-full rounded-xl bg-accent px-4 py-4 text-lg font-bold text-accent-fg transition hover:bg-accent-hover disabled:opacity-40"
        >
          {busy === 'create' ? 'Création…' : 'Créer une partie'}
        </button>
      </form>

      <div className="flex items-center gap-3 text-xs tracking-widest text-fg-faint uppercase">
        <span className="h-px flex-1 bg-chip" />
        ou
        <span className="h-px flex-1 bg-chip" />
      </div>

      <form onSubmit={handleJoin} className="flex gap-2">
        <input
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          maxLength={6}
          placeholder="CODE"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Code de la salle"
          className="w-full rounded-xl border border-border-strong bg-panel-soft px-4 py-3 text-center font-mono text-2xl tracking-[0.3em] text-fg uppercase outline-none placeholder:tracking-normal placeholder:text-fg-faint focus:border-accent"
        />
        <button
          type="submit"
          disabled={!connected || busy !== null}
          className="shrink-0 rounded-xl border border-border-strong px-5 py-3 font-semibold text-fg transition hover:border-accent hover:text-accent disabled:opacity-40"
        >
          {busy === 'join' ? '…' : 'Rejoindre'}
        </button>
      </form>

      {/*
        The grille du jour asks for nothing: no room, no code, no waiting for
        anyone. It sits under the multiplayer entry rather than above it,
        because the game is a game between people first.
      */}
      {daily && (
        <button
          type="button"
          onClick={() => {
            setNickname(nickname.trim() || 'Joueur');
            onDaily();
          }}
          className="rounded-xl border border-border-strong bg-panel px-4 py-3 text-left transition hover:border-accent"
        >
          <span className="block font-semibold text-fg">Grille du jour</span>
          <span className="mt-0.5 block text-sm text-fg-faint">
            {daily.done
              ? 'Vous l’avez terminée, revoyez le classement'
              : 'La même grille pour tout le monde, seul et sans chrono'}
            {daily.playerCount > 0 &&
              ` · ${daily.playerCount} joueur${daily.playerCount > 1 ? 's' : ''} aujourd’hui`}
          </span>
        </button>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-bad-bg px-4 py-2 text-center text-sm text-bad">
          {error}
        </p>
      )}

      {!connected && (
        <p className="text-center text-sm text-fg-faint">Connexion au serveur…</p>
      )}

      <footer className="text-center text-xs leading-relaxed text-fg-faint">
        Règles et variantes d'après{' '}
        <a href="https://www.boggle.fr/regles.php" className="underline hover:text-fg-muted">
          boggle.fr
        </a>
      </footer>
    </div>
  );
}
