import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

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
  /** Autorise le tracé au doigt ou à la souris. */
  traceable?: boolean;
  /** Chemin en cours de tracé, à chaque changement. */
  onTraceChange?(path: number[]): void;
  /** Chemin terminé, au relâchement. */
  onTraceEnd?(path: number[]): void;
}

export function BoardGrid({
  cells,
  size,
  highlight,
  qEqualsQu = false,
  compact = false,
  animateHighlight = false,
  traceable = false,
  onTraceChange,
  onTraceEnd,
}: BoardGridProps) {
  const [path, setPath] = useState<number[]>([]);
  /**
   * Le chemin fait foi ici, pas dans l'état : deux `pointermove` peuvent tomber
   * dans le même lot de rendu React, et le second lirait alors un `path` périmé
   *, une case perdue au milieu d'un tracé rapide.
   */
  const pathRef = useRef<number[]>([]);
  const tracing = useRef(false);
  const container = useRef<HTMLDivElement>(null);

  // Pendant un tracé, c'est lui qu'on montre ; sinon la mise en évidence reçue.
  const shown = tracing.current && path.length > 0 ? path : (highlight ?? []);
  const highlighted = new Set(shown);

  /**
   * La case sous le doigt. `elementFromPoint` est indispensable : dès le
   * premier contact le pointeur est capturé par la grille, donc les événements
   * suivants ne visent plus la case survolée.
   */
  const cellAt = (x: number, y: number): number | null => {
    const element = document.elementFromPoint(x, y)?.closest('[data-cell]');
    if (!element) return null;
    const index = Number(element.getAttribute('data-cell'));
    return Number.isInteger(index) ? index : null;
  };

  const update = (next: number[]) => {
    pathRef.current = next;
    setPath(next);
    onTraceChange?.(next);
  };

  const start = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!traceable) return;
    const index = cellAt(event.clientX, event.clientY);
    if (index === null) return;
    event.preventDefault();
    tracing.current = true;
    // La capture échoue si le pointeur n'est plus actif : ce n'est pas une
    // raison d'interrompre le tracé.
    try {
      container.current?.setPointerCapture(event.pointerId);
    } catch {
      /* sans capture, elementFromPoint suffit */
    }
    update([index]);
  };

  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!tracing.current) return;
    const index = cellAt(event.clientX, event.clientY);
    if (index === null) return;

    const current = pathRef.current;
    const last = current[current.length - 1];
    if (index === last) return;
    // Revenir sur l'avant-dernière case efface la dernière : on se corrige
    // sans relever le doigt.
    if (current.length >= 2 && index === current[current.length - 2]) {
      update(current.slice(0, -1));
      return;
    }
    if (current.includes(index)) return;
    if (last === undefined || !getNeighbours(size)[last]?.includes(index)) return;
    update([...current, index]);
  };

  const end = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!tracing.current) return;
    tracing.current = false;
    try {
      container.current?.releasePointerCapture(event.pointerId);
    } catch {
      /* déjà relâché */
    }
    // Une case seule est presque toujours un appui involontaire.
    const traced = pathRef.current;
    update([]);
    if (traced.length >= 2) onTraceEnd?.(traced);
  };

  return (
    <div
      ref={container}
      className={`grid w-full ${compact ? 'gap-1.5' : 'gap-2 sm:gap-3'}`}
      style={{
        gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))`,
        // Sans cela, le doigt fait défiler la page au lieu de tracer.
        touchAction: traceable ? 'none' : undefined,
      }}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
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
