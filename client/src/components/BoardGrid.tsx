interface BoardGridProps {
  cells: string[];
  size: number;
  /** Chemin à mettre en évidence (indices de cases, dans l'ordre). */
  highlight?: number[];
  qEqualsQu?: boolean;
  compact?: boolean;
  /** Anime brièvement les cases mises en évidence (tracé d'un mot trouvé). */
  animateHighlight?: boolean;
}

export function BoardGrid({
  cells,
  size,
  highlight,
  qEqualsQu = false,
  compact = false,
  animateHighlight = false,
}: BoardGridProps) {
  const highlighted = new Set(highlight ?? []);

  return (
    <div
      className={`grid w-full ${compact ? 'gap-1.5' : 'gap-2 sm:gap-3'}`}
      style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}
    >
      {cells.map((letter, index) => {
        const active = highlighted.has(index);
        return (
          <div
            key={index}
            className={[
              'relative flex aspect-square items-center justify-center rounded-xl font-bold uppercase',
              'shadow-[0_1px_3px_var(--tile-shadow)] transition-colors duration-150 select-none',
              compact ? 'text-lg sm:text-xl' : 'text-2xl sm:text-4xl',
              // Les jetons gardent leur teinte ivoire dans les deux thèmes :
              // c'est la couleur des dés, et elle reste lisible sur les deux fonds.
              active
                ? 'bg-tile-active text-tile-active-fg ring-2 ring-tile-active-fg/25'
                : 'bg-tile text-tile-fg',
              active && animateHighlight ? 'animate-trace' : '',
            ].join(' ')}
          >
            {letter === 'Q' && qEqualsQu ? (
              <span>
                Q<span className="text-[0.55em] lowercase opacity-70">u</span>
              </span>
            ) : (
              letter
            )}
          </div>
        );
      })}
    </div>
  );
}
