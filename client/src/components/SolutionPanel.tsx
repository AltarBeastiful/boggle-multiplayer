import { useEffect, useMemo, useRef, useState } from 'react';

import type { PublicPlayer, SolutionWord } from '@boggle/shared';

import { DefinitionCard, prefetchDefinition } from './DefinitionCard';

type Filter = 'all' | 'missed' | 'mine';

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'Toutes' },
  { value: 'missed', label: 'Non trouvées' },
  { value: 'mine', label: 'Vos mots' },
];

interface SolutionPanelProps {
  solution: SolutionWord[];
  playerId: string;
  players: PublicPlayer[];
  onHighlight(path: number[]): void;
  /** Word whose definition is open, owned by the parent. */
  selected: string | null;
  onSelect(word: string | null): void;
}

/**
 * Every solution of the grid at the end of a round, marked by who found it.
 * Clicking a word highlights it on the grid.
 */
export function SolutionPanel({
  solution,
  playerId,
  players,
  onHighlight,
  selected,
  onSelect,
}: SolutionPanelProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const hoverTimer = useRef<number | undefined>(undefined);

  /**
   * Prefetch after a short pause, so running the eye down the list does not
   * fire one request per word crossed.
   */
  const prefetchSoon = (word: string) => {
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => prefetchDefinition(word), 130);
  };

  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  const names = useMemo(() => new Map(players.map((player) => [player.id, player.nickname])), [players]);

  const counts = useMemo(
    () => ({
      all: solution.length,
      missed: solution.filter((word) => word.finders.length === 0).length,
      mine: solution.filter((word) => word.finders.includes(playerId)).length,
    }),
    [solution, playerId],
  );

  /** Words stay grouped by length, which is how they get read. */
  const groups = useMemo(() => {
    const visible = solution.filter((word) => {
      if (filter === 'mine') return word.finders.includes(playerId);
      if (filter === 'missed') return word.finders.length === 0;
      return true;
    });
    const byLength = new Map<number, SolutionWord[]>();
    for (const word of visible) {
      const list = byLength.get(word.word.length);
      if (list) list.push(word);
      else byLength.set(word.word.length, [word]);
    }
    return [...byLength.entries()].sort((a, b) => b[0] - a[0]);
  }, [solution, filter, playerId]);

  return (
    <section className="rounded-2xl border border-border bg-panel p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-wide text-fg-muted uppercase">
          Solutions ({solution.length})
        </h2>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setFilter(option.value)}
              aria-pressed={filter === option.value}
              className={[
                'rounded-lg px-2.5 py-1.5 text-xs font-medium transition',
                filter === option.value
                  ? 'bg-accent text-accent-fg'
                  : 'bg-chip text-fg-muted hover:bg-chip-hover',
              ].join(' ')}
            >
              {option.label} ({counts[option.value]})
            </button>
          ))}
        </div>
      </div>

      <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-faint">
        <li>
          <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-accent align-middle" />
          trouvé par vous
        </li>
        <li>
          <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-ok align-middle" />
          trouvé par un autre joueur
        </li>
        <li>
          <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-chip-hover align-middle" />
          personne
        </li>
      </ul>

      {groups.length === 0 && <p className="text-sm text-fg-faint">Aucun mot dans cette catégorie.</p>}

      <div className="max-h-96 space-y-3 overflow-y-auto lg:max-h-none lg:overflow-visible">
        {groups.map(([length, words]) => (
          <div key={length}>
            <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-fg-faint uppercase">
              {length} lettres ({words.length})
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {words.map((word) => {
                const mine = word.finders.includes(playerId);
                const byOthers = word.finders.length > 0 && !mine;
                const who = word.finders
                  .map((id) => (id === playerId ? 'vous' : (names.get(id) ?? 'un joueur')))
                  .join(', ');
                return (
                  <button
                    key={word.word}
                    type="button"
                    onMouseEnter={() => {
                      onHighlight(word.path);
                      prefetchSoon(word.word);
                    }}
                    onFocus={() => {
                      onHighlight(word.path);
                      prefetchSoon(word.word);
                    }}
                    onClick={() => {
                      onHighlight(word.path);
                      onSelect(selected === word.word ? null : word.word);
                    }}
                    aria-expanded={selected === word.word}
                    title={
                      who
                        ? `Trouvé par ${who}. Cliquer pour la définition`
                        : 'Personne ne l’a trouvé. Cliquer pour la définition'
                    }
                    className={[
                      'rounded-lg px-2.5 py-1 text-sm transition',
                      mine
                        ? 'bg-accent font-semibold text-accent-fg'
                        : byOthers
                          ? 'bg-ok-bg text-ok'
                          : 'bg-chip text-fg-muted hover:bg-chip-hover',
                    ].join(' ')}
                  >
                    {word.word}
                    <span className="ml-1.5 text-xs opacity-70">{word.points}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* On a wide screen the definition shows beside the grid instead. */}
      {selected && (
        <DefinitionCard className="mt-3 lg:hidden" word={selected} onClose={() => onSelect(null)} />
      )}

      <p className="mt-3 text-xs text-fg-faint">
        Cliquez un mot pour le tracer sur la grille et lire sa définition.
      </p>
    </section>
  );
}
