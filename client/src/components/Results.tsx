import { useState } from 'react';

import type { PlayerRoundResult, RoomState, RoundResults, ScoredWord } from '@boggle/shared';

import { BoardGrid } from './BoardGrid';

interface ResultsProps {
  room: RoomState;
  results: RoundResults;
  isHost: boolean;
  playerId: string;
  onNext(): Promise<void>;
  onReset(): Promise<void>;
  onLeave(): void;
}

function WordChip({ word, onHover }: { word: ScoredWord; onHover?: () => void }) {
  const cancelled = word.status === 'duplicate';
  return (
    <span
      onMouseEnter={onHover}
      className={[
        'rounded-lg px-2.5 py-1 text-sm',
        cancelled ? 'bg-slate-800/50 text-slate-500 line-through' : 'bg-slate-800 text-slate-200',
      ].join(' ')}
      title={cancelled ? `Trouvé par ${word.foundBy} joueurs, donc annulé` : undefined}
    >
      {word.word}
      <span className="ml-1.5 text-xs text-slate-500">{word.points}</span>
    </span>
  );
}

function PlayerWords({ player, highlight }: { player: PlayerRoundResult; highlight(word: string): void }) {
  if (player.words.length === 0) {
    return <p className="text-sm text-slate-600">Aucun mot trouvé.</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {player.words.map((word) => (
        <WordChip key={word.word} word={word} onHover={() => highlight(word.word)} />
      ))}
    </div>
  );
}

export function Results({ room, results, isHost, playerId, onNext, onReset, onLeave }: ResultsProps) {
  const [highlight, setHighlight] = useState<number[] | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Retrouve le chemin d'un mot pour l'afficher sur la grille. */
  const highlightWord = (word: string) => {
    const missed = results.missedWords.find((entry) => entry.word === word);
    if (missed) setHighlight(missed.path);
  };

  const me = results.players.find((player) => player.playerId === playerId);
  const others = results.players.filter((player) => player.playerId !== playerId);
  const standings = [...results.players].sort((a, b) => b.totalScore - a.totalScore);
  const winner = standings[0];

  const act = async (action: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur inconnue');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 px-5 py-8">
      <header className="text-center">
        {results.gameOver ? (
          <>
            <h1 className="text-3xl font-black text-amber-400">Partie terminée</h1>
            {winner && (
              <p className="mt-1 text-slate-300">
                🏆 <span className="font-semibold">{winner.nickname}</span> l’emporte avec {winner.totalScore} points
              </p>
            )}
          </>
        ) : (
          <>
            <h1 className="text-3xl font-black text-slate-100">Manche {results.roundNumber} terminée</h1>
            <p className="mt-1 text-sm text-slate-500">
              {results.solutionCount} mots dans la grille, {results.solutionPoints} points possibles
            </p>
          </>
        )}
      </header>

      <div className="mx-auto max-w-xs">
        <BoardGrid
          cells={results.board}
          size={room.settings.boardSize}
          highlight={highlight}
          qEqualsQu={room.settings.qEqualsQu}
          compact
        />
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-900 text-xs tracking-wide text-slate-500 uppercase">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Joueur</th>
              <th className="px-3 py-2 text-right font-medium">Manche</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((player, index) => (
              <tr
                key={player.playerId}
                className={`border-t border-slate-800 ${player.playerId === playerId ? 'bg-amber-400/5' : ''}`}
              >
                <td className="px-3 py-2 text-slate-200">
                  <span className="mr-2 text-slate-600">{index + 1}</span>
                  {player.nickname}
                  {player.playerId === playerId && <span className="ml-1.5 text-xs text-slate-500">(vous)</span>}
                </td>
                <td className="px-3 py-2 text-right text-slate-400">+{player.roundScore}</td>
                <td className="px-3 py-2 text-right font-semibold text-slate-100">{player.totalScore}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {me && (
        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          <h2 className="mb-2 text-sm font-semibold tracking-wide text-slate-400 uppercase">
            Vos mots : {me.roundScore} pts
            {room.settings.duplicateMode === 'cancel' && (
              <span className="ml-2 font-normal text-slate-600 normal-case">
                (barrés = trouvés par un autre joueur)
              </span>
            )}
          </h2>
          <PlayerWords player={me} highlight={highlightWord} />
        </section>
      )}

      {others.map((player) => (
        <details key={player.playerId} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          <summary className="cursor-pointer text-sm font-semibold tracking-wide text-slate-400 uppercase">
            {player.nickname} : {player.roundScore} pts ({player.words.length} mots)
          </summary>
          <div className="mt-3">
            <PlayerWords player={player} highlight={highlightWord} />
          </div>
        </details>
      ))}

      <details className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
        <summary className="cursor-pointer text-sm font-semibold tracking-wide text-slate-400 uppercase">
          Les meilleurs mots manqués ({results.missedWords.length})
        </summary>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {results.missedWords.map((missed) => (
            <button
              key={missed.word}
              type="button"
              onMouseEnter={() => setHighlight(missed.path)}
              onClick={() => setHighlight(missed.path)}
              className="rounded-lg bg-slate-800 px-2.5 py-1 text-sm text-slate-300 transition hover:bg-amber-400 hover:text-slate-950"
            >
              {missed.word}
              <span className="ml-1.5 text-xs opacity-60">{missed.points}</span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-600">Survolez un mot pour le voir sur la grille.</p>
      </details>

      {error && (
        <p role="alert" className="rounded-lg bg-red-950/60 px-4 py-2 text-center text-sm text-red-300">
          {error}
        </p>
      )}

      {isHost ? (
        <div className="space-y-2">
          {!results.gameOver && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void act(onNext)}
              className="w-full rounded-xl bg-amber-400 px-4 py-4 text-lg font-bold text-slate-950 transition hover:bg-amber-300 disabled:opacity-40"
            >
              Manche suivante
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void act(onReset)}
            className={`w-full rounded-xl px-4 py-3 font-semibold transition disabled:opacity-40 ${
              results.gameOver
                ? 'bg-amber-400 text-slate-950 hover:bg-amber-300'
                : 'border border-slate-700 text-slate-300 hover:border-slate-500'
            }`}
          >
            Nouvelle partie
          </button>
        </div>
      ) : (
        <p className="rounded-xl bg-slate-900 px-4 py-4 text-center text-slate-400">
          En attente de l’hôte…
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
