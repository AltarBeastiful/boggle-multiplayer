import { useRef, type PointerEvent as ReactPointerEvent } from 'react';

import { getNeighbours } from '@boggle/shared';

interface BoardGridProps {
  cells: string[];
  size: number;
  /** Chemin à mettre en évidence (indices de cases, dans l'ordre). */
  highlight?: number[];
  qEqualsQu?: boolean;
  compact?: boolean;
  /** Anime brièvement les cases mises en évidence (tracé d'un mot trouvé). */
  animateHighlight?: boolean;
  /** Rend la grille cliquable : composition d'un mot au doigt ou à la souris. */
  interactive?: boolean;
  /** Chemin en cours de composition, tenu par le parent. */
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
  /** Dernière case atteinte par le pointeur, pour ne pas la rejouer au glissé. */
  const pressed = useRef<number | null>(null);
  const container = useRef<HTMLDivElement>(null);

  const shown = path.length > 0 ? path : (highlight ?? []);
  const highlighted = new Set(shown);

  /**
   * La case sous le doigt. `elementFromPoint` est indispensable : dès le premier
   * contact le pointeur est capturé par la grille, donc les événements suivants
   * ne visent plus la case survolée.
   */
  const cellAt = (x: number, y: number): number | null => {
    const element = document.elementFromPoint(x, y)?.closest('[data-cell]');
    if (!element) return null;
    const index = Number(element.getAttribute('data-cell'));
    return Number.isInteger(index) ? index : null;
  };

  /**
   * Prolonge le mot d'une case. La même règle sert à l'appui et au glissé, un
   * appui n'étant qu'un glissé d'une seule case. Le chemin survit au
   * relâchement, sinon la lettre tapée apparaîtrait puis disparaîtrait.
   */
  const extend = (current: number[], index: number): number[] | null => {
    if (current.length === 0) return [index];

    const last = current[current.length - 1];
    // Retoucher la dernière case l'enlève : la correction la plus naturelle.
    if (index === last) return current.slice(0, -1);
    // Revenir sur l'avant-dernière enlève la dernière, sans relever le doigt.
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
      /* sans capture, elementFromPoint suffit */
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
    // Le chemin reste affiché : c'est l'envoi du mot qui le remet à zéro.
    pressed.current = null;
    try {
      container.current?.releasePointerCapture(event.pointerId);
    } catch {
      /* déjà relâché */
    }
  };

  return (
    <div
      ref={container}
      className={`grid w-full ${compact ? 'gap-1.5' : 'gap-2 sm:gap-3'}`}
      style={{
        gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))`,
        // Sans cela, le doigt fait défiler la page au lieu de composer le mot.
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
              // Les jetons gardent leur teinte ivoire dans les deux thèmes :
              // c'est la couleur des dés, et elle reste lisible sur les deux fonds.
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
