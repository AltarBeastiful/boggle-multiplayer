interface BoardGridProps {
  cells: string[];
  size: number;
  /** Chemin à mettre en évidence (indices de cases, dans l'ordre). */
  highlight?: number[];
  qEqualsQu?: boolean;
  compact?: boolean;
}

export function BoardGrid({ cells, size, highlight, qEqualsQu = false, compact = false }: BoardGridProps) {
  const highlighted = new Set(highlight ?? []);

  return (
    <div
      className={`grid w-full ${compact ? 'gap-1.5' : 'gap-2 sm:gap-3'}`}
      style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}
    >
      {cells.map((letter, index) => {
        const active = highlighted.has(index);
        const order = highlight?.indexOf(index) ?? -1;
        return (
          <div
            key={index}
            className={[
              'relative flex aspect-square items-center justify-center rounded-xl font-bold uppercase',
              'shadow-sm transition-colors duration-150 select-none',
              compact ? 'text-lg sm:text-xl' : 'text-2xl sm:text-4xl',
              active
                ? 'bg-amber-400 text-slate-900 ring-2 ring-amber-200'
                : 'bg-amber-50 text-slate-900',
            ].join(' ')}
          >
            {letter === 'Q' && qEqualsQu ? (
              <span>
                Q<span className="text-[0.55em] lowercase opacity-70">u</span>
              </span>
            ) : (
              letter
            )}
            {active && order >= 0 && (
              <span className="absolute top-0.5 left-1 text-[0.5em] font-semibold text-slate-900/60">
                {order + 1}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
