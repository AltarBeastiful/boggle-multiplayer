import { useState } from 'react';

import type { GameSettings, RoomState } from '@boggle/shared';
import { scoringTable } from '@boggle/shared';

import { settingsSummary } from '../lib/labels';

import { AlertToggle } from './AlertToggle';
import { SettingsPanel } from './SettingsPanel';
import { ThemeToggle } from './ThemeToggle';

interface LobbyProps {
  room: RoomState;
  isHost: boolean;
  playerId: string;
  onStart(): Promise<void>;
  onSettings(patch: Partial<GameSettings>): Promise<void>;
  onLeave(): void;
}

export function Lobby({ room, isHost, playerId, onStart, onSettings, onLeave }: LobbyProps) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const shareUrl = `${location.origin}/r/${room.code}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Copie impossible, sélectionnez le lien à la main');
    }
  };

  const start = async () => {
    setError(null);
    setStarting(true);
    try {
      await onStart();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur inconnue');
    } finally {
      setStarting(false);
    }
  };

  const table = scoringTable(room.settings.scoringMode);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-5 py-8">
      <header className="text-center">
        {/* Their own row rather than floating over the title: two buttons are
            96 px, and on a 360 px phone the room code ran under them. */}
        <div className="mb-1 flex justify-end gap-2">
          <AlertToggle />
          <ThemeToggle />
        </div>
        <p className="text-sm tracking-widest text-fg-muted uppercase">Code de la salle</p>
        <p className="my-1 font-mono text-6xl font-black tracking-[0.2em] text-accent">{room.code}</p>
        <button
          type="button"
          onClick={() => void copy()}
          className="rounded-lg border border-border-strong px-4 py-2 text-sm text-fg-muted transition hover:border-accent hover:text-accent"
        >
          {copied ? '✓ Lien copié' : 'Copier le lien d’invitation'}
        </button>
      </header>

      <section className="rounded-2xl border border-border bg-panel p-4">
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-fg-muted uppercase">
          Joueurs ({room.players.length})
        </h2>
        <ul className="space-y-2">
          {room.players.map((player) => (
            <li key={player.id} className="flex items-center gap-2.5">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${player.connected ? 'bg-ok' : 'bg-fg-faint'}`}
                title={player.connected ? 'connecté' : 'déconnecté'}
              />
              <span className="font-medium text-fg">{player.nickname}</span>
              {player.isHost && (
                <span className="rounded bg-accent-soft px-1.5 py-0.5 text-xs text-accent">hôte</span>
              )}
              {player.id === playerId && <span className="text-xs text-fg-faint">(vous)</span>}
            </li>
          ))}
        </ul>
        {room.players.length === 1 && (
          <p className="mt-3 text-sm text-fg-faint">
            Partagez le code ou le lien : les autres joueurs apparaîtront ici.
          </p>
        )}
      </section>

      {error && (
        <p role="alert" className="rounded-lg bg-bad-bg px-4 py-2 text-center text-sm text-bad">
          {error}
        </p>
      )}

      {isHost ? (
        <button
          type="button"
          onClick={() => void start()}
          disabled={starting}
          className="w-full rounded-xl bg-accent px-4 py-4 text-lg font-bold text-accent-fg transition hover:bg-accent-hover disabled:opacity-40"
        >
          {starting ? 'Lancement…' : 'Lancer la partie'}
        </button>
      ) : (
        <p className="rounded-xl bg-panel-soft px-4 py-4 text-center text-fg-muted">
          En attente du lancement par l’hôte…
        </p>
      )}

      <details className="rounded-2xl border border-border bg-panel p-4">
        <summary className="cursor-pointer list-none">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold tracking-wide text-fg-muted uppercase">
              Règles {isHost ? '' : '(réglées par l’hôte)'}
            </h2>
            <span className="text-xs text-fg-faint">{isHost ? 'modifier' : 'voir le détail'}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {settingsSummary(room.settings).map((part) => (
              <span key={part} className="rounded-md bg-chip px-2 py-0.5 text-xs text-fg-muted">
                {part}
              </span>
            ))}
          </div>
        </summary>

        <div className="mt-4 border-t border-border pt-4">
          <SettingsPanel
            settings={room.settings}
            disabled={!isHost}
            onChange={(patch) => {
              setError(null);
              onSettings(patch).catch((cause: unknown) =>
                setError(cause instanceof Error ? cause.message : 'Erreur inconnue'),
              );
            }}
          />
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3 text-xs text-fg-faint">
            {table.map((row) => (
              <span key={row.label}>
                {row.label} lettres :{' '}
                <span className="text-fg-muted">
                  {row.points} pt{row.points > 1 ? 's' : ''}
                </span>
              </span>
            ))}
          </div>
        </div>
      </details>

      <button
        type="button"
        onClick={onLeave}
        className="mx-auto block text-sm text-fg-faint underline hover:text-fg-muted"
      >
        Quitter la salle
      </button>
    </div>
  );
}
