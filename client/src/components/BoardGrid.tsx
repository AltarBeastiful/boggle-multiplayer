import { useRef, type PointerEvent as ReactPointerEvent } from 'react';

import { REVERSIBLE_LETTERS, dieOrientations, getNeighbours } from '@boggle/shared';

interface BoardGridProps {
  cells: string[];
  size: number;
  /** Path to highlight, as tile indices in order. */
  highlight?: number[];
  qEqualsQu?: boolean;
  compact?: boolean;
  /** Briefly animates the highlighted tiles, when a found word is traced. */
  animateHighlight?: boolean;
  /**
   * Marks the tiles lightly rather than fully. Used for the flick after a word
   * is accepted, which lasts a fifth of a second: at that length a strong fill
   * reads as a flash, where a light one reads as a confirmation. A path being
   * built, or one held under the cursor, keeps the full mark.
   */
  faintHighlight?: boolean;
  /** Shows the dice as they fell, each turned any of four ways. */
  rotated?: boolean;
  /**
   * What this throw was: the round number, the day. Two rounds that drew the
   * same letters are still two throws, and this is what tells them apart.
   */
  throwKey?: string | number;
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
  faintHighlight = false,
  rotated = false,
  throwKey = '',
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
   * How the dice came to rest. Derived from the letters themselves, so every
   * screen showing this grid shows the same throw without a word being said
   * about it over the network.
   */
  const turns = rotated ? dieOrientations(cells, throwKey) : null;
  // A word being built always gets the full mark, whatever the caller asked for.
  const faint = faintHighlight && path.length === 0;

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
        const turn = turns?.[index] ?? 0;
        /*
         * A turned M is a W, and a turned N is a Z. The underline gives the
         * letter a floor and settles the question, which is why it is shown on
         * every reversible letter and not only the ones that happen to be
         * lying down: an M with no underline would then mean "this one is the
         * right way up", and reading the grid would become a chain of
         * deductions instead of a glance.
         */
        const reversible = turns !== null && REVERSIBLE_LETTERS.has(letter);
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
                ? faint
                  ? 'bg-tile-trace text-tile-active-fg'
                  : 'bg-tile-active text-tile-active-fg ring-1 ring-tile-active-fg/15'
                : 'bg-tile text-tile-fg',
              active && animateHighlight ? 'animate-trace' : '',
            ].join(' ')}
          >
            <span
              className="relative inline-block leading-none"
              style={turn === 0 ? undefined : { transform: `rotate(${turn * 90}deg)` }}
            >
              {letter === 'Q' && qEqualsQu ? (
                <span>
                  Q<span className="text-[0.55em] lowercase opacity-70">u</span>
                </span>
              ) : (
                letter
              )}
              {/* Sized in em so it holds at any tile size, and placed by hand
                  just under the baseline: a border on the letter's own box
                  lands wherever the font's descender happens to be, which on a
                  turned die reads as a stray tick beside the letter rather
                  than as the ground under it. */}
              {reversible && (
                <span
                  aria-hidden="true"
                  data-floor
                  className="absolute inset-x-[-0.1em] bottom-[0.09em] h-[0.06em] rounded-full bg-current opacity-45"
                />
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
