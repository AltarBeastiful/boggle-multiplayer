import { useState } from 'react';

import type { PlayerRoundResult, RoomState, RoundResults, ScoredWord } from '@boggle/shared';

import { BoardGrid } from './BoardGrid';
import { DefinitionCard } from './DefinitionCard';
import { SolutionPanel } from './SolutionPanel';
import { ThemeToggle } from './ThemeToggle';

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
        cancelled ? 'bg-chip/50 text-fg-faint line-through' : 'bg-chip text-fg',
      ].join(' ')}
      title={cancelled ? `Trouvé par ${word.foundBy} joueurs, donc annulé` : undefined}
    >
      {word.word}
      <span className="ml-1.5 text-xs text-fg-faint">{word.points}</span>
    </span>
  );
}

function PlayerWords({ player, highlight }: { player: PlayerRoundResult; highlight(word: string): void }) {
  if (player.words.length === 0) {
    return <p className="text-sm text-fg-faint">Aucun mot trouvé.</p>;
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
  /** Word whose definition is being read, lifted here to show it beside the grid. */
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Finds a word's path so it can be shown on the grid. */
  const highlightWord = (word: string) => {
    const found = results.solution.find((entry) => entry.word === word);
    if (found) setHighlight(found.path);
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
    <div className="mx-auto w-full max-w-2xl space-y-5 px-5 py-8 lg:max-w-6xl">
      <header className="relative text-center">
        <div className="absolute top-0 right-0">
          <ThemeToggle />
        </div>
        {results.gameOver ? (
          <>
            <h1 className="text-3xl font-black text-accent">Partie terminée</h1>
            {winner && (
              <p className="mt-1 text-fg-muted">
                🏆 <span className="font-semibold">{winner.nickname}</span> l’emporte avec {winner.totalScore}{' '}
                points
              </p>
            )}
          </>
        ) : (
          <>
            <h1 className="text-3xl font-black text-fg">Manche {results.roundNumber} terminée</h1>
            <p className="mt-1 text-sm text-fg-faint">
              {results.solutionCount} mots dans la grille, {results.solutionPoints} points possibles
            </p>
          </>
        )}
      </header>

      {/*
        Sur grand écran, deux colonnes : la grille, le classement et la
        définition restent sous les yeux pendant qu'on parcourt les solutions.
        Sans cela il fallait remonter à chaque mot survolé pour voir son tracé.
      */}
      <div className="lg:grid lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start lg:gap-6">
        <div className="space-y-5 lg:sticky lg:top-6">
          <div className="mx-auto max-w-xs lg:mx-0 lg:max-w-none">
            <BoardGrid
              cells={results.board}
              size={room.settings.boardSize}
              highlight={highlight}
              qEqualsQu={room.settings.qEqualsQu}
              compact
            />
          </div>

          <section className="overflow-hidden rounded-2xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-panel-soft text-xs tracking-wide text-fg-faint uppercase">
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
                    className={`border-t border-border ${player.playerId === playerId ? 'bg-accent-soft' : ''}`}
                  >
                    <td className="px-3 py-2 text-fg">
                      <span className="mr-2 text-fg-faint">{index + 1}</span>
                      {player.nickname}
                      {player.playerId === playerId && (
                        <span className="ml-1.5 text-xs text-fg-faint">(vous)</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-fg-muted">+{player.roundScore}</td>
                    <td className="px-3 py-2 text-right font-semibold text-fg">{player.totalScore}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* The definition follows the grid; the two are read together. */}
          {selected && (
            <DefinitionCard className="hidden lg:block" word={selected} onClose={() => setSelected(null)} />
          )}
        </div>

        <div className="mt-5 space-y-5 lg:mt-0">
          {me && (
            <section className="rounded-2xl border border-border bg-panel p-4">
              <h2 className="mb-2 text-sm font-semibold tracking-wide text-fg-muted uppercase">
                Vos mots : {me.roundScore} pts
                {room.settings.duplicateMode === 'cancel' && (
                  <span className="ml-2 font-normal text-fg-faint normal-case">
                    (barrés = trouvés par un autre joueur)
                  </span>
                )}
              </h2>
              <PlayerWords player={me} highlight={highlightWord} />
            </section>
          )}

          {others.map((player) => (
            <details key={player.playerId} className="rounded-2xl border border-border bg-panel p-4">
              <summary className="cursor-pointer text-sm font-semibold tracking-wide text-fg-muted uppercase">
                {player.nickname} : {player.roundScore} pts ({player.words.length} mots)
              </summary>
              <div className="mt-3">
                <PlayerWords player={player} highlight={highlightWord} />
              </div>
            </details>
          ))}

          <SolutionPanel
            solution={results.solution}
            playerId={playerId}
            players={room.players}
            onHighlight={setHighlight}
            selected={selected}
            onSelect={setSelected}
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-bad-bg px-4 py-2 text-center text-sm text-bad">
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
              className="w-full rounded-xl bg-accent px-4 py-4 text-lg font-bold text-accent-fg transition hover:bg-accent-hover disabled:opacity-40"
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
                ? 'bg-accent text-accent-fg hover:bg-accent-hover'
                : 'border border-border-strong text-fg-muted hover:border-accent'
            }`}
          >
            Nouvelle partie
          </button>
        </div>
      ) : (
        <p className="rounded-xl bg-panel-soft px-4 py-4 text-center text-fg-muted">En attente de l’hôte…</p>
      )}

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
