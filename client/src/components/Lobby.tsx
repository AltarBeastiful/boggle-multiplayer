import { useState } from 'react';

import type { GameSettings, RoomState } from '@boggle/shared';
import { scoringTable } from '@boggle/shared';

import { SettingsPanel } from './SettingsPanel';

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
      setError("Copie impossible, sélectionnez le lien à la main");
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
        <p className="text-sm tracking-widest text-slate-400 uppercase">Code de la salle</p>
        <p className="my-1 font-mono text-6xl font-black tracking-[0.2em] text-amber-400">{room.code}</p>
        <button
          type="button"
          onClick={() => void copy()}
          className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-amber-400 hover:text-amber-300"
        >
          {copied ? '✓ Lien copié' : 'Copier le lien d’invitation'}
        </button>
      </header>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-400 uppercase">
          Joueurs ({room.players.length})
        </h2>
        <ul className="space-y-2">
          {room.players.map((player) => (
            <li key={player.id} className="flex items-center gap-2.5">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${player.connected ? 'bg-emerald-400' : 'bg-slate-600'}`}
                title={player.connected ? 'connecté' : 'déconnecté'}
              />
              <span className="font-medium text-slate-100">{player.nickname}</span>
              {player.isHost && (
                <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-xs text-amber-300">hôte</span>
              )}
              {player.id === playerId && <span className="text-xs text-slate-500">(vous)</span>}
            </li>
          ))}
        </ul>
        {room.players.length === 1 && (
          <p className="mt-3 text-sm text-slate-500">
            Partagez le code ou le lien : les autres joueurs apparaîtront ici.
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-400 uppercase">
          Règles {isHost ? '' : '(réglées par l’hôte)'}
        </h2>
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
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-800 pt-3 text-xs text-slate-500">
          {table.map((row) => (
            <span key={row.label}>
              {row.label} lettres : <span className="text-slate-300">{row.points} pt{row.points > 1 ? 's' : ''}</span>
            </span>
          ))}
        </div>
      </section>

      {error && (
        <p role="alert" className="rounded-lg bg-red-950/60 px-4 py-2 text-center text-sm text-red-300">
          {error}
        </p>
      )}

      {isHost ? (
        <button
          type="button"
          onClick={() => void start()}
          disabled={starting}
          className="w-full rounded-xl bg-amber-400 px-4 py-4 text-lg font-bold text-slate-950 transition hover:bg-amber-300 disabled:opacity-40"
        >
          {starting ? 'Lancement…' : 'Lancer la partie'}
        </button>
      ) : (
        <p className="rounded-xl bg-slate-900 px-4 py-4 text-center text-slate-400">
          En attente du lancement par l’hôte…
        </p>
      )}

      <button
        type="button"
        onClick={onLeave}
        className="mx-auto block text-sm text-slate-500 underline hover:text-slate-300"
      >
        Quitter la salle
      </button>
    </div>
  );
}
