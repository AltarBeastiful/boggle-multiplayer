import { useRef, type PointerEvent as ReactPointerEvent } from 'react';

import { getNeighbours } from '@boggle/shared';

interface BoardGridProps {
  cells: string[];
  size: number;
  /** Path to highlight, as tile indices in order. */
  highlight?: number[];
  qEqualsQu?: boolean;
  compact?: boolean;
  /** Briefly animates the highlighted tiles, when a found word is traced. */
  animateHighlight?: boolean;
  /** Makes the grid clickable, so a word can be built by finger or mouse. */
  interactive?: boolean;
  /** Path being built, owned by the parent. */
  path?: number[];
  onPathChange?(path: number[]): void;
}

export function BoardGrid({
  cells,
  size,
  highlight,
  qEqualsQu = false,
  compact = false,
  animateHighlight = false,
  interactive = false,
  path = [],
  onPathChange,
}: BoardGridProps) {
  /** Last tile the pointer reached, so a drag does not replay it. */
  const pressed = useRef<number | null>(null);
  const container = useRef<HTMLDivElement>(null);

  const shown = path.length > 0 ? path : (highlight ?? []);
  const highlighted = new Set(shown);

  /**
   * The tile under the finger. `elementFromPoint` is essential: the grid
   * captures the pointer on first contact, so later events no longer target the
   * tile being crossed.
   */
  const cellAt = (x: number, y: number): number | null => {
    const element = document.elementFromPoint(x, y)?.closest('[data-cell]');
    if (!element) return null;
    const index = Number(element.getAttribute('data-cell'));
    return Number.isInteger(index) ? index : null;
  };

  /**
   * Extends the word by one tile. The same rule serves tap and drag, a tap
   * being a drag over a single tile. The path survives release, otherwise a
   * tapped letter would appear and vanish at once.
   */
  const extend = (current: number[], index: number): number[] | null => {
    if (current.length === 0) return [index];

    const last = current[current.length - 1];
    // Touching the last tile again removes it, the most natural correction.
    if (index === last) return current.slice(0, -1);
    // Going back to the one before removes the last, without lifting the finger.
    if (current.length >= 2 && index === current[current.length - 2]) return current.slice(0, -1);
    if (current.includes(index)) return null;
    if (last === undefined || !getNeighbours(size)[last]?.includes(index)) return null;
    return [...current, index];
  };

  const apply = (index: number) => {
    const next = extend(path, index);
    if (next) onPathChange?.(next);
  };

  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!interactive) return;
    const index = cellAt(event.clientX, event.clientY);
    if (index === null) return;
    event.preventDefault();
    try {
      container.current?.setPointerCapture(event.pointerId);
    } catch {
      /* without capture, elementFromPoint is enough */
    }
    pressed.current = index;
    apply(index);
  };

  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!interactive || pressed.current === null) return;
    const index = cellAt(event.clientX, event.clientY);
    if (index === null || index === pressed.current) return;
    pressed.current = index;
    apply(index);
  };

  const up = (event: ReactPointerEvent<HTMLDivElement>) => {
    // The path stays on screen; sending the word is what clears it.
    pressed.current = null;
    try {
      container.current?.releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }
  };

  return (
    <div
      ref={container}
      className={`grid w-full ${compact ? 'gap-1.5' : 'gap-2 sm:gap-3'}`}
      style={{
        gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))`,
        // Without this the finger scrolls the page instead of building the word.
        touchAction: interactive ? 'none' : undefined,
      }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      {cells.map((letter, index) => {
        const active = highlighted.has(index);
        return (
          <div
            key={index}
            data-cell={index}
            className={[
              'relative flex aspect-square items-center justify-center rounded-xl font-bold uppercase',
              'shadow-[0_1px_3px_var(--tile-shadow)] transition-colors duration-150 select-none',
              compact ? 'text-lg sm:text-xl' : 'text-2xl sm:text-4xl',
              interactive ? 'cursor-pointer' : '',
              // Tiles keep their ivory tone in both themes: it is the colour of
              // the dice, and it stays readable on either background.
              active
                ? 'bg-tile-active text-tile-active-fg ring-1 ring-tile-active-fg/15'
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
