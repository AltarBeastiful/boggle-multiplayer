import { useEffect, useMemo, useRef, useState } from 'react';

import type { PublicPlayer, SolutionWord } from '@boggle/shared';

import { DefinitionCard, prefetchDefinition } from './DefinitionCard';

type Filter = 'all' | 'missed' | 'mine';

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'Toutes' },
  { value: 'missed', label: 'Non trouvées' },
  { value: 'mine', label: 'Vos mots' },
];

/**
 * Colour of a word chip. The hue says who found it, and stays put when the
 * word is selected: selection is a step in intensity, not a fourth colour.
 * Among two hundred words it is what tells you which one the definition below
 * belongs to, and where to look back after scrolling.
 */
function tone(mine: boolean, byOthers: boolean, open: boolean): string {
  if (mine) return `font-semibold text-accent-fg ${open ? 'bg-accent-selected' : 'bg-accent'}`;
  if (byOthers) return `text-ok ${open ? 'bg-ok-bg-selected' : 'bg-ok-bg'}`;
  return open ? 'bg-chip-selected text-fg' : 'bg-chip text-fg-muted hover:bg-chip-hover';
}

interface SolutionPanelProps {
  solution: SolutionWord[];
  playerId: string;
  players: PublicPlayer[];
  onHighlight(path: number[]): void;
  /** Word whose definition is open, owned by the parent. */
  selected: string | null;
  onSelect(word: string | null): void;
  /** Played alone, as the grille du jour is: nobody else found anything. */
  solo?: boolean;
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
  solo = false,
}: SolutionPanelProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const hoverTimer = useRef<number | undefined>(undefined);
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardInView, setCardInView] = useState(true);

  /*
   * On a phone the definition appears under a list up to 400 px tall, so a
   * word tapped near the top opens a card below the fold. Going there by
   * itself turned out to be wrong twice over: half the time a word is tapped
   * only to see where it runs on the grid, and the card grows as the
   * definition lands, so the scroll chased a target that was still moving.
   * The card is announced instead, and the trip stays the reader's to take.
   */
  useEffect(() => {
    const card = cardRef.current;
    if (!selected || !card) {
      setCardInView(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) setCardInView(entry.isIntersecting);
    });
    observer.observe(card);
    return () => observer.disconnect();
  }, [selected]);

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
                'rounded-lg px-3 py-2 text-xs font-medium transition',
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
          {solo ? 'trouvé' : 'trouvé par vous'}
        </li>
        {/* Alone on the grille du jour, there is no other player to credit. */}
        {!solo && (
          <li>
            <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-ok align-middle" />
            trouvé par un autre joueur
          </li>
        )}
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
            {/* A wider gap than elsewhere: under a thumb, what separates two
                words matters as much as their own size. */}
            <div className="flex flex-wrap gap-2">
              {words.map((word) => {
                const mine = word.finders.includes(playerId);
                const byOthers = word.finders.length > 0 && !mine;
                const open = selected === word.word;
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
                    aria-expanded={open}
                    title={
                      solo
                        ? `${mine ? 'Trouvé' : 'Manqué'}. Cliquer pour la définition`
                        : who
                          ? `Trouvé par ${who}. Cliquer pour la définition`
                          : 'Personne ne l’a trouvé. Cliquer pour la définition'
                    }
                    className={['rounded-lg px-2.5 py-1.5 text-sm transition', tone(mine, byOthers, open)].join(
                      ' ',
                    )}
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
        <div ref={cardRef} className="lg:hidden">
          <DefinitionCard className="mt-3" word={selected} onClose={() => onSelect(null)} />
        </div>
      )}

      <p className="mt-3 text-xs text-fg-faint">
        Cliquez un mot pour le tracer sur la grille et lire sa définition.
      </p>

      {/* Only while the card is out of sight, and only on a narrow screen,
          where it is the one place the definition can be. */}
      {selected && !cardInView && (
        <button
          type="button"
          onClick={() => cardRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })}
          className="fixed bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full border border-border bg-panel/95 px-4 py-3 text-sm text-fg-muted shadow-lg backdrop-blur transition hover:text-fg lg:hidden"
        >
          Définition <span aria-hidden="true">↓</span>
        </button>
      )}
    </section>
  );
}
